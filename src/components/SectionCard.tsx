import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface SectionCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function SectionCard({ title, subtitle, children }: SectionCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
    borderRadius: 22,
    borderWidth: 1,
    padding: 18,
  },
  title: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '800',
  },
  subtitle: {
    color: '#cbd5e1',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  content: {
    gap: 14,
    marginTop: 18,
  },
});
