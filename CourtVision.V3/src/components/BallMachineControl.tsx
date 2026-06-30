import { StyleSheet, Text, View } from "react-native";

import type { BallMachinePower, ServiceResult } from "../types/raspberryPi";
import { AppButton } from "./AppButton";
import { AppCard } from "./AppCard";
import { StatusMessage } from "./StatusMessage";

type BallMachineControlProps = {
  power: BallMachinePower;
  isUpdating: boolean;
  result: ServiceResult | null;
  onChangePower: (power: BallMachinePower) => void;
};

export function BallMachineControl({
  power,
  isUpdating,
  result,
  onChangePower
}: BallMachineControlProps) {
  return (
    <AppCard title="Ball Machine Control">
      <Text style={styles.currentValue}>Selected: {power.toUpperCase()}</Text>
      <View style={styles.buttonRow}>
        <AppButton
          disabled={isUpdating}
          onPress={() => onChangePower("on")}
          title="Ball Machine ON"
          variant={power === "on" ? "primary" : "secondary"}
        />
        <AppButton
          disabled={isUpdating}
          onPress={() => onChangePower("off")}
          title="Ball Machine OFF"
          variant={power === "off" ? "primary" : "secondary"}
        />
      </View>
      <StatusMessage
        message={result?.message ?? null}
        tone={result?.success ? "success" : "error"}
      />
    </AppCard>
  );
}

const styles = StyleSheet.create({
  buttonRow: {
    flexDirection: "row",
    gap: 12
  },
  currentValue: {
    color: "#334155",
    fontSize: 16,
    fontWeight: "700"
  }
});
