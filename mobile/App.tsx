import { useRef } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { cacheDirectory, EncodingType, writeAsStringAsync } from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { PI_STREAM_URL } from './config';

const recordingBaseUrl = PI_STREAM_URL.replace(/\/stream$/, '');
const START_RECORDING_URL = `${recordingBaseUrl}/start-recording`;
const STOP_RECORDING_URL = `${recordingBaseUrl}/stop-recording`;
const LATEST_RECORDING_URL = `${recordingBaseUrl}/latest-recording`;

const FILENAME_TIMEOUT_MS = 10000;
// 30s 640x480 H264 is typically ~3-12 MB; allow time for fetch + chunked postMessage transfer.
const FILE_DOWNLOAD_TIMEOUT_MS = 300000;
// 32 KB raw per chunk (~44 KB base64 in JSON) stays well under iOS postMessage practical limits.
const WEBVIEW_CHUNK_SIZE = 32768;

const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#000"><img src="${PI_STREAM_URL}" style="width:100vw;height:100vh;object-fit:cover"></body></html>`;

type RecordingMessage = {
  ok: boolean;
  label: string;
  url: string;
  error?: string;
};

type DownloadFilenameMessage = {
  label: 'DownloadFilename';
  ok: boolean;
  filename?: string;
  error?: string;
};

type DownloadFileMessage = {
  label: 'DownloadFile';
  phase: 'start' | 'chunk' | 'done' | 'error';
  totalChunks?: number;
  index?: number;
  data?: string;
  error?: string;
};

type PendingDownloadFilename = {
  resolve: (filename: string) => void;
  reject: (error: Error) => void;
};

