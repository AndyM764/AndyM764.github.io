import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { PI_START_RECORDING_URL, PI_STOP_RECORDING_URL, PI_STREAM_URL } from './config';

const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#000"><img src="${PI_STREAM_URL}" style="width:100vw;height:100vh;object-fit:cover"></body></html>`;

export default function App() {
  return (
    <View style={styles.container}>
      <WebView style={styles.webview} source={{ html }} originWhitelist={['*']} />
      <View style={styles.controls}>
        <Pressable style={styles.button} onPress={() => fetch(PI_START_RECORDING_URL)}>
          <Text style={styles.buttonText}>Record</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={() => fetch(PI_STOP_RECORDING_URL)}>
          <Text style={styles.buttonText}>Stop</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  webview: { flex: 1 },
  controls: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  button: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    marginHorizontal: 8,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
