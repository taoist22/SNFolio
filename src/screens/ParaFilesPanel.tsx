import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ParaFolderEntry } from '../supernote/exportService';
import { weekFolderNumber } from '../domain/linkedFileWeeks';
import { HandwritingTextInput, HandwritingTextInputHandle } from './HandwritingTextInput';

interface ParaFilesPanelProps {
  itemKey: string;
  folder: string;
  onListEntries: (folder: string) => Promise<ParaFolderEntry[]>;
  onOpenFile: (path: string) => void;
  onNewNote: (name: string, folder: string) => Promise<void>;
  onChooseFolder: (folder: string) => Promise<void>;
  /**
   * A subfolder that is "now", such as this week's folder in a class. Its
   * section starts open and the top + New Note files notes there.
   */
  currentSubfolder?: string;
  /** Moves a file into another folder; rejects with a message the panel shows. */
  onMoveFile?: (path: string, destinationFolder: string) => Promise<void>;
  /** What a file is linked to, shown under it with 🔗; undefined for files not linked to anything. */
  linkCaption?: (path: string) => string | undefined;
  /**
   * Week numbers whose "Week NN" folders are listed directly. The rest are
   * under an "All weeks" row. Undefined lists every folder.
   */
  weekWindow?: number[];
}

type SectionState = { loading: boolean; entries: ParaFolderEntry[]; error: string };

const trim = (path: string) => path.replace(/\/+$/, '');

function parentFolder(path: string): string | undefined {
  const normalized = trim(path);
  const slash = normalized.lastIndexOf('/');
  return slash > 0 ? normalized.slice(0, slash) : undefined;
}

/**
 * Shared, navigable folder UI for Projects, Areas, and Resources.
 *
 * At the item's own folder, subfolders are collapsible sections (a class's
 * Week 01 … Week NN), so the whole project is visible on one screen instead of
 * one folder at a time. Deeper folders, and choosing a folder, still browse.
 */
