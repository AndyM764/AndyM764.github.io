import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { RaspberryPiConnectionStatus } from '../types/raspberryPi';
import { PrimaryButton } from './PrimaryButton';
import { SectionCard } from './SectionCard';

interface ConnectionPanelProps {
  status: RaspberryPiConnectionStatus;
  isLoading: boolean;
  errorMessage: string | null;
  onTestConnection: () => void;
}

export function ConnectionPanel({
  status,
  isLoading,
  errorMessage,
  onTestConnection,
}: ConnectionPanelProps) {
  const isConnected = status.state === 'connected';

  return (
    <SectionCard
      title="Connection Status"
      subtitle="Checks the Raspberry Pi at http://10.136.19.4:5000."
    >
      <View style={styles.statusRow}>
        <View style={[styles.connectionBadge, isConnected ? styles.connectedBadge : styles.disconnectedBadge]}>
          <Text style={styles.connectionLabel}>
            {isConnected ? 'Connected to Raspberry Pi' : 'Disconnected'}
          </Text>
        </View>
        {isLoading ? <ActivityIndicator color="#38bdf8" /> : null}
      </View>

      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Raspberry Pi IP Address</Text>
        <Text style={styles.detailValue}>{status.ipAddress ?? 'Not available'}</Text>
      </View>

      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

      <PrimaryButton disabled={isLoading} label="Test Connection" onPress={onTestConnection} />
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  connectionBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  connectedBadge: {
    backgroundColor: '#16a34a',
  },
  disconnectedBadge: {
    backgroundColor: '#475569',
  },
  connectionLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
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
});
