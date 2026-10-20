import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import {  TranscribeOptions, 
          TranscribeResult, 
          TranscriptResult,
          TranscriptSegment,
          WordAnnotation } from './type/gemini-transcribe.type.js'
import { ConfigService } from '@nestjs/config';
import type { Prisma, Transcribe } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class GeminiTranscribeService {
  private readonly logger = new Logger(GeminiTranscribeService.name);
  private ai: GoogleGenAI;
  private model:string;

  constructor(private readonly configService:ConfigService,
              private readonly prismaService: PrismaService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
    this.model = this.configService.get<string>('GEMINI_3_5_TRANSCRIBE') || 'gemini-3.5-transcribe';
    this.ai = new GoogleGenAI({ apiKey });
  }

  async transcribe(options: TranscribeOptions): Promise<TranscribeResult> {

    const { filePath,originalPath, mimeType, transcriptionConfig } = options;

    this.logger.log(`Uploading audio file: ${filePath} (${mimeType})`);
    
    // 1. Upload the audio file using the Files API
    const audioFile = await this.ai.files.upload({
      file: filePath,
      config: { mimeType: mimeType },
    });

    // 2. Build generation_config dynamically based on user options
    const generationConfig: Record<string, any> = {};

    if (transcriptionConfig) {
      generationConfig.transcription_config = {};

      this.logger.log('has language_codes?', !!transcriptionConfig.language_codes, transcriptionConfig.language_codes);
      if (transcriptionConfig.language_codes) {
        generationConfig.transcription_config.language_codes = transcriptionConfig.language_codes;
      }

      this.logger.log('has custom_vocabulary?', !!transcriptionConfig.custom_vocabulary, transcriptionConfig.custom_vocabulary);
      if (transcriptionConfig.custom_vocabulary) {
        generationConfig.transcription_config.custom_vocabulary = transcriptionConfig.custom_vocabulary;
      }

      this.logger.log('has mode?', !!transcriptionConfig.mode, transcriptionConfig.mode);
      if (transcriptionConfig.mode) {
        generationConfig.transcription_config.mode = transcriptionConfig.mode;
      }
    }

    this.logger.log(`Sending request to gemini-3.5-transcribe with model options... `);


    // 3. Call the Interactions API with gemini-3.5-transcribe
    const interaction = await this.ai.interactions.create({
      model: this.model,
      input: [
        {
          type: 'audio',
          uri: audioFile.uri,
          mime_type: audioFile.mimeType,
        },
      ],
      ...(Object.keys(generationConfig).length > 0 && { generation_config: generationConfig }),
    });
    this.logger.log(interaction);
    const outputText = interaction.output_text ?? '';
    const words = this.extractWordAnnotations(interaction);

    // Build the structured format
    const structured = this.buildStructuredTranscript(words, {
      sourceFile: options.originalPath.split('/').pop() || options.filePath,
      // durationSeconds: 12.5,               // optional – will auto-calculate from last word
      languageDetected: options.transcriptionConfig?.language_codes?.join('-') ?? 'km-en',
    });

    this.logger.log('Structured transcript:');
    this.logger.log(JSON.stringify(structured, null, 2));

    // save result to database
    const transcribeData:Prisma.TranscribeCreateInput =  {
      audio_name:originalPath,
      transcription:outputText,
      url:filePath,
      transcription_json:structured as unknown as Prisma.InputJsonValue,
    }

    await this.prismaService.transcribe.create({data:transcribeData});
    
    return {
      outputText,
      ...(words.length > 0 && { words }),
      structured,
    };
  }

  private extractWordAnnotations(interaction: any): WordAnnotation[] {
    const words: WordAnnotation[] = [];
    for (const step of interaction.steps ?? []) {
      for (const content of step.content ?? []) {
        for (const annotation of content.annotations ?? []) {
          if (annotation.type === 'word_info') {
            words.push({
              type: annotation.type,
              text: annotation.text,
              speaker: annotation.speaker,
              start_offset: annotation.start_offset,
              end_offset: annotation.end_offset,
            });
          }
        }
      }
    }
    return words;
  }

  async deleteFile (){
    try {
      this.ai.files.delete({name:'mynamge'})
    }
    catch(error){
      this.logger.log(`Delete file: ${error}`);
    }
  }

  /**
   * Build the structured JSON from the raw word annotations
   */
  private buildStructuredTranscript(
    words: WordAnnotation[],
    options: {
      sourceFile: string;
      durationSeconds?: number;
      languageDetected?: string;
    },
  ): TranscriptResult {
    const parsedWords = words.map((w) => ({
      text: (w.text ?? '').trim(),
      speaker: this.normalizeSpeaker(w.speaker),
      start: this.parseOffset(w.start_offset),
      end: this.parseOffset(w.end_offset),
    }));

    // Group consecutive words by speaker → segments
    const segments: TranscriptSegment[] = [];
    let current: TranscriptSegment | null = null;

    for (const w of parsedWords) {
      if (!current || current.speaker !== w.speaker) {
        if (current) segments.push(current);

        current = {
          speaker: w.speaker,
          start: w.start,
          end: w.end,
          text: w.text,
          language: this.detectLanguage(w.text, options.languageDetected),
          words: [{ word: w.text, start: w.start, end: w.end }],
        };
      } else {
        current.end = w.end;
        current.text += (current.text ? ' ' : '') + w.text;
        current.words.push({ word: w.text, start: w.start, end: w.end });
      }
    }
    if (current) segments.push(current);

    const duration =
      options.durationSeconds ??
      (segments.length > 0 ? Math.max(...segments.map((s) => s.end)) : 0);

    return {
      metadata: {
        source_file: options.sourceFile,
        duration_seconds: Number(duration.toFixed(2)),
        language_detected: options.languageDetected ?? 'unknown',
      },
      transcript_segments: segments,
    };
  }

  // ---------- helpers ----------

  private parseOffset(offset?: string | number): number {
    if (typeof offset === 'number') return offset;
    if (!offset) return 0;
    const num = parseFloat(String(offset).replace(/s$/i, ''));
    return isNaN(num) ? 0 : Number(num.toFixed(2));
  }

  private normalizeSpeaker(raw?: string): string {
    if (!raw) return 'speaker_1';
    const match = raw.match(/(\d+)/);
    if (!match) return raw;
    // "spk_1" → speaker_1 | "spk:0" → speaker_1
    const num = Number(match[1]);
    return raw.includes(':') ? `speaker_${num + 1}` : `speaker_${num}`;
  }

  private detectLanguage(text: string, fallback?: string): string {
    const hasKhmer = /[\u1780-\u17FF]/.test(text);
    const hasLatin = /[a-zA-Z]/.test(text);
    if (hasKhmer && hasLatin) return 'mixed';
    if (hasKhmer) return 'km';
    if (hasLatin) return 'en';
    return fallback ?? 'unknown';
  }
}