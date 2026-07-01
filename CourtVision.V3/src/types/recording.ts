export type RecordingState = "idle" | "recording" | "saving";

export type StartRecordingResponse = {
  success: boolean;
  recordingId: string;
  filename?: string;
  processesRunning?: boolean;
  message?: string;
};

export type StopRecordingResponse = {
  success: boolean;
  recordingId: string;
  downloadUrl: string;
  filename?: string;
  fileSize?: number;
  message?: string;
};

export type SavedVideo = {
  path: string;
  filename: string;
  size: number;
};
