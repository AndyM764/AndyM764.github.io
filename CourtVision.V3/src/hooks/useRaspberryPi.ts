import { useCallback, useState } from "react";

import { raspberryPiService } from "../services/RaspberryPiService";
import type { ConnectionStatus, PiInfo } from "../types/raspberryPi";

type UseRaspberryPiResult = {
  piInfo: PiInfo | null;
  connectionStatus: ConnectionStatus;
  isRefreshing: boolean;
  errorMessage: string | null;
  refresh: () => Promise<void>;
};

export function useRaspberryPi(): UseRaspberryPiResult {
  const [piInfo, setPiInfo] = useState<PiInfo | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);

    try {
      const state = await raspberryPiService.refreshPiState();
      setPiInfo(state.info);
      setConnectionStatus(state.connectionStatus);
      setErrorMessage(state.errorMessage);
    } catch (error) {
      setPiInfo(null);
      setConnectionStatus("disconnected");
      setErrorMessage(error instanceof Error ? error.message : "Unable to refresh Raspberry Pi.");
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  return {
    piInfo,
    connectionStatus,
    isRefreshing,
    errorMessage,
    refresh
  };
}
