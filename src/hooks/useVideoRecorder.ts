import { CameraView, useCameraPermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { useCallback, useRef, useState } from 'react';

import { RecordingStatus } from '../types/video';

export function useVideoRecorder() {
  const cameraRef = useRef<CameraView | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>('idle');
  const [lastRecordingUri, setLastRecordingUri] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const requestPermissions = useCallback(async () => {
    const camera = cameraPermission?.granted
      ? cameraPermission
      : await requestCameraPermission();

    if (!camera.granted) {
      setErrorMessage('Camera permission is required to record video.');
    }

    return camera.granted;
  }, [cameraPermission, requestCameraPermission]);

  const startRecording = useCallback(async () => {
    if (recordingStatus === 'recording' || recordingStatus === 'saving') {
      return;
    }

    if (!cameraRef.current) {
      setErrorMessage('Camera is not ready yet.');
      return;
    }

    const hasPermissions = await requestPermissions();

    if (!hasPermissions) {
      setRecordingStatus('error');
      return;
    }

    try {
      setErrorMessage(null);
      setRecordingStatus('recording');

      const recording = await cameraRef.current.recordAsync();

      if (!recording?.uri) {
        throw new Error('No recording URI returned by camera.');
      }

      setRecordingStatus('saving');
      await MediaLibrary.saveToLibraryAsync(recording.uri);
      setLastRecordingUri(recording.uri);
      setRecordingStatus('saved');

      // TODO: Queue the saved video for computer vision, ML, and cloud processing.
    } catch (error) {
      setRecordingStatus('error');
      setErrorMessage('Unable to save the recording.');
      console.warn('[useVideoRecorder] Recording failed', error);
    }
  }, [recordingStatus, requestPermissions]);

  const stopRecording = useCallback(() => {
    if (recordingStatus !== 'recording') {
      return;
    }

    cameraRef.current?.stopRecording();
  }, [recordingStatus]);

  return {
    cameraRef,
    cameraPermission,
    recordingStatus,
    lastRecordingUri,
    errorMessage,
    requestPermissions,
    startRecording,
    stopRecording,
  };
}
