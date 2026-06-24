import Slider from "@react-native-community/slider";
import { StyleSheet, Text, View } from "react-native";

type TennisParameterSliderProps = {
  label: string;
  value: number;
  minimumValue: number;
  maximumValue: number;
  step: number;
  unit: string;
  onValueChange: (value: number) => void;
};

export function TennisParameterSlider({
  label,
  value,
  minimumValue,
  maximumValue,
  step,
  unit,
  onValueChange
}: TennisParameterSliderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>
          {value} {unit}
        </Text>
      </View>
      <Slider
        maximumTrackTintColor="#cbd5e1"
        maximumValue={maximumValue}
        minimumTrackTintColor="#2563eb"
        minimumValue={minimumValue}
        onValueChange={onValueChange}
        step={step}
        thumbTintColor="#2563eb"
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  label: {
    color: "#334155",
    fontSize: 16,
    fontWeight: "700"
  },
  value: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "800"
  }
});
