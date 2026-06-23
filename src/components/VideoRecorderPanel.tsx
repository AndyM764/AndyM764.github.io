import { StyleSheet, Text, View } from 'react-native';

import { useVideoRecorder } from '../hooks/useVideoRecorder';
import { RecordingStatus } from '../types/video';
import { PrimaryButton } from './PrimaryButton';
import { SectionCard } from './SectionCard';
import { StatusBadge } from './StatusBadge';

function getStatusLabel(status: RecordingStatus) {
  switch (status) {
    case 'starting':
      return 'Starting';
    case 'recording':
      return 'Recording';
    case 'stopping':
      return 'Stopping';
    case 'error':
      return 'Error';
    case 'idle':
    default:
      return 'Stopped';
  }
}

function getStatusVariant(status: RecordingStatus) {
  switch (status) {
    case 'starting':
    case 'stopping':
      return 'warning';
    case 'recording':
      return 'danger';
    case 'error':
      return 'danger';
    case 'idle':
    default:
      return 'neutral';
  }
}

export function VideoRecorderPanel() {
  const {
    recordingStatus,
    successMessage,
    errorMessage,
    startRecording,
    stopRecording,
  } = useVideoRecorder();

  const isRecording = recordingStatus === 'recording';
  const isBusy = recordingStatus === 'starting' || recordingStatus === 'stopping';

  return (
    <SectionCard
      title="Video Recording"
      subtitle="Control recording on the Raspberry Pi camera. Videos stay on the Raspberry Pi for now."
    >
      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Recording status</Text>
        <StatusBadge label={getStatusLabel(recordingStatus)} status={getStatusVariant(recordingStatus)} />
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoTitle}>Raspberry Pi Camera</Text>
        <Text style={styles.infoText}>
          Start and stop commands are sent to http://10.136.19.4:5000. Video downloading will be added later.
        </Text>
      </View>

      {successMessage ? <Text style={styles.successText}>{successMessage}</Text> : null}
      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

      <View style={styles.buttonRow}>
        <PrimaryButton
          disabled={isRecording || isBusy}
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
  infoBox: {
    backgroundColor: '#0f172a',
    borderColor: '#334155',
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  infoTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
  },
  infoText: {
    color: '#cbd5e1',
    fontSize: 14,
    lineHeight: 20,
  },
  successText: {
    color: '#86efac',
    fontSize: 14,
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
});
