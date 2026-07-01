export type RecordingState = "idle" | "recording" | "saving";

export type StartRecordingResponse = {
  success: boolean;
  recordingId: string;
  filename?: string;
  processesRunning?: boolean;
  message?: string;
};

export type RecordingValidation = {
  fileExists: boolean;
  fileSize: number;
  ffprobeAvailable: boolean;
  duration?: number | null;
  validVideoStream?: boolean | null;
  passed: boolean;
  warning?: string;
};

export type StopRecordingResponse = {
  success: boolean;
  recordingId: string;
  downloadUrl: string;
  filename?: string;
  fileSize: number;
  recordingDurationSeconds?: number;
  validation?: RecordingValidation;
  message?: string;
};

export type SavedVideo = {
  path: string;
  filename: string;
  size: number;
};
