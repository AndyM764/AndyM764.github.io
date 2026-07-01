import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";

import type { RecordingState, SavedVideo } from "../types/recording";
import { AppButton } from "./AppButton";
import { AppCard } from "./AppCard";
import { StatusMessage } from "./StatusMessage";

type RecordingControlsProps = {
  recordingState: RecordingState;
  lastSavedVideo: SavedVideo | null;
  errorMessage: string | null;
  onStartRecording: () => void;
  onStopRecording: () => void;
};

export function RecordingControls({
  recordingState,
  lastSavedVideo,
  errorMessage,
  onStartRecording,
  onStopRecording
}: RecordingControlsProps) {
  const isRecording = recordingState === "recording";
  const isSaving = recordingState === "saving";

  const player = useVideoPlayer(null, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.muted = false;
  });

  useEffect(() => {
    if (lastSavedVideo?.path) {
      player.replace({ uri: lastSavedVideo.path });
      player.play();
      return;
    }

    player.pause();
    player.replace(null);
  }, [lastSavedVideo, player]);

  return (
    <AppCard title="Recording MVP">
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

      {lastSavedVideo ? (
        <View style={styles.playbackBlock}>
          <Text style={styles.pathLabel}>Saved recording</Text>
          <Text style={styles.pathValue}>{lastSavedVideo.filename}</Text>
          <Text style={styles.pathValue}>{lastSavedVideo.path}</Text>
          <Text style={styles.pathValue}>{formatBytes(lastSavedVideo.size)}</Text>
          <View style={styles.preview}>
            <VideoView
              allowsFullscreen
              contentFit="contain"
              nativeControls
              player={player}
              style={styles.video}
            />
          </View>
        </View>
      ) : (
        <Text style={styles.pathValue}>No saved recording yet.</Text>
      )}

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

function formatBytes(size: number): string {
  return `${size.toLocaleString()} bytes`;
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
  playbackBlock: {
    gap: 8
  },
  preview: {
    aspectRatio: 16 / 9,
    backgroundColor: "#0f172a",
    borderRadius: 14,
    overflow: "hidden"
  },
  state: {
    color: "#334155",
    fontSize: 16,
    fontWeight: "700"
  },
  video: {
    height: "100%",
    width: "100%"
  }
});
