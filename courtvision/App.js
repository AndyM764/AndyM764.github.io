import { useEffect, useMemo, useRef, useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { StatusBar } from 'expo-status-bar';
import Slider from '@react-native-community/slider';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  connectToRaspberryPi,
  raspberryPiConfig,
  sendBallParameters,
} from './src/services/raspberryPiClient';

const RECORDINGS_ALBUM = 'CourtVision';

export default function App() {
  const cameraRef = useRef(null);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions({
    granularPermissions: ['video'],
  });

  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [isConnecting, setIsConnecting] = useState(false);
  const [parameterStatus, setParameterStatus] = useState('Ready to send mock parameters.');

  const [ballSpeed, setBallSpeed] = useState(65);
  const [launchAngle, setLaunchAngle] = useState(18);
  const [ballFrequency, setBallFrequency] = useState(8);

  const [cameraReady, setCameraReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSavingRecording, setIsSavingRecording] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState('Camera is ready when permissions are granted.');
  const [recordings, setRecordings] = useState([]);

  const ballParameters = useMemo(
    () => ({
      speedMph: Math.round(ballSpeed),
      launchAngleDegrees: Math.round(launchAngle),
      frequencyBallsPerMinute: Math.round(ballFrequency),
    }),
    [ballFrequency, ballSpeed, launchAngle]
  );

  useEffect(() => {
    if (mediaPermission?.granted) {
      loadRecordings();
    }
  }, [mediaPermission?.granted]);

  async function handleConnectDevice() {
    setIsConnecting(true);
    setConnectionStatus('Connecting to Raspberry Pi...');

    try {
      const result = await connectToRaspberryPi();
      setConnectionStatus(result.message);
    } catch (error) {
      setConnectionStatus('Connection failed. Check Wi-Fi and try again.');
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleSendParameters() {
    if (!connectionStatus.includes('Connected')) {
      setParameterStatus('Connect to the simulated Raspberry Pi before sending.');
      return;
    }

    setParameterStatus('Sending mock parameters...');

    try {
      const result = await sendBallParameters(ballParameters);
      setParameterStatus(result.message);
    } catch (error) {
      setParameterStatus('Could not send parameters. Try again.');
    }
  }

  async function ensureCameraPermission() {
    if (cameraPermission?.granted) {
      return true;
    }

    const response = await requestCameraPermission();
    return response.granted;
  }

  async function ensureMediaPermission() {
    if (mediaPermission?.granted) {
      return true;
    }

    const response = await requestMediaPermission();
    return response.granted;
  }

  async function loadRecordings() {
    try {
      const album = await MediaLibrary.getAlbumAsync(RECORDINGS_ALBUM);

      if (!album) {
        setRecordings([]);
        return;
      }

      const page = await MediaLibrary.getAssetsAsync({
        album,
        first: 25,
        mediaType: MediaLibrary.MediaType.video,
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
      });

      setRecordings(page.assets);
    } catch (error) {
      setRecordingStatus('Could not load saved recordings.');
    }
  }

  async function saveRecordingToLibrary(uri) {
    setIsSavingRecording(true);

    try {
      const asset = await MediaLibrary.createAssetAsync(uri);
      const album = await MediaLibrary.getAlbumAsync(RECORDINGS_ALBUM);

      if (album) {
        await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
      } else {
        await MediaLibrary.createAlbumAsync(RECORDINGS_ALBUM, asset, false);
      }
    } finally {
      setIsSavingRecording(false);
    }
  }

  async function handleStartRecording() {
    const hasCameraPermission = await ensureCameraPermission();
    const hasMediaPermission = await ensureMediaPermission();

    if (!hasCameraPermission || !hasMediaPermission) {
      setRecordingStatus('Camera and storage permissions are required to record.');
      return;
    }

    if (!cameraRef.current || !cameraReady) {
      setRecordingStatus('Camera is still starting. Please wait a moment.');
      return;
    }

    try {
      setIsRecording(true);
      setRecordingStatus('Recording tennis session...');

      const video = await cameraRef.current.recordAsync({
        maxDuration: 120,
      });

      if (!video?.uri) {
        setRecordingStatus('Recording stopped before a video file was created.');
        return;
      }

      setRecordingStatus('Saving recording to local storage...');
      await saveRecordingToLibrary(video.uri);
      await loadRecordings();
      setRecordingStatus(`Saved recording to the ${RECORDINGS_ALBUM} album.`);
    } catch (error) {
      setRecordingStatus('Recording failed. Please try again.');
    } finally {
      setIsRecording(false);
    }
  }

  function handleStopRecording() {
    if (cameraRef.current && isRecording) {
      setRecordingStatus('Stopping recording...');
      cameraRef.current.stopRecording();
    }
  }

  function handlePermissionHelp() {
    Alert.alert(
      'Permissions needed',
      'CourtVision needs camera access to record video and media-library access to save recordings on your phone.'
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>University Tennis Research</Text>
          <Text style={styles.title}>CourtVision</Text>
          <Text style={styles.subtitle}>
            Control mock ball-launch parameters and record practice footage for analysis.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>1. Raspberry Pi Connection</Text>
          <Text style={styles.label}>Status</Text>
          <Text style={styles.statusText}>{connectionStatus}</Text>
          <Text style={styles.helperText}>
            V1 uses a simulated Wi-Fi connection. Future code can send requests to{' '}
            {raspberryPiConfig.futureEndpoint}.
          </Text>
          <PrimaryButton
            title={isConnecting ? 'Connecting...' : 'Connect Device'}
            onPress={handleConnectDevice}
            disabled={isConnecting}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>2. Tennis Ball Parameters</Text>
          <ParameterSlider
            label="Ball Speed"
            value={ballParameters.speedMph}
            unit="mph"
            minimumValue={20}
            maximumValue={120}
            onValueChange={setBallSpeed}
          />
          <ParameterSlider
            label="Launch Angle"
            value={ballParameters.launchAngleDegrees}
            unit="degrees"
            minimumValue={0}
            maximumValue={60}
            onValueChange={setLaunchAngle}
          />
          <ParameterSlider
            label="Ball Frequency"
            value={ballParameters.frequencyBallsPerMinute}
            unit="balls/min"
            minimumValue={1}
            maximumValue={30}
            onValueChange={setBallFrequency}
          />

          <View style={styles.payloadBox}>
            <Text style={styles.payloadTitle}>Current mock payload</Text>
            <Text style={styles.payloadText}>Speed: {ballParameters.speedMph} mph</Text>
            <Text style={styles.payloadText}>
              Launch angle: {ballParameters.launchAngleDegrees} degrees
            </Text>
            <Text style={styles.payloadText}>
              Frequency: {ballParameters.frequencyBallsPerMinute} balls/min
            </Text>
          </View>

          <PrimaryButton title="Send Parameters" onPress={handleSendParameters} />
          <Text style={styles.helperText}>{parameterStatus}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>3. Video Recording</Text>
          <View style={styles.cameraFrame}>
            {cameraPermission?.granted ? (
              <CameraView
                ref={cameraRef}
                style={styles.camera}
                facing="back"
                mode="video"
                mute
                onCameraReady={() => setCameraReady(true)}
                onMountError={() => setRecordingStatus('Camera could not start on this device.')}
              />
            ) : (
              <View style={styles.permissionPanel}>
                <Text style={styles.permissionTitle}>Camera permission needed</Text>
                <Text style={styles.permissionText}>
                  Tap the button below before recording your first session.
                </Text>
                <SecondaryButton title="Request Camera Permission" onPress={requestCameraPermission} />
              </View>
            )}
          </View>

          <View style={styles.buttonRow}>
            <PrimaryButton
              title={isRecording ? 'Recording...' : 'Start Recording'}
              onPress={handleStartRecording}
              disabled={isRecording || isSavingRecording}
              style={styles.flexButton}
            />
            <DangerButton
              title="Stop Recording"
              onPress={handleStopRecording}
              disabled={!isRecording}
              style={styles.flexButton}
            />
          </View>

          {!mediaPermission?.granted ? (
            <SecondaryButton title="Request Storage Permission" onPress={requestMediaPermission} />
          ) : null}

          <TouchableOpacity onPress={handlePermissionHelp}>
            <Text style={styles.permissionLink}>Why does the app need permissions?</Text>
          </TouchableOpacity>

          <View style={styles.recordingStatusRow}>
            {isSavingRecording ? <ActivityIndicator color="#7dd3fc" /> : null}
            <Text style={styles.helperText}>{recordingStatus}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Saved Recordings</Text>
            <SecondaryButton title="Refresh" onPress={loadRecordings} compact />
          </View>

          {recordings.length === 0 ? (
            <Text style={styles.emptyText}>
              No saved recordings yet. Record a video and it will appear here after it is saved.
            </Text>
          ) : (
            recordings.map((recording, index) => (
              <View key={recording.id} style={styles.recordingItem}>
                <Text style={styles.recordingName}>Recording {recordings.length - index}</Text>
                <Text style={styles.recordingMeta}>
                  Saved {formatDate(recording.creationTime)} • {formatDuration(recording.duration)}
                </Text>
                <Text style={styles.recordingUri} numberOfLines={1}>
                  {recording.uri}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ParameterSlider({ label, value, unit, minimumValue, maximumValue, onValueChange }) {
  return (
    <View style={styles.parameterGroup}>
      <View style={styles.parameterHeader}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.valueText}>
          {value} {unit}
        </Text>
      </View>
      <Slider
        minimumValue={minimumValue}
        maximumValue={maximumValue}
        step={1}
        value={value}
        minimumTrackTintColor="#38bdf8"
        maximumTrackTintColor="#334155"
        thumbTintColor="#7dd3fc"
        onValueChange={onValueChange}
      />
    </View>
  );
}

function PrimaryButton({ title, onPress, disabled = false, style }) {
  return (
    <TouchableOpacity
      style={[styles.button, styles.primaryButton, disabled && styles.disabledButton, style]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </TouchableOpacity>
  );
}

function SecondaryButton({ title, onPress, compact = false }) {
  return (
    <TouchableOpacity
      style={[styles.button, styles.secondaryButton, compact && styles.compactButton]}
      onPress={onPress}
    >
      <Text style={styles.secondaryButtonText}>{title}</Text>
    </TouchableOpacity>
  );
}

function DangerButton({ title, onPress, disabled = false, style }) {
  return (
    <TouchableOpacity
      style={[styles.button, styles.dangerButton, disabled && styles.disabledButton, style]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </TouchableOpacity>
  );
}

function formatDate(timestamp) {
  if (!timestamp) {
    return 'recently';
  }

  return new Date(timestamp).toLocaleString();
}

function formatDuration(durationSeconds) {
  if (!durationSeconds) {
    return '0 sec';
  }

  const minutes = Math.floor(durationSeconds / 60);
  const seconds = Math.round(durationSeconds % 60);

  if (minutes === 0) {
    return `${seconds} sec`;
  }

  return `${minutes} min ${seconds} sec`;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#020617',
  },
  container: {
    padding: 20,
    paddingBottom: 48,
  },
  header: {
    marginBottom: 20,
    paddingTop: 16,
  },
  eyebrow: {
    color: '#7dd3fc',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    color: '#f8fafc',
    fontSize: 42,
    fontWeight: '800',
    marginTop: 6,
  },
  subtitle: {
    color: '#cbd5e1',
    fontSize: 16,
    lineHeight: 23,
    marginTop: 8,
  },
  card: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: 18,
    padding: 18,
  },
  sectionHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitle: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 12,
  },
  label: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '700',
  },
  statusText: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 6,
  },
  helperText: {
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
  },
  parameterGroup: {
    marginBottom: 18,
  },
  parameterHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  valueText: {
    color: '#7dd3fc',
    fontSize: 15,
    fontWeight: '800',
  },
  payloadBox: {
    backgroundColor: '#020617',
    borderColor: '#1e293b',
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
    padding: 14,
  },
  payloadTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 8,
  },
  payloadText: {
    color: '#cbd5e1',
    fontSize: 14,
    lineHeight: 22,
  },
  button: {
    alignItems: 'center',
    borderRadius: 16,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  primaryButton: {
    backgroundColor: '#0284c7',
  },
  secondaryButton: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
    borderWidth: 1,
  },
  dangerButton: {
    backgroundColor: '#dc2626',
  },
  disabledButton: {
    backgroundColor: '#475569',
    opacity: 0.65,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButtonText: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '800',
  },
  compactButton: {
    marginTop: 0,
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  flexButton: {
    flex: 1,
  },
  cameraFrame: {
    backgroundColor: '#020617',
    borderRadius: 20,
    height: 320,
    overflow: 'hidden',
  },
  camera: {
    flex: 1,
  },
  permissionPanel: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  permissionTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  permissionText: {
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  permissionLink: {
    color: '#7dd3fc',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 14,
    textAlign: 'center',
  },
  recordingStatusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  emptyText: {
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 21,
  },
  recordingItem: {
    backgroundColor: '#020617',
    borderColor: '#1e293b',
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 10,
    padding: 14,
  },
  recordingName: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '800',
  },
  recordingMeta: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 5,
  },
  recordingUri: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 5,
  },
});
