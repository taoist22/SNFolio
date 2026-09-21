import React from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { matchKey } from '../domain/autoFile';
import { Project } from '../domain/types';
import { HandwritingTextInput, HandwritingTextInputHandle } from './HandwritingTextInput';

/** One unfiled calendar item; a recurring series appears once. */
export interface BulkFileItem {
  /** The key its filing is stored under (the series for a recurring event). */
  identity: string;
  summary: string;
  start: Date;
  location?: string;
  categories?: string[];
}

/**
 * Files many unfiled items from one calendar under a Project at once, for
 * calendars whose items carry no course or client name for the automatic
 * rules to find. Select all, select by a word, or tick items one by one.
 */
export function BulkFilePanel({ calendarName, items, projects, onFile, onClose }: {
  calendarName: string;
  items: BulkFileItem[];
  projects: Project[];
  onFile: (identities: string[], projectId: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [projectId, setProjectId] = React.useState<string | undefined>(undefined);
  const [word, setWord] = React.useState('');
  const [message, setMessage] = React.useState('');
  const wordRef = React.useRef<HandwritingTextInputHandle>(null);
  const active = projects.filter(project => project.status === 'active');
  const target = active.find(project => project.id === projectId);

  React.useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => subscription.remove();
  }, [onClose]);

  const toggle = (identity: string) => setSelected(current => {
    const next = new Set(current);
    if (next.has(identity)) next.delete(identity);
    else next.add(identity);
    return next;
  });

  const selectMatching = () => {
    const key = matchKey((wordRef.current?.getValue() ?? word).trim());
    if (!key) { setMessage('Write a word first, such as a course code, client or assignment name.'); return; }
    const matches = items.filter(item =>
      matchKey([item.summary, item.location, ...(item.categories || [])].filter(Boolean).join(' ')).includes(key));
    setSelected(current => new Set([...current, ...matches.map(item => item.identity)]));
    setMessage(`${matches.length} item${matches.length === 1 ? '' : 's'} matched and ${matches.length === 1 ? 'is' : 'are'} now selected.`);
  };

  const dateLabel = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return <View style={styles.overlay} accessibilityViewIsModal>
    <View style={styles.dialog}>
      <Text allowFontScaling={false} style={styles.heading}>{`File items from ${calendarName}`}</Text>
      <Text allowFontScaling={false} style={styles.text}>
        {`${items.length} unfiled item${items.length === 1 ? '' : 's'}. Select the ones that belong to one Project, choose the Project, and file them together. Items you have already filed are not listed.`}
      </Text>

      <View style={styles.row}>
        <HandwritingTextInput ref={wordRef} style={styles.input} value={word} onChangeText={setWord}
          placeholder="Word in title or location" placeholderTextColor="#707070" autoCorrect={false} />
        <TouchableOpacity style={styles.button} onPress={selectMatching}>
          <Text allowFontScaling={false} style={styles.buttonText}>Select matching</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.row}>
        <TouchableOpacity style={styles.button} onPress={() => setSelected(new Set(items.map(item => item.identity)))}>
          <Text allowFontScaling={false} style={styles.buttonText}>Select all</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={() => { setSelected(new Set()); setMessage(''); }}>
          <Text allowFontScaling={false} style={styles.buttonText}>Clear</Text>
        </TouchableOpacity>
        <Text allowFontScaling={false} style={styles.count}>{`${selected.size} selected`}</Text>
      </View>
      {Boolean(message) && <Text allowFontScaling={false} style={styles.hint}>{message}</Text>}

      <ScrollView style={styles.list} keyboardShouldPersistTaps="always">
        {items.length === 0 && <Text allowFontScaling={false} style={styles.hint}>Every item from this calendar is filed.</Text>}
        {items.map(item => {
          const on = selected.has(item.identity);
          return (
            <TouchableOpacity key={item.identity} style={styles.item} onPress={() => toggle(item.identity)}
              accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
              <Text allowFontScaling={false} style={styles.check}>{on ? '☑' : '☐'}</Text>
              <View style={styles.itemBody}>
                <Text allowFontScaling={false} style={styles.itemTitle} numberOfLines={1}>{item.summary}</Text>
                <Text allowFontScaling={false} style={styles.itemDetail} numberOfLines={1}>
                  {item.location ? `${dateLabel(item.start)} · ${item.location}` : dateLabel(item.start)}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <Text allowFontScaling={false} style={styles.label}>File under</Text>
      <View style={styles.projects}>
        {active.length === 0 && <Text allowFontScaling={false} style={styles.hint}>Create a Project in PARA first.</Text>}
        {active.map(project => (
          <TouchableOpacity key={project.id} style={[styles.project, project.id === projectId && styles.projectOn]}
            onPress={() => setProjectId(project.id)} accessibilityRole="radio" accessibilityState={{ selected: project.id === projectId }}>
            <Text allowFontScaling={false} style={styles.buttonText} numberOfLines={1}>
              {`${project.id === projectId ? '●' : '○'} ${project.name}`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.row}>
        <TouchableOpacity disabled={!target || selected.size === 0}
          style={[styles.primary, (!target || selected.size === 0) && styles.disabled]}
          onPress={() => { if (target && selected.size) onFile([...selected], target.id); }}>
          <Text allowFontScaling={false} style={styles.primaryText}>
            {target ? `File ${selected.size} under ${target.name}` : 'Choose a Project'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={onClose}>
          <Text allowFontScaling={false} style={styles.buttonText}>Close</Text>
        </TouchableOpacity>
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 24 },
  dialog: { maxHeight: '94%', backgroundColor: '#fff', borderWidth: 2, borderColor: '#000', padding: 16 },
  heading: { fontSize: 18, fontWeight: 'bold', color: '#000', marginBottom: 6 },
  text: { fontSize: 14, lineHeight: 20, color: '#000', marginBottom: 8 },
  hint: { fontSize: 13, color: '#404040', paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 },
  input: { flex: 1, minWidth: 200, minHeight: 42, borderWidth: 1, borderColor: '#000', paddingHorizontal: 8, fontSize: 14, color: '#000', marginRight: 8 },
  button: { minHeight: 42, borderWidth: 1, borderColor: '#000', borderRadius: 4, paddingHorizontal: 12, justifyContent: 'center', marginRight: 8, marginVertical: 2 },
  buttonText: { fontSize: 14, fontWeight: 'bold', color: '#000' },
  count: { fontSize: 14, fontWeight: 'bold', color: '#000', marginLeft: 4 },
  list: { flexGrow: 0, flexShrink: 1, minHeight: 120, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#000', marginVertical: 6 },
  item: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderBottomWidth: 1, borderBottomColor: '#d0d0d0', paddingHorizontal: 4 },
  check: { fontSize: 22, color: '#000', width: 34 },
  itemBody: { flex: 1 },
  itemTitle: { fontSize: 14, fontWeight: 'bold', color: '#000' },
  itemDetail: { fontSize: 12, color: '#404040' },
  label: { fontSize: 14, fontWeight: 'bold', color: '#000', marginTop: 4 },
  projects: { flexDirection: 'row', flexWrap: 'wrap', marginVertical: 6 },
  project: { minHeight: 40, maxWidth: 260, borderWidth: 1, borderColor: '#000', borderRadius: 4, paddingHorizontal: 10, justifyContent: 'center', marginRight: 6, marginBottom: 6 },
  projectOn: { borderWidth: 3 },
  primary: { minHeight: 46, backgroundColor: '#000', borderRadius: 4, paddingHorizontal: 16, justifyContent: 'center', marginRight: 8 },
  primaryText: { fontSize: 15, fontWeight: 'bold', color: '#fff' },
  disabled: { opacity: 0.4 },
});
