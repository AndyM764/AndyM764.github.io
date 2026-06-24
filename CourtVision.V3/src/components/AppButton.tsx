import { Pressable, StyleSheet, Text } from "react-native";

type AppButtonProps = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
};

export function AppButton({
  title,
  onPress,
  disabled = false,
  variant = "primary"
}: AppButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed
      ]}
    >
      <Text style={styles.text}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 18,
    paddingVertical: 12
  },
  danger: {
    backgroundColor: "#b42318"
  },
  disabled: {
    opacity: 0.45
  },
  pressed: {
    opacity: 0.8
  },
  primary: {
    backgroundColor: "#2563eb"
  },
  secondary: {
    backgroundColor: "#334155"
  },
  text: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700"
  }
});
