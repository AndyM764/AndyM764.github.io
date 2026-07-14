import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { TennisParameters } from '../types/tennisParameters';
import { ParameterSlider } from './ParameterSlider';
import { PrimaryButton } from './PrimaryButton';
import { SectionCard } from './SectionCard';

interface TennisParametersPanelProps {
  parameters: TennisParameters;
  onSpeedChange: (value: number) => void;
  onAngleChange: (value: number) => void;
  onFrequencyChange: (value: number) => void;
  onReset: () => void;
  onSend: (parameters: TennisParameters) => Promise<void>;
}

export function TennisParametersPanel({
  parameters,
  onSpeedChange,
  onAngleChange,
  onFrequencyChange,
  onReset,
  onSend,
}: TennisParametersPanelProps) {
  const [isSending, setIsSending] = useState(false);

  const handleSend = async () => {
    setIsSending(true);

    try {
      await onSend(parameters);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <SectionCard
      title="Tennis Parameters"
      subtitle="Tune the launcher values live and send the JSON payload when ready."
    >
      <ParameterSlider
        label="Ball Speed"
        maximumValue={250}
        minimumValue={0}
        onValueChange={onSpeedChange}
        step={1}
        unit="km/h"
        value={parameters.speed}
      />
      <ParameterSlider
        label="Launch Angle"
        maximumValue={90}
        minimumValue={0}
        onValueChange={onAngleChange}
        step={1}
        unit="deg"
        value={parameters.angle}
      />
      <ParameterSlider
        label="Ball Frequency"
        maximumValue={20}
        minimumValue={0}
        onValueChange={onFrequencyChange}
        step={1}
        unit="balls/sec"
        value={parameters.frequency}
      />

      <View style={styles.payloadPreview}>
        <Text style={styles.payloadTitle}>Payload preview</Text>
        <Text style={styles.payloadText}>{JSON.stringify(parameters, null, 2)}</Text>
      </View>

      <View style={styles.buttonRow}>
        <PrimaryButton
          disabled={isSending}
          label={isSending ? 'Sending...' : 'Send Parameters'}
          onPress={handleSend}
          style={styles.flexButton}
        />
        <PrimaryButton label="Reset" onPress={onReset} style={styles.flexButton} variant="secondary" />
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  payloadPreview: {
    backgroundColor: '#020617',
    borderColor: '#334155',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  payloadTitle: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  payloadText: {
    color: '#bae6fd',
    fontFamily: 'Courier',
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
