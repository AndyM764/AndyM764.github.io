import { StyleSheet, Text, View } from "react-native";

import type { RecordingState } from "../types/recording";
import { AppButton } from "./AppButton";
import { AppCard } from "./AppCard";
import { StatusMessage } from "./StatusMessage";

type RecordingControlsProps = {
  recordingState: RecordingState;
  lastSavedVideoPath: string | null;
  errorMessage: string | null;
  onStartRecording: () => void;
  onStopRecording: () => void;
};

export function RecordingControls({
  recordingState,
  lastSavedVideoPath,
  errorMessage,
  onStartRecording,
  onStopRecording
}: RecordingControlsProps) {
  const isRecording = recordingState === "recording";
  const isSaving = recordingState === "saving";

  return (
    <AppCard title="Video Recording">
      <Text style={styles.state}>Current state: {formatRecordingState(recordingState)}</Text>
      <View style={styles.buttonRow}>
        <AppButton
          disabled={isRecording || isSaving}
          onPress={onStartRecording}
          title="Start Recording"
        />
        <AppButton
          disabled={!isRecording || isSaving}
          onPress={onStopRecording}
          title={isSaving ? "Saving..." : "Stop Recording"}
          variant="danger"
        />
      </View>
      <Text style={styles.pathLabel}>Last saved video path</Text>
      <Text style={styles.pathValue}>{lastSavedVideoPath ?? "Not available"}</Text>
      <StatusMessage message={errorMessage} tone="error" />
    </AppCard>
  );
}

function formatRecordingState(recordingState: RecordingState): string {
  switch (recordingState) {
    case "idle":
      return "Idle";
    case "recording":
      return "Recording";
    case "saving":
      return "Saving";
  }
}

const styles = StyleSheet.create({
  buttonRow: {
    flexDirection: "row",
    gap: 12
  },
  pathLabel: {
    color: "#64748b",
    fontSize: 14,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  pathValue: {
    color: "#0f172a",
    fontSize: 14,
    fontWeight: "600"
  },
  state: {
    color: "#334155",
    fontSize: 16,
    fontWeight: "700"
  }
});
