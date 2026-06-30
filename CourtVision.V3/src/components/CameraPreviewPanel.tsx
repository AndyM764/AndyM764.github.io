import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useVideoPlayer, VideoView, type VideoSource } from "expo-video";

import type { ServiceResult } from "../types/raspberryPi";
import { AppButton } from "./AppButton";
import { AppCard } from "./AppCard";
import { StatusMessage } from "./StatusMessage";

type CameraPreviewPanelProps = {
  cameraEnabled: boolean;
  isUpdating: boolean;
  streamUrl: string | null;
  recordingActive: boolean;
  result: ServiceResult | null;
  onToggleCamera: (enabled: boolean) => void;
};

export function CameraPreviewPanel({
  cameraEnabled,
  isUpdating,
  streamUrl,
  recordingActive,
  result,
  onToggleCamera
}: CameraPreviewPanelProps) {
  const player = useVideoPlayer(null, (videoPlayer) => {
    videoPlayer.loop = true;
    videoPlayer.muted = true;
  });

  useEffect(() => {
    if (cameraEnabled && streamUrl) {
      const hlsSource: VideoSource = {
        uri: streamUrl,
        contentType: "hls"
      };

      player.replace(hlsSource);
      player.play();
      return;
    }

    player.pause();
    player.replace(null);
  }, [cameraEnabled, player, streamUrl]);

  return (
    <AppCard title="Camera Preview">
      <Text style={styles.note}>
        Preview and recording cannot run at the same time on the Pi camera.
      </Text>
      <View style={styles.buttonRow}>
        <AppButton
          disabled={isUpdating || recordingActive}
          onPress={() => onToggleCamera(true)}
          title="Preview ON"
          variant={cameraEnabled ? "primary" : "secondary"}
        />
        <AppButton
          disabled={isUpdating}
          onPress={() => onToggleCamera(false)}
          title="Preview OFF"
          variant={!cameraEnabled ? "primary" : "secondary"}
        />
      </View>

      <View style={styles.preview}>
        {cameraEnabled && streamUrl ? (
          <VideoView
            allowsFullscreen
            contentFit="contain"
            nativeControls={false}
            player={player}
            style={styles.video}
          />
        ) : (
          <Text style={styles.blankText}>
            {recordingActive ? "Preview disabled during recording." : "Camera preview is off."}
          </Text>
        )}
      </View>

      <StatusMessage
        message={result?.message ?? null}
        tone={result?.success ? "success" : "error"}
      />
    </AppCard>
  );
}

const styles = StyleSheet.create({
  blankText: {
    color: "#64748b",
    fontSize: 16,
    fontWeight: "700"
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12
  },
  note: {
    color: "#64748b",
    fontSize: 14,
    fontWeight: "600"
  },
  preview: {
    alignItems: "center",
    aspectRatio: 16 / 9,
    backgroundColor: "#0f172a",
    borderRadius: 14,
    justifyContent: "center",
    overflow: "hidden"
  },
  video: {
    height: "100%",
    width: "100%"
  }
});
