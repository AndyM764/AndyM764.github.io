import Slider from '@react-native-community/slider';
import { StyleSheet, Text, View } from 'react-native';

interface ParameterSliderProps {
  label: string;
  value: number;
  minimumValue: number;
  maximumValue: number;
  step: number;
  unit: string;
  onValueChange: (value: number) => void;
}

export function ParameterSlider({
  label,
  value,
  minimumValue,
  maximumValue,
  step,
  unit,
  onValueChange,
}: ParameterSliderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>
          {value} {unit}
        </Text>
      </View>
      <Slider
        accessibilityLabel={label}
        maximumTrackTintColor="#475569"
        maximumValue={maximumValue}
        minimumTrackTintColor="#38bdf8"
        minimumValue={minimumValue}
        onValueChange={(nextValue) => onValueChange(Math.round(nextValue))}
        step={step}
        thumbTintColor="#f8fafc"
        value={value}
      />
      <View style={styles.rangeRow}>
        <Text style={styles.rangeText}>
          {minimumValue} {unit}
        </Text>
        <Text style={styles.rangeText}>
          {maximumValue} {unit}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  label: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '700',
  },
  value: {
    color: '#38bdf8',
    fontSize: 16,
    fontWeight: '800',
  },
  rangeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rangeText: {
    color: '#94a3b8',
    fontSize: 12,
  },
});
