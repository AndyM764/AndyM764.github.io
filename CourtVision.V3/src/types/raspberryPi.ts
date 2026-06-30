export type PiInfo = {
  hostname: string;
  ip: string;
};

export type PiStatusResponse = {
  status: "ok";
  cameraState?: "IDLE" | "PREVIEW" | "RECORDING";
  cameraStateConsistent?: boolean;
  cameraPreviewEnabled?: boolean;
  recordingActive?: boolean;
  ballMachinePower?: BallMachinePower;
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

export type BallMachineStateResponse = ServiceResult & {
  power?: BallMachinePower;
};
