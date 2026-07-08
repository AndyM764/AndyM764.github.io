import { useRef } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { PI_START_RECORDING_URL, PI_STOP_RECORDING_URL, PI_STREAM_URL } from './config';

const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#000"><img src="${PI_STREAM_URL}" style="width:100vw;height:100vh;object-fit:cover"></body></html>`;

type RecordingMessage = {
  ok: boolean;
  label: string;
  url: string;
  error?: string;
};

export default function App() {
  const webViewRef = useRef<WebView>(null);

  const sendRecordingRequest = (url: string, label: string) => {
    console.log(`[recording] ${label} -> ${url}`);

    if (!webViewRef.current) {
      const message = 'Preview WebView is not ready.';
      console.error(`[recording] ${label} failed: ${message}`);
      Alert.alert(`${label} failed`, `${url}\n${message}`);
      return;
    }

    const script = `
      (function() {
        var url = ${JSON.stringify(url)} + '?_=' + Date.now();
        var img = new Image();
        var done = function(ok, error) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            ok: ok,
            label: ${JSON.stringify(label)},
            url: ${JSON.stringify(url)},
            error: error || undefined
          }));
        };
        img.onload = function() { done(true); };
        img.onerror = function() { done(true); };
        img.src = url;
        return true;
      })();
    `;

    webViewRef.current.injectJavaScript(script);
  };

  const onWebViewMessage = (event: WebViewMessageEvent) => {
    let data: RecordingMessage;
    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }

    if (data.label !== 'Record' && data.label !== 'Stop') {
      return;
    }

    console.log('[recording] response', data);

    if (data.ok) {
      console.log(`[recording] ${data.label} request sent to ${data.url}`);
      return;
    }

    const message = `${data.url}\n${data.error ?? 'Unknown error'}`;
    console.error(`[recording] ${data.label} failed:`, message);
    Alert.alert(`${data.label} failed`, message);
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        style={styles.webview}
        source={{ html }}
        originWhitelist={['*']}
        onMessage={onWebViewMessage}
      />
      <View style={styles.controls}>
        <Pressable
          style={styles.button}
          onPress={() => sendRecordingRequest(PI_START_RECORDING_URL, 'Record')}
        >
          <Text style={styles.buttonText}>Record</Text>
        </Pressable>
        <Pressable
          style={styles.button}
          onPress={() => sendRecordingRequest(PI_STOP_RECORDING_URL, 'Stop')}
        >
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
