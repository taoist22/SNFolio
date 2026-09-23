import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules } from 'react-native';
import { FileUtils, PluginManager, RattaFileSelector } from 'sn-plugin-lib';
import { CalendarStorage } from '../storage/calendarStorage';
import { parseWorkspaceBackup } from '../storage/workspaceBackup';
import { listWorkspaceBackups, resetWorkspace, autoBackupDue, autoBackupFileName, createAutoBackup, createWorkspaceBackup, localDayKey, missingBackupNotes, restoreWorkspaceBackup, selectWorkspaceBackup } from './workspaceBackupService';

jest.mock('sn-plugin-lib', () => ({
  PluginManager: { hasPermission: jest.fn(async () => 1), requestPermission: jest.fn(async () => 0) },
  FileUtils: { getExportPath: jest.fn(async () => '/storage/emulated/0/Export'), exists: jest.fn(async () => false) },
  RattaFileSelector: { selectFile: jest.fn() },
}));
const files = new Map<string, string>();
const native = NativeModules.CalendarFile;
const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';

beforeEach(async () => {
  await AsyncStorage.clear();
  files.clear();
  jest.clearAllMocks();
  native.readBackupFile.mockImplementation(async (path: string) => {
    if (!files.has(path)) throw new Error('File not found');
    return files.get(path);
  });
  native.writeBackupFile.mockImplementation(async (path: string, text: string) => { files.set(path, text); return path; });
  native.writeAutoBackupFile.mockImplementation(async (path: string, text: string) => { files.set(path, text); return path; });
  native.storeImportedCalendar.mockImplementation(async (name: string, text: string) => {
    files.set(`/private/${name}`, text); return `/private/${name}`;
  });
});
async function storeWithImport() {
  const store = new CalendarStorage();
  await store.load();
  files.set('/private/original.ics', ics);
  store.addFeed({ id: 'local', name: 'Imported', enabled: true, localPath: '/private/original.ics' });
  store.upsertTask({ uid: 'keep', title: 'Keep', completed: false, createdAt: new Date() });
  await store.flush();
  return store;
}

test('export verifies its external file and embeds imported calendars; restore relocates imports', async () => {
  const store = await storeWithImport();
  const path = await createWorkspaceBackup(store);
  expect(path).toContain('/Export/SNFolio Backups/workspace-');
  const backup = parseWorkspaceBackup(files.get(path)!);
  expect(backup.imports.local).toBe(ics);
  store.upsertTask({ uid: 'later', title: 'Later', completed: false, createdAt: new Date() });
  const safetySaved = jest.fn();
  const safety = await restoreWorkspaceBackup(store, backup, safetySaved);
  expect(safetySaved).toHaveBeenCalledWith(safety);
  expect(parseWorkspaceBackup(files.get(safety)!).data.tasks).toHaveLength(2);
  expect(store.getTasks()).toHaveLength(1);
  const feed = store.getSettings().feeds.find(item => item.id === 'local')!;
  expect(feed.localPath).not.toBe('/private/original.ics');
  expect(files.get(feed.localPath!)).toBe(ics);
  expect(feed.enabled).toBe(false);
});

test('a mismatched safety backup prevents all restore writes', async () => {
  const store = await storeWithImport();
  const backupPath = await createWorkspaceBackup(store);
  const backup = parseWorkspaceBackup(files.get(backupPath)!);
  const restore = jest.spyOn(store, 'restoreWorkspace');
  native.writeBackupFile.mockImplementationOnce(async (path: string) => { files.set(path, '{}'); return path; });
  await expect(restoreWorkspaceBackup(store, backup, jest.fn())).rejects.toThrow('verification failed');
  expect(restore).not.toHaveBeenCalled();
  expect(store.isLoaded()).toBe(true);
});

test('a missing imported file aborts backup and leaves the current workspace alone', async () => {
  const store = await storeWithImport();
  files.delete('/private/original.ics');
  await expect(createWorkspaceBackup(store)).rejects.toThrow('File not found');
  expect(native.writeBackupFile).not.toHaveBeenCalled();
  expect(store.getTasks()).toHaveLength(1);
});

test('denied file permissions leave storage and external files unchanged', async () => {
  const store = await storeWithImport();
  (PluginManager.hasPermission as jest.Mock).mockResolvedValueOnce(0);
  await expect(createWorkspaceBackup(store)).rejects.toThrow('not allowed');
  expect(native.writeBackupFile).not.toHaveBeenCalled();
});

test('failed storage loading prevents exporting an empty replacement', async () => {
  await AsyncStorage.setItem('@sn-calendar/tasks', '{broken');
  const store = new CalendarStorage();
  await store.load();
  await expect(createWorkspaceBackup(store)).rejects.toThrow('load successfully');
  expect(native.writeBackupFile).not.toHaveBeenCalled();
});

test('picker accepts firmware object results, and cancellation does not restore', async () => {
  const store = await storeWithImport();
  const path = await createWorkspaceBackup(store);
  (RattaFileSelector.selectFile as jest.Mock).mockResolvedValueOnce([{ path }]);
  expect((await selectWorkspaceBackup())?.data.tasks).toHaveLength(1);
  expect(RattaFileSelector.selectFile).toHaveBeenCalledWith(expect.objectContaining({ selectType: 0 }));
  (RattaFileSelector.selectFile as jest.Mock).mockResolvedValueOnce([]);
  expect(await selectWorkspaceBackup()).toBeNull();
});

