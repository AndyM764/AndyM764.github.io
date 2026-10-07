const SIMULATED_PI_HOST = '192.168.4.1';

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function connectToRaspberryPi() {
  await wait(900);

  return {
    connected: true,
    host: SIMULATED_PI_HOST,
    message: `Connected to CourtVision Pi at ${SIMULATED_PI_HOST} (simulated)`,
  };
}

export async function sendBallParameters(parameters) {
  await wait(500);

  const payload = {
    speedMph: parameters.speedMph,
    launchAngleDegrees: parameters.launchAngleDegrees,
    frequencyBallsPerMinute: parameters.frequencyBallsPerMinute,
    sentAt: new Date().toISOString(),
  };

  console.log('Mock payload ready for Raspberry Pi:', payload);

  return {
    ok: true,
    payload,
    message: 'Mock ball parameters prepared for the Raspberry Pi.',
  };
}

export const raspberryPiConfig = {
  simulated: true,
  host: SIMULATED_PI_HOST,
  futureEndpoint: `http://${SIMULATED_PI_HOST}:5000/api/ball-parameters`,
};
