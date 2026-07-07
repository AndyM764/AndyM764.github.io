export const PI_STREAM_URL = 'http://192.168.1.42:8080/stream';

const base = PI_STREAM_URL.replace(/\/stream$/, '');
export const PI_START_RECORDING_URL = `${base}/start-recording`;
export const PI_STOP_RECORDING_URL = `${base}/stop-recording`;
