import { RaspberryPiApiConfig, RaspberryPiConnectionStatus } from '../types/raspberryPi';
import { TennisParameters } from '../types/tennisParameters';

const RASPBERRY_PI_IP = '10.136.19.4';
const RASPBERRY_PI_BASE_URL = `http://${RASPBERRY_PI_IP}:5000`;

class RaspberryPiService {
  private connectionStatus: RaspberryPiConnectionStatus = {
    state: 'disconnected',
    ipAddress: null,
  };

  private apiConfig: RaspberryPiApiConfig = {
    baseUrl: RASPBERRY_PI_BASE_URL,
    timeoutMs: 5000,
  };

  async connect(): Promise<RaspberryPiConnectionStatus> {
    return this.getConnectionStatus();
  }

  async disconnect(): Promise<RaspberryPiConnectionStatus> {
    this.connectionStatus = {
      state: 'disconnected',
      ipAddress: null,
    };

    return this.connectionStatus;
  }

  async getConnectionStatus(): Promise<RaspberryPiConnectionStatus> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.apiConfig.timeoutMs);

    try {
      await fetch(this.apiConfig.baseUrl, {
        method: 'GET',
        signal: controller.signal,
      });

      this.connectionStatus = {
        state: 'connected',
        ipAddress: RASPBERRY_PI_IP,
      };
    } catch (error) {
      this.connectionStatus = {
        state: 'disconnected',
        ipAddress: RASPBERRY_PI_IP,
      };

      console.warn('[RaspberryPiService] Raspberry Pi connection check failed', error);
    } finally {
      clearTimeout(timeout);
    }

    // TODO: Poll Raspberry Pi telemetry endpoint after the base health check succeeds.
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
}

export const raspberryPiService = new RaspberryPiService();
