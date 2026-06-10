import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ConnectionPanel } from '../components/ConnectionPanel';
import { TennisParametersPanel } from '../components/TennisParametersPanel';
import { VideoRecorderPanel } from '../components/VideoRecorderPanel';
import { useRaspberryPiConnection } from '../hooks/useRaspberryPiConnection';
import { useTennisParameters } from '../hooks/useTennisParameters';

export function WifiConnectionScreen() {
  const {
    status,
    isLoading,
    errorMessage,
    connect,
    disconnect,
    refreshStatus,
    sendParameters,
  } = useRaspberryPiConnection();
  const {
    parameters,
    setSpeed,
    setAngle,
    setFrequency,
    resetParameters,
  } = useTennisParameters();

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>CourtVision.V2</Text>
        <Text style={styles.title}>Tennis Launcher Control</Text>
        <Text style={styles.subtitle}>
          Stable Expo SDK 54 app for Raspberry Pi connectivity, launcher parameters, and practice video recording.
        </Text>
      </View>

      <ConnectionPanel
        errorMessage={errorMessage}
        isLoading={isLoading}
        onConnect={connect}
        onDisconnect={disconnect}
        onRefresh={refreshStatus}
        status={status}
      />

      <TennisParametersPanel
        onAngleChange={setAngle}
        onFrequencyChange={setFrequency}
        onReset={resetParameters}
        onSend={sendParameters}
        onSpeedChange={setSpeed}
        parameters={parameters}
      />

      <VideoRecorderPanel />

      <View style={styles.futureCard}>
        <Text style={styles.futureTitle}>Future expansion points</Text>
        <Text style={styles.futureText}>
          TODO: Add TrackNet, computer vision, machine learning, shot detection, cloud processing, and real-time
          Raspberry Pi telemetry modules behind services and hooks.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0f172a',
    flex: 1,
  },
  content: {
    gap: 18,
    padding: 20,
    paddingBottom: 36,
  },
  header: {
    gap: 8,
    paddingTop: 12,
  },
  eyebrow: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    color: '#f8fafc',
    fontSize: 32,
    fontWeight: '900',
    lineHeight: 38,
  },
  subtitle: {
    color: '#cbd5e1',
    fontSize: 16,
    lineHeight: 23,
  },
  futureCard: {
    backgroundColor: '#111827',
    borderColor: '#334155',
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  futureTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
  },
  futureText: {
    color: '#cbd5e1',
    fontSize: 14,
    lineHeight: 20,
  },
});
