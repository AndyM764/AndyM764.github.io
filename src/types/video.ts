export type RecordingStatus = 'idle' | 'recording' | 'saving' | 'saved' | 'error';

export interface RecordingResult {
  uri: string;
}
