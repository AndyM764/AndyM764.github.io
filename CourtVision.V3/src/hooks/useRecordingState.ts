import { useCallback, useState } from "react";

import { raspberryPiService } from "../services/RaspberryPiService";
import type { RecordingState } from "../types/recording";

type UseRecordingStateResult = {
  recordingState: RecordingState;
  recordingId: string | null;
  lastSavedVideoPath: string | null;
  errorMessage: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
};

export function useRecordingState(): UseRecordingStateResult {
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [lastSavedVideoPath, setLastSavedVideoPath] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const startRecording = useCallback(async () => {
    setErrorMessage(null);

    try {
      const response = await raspberryPiService.startRecording();
      setRecordingId(response.recordingId);
      setRecordingState("recording");
    } catch (error) {
      setRecordingState("idle");
      setRecordingId(null);
      setErrorMessage(error instanceof Error ? error.message : "Unable to start recording.");
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (!recordingId) {
      setErrorMessage("No active recording ID is available.");
      return;
    }

    setRecordingState("saving");
    setErrorMessage(null);

    try {
      const stopResponse = await raspberryPiService.stopRecording(recordingId);
      const savedVideo = await raspberryPiService.downloadRecording(
        stopResponse.downloadUrl,
        stopResponse.filename
      );

      setLastSavedVideoPath(savedVideo.path);
      setRecordingId(null);
      setRecordingState("idle");
    } catch (error) {
      setRecordingState("idle");
      setErrorMessage(error instanceof Error ? error.message : "Unable to stop recording.");
    }
  }, [recordingId]);

  return {
    recordingState,
    recordingId,
    lastSavedVideoPath,
    errorMessage,
    startRecording,
    stopRecording
  };
}
