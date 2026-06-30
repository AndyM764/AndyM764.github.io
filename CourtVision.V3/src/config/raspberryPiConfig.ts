export type RaspberryPiRuntimeConfig = {
  /**
   * Temporary development bootstrap only.
   *
   * This value is never displayed in the UI and is never treated as the
   * Raspberry Pi identity. Hostname and IP shown to users must come from /info.
   *
   * Set with:
   * EXPO_PUBLIC_RASPBERRY_PI_BASE_URL=http://<real-pi-address>:<port>
   */
  baseUrl: string;
  requestTimeoutMs: number;
  recordingRequestTimeoutMs: number;
  connectionPollIntervalMs: number;
};

export const raspberryPiConfig: RaspberryPiRuntimeConfig = {
  baseUrl: process.env.EXPO_PUBLIC_RASPBERRY_PI_BASE_URL?.trim() ?? "",
  requestTimeoutMs: 8000,
  recordingRequestTimeoutMs: 60000,
  connectionPollIntervalMs: 5000
};
