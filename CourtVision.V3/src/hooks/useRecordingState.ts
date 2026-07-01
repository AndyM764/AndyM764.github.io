import { useCallback, useEffect, useRef, useState } from "react";

import { raspberryPiService } from "../services/RaspberryPiService";
import type { RecordingState, SavedVideo, StopRecordingResponse } from "../types/recording";

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
  const recoveryAttemptedRef = useRef(false);
  const pendingFinalizeRef = useRef<StopRecordingResponse | null>(null);

  useEffect(() => {
    if (recoveryAttemptedRef.current) {
      return;
    }

    recoveryAttemptedRef.current = true;

    void (async () => {
      try {
        const activeRecording = await raspberryPiService.recoverActiveRecordingFromStatus();
        if (!activeRecording) {
          return;
        }

        setRecordingId(activeRecording.recordingId);
        setRecordingState("recording");
        setErrorMessage(null);
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to recover recording state from Pi."
        );
      }
    })();
  }, []);

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

    const pendingFinalize = pendingFinalizeRef.current;
    if (!recordingId && !pendingFinalize) {
      setErrorMessage("No active recording ID is available.");
      return;
    }

    stopInProgressRef.current = true;
    setRecordingState("saving");
    setErrorMessage(null);

    const activeRecordingId = recordingId ?? pendingFinalize?.recordingId ?? null;

    try {
      const stopResponse =
        pendingFinalize ?? (await raspberryPiService.stopRecording(activeRecordingId!));
      pendingFinalizeRef.current = stopResponse;

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
      pendingFinalizeRef.current = null;
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
      setRecordingState(pendingFinalizeRef.current ? "saving" : recordingId ? "recording" : "idle");
      const baseMessage = error instanceof Error ? error.message : "Unable to stop recording.";
      setErrorMessage(
        `${baseMessage} The recording file remains on the Raspberry Pi and can be retried.`
      );
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
