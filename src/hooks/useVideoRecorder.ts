import { useCallback, useState } from 'react';

import { raspberryPiService } from '../services/RaspberryPiService';
import { RecordingStatus } from '../types/video';

export function useVideoRecorder() {
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>('idle');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const startRecording = useCallback(async () => {
    if (recordingStatus === 'starting' || recordingStatus === 'recording' || recordingStatus === 'stopping') {
      return;
    }

    try {
      setErrorMessage(null);
      setSuccessMessage(null);
      setRecordingStatus('starting');

      await raspberryPiService.startRecording();

      setRecordingStatus('recording');
      setSuccessMessage('Raspberry Pi recording started.');
    } catch (error) {
      setRecordingStatus('error');
      setSuccessMessage(null);
      setErrorMessage('Unable to reach Raspberry Pi. Recording was not started.');
      console.warn('[useVideoRecorder] Raspberry Pi start recording failed', error);
    }
  }, [recordingStatus]);

  const stopRecording = useCallback(async () => {
    if (recordingStatus !== 'recording') {
      return;
    }

    try {
      setErrorMessage(null);
      setSuccessMessage(null);
      setRecordingStatus('stopping');

      await raspberryPiService.stopRecording();

      setRecordingStatus('idle');
      setSuccessMessage('Raspberry Pi recording stopped. Video remains stored on the Raspberry Pi.');
    } catch (error) {
      setRecordingStatus('recording');
      setSuccessMessage(null);
      setErrorMessage('Unable to reach Raspberry Pi. Recording may still be active.');
      console.warn('[useVideoRecorder] Raspberry Pi stop recording failed', error);
    }
  }, [recordingStatus]);

  return {
    recordingStatus,
    successMessage,
    errorMessage,
    startRecording,
    stopRecording,
  };
}
