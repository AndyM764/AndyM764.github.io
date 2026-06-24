import { raspberryPiConfig, type RaspberryPiRuntimeConfig } from "../config/raspberryPiConfig";
import type {
  BallMachinePower,
  CameraStateResponse,
  PiInfo,
  PiStatusResponse,
  RaspberryPiState,
  ServiceResult
} from "../types/raspberryPi";
import type {
  SavedVideo,
  StartRecordingResponse,
  StopRecordingResponse
} from "../types/recording";
import type {
  ParameterTransmissionResult,
  TennisParameters
} from "../types/tennisParameters";
import { videoStorageService, type VideoStorageService } from "./VideoStorageService";

type BackendAddressProvider = {
  getBaseUrl(): string;
};

class StaticRuntimeConfigProvider implements BackendAddressProvider {
  constructor(private readonly config: RaspberryPiRuntimeConfig) {}

  getBaseUrl(): string {
    return this.config.baseUrl;
  }
}

const FORBIDDEN_BOOTSTRAP_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

class RaspberryPiService {
  constructor(
    private readonly addressProvider: BackendAddressProvider = new StaticRuntimeConfigProvider(
      raspberryPiConfig
    ),
    private readonly storageService: VideoStorageService = videoStorageService,
    private readonly requestTimeoutMs: number = raspberryPiConfig.requestTimeoutMs
  ) {}

  async refreshPiState(): Promise<RaspberryPiState> {
    const [infoResult, statusResult] = await Promise.allSettled([
      this.getInfo(),
      this.getStatus()
    ]);

    const errors: string[] = [];

    if (infoResult.status === "rejected") {
      errors.push(this.getErrorMessage(infoResult.reason));
    }

    if (statusResult.status === "rejected") {
      errors.push(this.getErrorMessage(statusResult.reason));
    }

    return {
      info: infoResult.status === "fulfilled" ? infoResult.value : null,
      connectionStatus: statusResult.status === "fulfilled" ? "connected" : "disconnected",
      errorMessage: errors.length > 0 ? errors.join(" ") : null
    };
  }

  async getInfo(): Promise<PiInfo> {
    const response = await this.request<unknown>("/info");

    if (!this.isRecord(response)) {
      throw new Error("The Raspberry Pi /info response was invalid.");
    }

    const hostname = response.hostname;
    const ip = response.ip;

    if (typeof hostname !== "string" || hostname.trim().length === 0) {
      throw new Error("The Raspberry Pi /info response did not include a hostname.");
    }

    if (typeof ip !== "string" || ip.trim().length === 0) {
      throw new Error("The Raspberry Pi /info response did not include an IP address.");
    }

    return {
      hostname: hostname.trim(),
      ip: ip.trim()
    };
  }

  async getStatus(): Promise<PiStatusResponse> {
    const response = await this.request<unknown>("/status");

    if (!this.isRecord(response) || response.status !== "ok") {
      throw new Error("The Raspberry Pi /status response was not ok.");
    }

    return {
      status: "ok"
    };
  }

