import { StyleSheet, Text, View } from "react-native";

import type { PiInfo } from "../types/raspberryPi";
import { AppCard } from "./AppCard";

type RaspberryPiInfoCardProps = {
  info: PiInfo | null;
};

export function RaspberryPiInfoCard({ info }: RaspberryPiInfoCardProps) {
  return (
    <AppCard title="Raspberry Pi Information">
      <InfoRow label="Hostname" value={info?.hostname ?? "Not available"} />
      <InfoRow label="Current IP Address" value={info?.ip ?? "Not available"} />
    </AppCard>
  );
}

type InfoRowProps = {
  label: string;
  value: string;
};

function InfoRow({ label, value }: InfoRowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: "#64748b",
    fontSize: 14,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  row: {
    gap: 4
  },
  value: {
    color: "#0f172a",
    fontSize: 18,
    fontWeight: "700"
  }
});
