import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { NoteKind } from '../domain/types';
import { FolderPickerModal } from './FolderPickerModal';
import { HandwritingTextInput, HandwritingTextInputHandle } from './HandwritingTextInput';

type EventNoteKind = Exclude<NoteKind, 'daily'>;
export type LinkedNoteKind = EventNoteKind | 'task';
type LocationMode = 'context' | 'default' | 'custom';

export interface EventNoteChoice {
  contextFolder?: string;
  contextLabel?: string;
  defaultFolder: string;
  defaultLabel: string;
  templateLabel: string;
}

interface CreateEventNoteModalProps {
  visible: boolean;
  eventKey?: string;
  eventTitle: string;
  mode?: 'event' | 'task';
  initialKind: LinkedNoteKind;
  initialName: string;
  preferContext: boolean;
  meeting?: EventNoteChoice;
  classNote?: EventNoteChoice;
  taskNote?: EventNoteChoice;
  onLinkExisting?: () => Promise<void>;
  onCancel: () => void;
  onCreate: (kind: LinkedNoteKind, folder: string, name: string) => void | Promise<void>;
}

/** Confirms note-specific choices only when a note is actually being created. */
export function CreateEventNoteModal({
  visible,
  eventKey,
  eventTitle,
  mode: itemMode = 'event',
  initialKind,
  initialName,
  preferContext,
  meeting,
  classNote,
  taskNote,
  onCancel,
  onCreate,
  onLinkExisting,
}: CreateEventNoteModalProps): React.JSX.Element {
  const [kind, setKind] = React.useState<LinkedNoteKind>(initialKind);
  const [name, setName] = React.useState(initialName);
  const nameInputRef = React.useRef<HandwritingTextInputHandle>(null);
  const [mode, setMode] = React.useState<LocationMode>('default');
  const [customFolder, setCustomFolder] = React.useState('');
  const [picking, setPicking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const choice = (kind === 'task' ? taskNote : kind === 'class' ? classNote : meeting) as EventNoteChoice;
  const initialChoice = (initialKind === 'task' ? taskNote : initialKind === 'class' ? classNote : meeting) as EventNoteChoice;
  const initialContextFolder = initialChoice?.contextFolder;

  React.useEffect(() => {
    if (!visible) return;
    setKind(initialKind);
    setName(initialName);
    setMode(preferContext && initialContextFolder ? 'context' : 'default');
    setCustomFolder('');
    setPicking(false);
    setBusy(false);
  }, [visible, eventKey, initialKind, initialName, preferContext, initialContextFolder]);

  React.useEffect(() => {
    if (mode === 'context' && !choice.contextFolder) setMode('default');
  }, [kind, mode, choice.contextFolder]);

  const selectedFolder = mode === 'context'
    ? choice.contextFolder || choice.defaultFolder
    : mode === 'custom'
      ? customFolder || choice.defaultFolder
      : choice.defaultFolder;

  return (
    <>
      <Modal visible={visible && !picking} transparent animationType="fade" onRequestClose={onCancel}>
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text allowFontScaling={false} style={styles.title}>Create {itemMode === 'task' ? 'Task' : 'Event'} Note</Text>
            <Text allowFontScaling={false} style={styles.eventTitle} numberOfLines={2}>“{eventTitle}”</Text>

            {itemMode === 'task' && onLinkExisting && (
              <TouchableOpacity
                disabled={busy}
                style={styles.location}
                onPress={async () => {
                  setBusy(true);
                  try { await onLinkExisting(); } finally { setBusy(false); }
                }}
              >
                <Text allowFontScaling={false} style={styles.locationLabel}>Link Existing Note</Text>
              </TouchableOpacity>
            )}

            <Text allowFontScaling={false} style={styles.label}>Note name</Text>
            <HandwritingTextInput
              ref={nameInputRef}
              style={styles.nameInput}
              value={name}
              onChangeText={setName}
              placeholder="Note name"
              placeholderTextColor="#707070"
              autoCorrect={false}
            />

            {itemMode === 'event' ? (
              <>
                <Text allowFontScaling={false} style={styles.label}>Note kind</Text>
                <View style={styles.choiceRow}>
                  <ChoiceButton label="🏢 Meeting" selected={kind === 'meeting'} onPress={() => setKind('meeting')} />
                  <ChoiceButton label="🎓 Class" selected={kind === 'class'} onPress={() => setKind('class')} />
                </View>
              </>
            ) : null}

            <Text allowFontScaling={false} style={styles.label}>Location</Text>
            {choice.contextFolder ? (
              <LocationButton
                label={`Follow ${choice.contextLabel || 'Project / Area'}`}
                path={choice.contextFolder}
                selected={mode === 'context'}
                onPress={() => setMode('context')}
              />
            ) : null}
            <LocationButton
              label={choice.defaultLabel}
              path={choice.defaultFolder}
              selected={mode === 'default'}
              onPress={() => setMode('default')}
            />
            <LocationButton
              label="Choose another folder"
              path={customFolder || 'Browse device folders'}
              selected={mode === 'custom'}
              onPress={() => {
                setMode('custom');
                setPicking(true);
              }}
            />

            <View style={styles.summaryBox}>
              <Text allowFontScaling={false} style={styles.summaryLabel}>Will create in</Text>
              <Text allowFontScaling={false} style={styles.path} numberOfLines={3}>{selectedFolder}</Text>
              <Text allowFontScaling={false} style={styles.template}>Template: {choice.templateLabel}</Text>
            </View>

            <Text allowFontScaling={false} style={styles.hint}>
              The {itemMode}'s Project or Area is unchanged. Once created, this name and location stay linked to the {itemMode}{itemMode === 'event' ? ' and its recurring series' : ''}.
            </Text>

            <View style={styles.footer}>
              <TouchableOpacity disabled={busy} style={styles.cancel} onPress={onCancel}>
                <Text allowFontScaling={false} style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={busy}
                style={[styles.create, busy && styles.disabled]}
                onPress={() => {
                  const currentName = (nameInputRef.current?.getValue() ?? name).trim();
                  if (!currentName) return;
                  setBusy(true);
                  Promise.resolve(onCreate(kind, selectedFolder, currentName)).catch(() => setBusy(false));
                }}
              >
                <Text allowFontScaling={false} style={styles.createText}>{busy ? 'Creating…' : 'Create Note'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <FolderPickerModal
        visible={visible && picking}
        title="Choose note folder"
        initialPath={customFolder || choice.contextFolder || choice.defaultFolder}
        onCancel={() => setPicking(false)}
        onSelect={folder => {
          setCustomFolder(folder);
          setMode('custom');
          setPicking(false);
        }}
      />
    </>
  );
}

function ChoiceButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.choice, selected && styles.choiceSelected]} onPress={onPress}>
      <Text allowFontScaling={false} style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

