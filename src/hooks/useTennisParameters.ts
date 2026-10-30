import { useCallback, useMemo, useState } from 'react';

import { TennisParameters } from '../types/tennisParameters';

const DEFAULT_PARAMETERS: TennisParameters = {
  speed: 120,
  angle: 35,
  frequency: 5,
};

export function useTennisParameters() {
  const [speed, setSpeed] = useState(DEFAULT_PARAMETERS.speed);
  const [angle, setAngle] = useState(DEFAULT_PARAMETERS.angle);
  const [frequency, setFrequency] = useState(DEFAULT_PARAMETERS.frequency);

  const parameters = useMemo<TennisParameters>(
    () => ({
      speed,
      angle,
      frequency,
    }),
    [angle, frequency, speed],
  );

  const resetParameters = useCallback(() => {
    setSpeed(DEFAULT_PARAMETERS.speed);
    setAngle(DEFAULT_PARAMETERS.angle);
    setFrequency(DEFAULT_PARAMETERS.frequency);
  }, []);

  return {
    parameters,
    setSpeed,
    setAngle,
    setFrequency,
    resetParameters,
  };
}
