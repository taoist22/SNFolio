import { NativeModules } from 'react-native';
import { FileUtils, RattaFileSelector } from 'sn-plugin-lib';
import { CalendarStorage } from '../storage/calendarStorage';
import { emptyWorkspaceData, parseWorkspaceBackup, WorkspaceBackup } from '../storage/workspaceBackup';
import { firstPickedFilePath } from '../domain/fileSelection';
import { ensureFileReadPermission, ensureFileWritePermission } from './pluginPermissions';

const native = NativeModules.CalendarFile;
async function permissions(write = false): Promise<void> {
  if (!(await ensureFileReadPermission()) || (write && !(await ensureFileWritePermission()))) {
    throw new Error('File access was not allowed.');
  }
  if (!native?.readBackupFile || !native?.writeBackupFile || !native?.storeImportedCalendar) {
    throw new Error('Backup support is missing from this build. Install the complete SNFolio plugin package.');
  }
}

export async function createWorkspaceBackup(store: CalendarStorage, safety = false): Promise<string> {
  await permissions(true);
  const data = await store.exportWorkspace();
  const imports: Record<string, string> = {};
  for (const feed of data.settings.feeds) {
    if (feed.localPath) imports[feed.id] = await native.readBackupFile(feed.localPath);
  }
  const backup: WorkspaceBackup = { format: 'snfolio-workspace', version: 1,
    createdAt: new Date().toISOString(), data, imports };
  const content = JSON.stringify(backup);
  parseWorkspaceBackup(content);
  let root = '/storage/emulated/0/Export';
  try { root = await FileUtils.getExportPath() || root; } catch (_) { /* Older firmware. */ }
  const stamp = backup.createdAt.replace(/[:.]/g, '-');
  const suffix = Math.random().toString(36).slice(2, 10);
  const path = await native.writeBackupFile(`${root}/SNFolio Backups/${safety ? 'before-restore' : 'workspace'}-${stamp}-${suffix}.snfolio.json`, content);
  // Do not authorize a restore based merely on a successful write response.
  const verified = await native.readBackupFile(path);
  if (verified !== content) throw new Error('Backup verification failed. The workspace has not been restored.');
  parseWorkspaceBackup(verified);
  return path;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Local calendar day, for "once a day". */
export const localDayKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** The rotating file for a day: seven files, each replaced a week later. */
export const autoBackupFileName = (date: Date): string => `SNFolio Auto Backup - ${WEEKDAYS[date.getDay()]}.snfolio.json`;

/** Whether today's automatic backup is still due. */
export function autoBackupDue(settings: { autoBackupEnabled?: boolean; lastAutoBackupDay?: string; restoreSyncPaused?: boolean }, now: Date): boolean {
  return settings.autoBackupEnabled !== false && !settings.restoreSyncPaused && settings.lastAutoBackupDay !== localDayKey(now);
}

/** Writes today's automatic backup over last week's file of the same weekday, then verifies it. */
export async function createAutoBackup(store: CalendarStorage, now = new Date()): Promise<string> {
  await permissions(true);
  if (!native?.writeAutoBackupFile) {
    throw new Error('Automatic backup needs the complete SNFolio plugin package.');
  }
  const data = await store.exportWorkspace();
  const imports: Record<string, string> = {};
  for (const feed of data.settings.feeds) {
    if (feed.localPath) imports[feed.id] = await native.readBackupFile(feed.localPath);
  }
  const backup: WorkspaceBackup = { format: 'snfolio-workspace', version: 1,
    createdAt: now.toISOString(), data, imports };
  const content = JSON.stringify(backup);
  parseWorkspaceBackup(content);
  let root = '/storage/emulated/0/Export';
  try { root = await FileUtils.getExportPath() || root; } catch (_) { /* Older firmware. */ }
  const path = await native.writeAutoBackupFile(`${root}/SNFolio Backups/${autoBackupFileName(now)}`, content);
  const verified = await native.readBackupFile(path);
  if (verified !== content) throw new Error('Automatic backup could not be verified.');
  return path;
}

/**
 * Empties SNFolio: events, tasks, PARA, note links and settings. A verified
 * backup is written first and its path returned, so a reset is recoverable.
 * Notes and other files on the device are never touched.
 */
export async function resetWorkspace(store: CalendarStorage, defaultSettings: any): Promise<string> {
  const safetyPath = await createWorkspaceBackup(store, true);
  await store.restoreWorkspace(emptyWorkspaceData(defaultSettings));
  // A restore pauses syncing so old edits and queued deletions can be reviewed
  // first. A reset leaves nothing to review, so the pause would only block
  // reconnecting an account.
  store.updateSettings({ restoreSyncPaused: false });
  const error = await store.flush();
  if (error) throw new Error(`SNFolio was reset, but the change could not be saved: ${error}`);
  return safetyPath;
}

export interface BackupFile {
  path: string;
  name: string;
  /** Last modified, in milliseconds, when the native build reports it. */
  modified?: number;
  size?: number;
}

/**
 * The backups in Export / SNFolio Backups, newest first.
 *
 * Listed through SNFolio's own native module rather than the system file
 * picker: the picker refuses paths outside the plugin's whitelist and warns
 * about Export, even though the plugin can read the file perfectly well.
 */
export async function listWorkspaceBackups(): Promise<BackupFile[]> {
  await permissions();
  if (!native?.listFolderEntries) return [];
  let root = '/storage/emulated/0/Export';
  try { root = await FileUtils.getExportPath() || root; } catch (_) { /* Older firmware. */ }
  const entries: any[] = await native.listFolderEntries(`${root}/SNFolio Backups`).catch(() => []);
  return (Array.isArray(entries) ? entries : [])
    .filter(entry => entry && !entry.isFolder && typeof entry.name === 'string' && entry.name.endsWith('.snfolio.json'))
    .map(entry => ({ path: entry.path, name: entry.name, modified: entry.modified, size: entry.size }))
    .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0) || a.name.localeCompare(b.name));
}

