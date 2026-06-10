import { CameraView } from 'expo-camera';
import { StyleSheet, Text, View } from 'react-native';

import { useVideoRecorder } from '../hooks/useVideoRecorder';
import { RecordingStatus } from '../types/video';
import { PrimaryButton } from './PrimaryButton';
import { SectionCard } from './SectionCard';
import { StatusBadge } from './StatusBadge';

function getStatusLabel(status: RecordingStatus) {
  switch (status) {
    case 'recording':
      return 'Recording';
    case 'saving':
      return 'Saving';
    case 'saved':
      return 'Saved';
    case 'error':
      return 'Error';
    case 'idle':
    default:
      return 'Idle';
  }
}

function getStatusVariant(status: RecordingStatus) {
  switch (status) {
    case 'recording':
      return 'danger';
    case 'saving':
      return 'warning';
    case 'saved':
      return 'success';
    case 'error':
      return 'danger';
    case 'idle':
    default:
      return 'neutral';
  }
}

export function VideoRecorderPanel() {
  const {
    cameraRef,
    cameraPermission,
    recordingStatus,
    lastRecordingUri,
    errorMessage,
    requestPermissions,
    startRecording,
    stopRecording,
  } = useVideoRecorder();

  const hasCameraPermission = cameraPermission?.granted === true;
  const isRecording = recordingStatus === 'recording';
  const isBusy = recordingStatus === 'recording' || recordingStatus === 'saving';

  return (
    <SectionCard
      title="Video Recording"
      subtitle="Record practice clips with Expo Camera and save them to the phone gallery."
    >
      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Recording status</Text>
        <StatusBadge label={getStatusLabel(recordingStatus)} status={getStatusVariant(recordingStatus)} />
      </View>

      {hasCameraPermission ? (
        <CameraView ref={cameraRef} facing="back" mode="video" mute style={styles.cameraPreview} />
      ) : (
        <View style={styles.permissionBox}>
          <Text style={styles.permissionTitle}>Camera permission required</Text>
          <Text style={styles.permissionText}>
            Grant camera permission to record video-only tennis sessions.
          </Text>
          <PrimaryButton label="Grant Camera Permission" onPress={requestPermissions} />
        </View>
      )}

      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

      <View style={styles.buttonRow}>
        <PrimaryButton
          disabled={!hasCameraPermission || isBusy}
          label="Start Recording"
          onPress={startRecording}
          style={styles.flexButton}
        />
        <PrimaryButton
          disabled={!isRecording}
          label="Stop Recording"
          onPress={stopRecording}
          style={styles.flexButton}
          variant="danger"
        />
      </View>

      <View style={styles.filePathBox}>
        <Text style={styles.filePathLabel}>Last recorded file path</Text>
        <Text style={styles.filePathValue}>{lastRecordingUri ?? 'No recording saved yet'}</Text>
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statusLabel: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '700',
  },
  cameraPreview: {
    aspectRatio: 9 / 12,
    backgroundColor: '#020617',
    borderRadius: 18,
    overflow: 'hidden',
    width: '100%',
  },
  permissionBox: {
    backgroundColor: '#0f172a',
    borderColor: '#334155',
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  permissionTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
  },
  permissionText: {
    color: '#cbd5e1',
    fontSize: 14,
    lineHeight: 20,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  flexButton: {
    flex: 1,
  },
  filePathBox: {
    backgroundColor: '#020617',
    borderRadius: 16,
    gap: 6,
    padding: 14,
  },
  filePathLabel: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  filePathValue: {
    color: '#f8fafc',
    fontSize: 13,
    lineHeight: 18,
  },
});
