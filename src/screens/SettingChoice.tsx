import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface SettingChoiceProps {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  labels?: readonly [string, string];
}

/** Explicit, high-contrast states for monochrome e-ink screens. */
export function SettingChoice({ label, value, onChange, labels = ['OFF', 'ON'] }: SettingChoiceProps): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text allowFontScaling={false} style={styles.label}>{label}</Text>
      <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {labels.map((text, index) => {
          const selected = value === (index === 1);
          return (
            <TouchableOpacity
              key={text}
              accessibilityRole="radio"
              accessibilityLabel={`${label}: ${text}`}
              accessibilityState={{ checked: selected }}
              style={[styles.button, selected && styles.selected]}
              onPress={() => onChange(index === 1)}
            >
              <Text allowFontScaling={false} style={[styles.text, selected && styles.selectedText]}>{text}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginVertical: 8 },
  label: { color: '#000', fontSize: 14, flexShrink: 1, marginRight: 12, marginVertical: 6 },
  choices: { flexDirection: 'row', flexShrink: 0 },
  button: { minWidth: 64, minHeight: 44, paddingHorizontal: 12, borderWidth: 2, borderColor: '#000', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginLeft: 4, borderRadius: 4 },
  selected: { backgroundColor: '#000' },
  text: { color: '#000', fontSize: 14, fontWeight: 'bold' },
  selectedText: { color: '#fff' },
});
