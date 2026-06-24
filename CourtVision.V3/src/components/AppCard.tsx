import type { PropsWithChildren } from "react";
import { StyleSheet, Text, View } from "react-native";

type AppCardProps = PropsWithChildren<{
  title: string;
}>;

export function AppCard({ title, children }: AppCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 18,
    borderWidth: 1,
    gap: 14,
    padding: 18,
    shadowColor: "#0f172a",
    shadowOffset: {
      height: 8,
      width: 0
    },
    shadowOpacity: 0.08,
    shadowRadius: 18
  },
  title: {
    color: "#0f172a",
    fontSize: 20,
    fontWeight: "800"
  }
});
