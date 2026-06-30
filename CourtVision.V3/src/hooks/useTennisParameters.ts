import { useCallback, useState } from "react";

import { raspberryPiService } from "../services/RaspberryPiService";
import type { ParameterTransmissionResult, TennisParameters } from "../types/tennisParameters";

type UseTennisParametersResult = TennisParameters & {
  isSending: boolean;
  sendResult: ParameterTransmissionResult | null;
  setSpeed: (value: number) => void;
  setElevation: (value: number) => void;
  setSpin: (value: number) => void;
  setFrequency: (value: number) => void;
  sendParameters: () => Promise<void>;
};

export function useTennisParameters(): UseTennisParametersResult {
  const [speed, setSpeed] = useState(0);
  const [elevation, setElevation] = useState(0);
  const [spin, setSpin] = useState(0);
  const [frequency, setFrequency] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<ParameterTransmissionResult | null>(null);

  const sendParameters = useCallback(async () => {
    setIsSending(true);
    setSendResult(null);

    try {
      const result = await raspberryPiService.sendParameters({
        speed,
        elevation,
        spin,
        frequency
      });
      setSendResult(result);
    } catch (error) {
      setSendResult({
        success: false,
        message: error instanceof Error ? error.message : "Unable to send tennis parameters."
      });
    } finally {
      setIsSending(false);
    }
  }, [elevation, frequency, speed, spin]);

  return {
    speed,
    elevation,
    spin,
    frequency,
    isSending,
    sendResult,
    setSpeed,
    setElevation,
    setSpin,
    setFrequency,
    sendParameters
  };
}
