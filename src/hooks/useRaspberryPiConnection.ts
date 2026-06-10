import { useCallback, useEffect, useState } from 'react';

import { raspberryPiService } from '../services/RaspberryPiService';
import { RaspberryPiConnectionStatus } from '../types/raspberryPi';
import { TennisParameters } from '../types/tennisParameters';

const initialStatus: RaspberryPiConnectionStatus = {
  state: 'disconnected',
  ipAddress: null,
};

export function useRaspberryPiConnection() {
  const [status, setStatus] = useState<RaspberryPiConnectionStatus>(initialStatus);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const nextStatus = await raspberryPiService.getConnectionStatus();
      setStatus(nextStatus);
    } catch (error) {
      setErrorMessage('Unable to read Raspberry Pi connection status.');
      console.warn('[useRaspberryPiConnection] Status refresh failed', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const connect = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const nextStatus = await raspberryPiService.connect();
      setStatus(nextStatus);
    } catch (error) {
      setErrorMessage('Unable to connect to Raspberry Pi.');
      console.warn('[useRaspberryPiConnection] Connect failed', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const nextStatus = await raspberryPiService.disconnect();
      setStatus(nextStatus);
    } catch (error) {
      setErrorMessage('Unable to disconnect from Raspberry Pi.');
      console.warn('[useRaspberryPiConnection] Disconnect failed', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const sendParameters = useCallback(async (parameters: TennisParameters) => {
    setErrorMessage(null);

    try {
      await raspberryPiService.sendParameters(parameters);
    } catch (error) {
      setErrorMessage('Unable to send tennis parameters.');
      console.warn('[useRaspberryPiConnection] Send parameters failed', error);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  return {
    status,
    isLoading,
    errorMessage,
    connect,
    disconnect,
    refreshStatus,
    sendParameters,
  };
}
