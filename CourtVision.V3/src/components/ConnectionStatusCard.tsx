import { StyleSheet, Text, View } from "react-native";

import type { ConnectionStatus } from "../types/raspberryPi";
import { AppButton } from "./AppButton";
import { AppCard } from "./AppCard";

type ConnectionStatusCardProps = {
  status: ConnectionStatus;
  isRefreshing: boolean;
  onRefresh: () => void;
};

export function ConnectionStatusCard({
  status,
  isRefreshing,
  onRefresh
}: ConnectionStatusCardProps) {
  const isConnected = status === "connected";

  return (
    <AppCard title="Connection Status">
      <View style={styles.statusRow}>
        <View style={[styles.dot, isConnected ? styles.connectedDot : styles.disconnectedDot]} />
        <Text style={styles.statusText}>{isConnected ? "Connected" : "Disconnected"}</Text>
      </View>
      <AppButton
        disabled={isRefreshing}
        onPress={onRefresh}
        title={isRefreshing ? "Refreshing..." : "Refresh"}
      />
    </AppCard>
  );
}

const styles = StyleSheet.create({
  connectedDot: {
    backgroundColor: "#16a34a"
  },
  disconnectedDot: {
    backgroundColor: "#dc2626"
  },
  dot: {
    borderRadius: 8,
    height: 16,
    width: 16
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10
  },
  statusText: {
    color: "#0f172a",
    fontSize: 18,
    fontWeight: "700"
  }
});
