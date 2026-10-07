import { StyleSheet, Text, View } from 'react-native';

interface StatusBadgeProps {
  label: string;
  status: 'success' | 'neutral' | 'warning' | 'danger';
}

export function StatusBadge({ label, status }: StatusBadgeProps) {
  return (
    <View style={[styles.badge, styles[status]]}>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  success: {
    backgroundColor: '#16a34a',
  },
  neutral: {
    backgroundColor: '#475569',
  },
  warning: {
    backgroundColor: '#d97706',
  },
  danger: {
    backgroundColor: '#dc2626',
  },
  label: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
});
