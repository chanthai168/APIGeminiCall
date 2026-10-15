import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { TranscribeOptions, TranscribeResult, WordAnnotation } from './type/gemini-transcribe.type.js'
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GeminiTranscribeService {
  private readonly logger = new Logger(GeminiTranscribeService.name);
  private ai: GoogleGenAI;
  private model:string;

  constructor(private readonly configService:ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
    this.model = this.configService.get<string>('GEMINI_3_5_TRANSCRIBE') || 'gemini-3.5-transcribe';
    this.ai = new GoogleGenAI({ apiKey });
  }

  async transcribe(options: TranscribeOptions): Promise<TranscribeResult> {
    const { filePath, mimeType, transcriptionConfig } = options;

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

      if (transcriptionConfig.language_codes) {
        generationConfig.transcription_config.language_codes = transcriptionConfig.language_codes;
      }

      if (transcriptionConfig.custom_vocabulary) {
        generationConfig.transcription_config.custom_vocabulary = transcriptionConfig.custom_vocabulary;
      }

      if (transcriptionConfig.mode) {
        generationConfig.transcription_config.mode = transcriptionConfig.mode;
      }
    }

    this.logger.log(`Sending request to gemini-3.5-transcribe with model options... ${generationConfig}`);

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

    const outputText = interaction.output_text ?? '';
    const words = this.extractWordAnnotations(interaction);

    return {
      outputText,
      ...(words.length > 0 && { words }),
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
}