test('missing-note preview checks links without modifying note files', async () => {
  const store = await storeWithImport();
  const backup = parseWorkspaceBackup(files.get(await createWorkspaceBackup(store))!);
  backup.data.mappings.e = { eventUid: 'e', notePath: '/storage/emulated/0/Note/missing.note' };
  expect(await missingBackupNotes(backup)).toEqual(['/storage/emulated/0/Note/missing.note']);
  expect(FileUtils.exists).toHaveBeenCalledWith('/storage/emulated/0/Note/missing.note');
});

test('automatic backups rotate through seven weekday files and are due once a day while switched on', async () => {
  const monday = new Date(2026, 8, 21, 9);
  expect(autoBackupFileName(monday)).toBe('SNFolio Auto Backup - Mon.snfolio.json');
  expect(autoBackupFileName(new Date(2026, 8, 27, 9))).toBe('SNFolio Auto Backup - Sun.snfolio.json');
  expect(localDayKey(monday)).toBe('2026-09-21');
  expect(autoBackupDue({}, monday)).toBe(true);
  expect(autoBackupDue({ autoBackupEnabled: false }, monday)).toBe(false);
  expect(autoBackupDue({ lastAutoBackupDay: '2026-09-21' }, monday)).toBe(false);
  expect(autoBackupDue({ lastAutoBackupDay: '2026-09-20' }, monday)).toBe(true);
  expect(autoBackupDue({ restoreSyncPaused: true }, monday)).toBe(false);

  const store = await storeWithImport();
  const path = await createAutoBackup(store, monday);
  expect(path).toBe('/storage/emulated/0/Export/SNFolio Backups/SNFolio Auto Backup - Mon.snfolio.json');
  expect(native.writeBackupFile).not.toHaveBeenCalled();
  expect(parseWorkspaceBackup(files.get(path) as string).data.tasks.map((task: any) => task.uid)).toEqual(['keep']);
  // A week later the same file is replaced.
  store.upsertTask({ uid: 'new', title: 'New', completed: false, createdAt: new Date() });
  await createAutoBackup(store, new Date(2026, 8, 28, 9));
  expect(parseWorkspaceBackup(files.get(path) as string).data.tasks.map((task: any) => task.uid).sort()).toEqual(['keep', 'new']);
});

test('reset backs the workspace up first, then empties SNFolio', async () => {
  const store = await storeWithImport();
  store.upsertProject({ id: 'p', name: 'IDS105', status: 'active', createdAt: new Date() });
  store.setCaldavEvents([{ uid: 'synced', summary: 'Synced', start: new Date(), end: new Date(), allDay: false, attendees: [], sourceKind: 'caldav' }]);
  await store.flush();

  const path = await resetWorkspace(store, { feeds: [], notesDirectory: '/storage/emulated/0/Note/Meetings' } as any);

  // The backup holds what SNFolio had, so a reset by mistake is recoverable.
  const saved = parseWorkspaceBackup(files.get(path) as string);
  expect(saved.data.tasks.map((task: any) => task.uid)).toEqual(['keep']);
  expect(saved.data.projects).toHaveLength(1);
  // …and the workspace is empty afterwards.
  expect(store.getTasks()).toEqual([]);
  expect(store.getProjects()).toEqual([]);
  expect(store.getCaldavEvents()).toEqual([]);
  expect(store.getSettings().feeds).toEqual([]);
  // A restore pauses syncing for review; a reset has nothing to review, so an
  // account can be connected straight away.
  expect(store.getSettings().restoreSyncPaused).toBe(false);
});

test('a restored backup still pauses syncing, unlike a reset', async () => {
  const store = await storeWithImport();
  const path = await createWorkspaceBackup(store);
  const backup = parseWorkspaceBackup(files.get(path) as string);
  await restoreWorkspaceBackup(store, backup, () => {});
  expect(store.getSettings().restoreSyncPaused).toBe(true);
});

test('backups are listed from Export through the plugin\'s own module, newest first', async () => {
  const folder = '/storage/emulated/0/Export/SNFolio Backups';
  native.listFolderEntries = jest.fn(async () => [
    { name: 'SNFolio Auto Backup - Mon.snfolio.json', path: `${folder}/SNFolio Auto Backup - Mon.snfolio.json`, isFolder: false, modified: 1000, size: 2048 },
    { name: 'workspace-2026-09-22.snfolio.json', path: `${folder}/workspace-2026-09-22.snfolio.json`, isFolder: false, modified: 5000, size: 4096 },
    { name: 'notes.txt', path: `${folder}/notes.txt`, isFolder: false, modified: 9000 },
    { name: 'Old', path: `${folder}/Old`, isFolder: true, modified: 9000 },
  ]);
  const files = await listWorkspaceBackups();
  expect(files.map(file => file.name)).toEqual(['workspace-2026-09-22.snfolio.json', 'SNFolio Auto Backup - Mon.snfolio.json']);
  expect(files[0]).toMatchObject({ path: `${folder}/workspace-2026-09-22.snfolio.json`, modified: 5000, size: 4096 });
  // The system file picker is never involved: it refuses paths outside the plugin whitelist.
  expect(RattaFileSelector.selectFile).not.toHaveBeenCalled();

  native.listFolderEntries = jest.fn(async () => { throw new Error('No such folder'); });
  expect(await listWorkspaceBackups()).toEqual([]);
});
