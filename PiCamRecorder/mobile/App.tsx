import { useState } from 'react';
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

export default function App() {
  const [connected, setConnected] = useState(false);
  const [recording, setRecording] = useState(false);
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
      } else {
        setConnected(false);
        setSaveMessage('Connection failed');
      }
    } catch {
      setConnected(false);
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

      const info = await FileSystem.getInfoAsync(localPath);
      if (!info.exists || !('size' in info) || !info.size || info.size <= 0) {
        setSaveStatus('error');
        setSaveMessage('Downloaded file is missing or empty');
        return;
      }

      setFileSize(info.size);
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

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <StatusBar style="auto" />

      <Text style={styles.label}>Connection Status:</Text>
      <Text style={styles.value}>
        {connected ? 'Connected' : 'Not Connected'}
      </Text>

      <View style={styles.buttonRow}>
        <Button title="Connect" onPress={handleConnect} disabled={busy} />
        <Button
          title="Record"
          onPress={handleRecord}
          disabled={!connected || recording || busy}
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
});
