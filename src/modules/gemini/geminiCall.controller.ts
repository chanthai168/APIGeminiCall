import { Body, Controller, Logger, Post, Res, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { PromptDTO } from './dto/prompt.dto.js';
import { GeminiCallService } from './geminiCall.service.js';
import { LoggingInterceptor } from '../../common/interceptors/Logging.interceptor.js';
import { GeminiTranscribeService } from './gemini-transcribe.service.js';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { UploadedFile } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { TranscriptionConfigOptionsDto } from './dto/transcription-option-config.dto.js';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

const uploadDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../uploads',
);

@UseInterceptors(LoggingInterceptor)
@Controller('gemini')
export class GeminiCallController {
  private readonly logger = new Logger(GeminiCallController.name);

  constructor(private readonly ai: GeminiCallService,private readonly transcribeService:GeminiTranscribeService ) {}

  @Post('audio')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: uploadDirectory,
        filename: (req, file, callback) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          callback(null, `${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
    }),
  )
  async uploadAndTranscribe(
    @UploadedFile() file: Express.Multer.File,
    @Body('config') config: unknown,
  ) {
    if (!file) {
      throw new BadRequestException('Audio file is required');
    }

    const transcriptionConfig = await this.parseTranscriptionConfig(config);

    // 2. Clean up: Delete the local file after processing to save disk space
    // await fs.unlink(file.path).catch(() => {});
    return this.transcribeService.transcribe({
      filePath: file.path,
      originalPath: file.originalname,
      mimeType: file.mimetype,
      transcriptionConfig,
    });
  }

  private async parseTranscriptionConfig(
    config: unknown,
  ): Promise<TranscriptionConfigOptionsDto | undefined> {
    if (config === undefined || config === '') {
      return undefined;
    }

    let parsedConfig: unknown = config;
    if (typeof config === 'string') {
      try {
        parsedConfig = JSON.parse(config);
      } catch {
        throw new BadRequestException('"config" must contain valid JSON');
      }
    }

    if (
      parsedConfig === null ||
      typeof parsedConfig !== 'object' ||
      Array.isArray(parsedConfig)
    ) {
      throw new BadRequestException('"config" must be a JSON object');
    }

    const transcriptionConfig = plainToInstance(
      TranscriptionConfigOptionsDto,
      parsedConfig,
    );
    const errors = await validate(transcriptionConfig, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Invalid transcription config',
        errors,
      });
    }

    return transcriptionConfig;
  }

  @Post('stream')
  async streamAI(@Body() dto: PromptDTO, @Res() res: Response) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      for await (const chunk of this.ai.streamAiMock(dto.prompt)) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      } 
    } catch (error) {
      this.logger.error(
        'Gemini streaming request failed',
        this.formatErrorChain(error),
      );
      res.write(
        `event: error\ndata: ${JSON.stringify('Gemini request failed.')}\n\n`,
      );
    } finally {
      res.end();
    }
  }

  private formatErrorChain(error: unknown): string {
    const details: string[] = [];
    const seen = new Set<unknown>();
    let current: unknown = error;

    while (current && !seen.has(current)) {
      seen.add(current);
      if (current instanceof Error) {
        details.push(current.stack ?? `${current.name}: ${current.message}`);
        current = current.cause;
      } else {
        details.push(String(current));
        break;
      }
    }

    return details.join('\nCaused by: ');
  }
}