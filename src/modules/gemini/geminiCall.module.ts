import { Global, Module } from '@nestjs/common';
import { GeminiCallService } from './geminiCall.service.js';
import { GeminiCallController } from './geminiCall.controller.js';
import { GeminiTranscribeServiceLive } from './gemini-transcribe-live.service.js';
import { GeminiTranscribeService } from './gemini-transcribe.service.js';

@Global()
@Module({
  providers: [GeminiCallService,GeminiTranscribeServiceLive,GeminiTranscribeService],
  exports: [GeminiCallService,GeminiTranscribeServiceLive],
  controllers: [GeminiCallController],
})
export class geminiCallModule {}
