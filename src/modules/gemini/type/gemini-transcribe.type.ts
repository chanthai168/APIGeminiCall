
export interface TranscriptionModeConfig {
  type?: 'verbatim';
  timestamp_granularities?: ('word')[];
  diarization_mode?: 'speaker';
}

// if chosing smart than timstamp and diarization must disable 
export interface TranscriptionConfigOptions {
  language_codes?: string[];
  custom_vocabulary?: string[];
  mode?: 'smart' | TranscriptionModeConfig;
}

export interface TranscribeOptions {
  filePath: string;
  mimeType: string;
  transcriptionConfig?: TranscriptionConfigOptions;
}

export interface WordAnnotation {
  type: string;
  text: string;
  speaker?: string;
  start_offset?: string;
  end_offset?: string;
}

export interface TranscribeResult {
  outputText: string;
  words?: WordAnnotation[];
}