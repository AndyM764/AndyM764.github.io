import { useRef } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { cacheDirectory, downloadAsync } from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { PI_STREAM_URL } from './config';

const recordingBaseUrl = PI_STREAM_URL.replace(/\/stream$/, '');
const START_RECORDING_URL = `${recordingBaseUrl}/start-recording`;
const STOP_RECORDING_URL = `${recordingBaseUrl}/stop-recording`;
const LATEST_RECORDING_URL = `${recordingBaseUrl}/latest-recording`;

const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#000"><img src="${PI_STREAM_URL}" style="width:100vw;height:100vh;object-fit:cover"></body></html>`;

type RecordingMessage = {
  ok: boolean;
  label: string;
  url: string;
  error?: string;
};

type DownloadFilenameMessage = {
  label: 'Download';
  ok: boolean;
  filename?: string;
  error?: string;
};

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const downloadFilenameRef = useRef<{
    resolve: (filename: string) => void;
    reject: (error: Error) => void;
  } | null>(null);

  const sendRecordingRequest = (url: string, label: string) => {
    if (!url) {
      const message = 'Recording URL is missing. Check PI_STREAM_URL in config.ts.';
      console.error(`[recording] ${label} failed: ${message}`);
      Alert.alert(`${label} failed`, message);
      return;
    }

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
        fetch(url, { method: 'GET' })
          .then(function() {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              ok: true,
              label: ${JSON.stringify(label)},
              url: ${JSON.stringify(url)}
            }));
          })
          .catch(function(error) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              ok: false,
              label: ${JSON.stringify(label)},
              url: ${JSON.stringify(url)},
              error: String(error)
            }));
          });
        return true;
      })();
    `;

    webViewRef.current.injectJavaScript(script);
  };

  const fetchLatestFilename = (): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!webViewRef.current) {
        reject(new Error('Step 1: Preview WebView is not ready.'));
        return;
      }

      downloadFilenameRef.current = { resolve, reject };

      const script = `
        (function() {
          fetch(${JSON.stringify(LATEST_RECORDING_URL)} + '?_=' + Date.now())
            .then(function(response) {
              if (!response.ok) {
                throw new Error('Step 1: latest-recording returned HTTP ' + response.status);
              }
              return response.text();
            })
            .then(function(text) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                label: 'Download',
                ok: true,
                filename: text.trim()
              }));
            })
            .catch(function(error) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                label: 'Download',
                ok: false,
                error: String(error)
              }));
            });
          return true;
        })();
      `;

      webViewRef.current.injectJavaScript(script);
    });
  };

  const downloadLatest = async () => {
    try {
      const filename = await fetchLatestFilename();
      if (!filename) {
        throw new Error('Step 2: Pi returned an empty filename.');
      }

      const downloadUrl = `${recordingBaseUrl}/download/${encodeURIComponent(filename)}`;
      const localUri = `${cacheDirectory}${filename}`;
      const result = await downloadAsync(downloadUrl, localUri);
      if (result.status !== 200) {
        throw new Error(`Step 3: download returned HTTP ${result.status}`);
      }

      const permission = await MediaLibrary.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        throw new Error('Step 5: Media library permission denied.');
      }

      await MediaLibrary.saveToLibraryAsync(localUri);
      Alert.alert('Download complete', `Saved ${filename} to Photos.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[download] failed:', message);
      Alert.alert('Download failed', message);
    }
  };

  const onWebViewMessage = (event: WebViewMessageEvent) => {
    let data: RecordingMessage;
    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }

    if (data.label === 'Download') {
      const pending = downloadFilenameRef.current;
      downloadFilenameRef.current = null;
      const downloadData = data as DownloadFilenameMessage;
      if (downloadData.ok && downloadData.filename) {
        pending?.resolve(downloadData.filename);
      } else {
        pending?.reject(new Error(downloadData.error ?? 'Step 1: latest-recording failed.'));
      }
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
          onPress={() => sendRecordingRequest(START_RECORDING_URL, 'Record')}
        >
          <Text style={styles.buttonText}>Record</Text>
        </Pressable>
        <Pressable
          style={styles.button}
          onPress={() => sendRecordingRequest(STOP_RECORDING_URL, 'Stop')}
        >
          <Text style={styles.buttonText}>Stop</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={downloadLatest}>
          <Text style={styles.buttonText}>Download</Text>
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
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 24,
    marginHorizontal: 6,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
