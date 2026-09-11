import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CalendarEvent } from '../domain/types';

interface EventDetailsModalProps {
  event: CalendarEvent | null;
  readOnly: boolean;
  onClose: () => void;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (event: CalendarEvent) => void;
  onCopy: (event: CalendarEvent) => void;
  onHide: (event: CalendarEvent) => void;
  notePath?: string;
  onNoteAction: (event: CalendarEvent, existingPath?: string) => void;
}

export function EventDetailsModal({
  event,
  readOnly,
  onClose,
  onEdit,
  onDelete,
  onCopy,
  onHide,
  notePath,
  onNoteAction,
}: EventDetailsModalProps): React.JSX.Element {
  if (!event) return <></>;
  const recurrenceWarning = event.recurrenceError && event.recurrenceError.length > 240
    ? `${event.recurrenceError.slice(0, 237)}...`
    : event.recurrenceError;
  const when = event.allDay
    ? event.start.toLocaleDateString()
    : `${event.start.toLocaleDateString()} · ${event.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}–${event.end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

  return (
    <Modal visible transparent animationType="fade">
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.content} onStartShouldSetResponder={() => true}>
          <View style={styles.header}>
            <Text allowFontScaling={false} style={styles.title} numberOfLines={2}>{event.summary}</Text>
            <TouchableOpacity onPress={onClose}><Text allowFontScaling={false} style={styles.close}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView style={styles.details}>
            <Text allowFontScaling={false} style={styles.when}>{when}</Text>
            <Text allowFontScaling={false} style={styles.source}>
              {readOnly ? 'Read-only subscribed calendar' : 'Editable calendar event'} · {event.calendarName || 'Calendar'}
            </Text>
            {recurrenceWarning ? (
              <Text allowFontScaling={false} style={styles.warning}>
                Recurrence not expanded: {recurrenceWarning}. Only the original event is shown.
              </Text>
            ) : null}
            {event.location ? <Text allowFontScaling={false} style={styles.body}>📍 {event.location}</Text> : null}
            {event.description ? <Text allowFontScaling={false} style={styles.body}>{event.description}</Text> : null}
          </ScrollView>

          {/* Short timed blocks and all-day rows cannot safely fit inline
              controls. Details is therefore the universal route to an event
              note, regardless of duration, recurrence, or source calendar. */}
          <TouchableOpacity style={styles.noteAction} onPress={() => onNoteAction(event, notePath)}>
            <Text allowFontScaling={false} style={styles.noteActionText}>
              {notePath ? '📂 Open Note' : '📝 Create Note'}
            </Text>
          </TouchableOpacity>

          {readOnly ? (
            <>
              <Text allowFontScaling={false} style={styles.explanation}>
                Subscription links can be read but cannot send changes back to Google. Make a local copy to edit it, or hide it only on this Supernote.
              </Text>
              <View style={styles.actions}>
                <TouchableOpacity style={styles.primary} onPress={() => onCopy(event)}>
                  <Text allowFontScaling={false} style={styles.primaryText}>Copy as Editable</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondary} onPress={() => onHide(event)}>
                  <Text allowFontScaling={false} style={styles.secondaryText}>Hide on Supernote</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={styles.actions}>
              <TouchableOpacity style={styles.primary} onPress={() => onEdit(event)}>
                <Text allowFontScaling={false} style={styles.primaryText}>Edit Event</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={() => onDelete(event)}>
                <Text allowFontScaling={false} style={styles.secondaryText}>Delete Event</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 18 },
  content: { width: '68%', maxWidth: 720, maxHeight: '76%', backgroundColor: '#fff', borderWidth: 2, borderColor: '#000', borderRadius: 8, padding: 14 },
  header: { flexDirection: 'row', alignItems: 'flex-start', borderBottomWidth: 1, borderBottomColor: '#000', paddingBottom: 8 },
  title: { flex: 1, fontSize: 19, fontWeight: 'bold', color: '#000' },
  close: { fontSize: 20, fontWeight: 'bold', color: '#000', paddingLeft: 12 },
  details: { maxHeight: 260 },
  when: { fontSize: 16, fontWeight: 'bold', color: '#000', marginTop: 12 },
  source: { fontSize: 13, color: '#303030', backgroundColor: '#eee', padding: 7, marginVertical: 9 },
  warning: { fontSize: 13, color: '#000', borderWidth: 2, borderColor: '#000', padding: 8, marginBottom: 9 },
  body: { fontSize: 14, color: '#000', marginBottom: 8 },
  noteAction: { borderWidth: 2, borderColor: '#000', borderRadius: 6, paddingVertical: 11, alignItems: 'center', marginTop: 10 },
  noteActionText: { color: '#000', fontSize: 15, fontWeight: 'bold' },
  explanation: { fontSize: 12, color: '#303030', marginVertical: 10 },
  actions: { flexDirection: 'row', marginTop: 10 },
  primary: { flex: 1, backgroundColor: '#000', borderRadius: 6, paddingVertical: 12, alignItems: 'center', marginRight: 6 },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  secondary: { flex: 1, borderWidth: 2, borderColor: '#000', borderRadius: 6, paddingVertical: 10, alignItems: 'center', marginLeft: 6 },
  secondaryText: { color: '#000', fontSize: 15, fontWeight: 'bold' },
});