type PendingDownloadFile = {
  resolve: (localUri: string) => void;
  reject: (error: Error) => void;
  localUri: string;
  chunks: string[];
  totalChunks: number;
  receivedChunks: number;
};

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const downloadFilenameRef = useRef<PendingDownloadFilename | null>(null);
  const downloadFileRef = useRef<PendingDownloadFile | null>(null);
  const isDownloadingRef = useRef(false);

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

      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        downloadFilenameRef.current = null;
        reject(new Error('Step 1: Timed out waiting for latest-recording response.'));
      }, FILENAME_TIMEOUT_MS);

      downloadFilenameRef.current = {
        resolve: (filename: string) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeoutId);
          downloadFilenameRef.current = null;
          resolve(filename);
        },
        reject: (error: Error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeoutId);
          downloadFilenameRef.current = null;
          reject(error);
        },
      };

      const url = LATEST_RECORDING_URL;
      console.log('[download] fetchLatestFilename webview fetch ->', url);

      const script = `
        (function() {
          var url = ${JSON.stringify(url)} + '?_=' + Date.now();
          fetch(url, { method: 'GET' })
            .then(function(response) {
              if (!response.ok) {
                throw new Error('Step 1: latest-recording returned HTTP ' + response.status);
              }
              return response.text();
            })
            .then(function(text) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                label: 'DownloadFilename',
                ok: true,
                filename: text.trim()
              }));
            })
            .catch(function(error) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                label: 'DownloadFilename',
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

  const downloadFileViaWebView = (filename: string): Promise<string> => {
    const downloadUrl = `${recordingBaseUrl}/download/${encodeURIComponent(filename)}`;
    const localUri = `${cacheDirectory}${filename}`;

    return new Promise((resolve, reject) => {
      if (!webViewRef.current) {
        reject(new Error('Step 2: Preview WebView is not ready.'));
        return;
      }

      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        downloadFileRef.current = null;
        reject(new Error('Step 2: Timed out waiting for MP4 download.'));
      }, FILE_DOWNLOAD_TIMEOUT_MS);

      const finish = (handler: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        downloadFileRef.current = null;
        handler();
      };

      downloadFileRef.current = {
        resolve: (uri: string) => finish(() => resolve(uri)),
        reject: (error: Error) => finish(() => reject(error)),
        localUri,
        chunks: [],
        totalChunks: 0,
        receivedChunks: 0,
      };

      console.log('[download] downloadFileViaWebView ->', downloadUrl);

      const script = `
        (function() {
          var url = ${JSON.stringify(downloadUrl)} + '?_=' + Date.now();
          var chunkSize = ${WEBVIEW_CHUNK_SIZE};
          fetch(url, { method: 'GET' })
            .then(function(response) {
              if (!response.ok) {
                throw new Error('Step 2: download returned HTTP ' + response.status);
              }
              return response.arrayBuffer();
            })
            .then(function(buffer) {
              var bytes = new Uint8Array(buffer);
              var totalChunks = bytes.length === 0 ? 0 : Math.ceil(bytes.length / chunkSize);
              window.ReactNativeWebView.postMessage(JSON.stringify({
                label: 'DownloadFile',
                phase: 'start',
                totalChunks: totalChunks
              }));

              function encodeSlice(slice) {
                var binary = '';
                var step = 0x8000;
                for (var i = 0; i < slice.length; i += step) {
                  binary += String.fromCharCode.apply(null, slice.subarray(i, i + step));
                }
                return btoa(binary);
              }

              function sendChunk(index) {
                if (index >= totalChunks) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    label: 'DownloadFile',
                    phase: 'done'
                  }));
                  return;
                }
                var start = index * chunkSize;
                var end = Math.min(start + chunkSize, bytes.length);
                var slice = bytes.subarray(start, end);
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  label: 'DownloadFile',
                  phase: 'chunk',
                  index: index,
                  data: encodeSlice(slice)
                }));
                setTimeout(function() { sendChunk(index + 1); }, 0);
              }

              if (totalChunks === 0) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  label: 'DownloadFile',
                  phase: 'done'
                }));
              } else {
                sendChunk(0);
              }
            })
            .catch(function(error) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                label: 'DownloadFile',
                phase: 'error',
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
    if (isDownloadingRef.current) {
      return;
    }
    isDownloadingRef.current = true;
    console.log('[download] button pressed');

    try {
      let filename: string;
      try {
        console.log('[download] before fetchLatestFilename()');
        filename = await fetchLatestFilename();
        console.log('[download] after fetchLatestFilename():', filename);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message);
      }

      if (!filename) {
        throw new Error('Step 1: Pi returned an empty filename.');
      }

      let localUri: string;
      try {
        console.log('[download] before downloadFileViaWebView()', filename);
        localUri = await downloadFileViaWebView(filename);
        console.log('[download] after downloadFileViaWebView():', localUri);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message);
      }

      let permission;
      try {
        console.log('[download] before requestPermissionsAsync()');
        permission = await MediaLibrary.requestPermissionsAsync();
        console.log('[download] after requestPermissionsAsync():', permission.status);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message);
      }

      if (permission.status !== 'granted') {
        throw new Error('Step 3: Media library permission denied.');
      }

      try {
        console.log('[download] before saveToLibraryAsync()', localUri);
        await MediaLibrary.saveToLibraryAsync(localUri);
        console.log('[download] after saveToLibraryAsync()');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message);
      }

      Alert.alert('Download complete', `Saved ${filename} to Photos.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[download] failed:', message);
      Alert.alert('Download failed', message);
    } finally {
      isDownloadingRef.current = false;
    }
  };

  const handleDownloadFileMessage = async (data: DownloadFileMessage) => {
    const pending = downloadFileRef.current;
    if (!pending) {
      return;
    }

    if (data.phase === 'start') {
      pending.totalChunks = data.totalChunks ?? 0;
      pending.chunks = new Array(pending.totalChunks).fill('');
      pending.receivedChunks = 0;
      console.log('[download] downloadFileViaWebView chunks:', pending.totalChunks);
      return;
    }

    if (data.phase === 'chunk') {
      const index = data.index;
      if (index === undefined || data.data === undefined) {
        pending.reject(new Error('Step 2: Invalid download chunk.'));
        return;
      }
      if (index < 0 || index >= pending.totalChunks) {
        pending.reject(new Error(`Step 2: Unexpected chunk index ${index}.`));
        return;
      }
      pending.chunks[index] = data.data;
      pending.receivedChunks += 1;
      return;
    }

    if (data.phase === 'error') {
      pending.reject(new Error(data.error ?? 'Step 2: MP4 download failed.'));
      return;
    }

    if (data.phase !== 'done') {
      return;
    }

    if (pending.receivedChunks !== pending.totalChunks) {
      pending.reject(
        new Error(
          `Step 2: Incomplete download (${pending.receivedChunks}/${pending.totalChunks} chunks).`,
        ),
      );
      return;
    }

    try {
      const base64 = pending.chunks.join('');
      await writeAsStringAsync(pending.localUri, base64, { encoding: EncodingType.Base64 });
      console.log('[download] wrote file to cache:', pending.localUri);
      pending.resolve(pending.localUri);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pending.reject(new Error(`Step 2: Failed to write MP4 to cache (${message}).`));
    }
  };

  const onWebViewMessage = (event: WebViewMessageEvent) => {
    let data: RecordingMessage | DownloadFilenameMessage | DownloadFileMessage;
    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }

    if (data.label === 'DownloadFilename') {
      const pending = downloadFilenameRef.current;
      if (!pending) {
        return;
      }
      const downloadData = data as DownloadFilenameMessage;
      if (downloadData.ok && downloadData.filename) {
        console.log('[download] fetchLatestFilename webview filename:', downloadData.filename);
        pending.resolve(downloadData.filename);
      } else {
        pending.reject(new Error(downloadData.error ?? 'Step 1: latest-recording failed.'));
      }
      return;
    }

    if (data.label === 'DownloadFile') {
      void handleDownloadFileMessage(data as DownloadFileMessage);
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
        source={{ html, baseUrl: recordingBaseUrl }}
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
