// src/tts/tts.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ElevenLabsClient } from 'elevenlabs';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiCallService } from '../gemini/geminiCall.service.js';

@Injectable()
@WebSocketGateway({
  cors: { origin: '*' }, // tighten in production
})
export class TtsGateway {
  @WebSocketServer()
  server!: Server;

  private elevenlabs;

  constructor(
    private readonly config: ConfigService,
    private readonly LLMCall: GeminiCallService,
  ) {
    const apiKey = config.get<string>('ELEVENLAB_API_KEY');
    this.elevenlabs = new ElevenLabsClient({ apiKey });
  }

  @SubscribeMessage('start-conversation')
  async handleConversation(
    @MessageBody() data: { message: string,runId: number },
    @ConnectedSocket() client: Socket,
  ) {
    const voiceId = 'cgSgspJ2msm6clMCkdW9';
    const modelId = 'eleven_flash_v2_5';

    try {
      const llmStream = await this.LLMCall.streamAi(data.message);

      let sentenceBuffer = '';
      let previousText = '';
      let sentenceIndex = 0;

      // TTS jobs run one after another (keeps audio in order)
      // while the LLM loop keeps reading tokens
      let ttsChain: Promise<void> = Promise.resolve();
      let ttsError: unknown = null;

      const enqueue = (sentence: string) => {
        const prev = previousText;
        const idx = sentenceIndex++;
        previousText += (previousText ? ' ' : '') + sentence;

        ttsChain = ttsChain
          .then(() => {
            if (ttsError) return; // stop after a failure
            return this.streamTTS(client, voiceId, modelId, sentence, prev, idx,data.runId);
          })
          .catch((e) => {
            ttsError = e;
          });
      };

      for await (const token of llmStream) {
        sentenceBuffer += token;

        // NOTE: no 'llm-token' emit anymore

        if (/[.!?]\s*$/.test(sentenceBuffer) || sentenceBuffer.length > 120) {
          enqueue(sentenceBuffer.trim());
          sentenceBuffer = '';
        }
      }

      if (sentenceBuffer.trim()) enqueue(sentenceBuffer.trim());

      await ttsChain;
      if (ttsError) throw ttsError;

      client.emit('done',{runId:data.runId});
    } catch (err) {
      console.error(err);
      client.emit('error', {
        message: err instanceof Error ? err.message : 'Unknown error',
        runId:data.runId
      });
    }
  }

  private async streamTTS(
    client: Socket,
    voiceId: string,
    modelId: string,
    text: string,
    previousText: string,
    sentenceIndex: number,
    runId:number,
  ) {
    const stream = await this.elevenlabs.textToSpeech.streamWithTimestamps(
      voiceId,
      {
        text,
        model_id: modelId,
        output_format: 'pcm_24000',
        previous_text: previousText,
      },
    );

    for await (const chunk of stream) {
      if (chunk.audio_base64) {
        client.emit('tts-chunk', {
          audio: chunk.audio_base64,
          alignment: chunk.alignment || chunk.normalized_alignment,
          sentenceIndex, // new: the client uses this to add spaces between sentences
          runId,
        });
      }
    }
  }
}