function LocationButton({
  label,
  path,
  selected,
  onPress,
}: {
  label: string;
  path: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={[styles.location, selected && styles.locationSelected]} onPress={onPress}>
      <Text allowFontScaling={false} style={styles.radio}>{selected ? '●' : '○'}</Text>
      <View style={styles.locationCopy}>
        <Text allowFontScaling={false} style={styles.locationLabel}>{label}</Text>
        <Text allowFontScaling={false} style={styles.locationPath} numberOfLines={2}>{path}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 18 },
  card: { backgroundColor: '#ffffff', borderWidth: 2, borderColor: '#000000', borderRadius: 8, padding: 14, maxHeight: '92%' },
  title: { fontSize: 18, fontWeight: 'bold', color: '#000000', textAlign: 'center' },
  eventTitle: { fontSize: 13, color: '#303030', textAlign: 'center', marginTop: 3, marginBottom: 9 },
  label: { fontSize: 13, fontWeight: 'bold', color: '#000000', marginTop: 7, marginBottom: 5 },
  nameInput: { borderWidth: 1, borderColor: '#000000', borderRadius: 5, paddingHorizontal: 8, paddingVertical: 6, fontSize: 13, color: '#000000' },
  choiceRow: { flexDirection: 'row' },
  choice: { flex: 1, borderWidth: 1, borderColor: '#000000', borderRadius: 5, paddingVertical: 8, alignItems: 'center', marginRight: 6 },
  choiceSelected: { backgroundColor: '#000000' },
  choiceText: { fontSize: 13, fontWeight: 'bold', color: '#000000' },
  choiceTextSelected: { color: '#ffffff' },
  location: { flexDirection: 'row', borderWidth: 1, borderColor: '#909090', borderRadius: 5, padding: 7, marginBottom: 5 },
  locationSelected: { borderWidth: 2, borderColor: '#000000', padding: 6 },
  radio: { width: 22, fontSize: 16, color: '#000000' },
  locationCopy: { flex: 1 },
  locationLabel: { fontSize: 13, fontWeight: 'bold', color: '#000000' },
  locationPath: { fontSize: 10, lineHeight: 13, fontFamily: 'monospace', color: '#404040', marginTop: 2 },
  summaryBox: { borderWidth: 1, borderColor: '#000000', backgroundColor: '#f1f1f1', borderRadius: 5, padding: 8, marginTop: 6 },
  summaryLabel: { fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', color: '#303030' },
  path: { fontSize: 11, lineHeight: 14, fontFamily: 'monospace', color: '#000000', marginTop: 2 },
  template: { fontSize: 11, color: '#000000', marginTop: 5 },
  hint: { fontSize: 10, lineHeight: 14, color: '#505050', marginTop: 7 },
  footer: { flexDirection: 'row', marginTop: 10 },
  cancel: { flex: 1, borderWidth: 1, borderColor: '#000000', borderRadius: 5, paddingVertical: 9, alignItems: 'center', marginRight: 7 },
  cancelText: { fontSize: 13, fontWeight: 'bold', color: '#000000' },
  create: { flex: 2, backgroundColor: '#000000', borderRadius: 5, paddingVertical: 10, alignItems: 'center' },
  createText: { fontSize: 13, fontWeight: 'bold', color: '#ffffff' },
  disabled: { opacity: 0.5 },
});
