import { RaspberryPiApiConfig, RaspberryPiConnectionStatus } from '../types/raspberryPi';
import { TennisParameters } from '../types/tennisParameters';

const MOCK_RASPBERRY_PI_IP = '192.168.4.1';
const MOCK_DELAY_MS = 350;

class RaspberryPiService {
  private connectionStatus: RaspberryPiConnectionStatus = {
    state: 'disconnected',
    ipAddress: null,
  };

  private apiConfig: RaspberryPiApiConfig = {
    baseUrl: `http://${MOCK_RASPBERRY_PI_IP}:8000`,
    timeoutMs: 5000,
  };

  async connect(): Promise<RaspberryPiConnectionStatus> {
    await this.simulateNetworkDelay();

    this.connectionStatus = {
      state: 'connected',
      ipAddress: MOCK_RASPBERRY_PI_IP,
    };

    // TODO: Replace this mock with Raspberry Pi WiFi discovery or REST health check.
    console.log('[RaspberryPiService] Mock connected', this.connectionStatus);

    return this.connectionStatus;
  }

  async disconnect(): Promise<RaspberryPiConnectionStatus> {
    await this.simulateNetworkDelay();

    this.connectionStatus = {
      state: 'disconnected',
      ipAddress: null,
    };

    console.log('[RaspberryPiService] Mock disconnected');

    return this.connectionStatus;
  }

  async getConnectionStatus(): Promise<RaspberryPiConnectionStatus> {
    await this.simulateNetworkDelay();

    // TODO: Poll Raspberry Pi telemetry endpoint for real connection health.
    return this.connectionStatus;
  }

  async sendParameters(parameters: TennisParameters): Promise<void> {
    const payload = {
      speed: parameters.speed,
      angle: parameters.angle,
      frequency: parameters.frequency,
    };

    // TODO: POST this payload to `${this.apiConfig.baseUrl}/parameters`.
    // TODO: Attach TrackNet, shot detection, and real-time telemetry metadata here.
    console.log('[RaspberryPiService] Mock parameter payload', payload);
  }

  getApiConfig(): RaspberryPiApiConfig {
    return this.apiConfig;
  }

  setApiConfig(config: RaspberryPiApiConfig): void {
    this.apiConfig = config;
  }

  private simulateNetworkDelay(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, MOCK_DELAY_MS);
    });
  }
}

export const raspberryPiService = new RaspberryPiService();
