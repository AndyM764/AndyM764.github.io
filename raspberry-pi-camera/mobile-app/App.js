import { useState } from 'react';
import { StyleSheet, Text, View, Button, Alert } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

const PI_URL = 'http://10.136.19.4:5000';

export default function App() {
  const [message, setMessage] = useState('Ready');

  async function startRecording() {
    try {
      const response = await fetch(`${PI_URL}/start`, { method: 'POST' });
      const data = await response.json();
      setMessage(data.status || JSON.stringify(data));
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  }

  async function stopRecording() {
    try {
      const response = await fetch(`${PI_URL}/stop`, { method: 'POST' });
      const data = await response.json();
      setMessage(data.status || JSON.stringify(data));
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  }

  async function downloadVideo() {
    try {
      const fileUri = FileSystem.documentDirectory + 'video.h264';
      const download = FileSystem.createDownloadResumable(
        `${PI_URL}/download`,
        fileUri
      );
      const result = await download.downloadAsync();
      setMessage('Saved to: ' + result.uri);
      Alert.alert('Download complete', result.uri);
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pi Camera Control</Text>
      <Button title="Start Recording" onPress={startRecording} />
      <Button title="Stop Recording" onPress={stopRecording} />
      <Button title="Download Video" onPress={downloadVideo} />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  message: {
    marginTop: 20,
    fontSize: 14,
    textAlign: 'center',
  },
});
