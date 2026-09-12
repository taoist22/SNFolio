import { useTimeFormat } from './TimeFormatContext';
import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { clampToDay, formatTimeOfDay, isPm, withMeridiem } from '../domain/timeOfDay';

interface TimePickerModalProps {
  visible: boolean;
  title: string;
  value: number;
  onSelect: (minutes: number) => void;
  onClose: () => void;
}

/** Large, tap-only clock designed for e-ink; no keyboard or scrolling wheel. */
export function TimePickerModal({
  visible,
  title,
  value,
  onSelect,
  onClose,
}: TimePickerModalProps): React.JSX.Element {
  const timeFormat = useTimeFormat();
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

  const chooseHour = (hour12: number) => {
    const hour = timeFormat === '24h' ? hour12 : hour12 % 12 + (isPm(draft) ? 12 : 0);
    setDraft(hour * 60 + (draft % 60));
  };

  const chooseMinute = (minute: number) => {
    setDraft(Math.floor(draft / 60) * 60 + minute);
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.content} onStartShouldSetResponder={() => true}>
          <View style={styles.header}>
            <Text allowFontScaling={false} style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose}>
              <Text allowFontScaling={false} style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text allowFontScaling={false} style={styles.preview}>{formatTimeOfDay(draft, timeFormat)}</Text>

          <View style={styles.hourGrid}>
            {Array.from({ length: timeFormat === '24h' ? 24 : 12 }, (_, index) => timeFormat === '24h' ? index : index + 1).map(hour => {
              const selected = (timeFormat === '24h' ? Math.floor(draft / 60) : (Math.floor(draft / 60) % 12 || 12)) === hour;
              return (
                <TouchableOpacity
                  key={timeFormat === '24h' ? String(hour).padStart(2, '0') : hour}
                  style={[styles.hourButton, selected && styles.selected]}
                  onPress={() => chooseHour(hour)}
                >
                  <Text allowFontScaling={false} style={[styles.buttonText, selected && styles.selectedText]}>
                    {timeFormat === '24h' ? String(hour).padStart(2, '0') : hour}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.row}>
            {[0, 15, 30, 45].map(minute => {
              const selected = draft % 60 === minute;
              return (
                <TouchableOpacity
                  key={minute}
                  style={[styles.minuteButton, selected && styles.selected]}
                  onPress={() => chooseMinute(minute)}
                >
                  <Text allowFontScaling={false} style={[styles.buttonText, selected && styles.selectedText]}>
                    :{String(minute).padStart(2, '0')}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.row}>
            <TouchableOpacity style={styles.adjustButton} onPress={() => setDraft(clampToDay(draft - 5))}>
              <Text allowFontScaling={false} style={styles.buttonText}>−5 min</Text>
            </TouchableOpacity>
            {timeFormat === '12h' && (['AM', 'PM'] as const).map(part => {
              const selected = isPm(draft) === (part === 'PM');
              return (
                <TouchableOpacity
                  key={part}
                  style={[styles.meridiemButton, selected && styles.selected]}
                  onPress={() => setDraft(withMeridiem(draft, part === 'PM'))}
                >
                  <Text allowFontScaling={false} style={[styles.buttonText, selected && styles.selectedText]}>{part}</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={styles.adjustButton} onPress={() => setDraft(clampToDay(draft + 5))}>
              <Text allowFontScaling={false} style={styles.buttonText}>+5 min</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => {
              onSelect(draft);
              onClose();
            }}
          >
            <Text allowFontScaling={false} style={styles.doneText}>Use {formatTimeOfDay(draft, timeFormat)}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  content: { width: '62%', maxWidth: 620, backgroundColor: '#fff', borderWidth: 2, borderColor: '#000', borderRadius: 8, padding: 14 },
  header: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#000', paddingBottom: 8 },
  title: { fontSize: 18, fontWeight: 'bold', color: '#000' },
  close: { fontSize: 20, fontWeight: 'bold', color: '#000' },
  preview: { fontSize: 28, fontWeight: 'bold', color: '#000', textAlign: 'center', marginVertical: 14 },
  hourGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  hourButton: { width: '15%', minHeight: 48, borderWidth: 2, borderColor: '#000', borderRadius: 5, margin: 3, justifyContent: 'center', alignItems: 'center' },
  row: { flexDirection: 'row', justifyContent: 'center', marginTop: 8 },
  minuteButton: { flex: 1, minHeight: 48, borderWidth: 2, borderColor: '#000', borderRadius: 5, marginHorizontal: 3, justifyContent: 'center', alignItems: 'center' },
  adjustButton: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: '#000', borderRadius: 5, marginHorizontal: 3, justifyContent: 'center', alignItems: 'center' },
  meridiemButton: { flex: 1, minHeight: 48, borderWidth: 2, borderColor: '#000', borderRadius: 5, marginHorizontal: 3, justifyContent: 'center', alignItems: 'center' },
  selected: { backgroundColor: '#000' },
  buttonText: { fontSize: 15, fontWeight: 'bold', color: '#000' },
  selectedText: { color: '#fff' },
  doneButton: { backgroundColor: '#000', borderRadius: 6, paddingVertical: 13, alignItems: 'center', marginTop: 12 },
  doneText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
