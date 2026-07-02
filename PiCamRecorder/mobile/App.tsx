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

type SaveStatus = 'idle' | 'downloading' | 'saved' | 'error';

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

function formatCheck(value: boolean) {
  return value ? 'OK' : 'FAIL';
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

export default function App() {
  const verifyVideoRef = useRef<Video>(null);
  const [connected, setConnected] = useState(false);
  const [recording, setRecording] = useState(false);
  const [diagnostics, setDiagnostics] = useState<PiDiagnostics>(EMPTY_DIAGNOSTICS);
  const [filename, setFilename] = useState('');
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function ensureSaveDir() {
    const info = await FileSystem.getInfoAsync(SAVE_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(SAVE_DIR, { intermediates: true });
    }
  }

  async function handleConnect() {
    setBusy(true);
    setSaveStatus('idle');
    setSaveMessage('');
    try {
      const response = await fetch(`${PI_BASE_URL}/status`);
      const data = await response.json();
      if (data.success) {
        setConnected(true);
        setRecording(!!data.recording);
        setDiagnostics({
          cameraAvailable: !!data.cameraAvailable,
          rpicamInstalled: !!data.rpicamInstalled,
          ffmpegInstalled: !!data.ffmpegInstalled,
          recordingDirectoryWritable: !!data.recordingDirectoryWritable,
        });
      } else {
        setConnected(false);
        setDiagnostics(EMPTY_DIAGNOSTICS);
        setSaveMessage('Connection failed');
      }
    } catch {
      setConnected(false);
      setDiagnostics(EMPTY_DIAGNOSTICS);
      setSaveMessage('Connection failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleRecord() {
    if (!connected || recording) {
      return;
    }
    setBusy(true);
    setSaveStatus('idle');
    setSaveMessage('');
    setFilename('');
    setFileSize(null);
    setVideoUri(null);
    try {
      const response = await fetch(`${PI_BASE_URL}/recording/start`, {
        method: 'POST',
      });
      const data = await response.json();
      if (data.success) {
        setRecording(true);
        setFilename(data.filename);
      } else {
        setSaveMessage(data.error || 'Failed to start recording');
      }
    } catch {
      setSaveMessage('Failed to start recording');
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    if (!recording) {
      return;
    }
    setBusy(true);
    setSaveStatus('downloading');
    setSaveMessage('Stopping recording...');
    try {
      const response = await fetch(`${PI_BASE_URL}/recording/stop`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!data.success) {
        setSaveStatus('error');
        setSaveMessage(data.error || 'Failed to stop recording');
        setRecording(false);
        return;
      }

      setRecording(false);
      setFilename(data.filename);
      setSaveMessage('Downloading...');

      await ensureSaveDir();
      const localPath = `${SAVE_DIR}${data.filename}`;
      await FileSystem.downloadAsync(
        `${PI_BASE_URL}${data.downloadUrl}`,
        localPath
      );

      const localSize = await verifyLocalFile(localPath);

      setSaveMessage('Verifying playback...');
      try {
        await verifyVideoPlayback(verifyVideoRef, localPath);
      } catch {
        setSaveStatus('error');
        setSaveMessage('Video playback verification failed');
        return;
      }

      setFileSize(localSize);
      setVideoUri(localPath);
      setSaveStatus('saved');
      setSaveMessage('Saved to phone');

      const deleteResponse = await fetch(
        `${PI_BASE_URL}/recordings/${data.filename}`,
        { method: 'DELETE' }
      );
      if (!deleteResponse.ok) {
        setSaveMessage('Saved to phone (Pi cleanup failed)');
      }
    } catch {
      setSaveStatus('error');
      setSaveMessage('Failed to stop or save recording');
      setRecording(false);
    } finally {
      setBusy(false);
    }
  }

  const formatSize = (size: number | null) => {
    if (size === null) {
      return '-';
    }
    return `${size.toLocaleString()} bytes`;
  };

  const recordingReady =
    diagnostics.rpicamInstalled &&
    diagnostics.ffmpegInstalled &&
    diagnostics.recordingDirectoryWritable &&
    diagnostics.cameraAvailable;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <StatusBar style="auto" />

      <Text style={styles.label}>Connection Status:</Text>
      <Text style={styles.value}>
        {connected ? 'Connected' : 'Not Connected'}
      </Text>

      {connected && (
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
        <Button title="Connect" onPress={handleConnect} disabled={busy} />
        <Button
          title="Record"
          onPress={handleRecord}
          disabled={!connected || !recordingReady || recording || busy}
        />
        <Button
          title="Stop"
          onPress={handleStop}
          disabled={!recording || busy}
        />
      </View>

      {busy && saveStatus === 'downloading' && (
        <ActivityIndicator size="large" style={styles.spinner} />
      )}

      <Text style={styles.label}>Filename:</Text>
      <Text style={styles.value}>{filename || '-'}</Text>

      <Text style={styles.label}>File size:</Text>
      <Text style={styles.value}>{formatSize(fileSize)}</Text>

      <Text style={styles.label}>Save status:</Text>
      <Text style={styles.value}>
        {saveStatus === 'idle'
          ? '-'
          : saveMessage || (saveStatus === 'saved' ? 'Saved to phone' : 'Error')}
      </Text>

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