/** Reads one backup by path, for the in-panel list. */
export async function readWorkspaceBackup(path: string): Promise<WorkspaceBackup> {
  await permissions();
  return parseWorkspaceBackup(await native.readBackupFile(path));
}

export async function selectWorkspaceBackup(): Promise<WorkspaceBackup | null> {
  await permissions();
  const result = await RattaFileSelector.selectFile({ selectType: 0, maxNum: 1,
    title: 'Select an SNFolio backup', rightButtonText: 'Review',
    needSelectFolder: '/storage/emulated/0/Export', suffixList: ['json'] });
  const path = firstPickedFilePath(result);
  if (!path) return null;
  return parseWorkspaceBackup(await native.readBackupFile(path));
}

export async function missingBackupNotes(backup: WorkspaceBackup): Promise<string[]> {
  const paths = [...new Set<string>(Object.values(backup.data.mappings).map((mapping: any) => mapping.notePath))];
  const missing: string[] = [];
  for (const path of paths) {
    // A failed check must be visible rather than reporting a file as present.
    if (!(await FileUtils.exists(path))) missing.push(path);
  }
  return missing;
}

export async function restoreWorkspaceBackup(
  store: CalendarStorage, backup: WorkspaceBackup, onSafetyBackup: (path: string) => void,
): Promise<string> {
  const validated = parseWorkspaceBackup(JSON.stringify(backup));
  // Export refuses an incomplete load. Never replace a workspace we cannot back up.
  const safetyPath = await createWorkspaceBackup(store, true);
  onSafetyBackup(safetyPath);
  const data = validated.data;
  for (const [index, feed] of data.settings.feeds.entries()) {
    if (feed.localPath) {
      feed.localPath = await native.storeImportedCalendar(`restored-${index}-${Date.now()}-${feed.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.ics`, validated.imports[feed.id]);
    }
  }
  await store.restoreWorkspace(data);
  return safetyPath;
}
