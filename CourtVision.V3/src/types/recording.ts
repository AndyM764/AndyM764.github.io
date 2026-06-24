export type RecordingState = "idle" | "recording" | "saving";

export type StartRecordingResponse = {
  success: boolean;
  recordingId: string;
  message?: string;
};

export type StopRecordingResponse = {
  success: boolean;
  recordingId: string;
  downloadUrl: string;
  filename?: string;
  message?: string;
};

export type SavedVideo = {
  path: string;
};
