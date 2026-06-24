export type PiInfo = {
  hostname: string;
  ip: string;
};

export type PiStatusResponse = {
  status: "ok";
};

export type ConnectionStatus = "connected" | "disconnected";

export type RaspberryPiState = {
  info: PiInfo | null;
  connectionStatus: ConnectionStatus;
  errorMessage: string | null;
};

export type ServiceResult = {
  success: boolean;
  message: string;
};

export type CameraStateResponse = ServiceResult;

export type BallMachinePower = "on" | "off";
