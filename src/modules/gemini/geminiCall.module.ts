import { Global, Module } from '@nestjs/common';
import { GeminiCallService } from './geminiCall.service.js';
import { GeminiCallController } from './geminiCall.controller.js';
import { GeminiTranscribeService } from './gemini-transcript.service.js';

@Global()
@Module({
  providers: [GeminiCallService,GeminiTranscribeService],
  exports: [GeminiCallService,GeminiTranscribeService],
  controllers: [GeminiCallController],
})
export class geminiCallModule {}
