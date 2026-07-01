import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";

import { ConnectionStatusCard } from "../components/ConnectionStatusCard";
import { RaspberryPiInfoCard } from "../components/RaspberryPiInfoCard";
import { RecordingControls } from "../components/RecordingControls";
import { StatusMessage } from "../components/StatusMessage";
import { useRaspberryPi } from "../hooks/useRaspberryPi";
import { useRecordingState } from "../hooks/useRecordingState";

export function HomeScreen() {
  const raspberryPi = useRaspberryPi();
  const recording = useRecordingState();

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>CourtVision V4</Text>
          <Text style={styles.subtitle}>Recording MVP — Pi camera to playable phone MP4</Text>
        </View>

        <RaspberryPiInfoCard info={raspberryPi.piInfo} />

        <ConnectionStatusCard
          isRefreshing={raspberryPi.isRefreshing}
          onRefresh={raspberryPi.refresh}
          status={raspberryPi.connectionStatus}
        />
        <StatusMessage message={raspberryPi.errorMessage} tone="error" />

        <RecordingControls
          errorMessage={recording.errorMessage}
          lastSavedVideo={recording.lastSavedVideo}
          onStartRecording={recording.startRecording}
          onStopRecording={recording.stopRecording}
          recordingState={recording.recordingState}
        />
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
