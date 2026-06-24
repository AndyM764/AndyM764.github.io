import { StyleSheet, Text } from "react-native";

type StatusMessageProps = {
  message: string | null;
  tone?: "info" | "success" | "error";
};

export function StatusMessage({ message, tone = "info" }: StatusMessageProps) {
  if (!message) {
    return null;
  }

  return <Text style={[styles.message, styles[tone]]}>{message}</Text>;
}

const styles = StyleSheet.create({
  error: {
    backgroundColor: "#fee2e2",
    color: "#991b1b"
  },
  info: {
    backgroundColor: "#e0f2fe",
    color: "#075985"
  },
  message: {
    borderRadius: 10,
    fontSize: 14,
    fontWeight: "700",
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  success: {
    backgroundColor: "#dcfce7",
    color: "#166534"
  }
});
