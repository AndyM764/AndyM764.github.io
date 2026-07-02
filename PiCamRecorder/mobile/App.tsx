import { useRef, useState, type RefObject } from 'react';
import {
  ActivityIndicator,
  Button,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { StatusBar } from 'expo-status-bar';

const PI_BASE_URL = 'http://10.136.19.4:5000';
const SAVE_DIR = `${FileSystem.documentDirectory}PiCamRecorder/`;
const DOWNLOAD_TIMEOUT_MS = 60_000;

type AppState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECORDING'
  | 'STOPPING'
  | 'DOWNLOADING'
  | 'SAVING'
  | 'READY'
  | 'ERROR';

type RecordingMetadata = {
  filename: string;
  fileSize: number;
  downloadUrl: string;
};

type PiDiagnostics = {
  cameraAvailable: boolean;
  rpicamInstalled: boolean;
  ffmpegInstalled: boolean;
  recordingDirectoryWritable: boolean;
};

const EMPTY_DIAGNOSTICS: PiDiagnostics = {
  cameraAvailable: false,
  rpicamInstalled: false,
  ffmpegInstalled: false,
  recordingDirectoryWritable: false,
};

const BUSY_STATES: AppState[] = [
  'CONNECTING',
  'STOPPING',
  'DOWNLOADING',
  'SAVING',
];

function formatCheck(value: boolean) {
  return value ? 'OK' : 'FAIL';
}

async function fetchPiStatus() {
  const response = await fetch(`${PI_BASE_URL}/status`);
  const data = await response.json();
  if (!data.success) {
    throw new Error('Pi status check failed');
  }
  return data;
}

async function ensureSaveDir() {
  const info = await FileSystem.getInfoAsync(SAVE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(SAVE_DIR, { intermediates: true });
  }
}

async function verifyLocalFile(localPath: string) {
  const info = await FileSystem.getInfoAsync(localPath);
  if (!info.exists) {
    throw new Error('Downloaded file is missing');
  }
  if (!('size' in info) || !info.size || info.size <= 0) {
    throw new Error('Downloaded file is empty');
  }
  return info.size;
}

async function verifyVideoPlayback(
  videoRef: RefObject<Video | null>,
  localPath: string
) {
  const video = videoRef.current;
  if (!video) {
    throw new Error('Video player not ready');
  }

  const status = await video.loadAsync({ uri: localPath });
  if (!status.isLoaded) {
    throw new Error('Video failed to load');
  }

  await video.unloadAsync();
}

async function downloadWithTimeout(remoteUrl: string, localPath: string) {
  const downloadPromise = FileSystem.downloadAsync(remoteUrl, localPath);
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error('Download timed out after 60 seconds'));
    }, DOWNLOAD_TIMEOUT_MS);
  });

  return Promise.race([downloadPromise, timeoutPromise]);
}

function parseDiagnostics(data: {
  cameraAvailable?: boolean;
  rpicamInstalled?: boolean;
  ffmpegInstalled?: boolean;
  recordingDirectoryWritable?: boolean;
}): PiDiagnostics {
  return {
    cameraAvailable: !!data.cameraAvailable,
    rpicamInstalled: !!data.rpicamInstalled,
    ffmpegInstalled: !!data.ffmpegInstalled,
    recordingDirectoryWritable: !!data.recordingDirectoryWritable,
  };
}

function formatPlaybackError(error: unknown) {
  const message =
    error instanceof Error ? error.message : 'Video playback verification failed';
  if (
    message === 'Video failed to load' ||
    message === 'Video player not ready'
  ) {
    return 'Video playback verification failed';
  }
  return message;
}

