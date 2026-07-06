import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { PI_STREAM_URL } from './config';

const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#000"><img src="${PI_STREAM_URL}" style="width:100vw;height:100vh;object-fit:cover"></body></html>`;

export default function App() {
  return (
    <View style={styles.container}>
      <WebView style={styles.webview} source={{ html }} originWhitelist={['*']} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  webview: { flex: 1 },
});
