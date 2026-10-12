import { Module } from '@nestjs/common';
import { TtsGateway } from './tts.gateway.js';
import { TtsGateway as TtsCateciaGateway } from './tts-catecia.gateway.js';

@Module({
  providers: [TtsCateciaGateway],
})
export class TtsModule {}