export default function App() {
  const verifyVideoRef = useRef<Video>(null);
  const [appState, setAppState] = useState<AppState>('DISCONNECTED');
  const [diagnostics, setDiagnostics] = useState<PiDiagnostics>(EMPTY_DIAGNOSTICS);
  const [activeFilename, setActiveFilename] = useState('');
  const [recordingMetadata, setRecordingMetadata] =
    useState<RecordingMetadata | null>(null);
  const [localFileSize, setLocalFileSize] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [videoUri, setVideoUri] = useState<string | null>(null);

  const isBusy = BUSY_STATES.includes(appState);
  const recordingReady =
    diagnostics.rpicamInstalled &&
    diagnostics.ffmpegInstalled &&
    diagnostics.recordingDirectoryWritable &&
    diagnostics.cameraAvailable;
  const showDiagnostics = !['DISCONNECTED', 'CONNECTING'].includes(appState);
  const displayFilename = recordingMetadata?.filename || activeFilename;
  const displayFileSize = localFileSize ?? recordingMetadata?.fileSize ?? null;
  const showRetryDownload = recordingMetadata !== null && appState === 'ERROR';

  function setError(message: string) {
    setStatusMessage(message);
    setAppState('ERROR');
  }

  async function downloadSaveAndFinalize(metadata: RecordingMetadata) {
    setAppState('DOWNLOADING');
    setStatusMessage('Downloading...');

    await ensureSaveDir();
    const localPath = `${SAVE_DIR}${metadata.filename}`;
    await downloadWithTimeout(`${PI_BASE_URL}${metadata.downloadUrl}`, localPath);

    setAppState('SAVING');
    setStatusMessage('Saving...');

    const savedSize = await verifyLocalFile(localPath);
    await verifyVideoPlayback(verifyVideoRef, localPath);

    const deleteResponse = await fetch(
      `${PI_BASE_URL}/recordings/${metadata.filename}`,
      { method: 'DELETE' }
    );

    setLocalFileSize(savedSize);
    setVideoUri(localPath);
    setAppState('READY');
    setStatusMessage(
      deleteResponse.ok
        ? 'Saved to phone'
        : 'Saved to phone (Pi cleanup failed)'
    );
  }

  async function handleConnect() {
    setAppState('CONNECTING');
    setStatusMessage('');
    try {
      const data = await fetchPiStatus();
      setDiagnostics(parseDiagnostics(data));

      if (data.recording) {
        setAppState('RECORDING');
        return;
      }

      setAppState('CONNECTED');
    } catch {
      setDiagnostics(EMPTY_DIAGNOSTICS);
      setError('Connection failed');
    }
  }

  async function handleRecord() {
    if (!['CONNECTED', 'READY'].includes(appState) || !recordingReady) {
      return;
    }

    setStatusMessage('');
    setActiveFilename('');
    setRecordingMetadata(null);
    setLocalFileSize(null);
    setVideoUri(null);

    try {
      const startResponse = await fetch(`${PI_BASE_URL}/recording/start`, {
        method: 'POST',
      });
      const startData = await startResponse.json();
      if (!startData.success) {
        setError(startData.error || 'Failed to start recording');
        return;
      }

      const statusData = await fetchPiStatus();
      setDiagnostics(parseDiagnostics(statusData));
      if (!statusData.recording) {
        setError('Pi did not confirm recording');
        return;
      }

      setActiveFilename(startData.filename);
      setAppState('RECORDING');
    } catch {
      setError('Failed to start recording');
    }
  }

  async function handleStop() {
    if (appState !== 'RECORDING') {
      return;
    }

    setAppState('STOPPING');
    setStatusMessage('Stopping recording...');

    try {
      const response = await fetch(`${PI_BASE_URL}/recording/stop`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!data.success) {
        setError(data.error || 'Failed to stop recording');
        return;
      }

      const metadata: RecordingMetadata = {
        filename: data.filename,
        fileSize: data.fileSize,
        downloadUrl: data.downloadUrl,
      };
      setRecordingMetadata(metadata);

      await downloadSaveAndFinalize(metadata);
    } catch (error) {
      setError(formatPlaybackError(error));
    }
  }

  async function handleRetryDownload() {
    if (!recordingMetadata || isBusy) {
      return;
    }

    setStatusMessage('Retrying download...');

    try {
      await downloadSaveAndFinalize(recordingMetadata);
    } catch (error) {
      setError(formatPlaybackError(error));
    }
  }

  const formatSize = (size: number | null) => {
    if (size === null) {
      return '-';
    }
    return `${size.toLocaleString()} bytes`;
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <StatusBar style="auto" />

      <Text style={styles.label}>State:</Text>
      <Text style={styles.value}>{appState}</Text>

      {showDiagnostics && (
        <>
          <Text style={styles.label}>Pi diagnostics:</Text>
          <Text style={styles.value}>
            rpicam-vid: {formatCheck(diagnostics.rpicamInstalled)}
          </Text>
          <Text style={styles.value}>
            ffmpeg: {formatCheck(diagnostics.ffmpegInstalled)}
          </Text>
          <Text style={styles.value}>
            recording dir: {formatCheck(diagnostics.recordingDirectoryWritable)}
          </Text>
          <Text style={styles.value}>
            camera: {formatCheck(diagnostics.cameraAvailable)}
          </Text>
        </>
      )}

      <View style={styles.buttonRow}>
        <Button
          title="Connect"
          onPress={handleConnect}
          disabled={isBusy || appState === 'RECORDING'}
        />
        <Button
          title="Record"
          onPress={handleRecord}
          disabled={
            !['CONNECTED', 'READY'].includes(appState) ||
            !recordingReady ||
            isBusy
          }
        />
        <Button
          title="Stop"
          onPress={handleStop}
          disabled={appState !== 'RECORDING' || isBusy}
        />
      </View>

      {showRetryDownload && (
        <View style={styles.buttonRow}>
          <Button
            title="Retry Download"
            onPress={handleRetryDownload}
            disabled={isBusy}
          />
        </View>
      )}

      {isBusy && <ActivityIndicator size="large" style={styles.spinner} />}

      <Text style={styles.label}>Filename:</Text>
      <Text style={styles.value}>{displayFilename || '-'}</Text>

      <Text style={styles.label}>File size:</Text>
      <Text style={styles.value}>{formatSize(displayFileSize)}</Text>

      <Text style={styles.label}>Status message:</Text>
      <Text style={styles.value}>{statusMessage || '-'}</Text>

      {videoUri && (
        <Video
          source={{ uri: videoUri }}
          useNativeControls
          resizeMode={ResizeMode.CONTAIN}
          style={styles.video}
        />
      )}

      <Video ref={verifyVideoRef} style={styles.hiddenVideo} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#fff',
    padding: 24,
    paddingTop: 60,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 16,
  },
  value: {
    fontSize: 16,
    marginTop: 4,
  },
  buttonRow: {
    marginTop: 24,
    gap: 12,
  },
  spinner: {
    marginTop: 16,
  },
  video: {
    width: '100%',
    height: 240,
    marginTop: 24,
    backgroundColor: '#000',
  },
  hiddenVideo: {
    width: 0,
    height: 0,
    position: 'absolute',
  },
});
