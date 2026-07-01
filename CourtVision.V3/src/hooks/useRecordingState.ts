import { useCallback, useRef, useState } from "react";

import { raspberryPiService } from "../services/RaspberryPiService";
import type { RecordingState, SavedVideo } from "../types/recording";

type UseRecordingStateResult = {
  recordingState: RecordingState;
  recordingId: string | null;
  lastSavedVideo: SavedVideo | null;
  errorMessage: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
};

export function useRecordingState(): UseRecordingStateResult {
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [lastSavedVideo, setLastSavedVideo] = useState<SavedVideo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const stopInProgressRef = useRef(false);

  const startRecording = useCallback(async () => {
    if (recordingState === "recording" || recordingState === "saving") {
      setErrorMessage("A recording is already in progress.");
      return;
    }

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
  }, [recordingState]);

  const stopRecording = useCallback(async () => {
    if (stopInProgressRef.current) {
      setErrorMessage("Recording stop is already in progress.");
      return;
    }

    if (!recordingId) {
      setErrorMessage("No active recording ID is available.");
      return;
    }

    stopInProgressRef.current = true;
    setRecordingState("saving");
    setErrorMessage(null);

    const activeRecordingId = recordingId;

    try {
      const stopResponse = await raspberryPiService.stopRecording(activeRecordingId);
      const savedVideo = await raspberryPiService.downloadRecording(
        stopResponse.downloadUrl,
        stopResponse.filename,
        stopResponse.fileSize
      );

      if (!savedVideo.path || savedVideo.size <= 0) {
        throw new Error("The recording was saved locally, but the file is not playable.");
      }

      if (savedVideo.size !== stopResponse.fileSize) {
        throw new Error(
          `Downloaded recording size mismatch: expected ${stopResponse.fileSize} bytes, saved ${savedVideo.size} bytes.`
        );
      }

      setLastSavedVideo(savedVideo);
      setRecordingId(null);
      setRecordingState("idle");

      if (stopResponse.filename && savedVideo.path && savedVideo.size > 0) {
        try {
          await raspberryPiService.deleteRecordingFromPiAfterSuccessfulDownload(
            stopResponse.filename
          );
        } catch {
          // Phone copy is valid. Pi cleanup can be retried later.
        }
      }
    } catch (error) {
      setRecordingState("idle");
      setErrorMessage(error instanceof Error ? error.message : "Unable to stop recording.");
    } finally {
      stopInProgressRef.current = false;
    }
  }, [recordingId]);

  return {
    recordingState,
    recordingId,
    lastSavedVideo,
    errorMessage,
    startRecording,
    stopRecording
  };
}
