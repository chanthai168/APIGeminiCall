// src/tts/tts.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiCallService } from '../gemini/geminiCall.service.js';
import { GeminiTranscribeService } from '../gemini/gemini-transcript.service.js';
import Cartesia from '@cartesia/cartesia-js';
import { WriteStream,createWriteStream } from 'node:fs';

@Injectable()
@WebSocketGateway({
  cors: { origin: '*' }, // tighten in production
})
export class TtsGateway {
  @WebSocketServer()
  server!: Server;

  private cartesia: Cartesia;
  private activeStreams = new Map<string, WriteStream>();

  constructor(
    private readonly config: ConfigService,
    private readonly LLMCall: GeminiCallService,
    private readonly geminiTranscript:GeminiTranscribeService,
  ) {
    const apiKey = this.config.get<string>('CARTESIA_API_KEY');
    this.cartesia = new Cartesia({ apiKey });
  }

  @SubscribeMessage('start-conversation')
  async handleConversation(
    @MessageBody() data: { message: string; runId: number },
    @ConnectedSocket() client: Socket,
  ) {

    const voiceId = 'a33f7a4c-100f-41cf-a1fd-5822e8fc253f'; 
    const modelId = 'sonic-3.6'; // or 'sonic-latest'

    try {
      const llmStream = await this.LLMCall.streamAi(data.message);

      let sentenceBuffer = '';
      let sentenceIndex = 0;

      // Keep TTS jobs sequential so audio order is preserved
      let ttsChain: Promise<void> = Promise.resolve();
      let ttsError: unknown = null;

      const enqueue = (sentence: string) => {
        const idx = sentenceIndex++;

        ttsChain = ttsChain
          .then(() => {
            if (ttsError) return;
            return this.streamTTS(client, voiceId, modelId, sentence, idx, data.runId);
          })
          .catch((e) => {
            ttsError = e;
          });
      };

      for await (const token of llmStream) {
        sentenceBuffer += token;

        if (/[.!?]\s*$/.test(sentenceBuffer) || sentenceBuffer.length > 120) {
          enqueue(sentenceBuffer.trim());
          sentenceBuffer = '';
        }
      }

      if (sentenceBuffer.trim()) {
        enqueue(sentenceBuffer.trim());
      }

      await ttsChain;
      if (ttsError) throw ttsError;

      client.emit('done', { runId: data.runId });
    } catch (err) {
      console.error(err);
      client.emit('error', {
        message: err instanceof Error ? err.message : 'Unknown error',
        runId: data.runId,
      });
    }
  }

  private async streamTTS(
    client: Socket,
    voiceId: string,
    modelId: string,
    text: string,
    sentenceIndex: number,
    runId: number,
    ) {
    const ws = await this.cartesia.tts.websocket();

    try {
        const ctx = ws.context({
        model_id: modelId,
        voice: voiceId,
        language: 'en',
        output_format: {
            container: 'raw',
            encoding: 'pcm_s16le',
            sample_rate: 24000,
        },
        add_timestamps: true, // important
        });

        await ctx.push({ transcript: text });
        await ctx.no_more_inputs();

        for await (const event of ctx.receive()) {
        if (event.type === 'chunk' && event.audio) {
            // event.audio is already a Buffer
            const base64Audio = Buffer.from(event.audio).toString('base64');

            client.emit('tts-chunk-catesia', {
            audio: base64Audio,
            alignment: null,          // timestamps come in a different event
            sentenceIndex,
            runId,
            });
        }

        // Timestamps come as a separate event
        if (event.type === 'timestamps' && (event as any).word_timestamps) {
            client.emit('tts-timestamps', {
            alignment: (event as any).word_timestamps,
            sentenceIndex,
            runId,
            });
        }

        if (event.type === 'error') {
            throw new Error(
            (event as any).message || (event as any).title || 'Cartesia TTS error',
            );
        }
        }
    } finally {
        ws.close();
    }
  }

  // Automatically call by NestJS when connection acomplished 
  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  // Automatically call by NestJs when connection close
  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    this.geminiTranscript.close();
    this.cleanup(client.id);
  }

  private cleanup(clientId: string) {
    const stream = this.activeStreams.get(clientId);
    if (stream) {
      stream.end();
      this.activeStreams.delete(clientId);
    }
  }

  @SubscribeMessage('start-recording')
  handleStartRecording(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {

    // 1 Initialize the upstream connection to google when start recording 
    // Pass the call back function that handle return text
    //------------------------
    try{
      this.geminiTranscript.connectToGemini(client.id,async (e)=>{
        switch(e.type){
          case 'interim':
            client.emit('transcript-interim', { text: e.text });
            break;

          case 'final':
          client.emit('transcript-final', { text: e.text });
          console.log(e.text);
          // this is the right place to feed your LLM -> TTS pipeline:
          // await this.handleConversation({ message: e.text, runId }, client);
          break;

          case 'speech-start':
          case 'speech-end':
            client.emit(e.type, {});
            break;
          }
      })
    }
    catch(error){
      client.emit('error', { message: 'Failed to connect to Gemini' });
    }

  }

  @SubscribeMessage('audio-chunk')
  handleAudioChunk(
    @ConnectedSocket() client: Socket,
    @MessageBody() chunk: Buffer, // Socket.IO automatically converts ArrayBuffer → Buffer
  ) {

    // 1 wrap and send chunk to Gemini Transcript websocket service
    this.geminiTranscript.sendAudioChunk(chunk);

    // 2 write voice chunk to disk 
  }

  @SubscribeMessage('stop-recording')
  handleStopRecording(@ConnectedSocket() client: Socket) {
    this.cleanup(client.id);
    client.emit('recording-stopped');
    console.log(`Stopped recording for ${client.id}`);
  }

}