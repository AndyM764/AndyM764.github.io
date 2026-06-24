import { useCallback, useState } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppButton } from "../components/AppButton";
import { AppCard } from "../components/AppCard";
import { BallMachineControl } from "../components/BallMachineControl";
import { CameraPreviewPanel } from "../components/CameraPreviewPanel";
import { ConnectionStatusCard } from "../components/ConnectionStatusCard";
import { RaspberryPiInfoCard } from "../components/RaspberryPiInfoCard";
import { RecordingControls } from "../components/RecordingControls";
import { StatusMessage } from "../components/StatusMessage";
import { TennisParameterSlider } from "../components/TennisParameterSlider";
import { useRaspberryPi } from "../hooks/useRaspberryPi";
import { useRecordingState } from "../hooks/useRecordingState";
import { useTennisParameters } from "../hooks/useTennisParameters";
import { raspberryPiService } from "../services/RaspberryPiService";
import type { BallMachinePower, ServiceResult } from "../types/raspberryPi";

export function HomeScreen() {
  const raspberryPi = useRaspberryPi();
  const tennisParameters = useTennisParameters();
  const recording = useRecordingState();

  const [ballMachinePower, setBallMachinePower] = useState<BallMachinePower>("off");
  const [isUpdatingBallMachine, setIsUpdatingBallMachine] = useState(false);
  const [ballMachineResult, setBallMachineResult] = useState<ServiceResult | null>(null);

  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [isUpdatingCamera, setIsUpdatingCamera] = useState(false);
  const [cameraStreamUrl, setCameraStreamUrl] = useState<string | null>(null);
  const [cameraResult, setCameraResult] = useState<ServiceResult | null>(null);

  const handleBallMachinePower = useCallback(async (power: BallMachinePower) => {
    setIsUpdatingBallMachine(true);
    setBallMachineResult(null);

    try {
      const result = await raspberryPiService.setBallMachinePower(power);
      setBallMachineResult(result);

      if (result.success) {
        setBallMachinePower(power);
      }
    } catch (error) {
      setBallMachineResult({
        success: false,
        message: error instanceof Error ? error.message : "Unable to update ball machine power."
      });
    } finally {
      setIsUpdatingBallMachine(false);
    }
  }, []);

  const handleToggleCamera = useCallback(async (enabled: boolean) => {
    setIsUpdatingCamera(true);
    setCameraResult(null);

    try {
      const result = await raspberryPiService.setCameraEnabled(enabled);
      setCameraResult(result);

      if (result.success && enabled) {
        setCameraStreamUrl(raspberryPiService.getCameraStreamUrl());
        setCameraEnabled(true);
      } else if (result.success) {
        setCameraStreamUrl(null);
        setCameraEnabled(false);
      }
    } catch (error) {
      setCameraResult({
        success: false,
        message: error instanceof Error ? error.message : "Unable to update Raspberry Pi camera."
      });
    } finally {
      setIsUpdatingCamera(false);
    }
  }, []);

  const sendResultTone = tennisParameters.sendResult?.success ? "success" : "error";

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>CourtVision.V3</Text>
          <Text style={styles.subtitle}>
            Raspberry Pi controlled tennis training system
          </Text>
        </View>

        <BallMachineControl
          isUpdating={isUpdatingBallMachine}
          onChangePower={handleBallMachinePower}
          power={ballMachinePower}
          result={ballMachineResult}
        />

        <RaspberryPiInfoCard info={raspberryPi.piInfo} />

        <ConnectionStatusCard
          isRefreshing={raspberryPi.isRefreshing}
          onRefresh={raspberryPi.refresh}
          status={raspberryPi.connectionStatus}
        />
        <StatusMessage message={raspberryPi.errorMessage} tone="error" />

        <CameraPreviewPanel
          cameraEnabled={cameraEnabled}
          isUpdating={isUpdatingCamera}
          onToggleCamera={handleToggleCamera}
          result={cameraResult}
          streamUrl={cameraStreamUrl}
        />

        <RecordingControls
          errorMessage={recording.errorMessage}
          lastSavedVideoPath={recording.lastSavedVideoPath}
          onStartRecording={recording.startRecording}
          onStopRecording={recording.stopRecording}
          recordingState={recording.recordingState}
        />

        <AppCard title="Tennis Parameters">
          <TennisParameterSlider
            label="Ball Speed"
            maximumValue={250}
            minimumValue={0}
            onValueChange={tennisParameters.setSpeed}
            step={1}
            unit="km/h"
            value={tennisParameters.speed}
          />
          <TennisParameterSlider
            label="Launch Angle"
            maximumValue={90}
            minimumValue={0}
            onValueChange={tennisParameters.setAngle}
            step={1}
            unit="degrees"
            value={tennisParameters.angle}
          />
          <TennisParameterSlider
            label="Ball Frequency"
            maximumValue={20}
            minimumValue={0}
            onValueChange={tennisParameters.setFrequency}
            step={1}
            unit="balls/sec"
            value={tennisParameters.frequency}
          />
          <AppButton
            disabled={tennisParameters.isSending}
            onPress={tennisParameters.sendParameters}
            title={tennisParameters.isSending ? "Sending..." : "Send Parameters"}
          />
          <StatusMessage message={tennisParameters.sendResult?.message ?? null} tone={sendResultTone} />
        </AppCard>

        <AppCard title="Future Expansion">
          <Text style={styles.futureText}>TODO: TrackNet</Text>
          <Text style={styles.futureText}>TODO: Computer Vision</Text>
          <Text style={styles.futureText}>TODO: Machine Learning</Text>
          <Text style={styles.futureText}>TODO: Shot Detection</Text>
          <Text style={styles.futureText}>TODO: Cloud Processing</Text>
          <Text style={styles.futureText}>TODO: Real-time Raspberry Pi telemetry</Text>
        </AppCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 18,
    padding: 18,
    paddingBottom: 36
  },
  futureText: {
    color: "#334155",
    fontSize: 15,
    fontWeight: "700"
  },
  header: {
    gap: 6
  },
  safeArea: {
    backgroundColor: "#f8fafc",
    flex: 1
  },
  subtitle: {
    color: "#475569",
    fontSize: 16,
    fontWeight: "600"
  },
  title: {
    color: "#0f172a",
    fontSize: 34,
    fontWeight: "900"
  }
});
