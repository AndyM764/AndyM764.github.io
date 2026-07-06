import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { useCallback, useRef, useState } from 'react';

import { RecordingStatus } from '../types/video';

export function useVideoRecorder() {
  const cameraRef = useRef<CameraView | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();
  const [mediaLibraryPermission, requestMediaLibraryPermission] = MediaLibrary.usePermissions();
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>('idle');
  const [lastRecordingUri, setLastRecordingUri] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const requestPermissions = useCallback(async () => {
    const camera = cameraPermission?.granted
      ? cameraPermission
      : await requestCameraPermission();
    const microphone = microphonePermission?.granted
      ? microphonePermission
      : await requestMicrophonePermission();
    const mediaLibrary = mediaLibraryPermission?.granted
      ? mediaLibraryPermission
      : await requestMediaLibraryPermission();

    const hasAllPermissions = camera.granted && microphone.granted && mediaLibrary.granted;

    if (!hasAllPermissions) {
      setErrorMessage('Camera, microphone, and gallery permissions are required.');
    }

    return hasAllPermissions;
  }, [
    cameraPermission,
    mediaLibraryPermission,
    microphonePermission,
    requestCameraPermission,
    requestMediaLibraryPermission,
    requestMicrophonePermission,
  ]);

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
    microphonePermission,
    mediaLibraryPermission,
    recordingStatus,
    lastRecordingUri,
    errorMessage,
    requestPermissions,
    startRecording,
    stopRecording,
  };
}