  async sendParameters(payload: TennisParameters): Promise<ParameterTransmissionResult> {
    this.validateTennisParameters(payload);

    const response = await this.request<unknown>("/data", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    return this.toServiceResult(response, "Parameters sent to Raspberry Pi.");
  }

  async setCameraEnabled(enabled: boolean): Promise<CameraStateResponse> {
    const response = await this.request<unknown>("/camera/state", {
      method: "POST",
      body: JSON.stringify({ enabled })
    });

    return this.toServiceResult(
      response,
      enabled ? "Raspberry Pi camera enabled." : "Raspberry Pi camera disabled."
    );
  }

  getCameraStreamUrl(): string {
    return this.resolveBackendUrl("/camera/stream");
  }

  async startRecording(): Promise<StartRecordingResponse> {
    const response = await this.request<unknown>("/recording/start", {
      method: "POST"
    });

    if (!this.isRecord(response) || response.success !== true) {
      throw new Error("The Raspberry Pi did not start recording.");
    }

    if (typeof response.recordingId !== "string" || response.recordingId.trim().length === 0) {
      throw new Error("The Raspberry Pi recording response did not include a recording ID.");
    }

    return {
      success: true,
      recordingId: response.recordingId.trim(),
      message: typeof response.message === "string" ? response.message : undefined
    };
  }

  async stopRecording(recordingId: string): Promise<StopRecordingResponse> {
    if (recordingId.trim().length === 0) {
      throw new Error("A recording ID is required to stop recording.");
    }

    const response = await this.request<unknown>("/recording/stop", {
      method: "POST",
      body: JSON.stringify({ recordingId })
    });

    if (!this.isRecord(response) || response.success !== true) {
      throw new Error("The Raspberry Pi did not finalize the recording.");
    }

    if (typeof response.downloadUrl !== "string" || response.downloadUrl.trim().length === 0) {
      throw new Error("The Raspberry Pi recording response did not include a download URL.");
    }

    return {
      success: true,
      recordingId,
      downloadUrl: response.downloadUrl.trim(),
      filename: typeof response.filename === "string" ? response.filename : undefined,
      message: typeof response.message === "string" ? response.message : undefined
    };
  }

  async downloadRecording(downloadUrl: string, filename?: string): Promise<SavedVideo> {
    const absoluteDownloadUrl = this.resolveBackendUrl(downloadUrl);
    return this.storageService.saveRecordingFromUrl(absoluteDownloadUrl, filename);
  }

  async setBallMachinePower(power: BallMachinePower): Promise<ServiceResult> {
    void power;

    // TODO: Wire this to the Raspberry Pi ball machine hardware endpoint when it is finalized.
    return {
      success: false,
      message: "Ball machine backend integration is pending."
    };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = this.resolveBackendUrl(path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...(this.isRecord(init?.headers) ? init.headers : {})
        },
        signal: controller.signal
      });

      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(`Raspberry Pi request failed with HTTP ${response.status}.`);
      }

      if (responseText.trim().length === 0) {
        return undefined as T;
      }

      try {
        return JSON.parse(responseText) as T;
      } catch {
        throw new Error("The Raspberry Pi backend returned invalid JSON.");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Raspberry Pi request timed out.");
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private resolveBackendUrl(path: string): string {
    const baseUrl = this.getValidatedBaseUrl();

    try {
      const resolvedUrl = new URL(path, `${baseUrl}/`);
      this.validateResolvedHost(resolvedUrl);
      return resolvedUrl.toString();
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }

      throw new Error("Unable to build Raspberry Pi backend URL.");
    }
  }

  private getValidatedBaseUrl(): string {
    const configuredBaseUrl = this.addressProvider.getBaseUrl().trim();

    if (configuredBaseUrl.length === 0) {
      throw new Error("Raspberry Pi backend base URL is not configured.");
    }

    let parsedUrl: URL;

    try {
      parsedUrl = new URL(configuredBaseUrl);
    } catch {
      throw new Error("Raspberry Pi backend base URL is invalid.");
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("Raspberry Pi backend base URL must use HTTP or HTTPS.");
    }

    this.validateResolvedHost(parsedUrl);

    return parsedUrl.toString().replace(/\/$/, "");
  }

  private validateResolvedHost(url: URL): void {
    const hostname = url.hostname.toLowerCase();

    if (FORBIDDEN_BOOTSTRAP_HOSTS.has(hostname)) {
      throw new Error("Raspberry Pi backend base URL must target a real device on the network.");
    }
  }

  private validateTennisParameters(payload: TennisParameters): void {
    if (!Number.isFinite(payload.speed) || payload.speed < 0 || payload.speed > 250) {
      throw new Error("Ball speed must be between 0 and 250 km/h.");
    }

    if (!Number.isFinite(payload.angle) || payload.angle < 0 || payload.angle > 90) {
      throw new Error("Launch angle must be between 0 and 90 degrees.");
    }

    if (!Number.isFinite(payload.frequency) || payload.frequency < 0 || payload.frequency > 20) {
      throw new Error("Ball frequency must be between 0 and 20 balls/sec.");
    }
  }

  private toServiceResult(response: unknown, defaultSuccessMessage: string): ServiceResult {
    if (!this.isRecord(response)) {
      return {
        success: true,
        message: defaultSuccessMessage
      };
    }

    if (response.success === false) {
      return {
        success: false,
        message: typeof response.message === "string" ? response.message : "Request failed."
      };
    }

    return {
      success: true,
      message: typeof response.message === "string" ? response.message : defaultSuccessMessage
    };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown Raspberry Pi communication error.";
  }
}

export const raspberryPiService = new RaspberryPiService();
export { RaspberryPiService, StaticRuntimeConfigProvider };
export type { BackendAddressProvider };
