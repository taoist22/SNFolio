import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { calendarStorage } from '../storage/calendarStorage';
import { WorkspaceBackup } from '../storage/workspaceBackup';
import { createWorkspaceBackup, missingBackupNotes, restoreWorkspaceBackup, selectWorkspaceBackup } from '../supernote/workspaceBackupService';

export function WorkspaceBackupPanel({ disabled, onRestored, onClose = () => {} }: {
  disabled: boolean; onRestored: (message: string) => void; onClose?: () => void;
}): React.JSX.Element {
  const running = useRef(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [backup, setBackup] = useState<WorkspaceBackup | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [safetyPath, setSafetyPath] = useState('');
  const [failedRestore, setFailedRestore] = useState(false);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!running.current && !failedRestore) onClose();
      return true;
    });
    return () => subscription.remove();
  }, [failedRestore, onClose]);
  const run = async (operation: () => Promise<void>) => {
    if (running.current || disabled || failedRestore) return;
    running.current = true;
    setBusy(true);
    setOpen(true);
    setMessage('Working…');
    try { await operation(); } catch (error: any) {
      setMessage(error?.message || 'Backup operation failed.');
      setFailedRestore(!calendarStorage.isLoaded());
    } finally { running.current = false; setBusy(false); }
  };
  const button = (title: string, action: () => void, blocked = false) => (
    <TouchableOpacity accessibilityRole="button" disabled={blocked} onPress={action}
      style={[styles.button, blocked && styles.disabled]}>
      <Text allowFontScaling={false} style={styles.buttonText}>{title}</Text>
    </TouchableOpacity>
  );
  // Keep this overlay in the host view hierarchy. A native Modal sits above
  // Supernote's permission prompts and file picker, making them unreachable.
  return <View style={styles.overlay} accessibilityViewIsModal>
    <ScrollView style={styles.dialog} contentContainerStyle={styles.content}>
    <Text allowFontScaling={false} style={styles.heading}>Workspace Backup & Restore</Text>
    <Text allowFontScaling={false} style={styles.text}>
      Save tasks, calendars, PARA organization, settings, and note links to Export / SNFolio Backups.
      Notes and other linked files are separate: back them up too. Passwords and private subscription URLs are excluded.
      Backups contain personal planning data in plain text. Copy them off the device for protection against device loss.
    </Text>
    {button('Create Backup', () => { setBackup(null); setSafetyPath(''); void run(async () => {
      setMessage(`Backup saved and verified:\n${await createWorkspaceBackup(calendarStorage)}`);
    }); }, disabled || busy || failedRestore)}
    {button('Choose Backup to Restore…', () => { setBackup(null); setSafetyPath(''); void run(async () => {
      const selected = await selectWorkspaceBackup();
      if (!selected) { setMessage('No backup selected.'); return; }
      const missingPaths = await missingBackupNotes(selected);
      setMissing(missingPaths);
      setBackup(selected);
      setMessage('Review this backup before replacing your workspace.');
    }); }, disabled || busy || failedRestore)}
    {open && <View>
        <Text allowFontScaling={false} style={styles.text}>{message}</Text>
        {safetyPath ? <Text allowFontScaling={false} style={styles.text}>Safety backup: {safetyPath}</Text> : null}
        {backup && !failedRestore && <>
          <Text allowFontScaling={false} style={styles.text}>
            Created: {new Date(backup.createdAt).toLocaleString()}{'\n'}
            {backup.data.tasks.length} tasks · {backup.data.userEvents.length + backup.data.caldavEvents.length} events{'\n'}
            {backup.data.areas.length} areas · {backup.data.projects.length} projects · {backup.data.resources.length} resources{'\n'}
            {Object.keys(backup.imports).length} imported calendars · {backup.data.pendingTaskDeletes.length} pending remote task deletions
          </Text>
          <Text allowFontScaling={false} style={styles.text}>
            This replaces your current workspace. A verified safety backup is required first.
            Notes will not be changed. All calendar feeds and account synchronization remain paused until you review the restored changes and reconnect.
          </Text>
          <Text allowFontScaling={false} style={styles.text}>
            {missing.length ? `${missing.length} linked note file(s) could not be found:\n${missing.slice(0, 8).join('\n')}${missing.length > 8 ? '\n…' : ''}` : 'All linked note paths were found.'}
          </Text>
          {button('Create Safety Backup and Replace Workspace', () => void run(async () => {
            const path = await restoreWorkspaceBackup(calendarStorage, backup, setSafetyPath);
            onRestored(`Workspace restored. Sync is paused. Safety backup: ${path}`);
          }), busy)}
        </>}
        {failedRestore ? <Text allowFontScaling={false} style={styles.text}>
          Saving is blocked. Close and reopen SNFolio to finish recovery. Keep the safety backup.
        </Text> : null}
      </View>}
      {button(backup ? 'Cancel / Close' : 'Close', onClose, busy || failedRestore)}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  heading: { fontSize: 18, fontWeight: 'bold', marginTop: 16, marginBottom: 8, color: '#000' },
  text: { fontSize: 15, lineHeight: 22, marginBottom: 12, color: '#000' },
  button: { borderWidth: 1, borderColor: '#000', padding: 14, marginVertical: 6 },
  buttonText: { fontSize: 16, fontWeight: 'bold', color: '#000' },
  disabled: { opacity: 0.4 },
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 24 },
  content: { padding: 20 },
  dialog: { flexGrow: 0, maxHeight: '90%', backgroundColor: '#fff', borderWidth: 2, borderColor: '#000' },
});
