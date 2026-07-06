import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { RaspberryPiConnectionStatus } from '../types/raspberryPi';
import { PrimaryButton } from './PrimaryButton';
import { SectionCard } from './SectionCard';
import { StatusBadge } from './StatusBadge';

interface ConnectionPanelProps {
  status: RaspberryPiConnectionStatus;
  isLoading: boolean;
  errorMessage: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
}

export function ConnectionPanel({
  status,
  isLoading,
  errorMessage,
  onConnect,
  onDisconnect,
  onRefresh,
}: ConnectionPanelProps) {
  const isConnected = status.state === 'connected';

  return (
    <SectionCard
      title="Raspberry Pi WiFi"
      subtitle="Mock connection today, ready for a real Raspberry Pi REST API later."
    >
      <View style={styles.statusRow}>
        <StatusBadge
          label={isConnected ? 'Connected' : 'Disconnected'}
          status={isConnected ? 'success' : 'neutral'}
        />
        {isLoading ? <ActivityIndicator color="#38bdf8" /> : null}
      </View>

      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Raspberry Pi IP Address</Text>
        <Text style={styles.detailValue}>{status.ipAddress ?? 'Not available'}</Text>
      </View>

      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

      <View style={styles.buttonRow}>
        <PrimaryButton
          disabled={isLoading || isConnected}
          label="Connect"
          onPress={onConnect}
          style={styles.flexButton}
        />
        <PrimaryButton
          disabled={isLoading || !isConnected}
          label="Disconnect"
          onPress={onDisconnect}
          style={styles.flexButton}
          variant="secondary"
        />
      </View>

      <PrimaryButton disabled={isLoading} label="Refresh Status" onPress={onRefresh} variant="secondary" />
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailRow: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    gap: 6,
    padding: 14,
  },
  detailLabel: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  detailValue: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '800',
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  flexButton: {
    flex: 1,
  },
});