export function ParaFilesPanel({
  itemKey,
  folder,
  onListEntries,
  onOpenFile,
  onNewNote,
  onChooseFolder,
  currentSubfolder,
  onMoveFile,
  linkCaption,
  weekWindow,
}: ParaFilesPanelProps): React.JSX.Element {
  const [entries, setEntries] = React.useState<ParaFolderEntry[]>([]);
  const [viewFolder, setViewFolder] = React.useState<string>(folder);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string>('');
  const [addingIn, setAddingIn] = React.useState<string | null>(null);
  const [choosing, setChoosing] = React.useState<boolean>(false);
  const [noteName, setNoteName] = React.useState<string>('');
  const noteNameInputRef = React.useRef<HandwritingTextInputHandle>(null);
  const [loadedFolder, setLoadedFolder] = React.useState<string>('');
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const [sections, setSections] = React.useState<Record<string, SectionState>>({});
  const [moving, setMoving] = React.useState<string | null>(null);
  const [moveBusy, setMoveBusy] = React.useState<boolean>(false);
  const [moveMessage, setMoveMessage] = React.useState<string>('');
  const currentOpenedFor = React.useRef<string>('');
  const [allWeeksOpen, setAllWeeksOpen] = React.useState<boolean>(false);

  // Parent callbacks change on ordinary renders (including activity tracking).
  // Keep the latest reader without making callback identity trigger another read.
  const listEntriesRef = React.useRef(onListEntries);
  const requestRef = React.useRef(0);
  React.useLayoutEffect(() => { listEntriesRef.current = onListEntries; }, [onListEntries]);

  const refresh = React.useCallback(async (target: string) => {
    const request = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const next = await listEntriesRef.current(target);
      if (request === requestRef.current) {
        setEntries(next);
        setLoadedFolder(target);
      }
    } catch (e: any) {
      if (request === requestRef.current) {
        setEntries([]);
        setError(e?.message || 'Could not read this folder.');
      }
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  const loadSection = React.useCallback(async (path: string) => {
    setSections(current => ({ ...current, [path]: { loading: true, entries: current[path]?.entries || [], error: '' } }));
    try {
      const next = await listEntriesRef.current(path);
      setSections(current => ({ ...current, [path]: { loading: false, entries: next, error: '' } }));
    } catch (e: any) {
      setSections(current => ({ ...current, [path]: { loading: false, entries: [], error: e?.message || 'Could not read this folder.' } }));
    }
  }, []);

  React.useEffect(() => {
    setViewFolder(folder);
    setChoosing(false);
    setAddingIn(null);
    setMoving(null);
    setMoveMessage('');
    setOpen({});
    setSections({});
    setAllWeeksOpen(false);
  }, [itemKey, folder]);

  React.useEffect(() => {
    void refresh(viewFolder);
    return () => { requestRef.current += 1; };
  }, [itemKey, viewFolder, refresh]);

  const atItemFolder = !choosing && trim(viewFolder) === trim(folder);
  const subfolders = atItemFolder ? entries.filter(entry => entry.isFolder) : [];
  const files = atItemFolder ? entries.filter(entry => !entry.isFolder) : entries;
  const current = currentSubfolder ? trim(currentSubfolder) : undefined;
  const currentExists = Boolean(current && subfolders.some(entry => trim(entry.path) === current));
  // A long class lists only the weeks around now; the rest wait under All weeks.
  const weekFolders = weekWindow ? subfolders.filter(entry => weekFolderNumber(entry.name) !== undefined) : [];
  const otherFolders = weekWindow ? subfolders.filter(entry => weekFolderNumber(entry.name) === undefined) : subfolders;
  const windowedWeeks = weekFolders.filter(entry => weekWindow?.includes(weekFolderNumber(entry.name) as number));
  const trimsWeeks = windowedWeeks.length < weekFolders.length;
  const listedFolders = !trimsWeeks ? subfolders : allWeeksOpen ? otherFolders : [...otherFolders, ...windowedWeeks];

  // This week's section starts open, once per visit.
  React.useEffect(() => {
    if (!current || loadedFolder !== folder || currentOpenedFor.current === itemKey) return;
    currentOpenedFor.current = itemKey;
    if (!entries.some(entry => entry.isFolder && trim(entry.path) === current)) return;
    setOpen(state => ({ ...state, [current]: true }));
    void loadSection(current);
  }, [entries, loadedFolder, folder, itemKey, current, loadSection]);

  const toggleSection = (path: string) => {
    const next = !open[path];
    setOpen(state => ({ ...state, [path]: next }));
    if (next && !sections[path]) void loadSection(path);
  };

  const refreshAll = async () => {
    await refresh(viewFolder);
    for (const [path, isOpen] of Object.entries(open)) if (isOpen) await loadSection(path);
  };

  const up = parentFolder(viewFolder);
  const canGoUp = choosing
    ? Boolean(up && viewFolder !== '/storage/emulated/0')
    : trim(viewFolder) !== trim(folder) && Boolean(up);

  const cancelChoosing = () => {
    setChoosing(false);
    setViewFolder(folder);
  };

  const commitCurrentFolder = async () => {
    await onChooseFolder(viewFolder);
    setChoosing(false);
  };

  // Where the top + New Note files a note: this week's folder while a class runs.
  const topNoteFolder = atItemFolder && currentExists && current ? current : viewFolder;
  const folderLabel = (path: string) => (trim(path) === trim(folder) ? 'the project folder' : trim(path).split('/').pop());

  const moveTargets = (filePath: string): string[] => {
    const parent = parentFolder(filePath);
    return [trim(folder), ...entries.filter(entry => entry.isFolder).map(entry => trim(entry.path))]
      .filter(target => target !== parent);
  };

  const moveTo = async (filePath: string, target: string) => {
    if (!onMoveFile) return;
    setMoveBusy(true);
    setMoveMessage('');
    try {
      await onMoveFile(filePath, target);
      setMoving(null);
      const source = parentFolder(filePath);
      await refresh(viewFolder);
      for (const path of [source, target]) if (path && open[path]) await loadSection(path);
    } catch (e: any) {
      setMoveMessage(e?.message || 'Could not move the file.');
    } finally {
      setMoveBusy(false);
    }
  };

  const noteForm = (target: string) => (
    <View style={styles.newRow}>
      <HandwritingTextInput
        ref={noteNameInputRef}
        style={styles.input}
        value={noteName}
        onChangeText={setNoteName}
        placeholder={`Note name (in ${folderLabel(target)})`}
        placeholderTextColor="#707070"
        autoCorrect={false}
      />
      <TouchableOpacity style={styles.button} onPress={async () => {
        const name = (noteNameInputRef.current?.getValue() ?? noteName).trim();
        if (name) {
          await onNewNote(name, target);
          if (sections[target] || open[target]) await loadSection(target);
          await refresh(viewFolder);
        }
        setAddingIn(null);
        setNoteName('');
      }}>
        <Text allowFontScaling={false} style={styles.buttonText}>Create</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.button} onPress={() => setAddingIn(null)}>
        <Text allowFontScaling={false} style={styles.buttonText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  const caption = (entry: ParaFolderEntry) => (entry.isFolder || !linkCaption ? undefined : linkCaption(entry.path));

  const fileRow = (entry: ParaFolderEntry, indent = false) => (
    <View key={entry.path}>
      <View style={[styles.fileRow, indent && styles.indented]}>
        <TouchableOpacity style={styles.fileOpen}
          onPress={() => entry.isFolder ? setViewFolder(entry.path) : onOpenFile(entry.path)}>
          <Text allowFontScaling={false} style={styles.fileIcon}>{entry.isFolder ? '📁' : fileIcon(entry.path)}</Text>
          <View style={styles.fileText}>
            <Text allowFontScaling={false} style={styles.fileName} numberOfLines={1}>
              {caption(entry) ? `${entry.name}  🔗` : entry.name}
            </Text>
            {Boolean(caption(entry)) && (
              <Text allowFontScaling={false} style={styles.caption} numberOfLines={1}>{`↳ ${caption(entry)}`}</Text>
            )}
          </View>
          <Text allowFontScaling={false} style={styles.openText}>{entry.isFolder ? 'Browse' : 'Open'}</Text>
        </TouchableOpacity>
        {!entry.isFolder && onMoveFile && !choosing && (
          <TouchableOpacity style={styles.moveButton} onPress={() => {
            setMoveMessage('');
            setMoving(moving === entry.path ? null : entry.path);
          }}>
            <Text allowFontScaling={false} style={styles.openText}>Move…</Text>
          </TouchableOpacity>
        )}
      </View>
      {moving === entry.path && (
        <View style={[styles.moveBox, indent && styles.indented]}>
          <Text allowFontScaling={false} style={styles.hint}>
            Move {entry.name} to: (close it first if it is open. SNFolio links follow it; links inside other notes do not.)
          </Text>
          {moveTargets(entry.path).map(target => (
            <TouchableOpacity key={target} disabled={moveBusy} style={styles.button} onPress={() => void moveTo(entry.path, target)}>
              <Text allowFontScaling={false} style={styles.buttonText}>📁 {trim(target) === trim(folder) ? 'Project folder' : trim(target).split('/').pop()}</Text>
            </TouchableOpacity>
          ))}
          {moveTargets(entry.path).length === 0 && (
            <Text allowFontScaling={false} style={styles.hint}>There are no other folders here to move it to.</Text>
          )}
          {moveBusy && <Text allowFontScaling={false} style={styles.hint}>Moving…</Text>}
          {Boolean(moveMessage) && <Text allowFontScaling={false} style={styles.error}>{moveMessage}</Text>}
          <TouchableOpacity style={styles.button} disabled={moveBusy} onPress={() => setMoving(null)}>
            <Text allowFontScaling={false} style={styles.buttonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const section = (entry: ParaFolderEntry) => {
    const path = trim(entry.path);
    const isOpen = Boolean(open[path]);
    const state = sections[path];
    return (
      <View key={path}>
        <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection(path)}
          accessibilityRole="button" accessibilityState={{ expanded: isOpen }}>
          <Text allowFontScaling={false} style={styles.sectionTitle} numberOfLines={1}>
            {isOpen ? '▾' : '▸'} 📁 {entry.name}
            {state && !state.loading ? `  (${state.entries.length})` : ''}
            {path === current ? '  · this week' : ''}
          </Text>
        </TouchableOpacity>
        {isOpen && (
          <View>
            {state?.loading && <Text allowFontScaling={false} style={[styles.hint, styles.indented]}>Reading folder…</Text>}
            {Boolean(state?.error) && <Text allowFontScaling={false} style={[styles.error, styles.indented]}>{state?.error}</Text>}
            {state && !state.loading && !state.error && state.entries.length === 0 && (
              <Text allowFontScaling={false} style={[styles.hint, styles.indented]}>Empty.</Text>
            )}
            {state && !state.loading && state.entries.map(child => fileRow(child, true))}
            {addingIn !== null && trim(addingIn) === path && trim(addingIn) !== trim(topNoteFolder)
              ? <View style={styles.indented}>{noteForm(path)}</View>
              : addingIn !== null && trim(addingIn) === path ? null : (
                <TouchableOpacity style={[styles.button, styles.indented, styles.inlineAdd]} onPress={() => {
                  setAddingIn(path);
                  setNoteName('');
                }}>
                  <Text allowFontScaling={false} style={styles.buttonText}>+ New Note in {entry.name}</Text>
                </TouchableOpacity>
              )}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <Text allowFontScaling={false} style={styles.folder} numberOfLines={2}>
        📁 {viewFolder}
      </Text>
      <View style={styles.actions}>
        {canGoUp && up ? (
          <TouchableOpacity style={styles.button} onPress={() => setViewFolder(up)}>
            <Text allowFontScaling={false} style={styles.buttonText}>↑ Up</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.button} onPress={() => void refreshAll()}>
          <Text allowFontScaling={false} style={styles.buttonText}>↻ Refresh</Text>
        </TouchableOpacity>
        {choosing ? (
          <>
            <TouchableOpacity style={styles.primaryButton} onPress={() => void commitCurrentFolder()}>
              <Text allowFontScaling={false} style={styles.primaryButtonText}>Use This Folder</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={cancelChoosing}>
              <Text allowFontScaling={false} style={styles.buttonText}>Cancel</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity style={styles.button} onPress={() => {
              setAddingIn(topNoteFolder);
              setNoteName('');
            }}>
              <Text allowFontScaling={false} style={styles.buttonText}>
                + New Note{topNoteFolder !== viewFolder ? ` in ${folderLabel(topNoteFolder)}` : ''}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={() => {
              setAddingIn(null);
              setChoosing(true);
              setViewFolder(folder);
            }}>
              <Text allowFontScaling={false} style={styles.buttonText}>Choose Folder</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {choosing && (
        <Text allowFontScaling={false} style={styles.hint}>
          Open folders below, then tap Use This Folder. Use Up to browse elsewhere.
        </Text>
      )}

      {addingIn !== null && !choosing && trim(addingIn) === trim(topNoteFolder) && noteForm(addingIn)}

      {loading && <Text allowFontScaling={false} style={styles.hint}>Reading folder…</Text>}
      {!loading && Boolean(error) && (
        <Text allowFontScaling={false} style={styles.error}>{error}</Text>
      )}
      {!loading && !error && entries.length === 0 && (
        <Text allowFontScaling={false} style={styles.hint}>No visible files or folders here.</Text>
      )}
      {!loading && files.map(entry => fileRow(entry))}

      {!loading && listedFolders.map(entry => section(entry))}

      {!loading && trimsWeeks && (
        <TouchableOpacity style={styles.sectionHeader} onPress={() => setAllWeeksOpen(value => !value)}
          accessibilityRole="button" accessibilityState={{ expanded: allWeeksOpen }}>
          <Text allowFontScaling={false} style={styles.sectionTitle}>
            {`${allWeeksOpen ? '▾' : '▸'} All weeks (${weekFolders.length})`}
          </Text>
        </TouchableOpacity>
      )}
      {!loading && trimsWeeks && allWeeksOpen && (
        <View style={styles.indented}>{weekFolders.map(entry => section(entry))}</View>
      )}
    </View>
  );
}

function fileIcon(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'note') return '📝';
  if (extension === 'pdf') return '📕';
  if (extension === 'epub') return '📖';
  if (extension === 'doc' || extension === 'docx' || extension === 'txt' || extension === 'md') return '📄';
  if (extension === 'png' || extension === 'jpg' || extension === 'jpeg' || extension === 'gif') return '🖼';
  return '📎';
}

const styles = StyleSheet.create({
  root: { marginTop: 7 },
  folder: { fontSize: 11, color: '#303030', marginBottom: 5 },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 },
  button: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 5,
    marginBottom: 4,
  },
  buttonText: { fontSize: 11, fontWeight: 'bold', color: '#000000' },
  primaryButton: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 5,
    marginBottom: 4,
  },
  primaryButtonText: { fontSize: 11, fontWeight: 'bold', color: '#ffffff' },
  newRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 7 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    marginRight: 5,
    fontSize: 12,
    color: '#000000',
  },
  hint: { fontSize: 11, color: '#505050', paddingVertical: 8 },
  error: { fontSize: 11, color: '#000000', fontWeight: 'bold', paddingVertical: 8 },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 5,
    marginBottom: 4,
    backgroundColor: '#ffffff',
  },
  fileOpen: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 8 },
  moveButton: { paddingVertical: 7, paddingHorizontal: 10, borderLeftWidth: 1, borderLeftColor: '#b0b0b0' },
  moveBox: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', borderWidth: 1, borderColor: '#707070', borderRadius: 5, padding: 6, marginBottom: 6 },
  indented: { marginLeft: 18 },
  inlineAdd: { alignSelf: 'flex-start', marginTop: 2, marginBottom: 8 },
  sectionHeader: { borderBottomWidth: 1, borderBottomColor: '#b0b0b0', paddingVertical: 8, paddingHorizontal: 4, marginBottom: 4 },
  sectionTitle: { fontSize: 13, fontWeight: 'bold', color: '#000000' },
  fileIcon: { fontSize: 14, marginRight: 7 },
  fileText: { flex: 1 },
  fileName: { fontSize: 12, color: '#000000' },
  caption: { fontSize: 11, color: '#505050', marginTop: 1 },
  openText: { fontSize: 11, fontWeight: 'bold', color: '#000000' },
});
