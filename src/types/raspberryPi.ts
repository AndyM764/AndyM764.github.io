export type RaspberryPiConnectionState = 'connected' | 'disconnected';

export interface RaspberryPiConnectionStatus {
  state: RaspberryPiConnectionState;
  ipAddress: string | null;
}

export interface RaspberryPiApiConfig {
  baseUrl: string;
  timeoutMs: number;
}
