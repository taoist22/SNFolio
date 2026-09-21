import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules } from 'react-native';
import { CalendarStorage, getSessionPassword } from './calendarStorage';
import { parseWorkspaceBackup, pausedWorkspace, RESTORE_JOURNAL_KEY, WorkspaceBackup } from './workspaceBackup';

async function fixture(): Promise<{ store: CalendarStorage; backup: WorkspaceBackup }> {
  const store = new CalendarStorage();
  await store.load();
  store.updateSettings({ caldavEnabled: true, caldavPassword: 'secret', caldavCustomUrl: 'https://private', timeFormat: '24h' });
  store.addFeed({ id: 'private', name: 'Private feed', enabled: true, url: 'https://private/token' });
  store.upsertTask({ uid: 'task', title: 'Remember', createdAt: new Date('2026-09-01'), completed: false, status: 'todo' });
  store.upsertArea({ id: 'area', name: 'Work', createdAt: new Date('2026-09-01') });
  store.setMapping({ eventUid: 'event', seriesId: 'event', notePath: '/storage/emulated/0/Note/Meeting.note', lastPageNum: 1, lastCreatedIso: '2026-09-01T00:00:00Z' });
  return { store, backup: { format: 'snfolio-workspace', version: 1, createdAt: new Date().toISOString(), data: await store.exportWorkspace(), imports: {} } };
}
beforeEach(async () => { await AsyncStorage.clear(); });

test('portable snapshots preserve workspace data but exclude all connection secrets', async () => {
  const { backup } = await fixture();
  const content = JSON.stringify(backup);
  expect(content).not.toContain('secret');
  expect(content).not.toContain('https://private');
  const validated = parseWorkspaceBackup(content);
  expect(validated.data.tasks[0].title).toBe('Remember');
  expect(validated.data.settings.timeFormat).toBe('24h');
  expect(validated.data.mappings.event.notePath).toContain('Meeting.note');
});

test.each([
  ['unsupported version', (b: any) => { b.version = 99; }],
  ['missing section', (b: any) => { delete b.data.tasks; }],
  ['invalid date', (b: any) => { b.data.tasks[0].createdAt = 'bad'; }],
  ['invalid title', (b: any) => { b.data.tasks[0].title = {}; }],
  ['duplicate identifiers', (b: any) => { b.data.tasks.push(b.data.tasks[0]); }],
  ['secret in settings', (b: any) => { b.data.settings.caldavPassword = 'secret'; }],
  ['invalid setting type', (b: any) => { b.data.settings.scheduleStartHour = '8'; }],
  ['missing imported calendar', (b: any) => { b.data.settings.feeds[0].localPath = '/lost.ics'; }],
])('rejects %s before touching storage', async (_name, mutate) => {
  const { backup } = await fixture();
  mutate(backup);
  expect(() => parseWorkspaceBackup(JSON.stringify(backup))).toThrow();
  expect(await AsyncStorage.getItem(RESTORE_JOURNAL_KEY)).toBeNull();
});

test('rejects unsafe object keys and truncated JSON', () => {
  expect(() => parseWorkspaceBackup('{')).toThrow('not valid JSON');
  expect(() => parseWorkspaceBackup('{"format":"snfolio-workspace","version":1,"createdAt":"2026-09-01","data":{"__proto__":{}}}')).toThrow();
});

test('restores data with dates revived, removes previous records and credentials, and pauses all sync', async () => {
  const { store, backup } = await fixture();
  store.upsertTask({ uid: 'later', title: 'Later', completed: false, createdAt: new Date() });
  await store.flush();
  await store.restoreWorkspace(backup.data);
  expect(store.getTasks().map(t => t.uid)).toEqual(['task']);
  expect(store.getTasks()[0].createdAt).toBeInstanceOf(Date);
  expect(store.getSettings()).toMatchObject({ caldavEnabled: false, taskCaldavEnabled: false, restoreSyncPaused: true });
  expect(store.getSettings().feeds.every(f => !f.enabled)).toBe(true);
  expect(getSessionPassword()).toBe('');
  expect(await NativeModules.CalendarFile.getSecret('calendar-connections')).toBe('{}');
  expect(await AsyncStorage.getItem(RESTORE_JOURNAL_KEY)).toBeNull();
});

test('an interrupted multi-section restore blocks saves and is completed on next startup', async () => {
  const { store, backup } = await fixture();
  const multiSet = AsyncStorage.multiSet as jest.Mock;
  multiSet.mockImplementationOnce(async (pairs: [string, string][]) => {
    await AsyncStorage.setItem(pairs[0][0], pairs[0][1]);
    throw new Error('Power interrupted');
  });
  await expect(store.restoreWorkspace(backup.data)).rejects.toThrow('Power interrupted');
  expect(store.isLoaded()).toBe(false);
  store.updateSettings({ timeFormat: '12h' });
  expect(await store.flush()).toContain('restore');
  expect(await AsyncStorage.getItem(RESTORE_JOURNAL_KEY)).not.toBeNull();
  const recovered = new CalendarStorage();
  await recovered.load();
  expect(recovered.isLoaded()).toBe(true);
  expect(recovered.getSettings().timeFormat).toBe('24h');
  expect(recovered.getTasks()[0].title).toBe('Remember');
  expect(await AsyncStorage.getItem(RESTORE_JOURNAL_KEY)).toBeNull();
});

test('an unreadable or invalid recovery journal blocks normal loading and writes', async () => {
  await AsyncStorage.setItem(RESTORE_JOURNAL_KEY, '{broken');
  const store = new CalendarStorage();
  await store.load();
  expect(store.isLoaded()).toBe(false);
  store.updateSettings({ timeFormat: '24h' });
  expect(await store.flush()).not.toBe('');
  expect(await AsyncStorage.getItem('@sn-calendar/settings')).toBeNull();
});

test('a failed journal cleanup is retried safely without restoring active synchronization', async () => {
  const { store, backup } = await fixture();
  (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error('Cleanup interrupted'));
  await expect(store.restoreWorkspace(backup.data)).rejects.toThrow('Cleanup interrupted');
  await store.load();
  expect(store.isLoaded()).toBe(true);
  expect(store.getSettings().restoreSyncPaused).toBe(true);
  expect(await store.exportWorkspace()).toEqual(pausedWorkspace(backup.data));
});


test('an upgraded installation with removed launcher settings can back up and restore', async () => {
  const legacy = {
    recentNotePaths: ['/storage/emulated/0/Note/Work.note', '/storage/emulated/0/Document/Guide.pdf'],
    floatingLauncherEnabled: true,
  };
  await AsyncStorage.setItem('@sn-calendar/settings', JSON.stringify(legacy));
  const { store, backup } = await fixture();
  const parsed = parseWorkspaceBackup(JSON.stringify(backup));
  expect(parsed.data.settings).toMatchObject(legacy);
  await store.restoreWorkspace(parsed.data);
  expect(store.getSettings()).toMatchObject({ ...legacy, restoreSyncPaused: true });
  expect(store.getTasks()[0].title).toBe('Remember');
  expect((await store.exportWorkspace()).settings).toMatchObject(legacy);
});

test.each([
  ['recentNotePaths', ['/valid.note', { path: '/invalid.note' }]],
  ['floatingLauncherEnabled', 'true'],
])('still rejects malformed legacy setting %s', async (key, value) => {
  const { backup } = await fixture();
  backup.data.settings[key as string] = value;
  expect(() => parseWorkspaceBackup(JSON.stringify(backup))).toThrow(`Invalid backup: ${key}`);
});

test('project categories, default designations and standalone overrides survive backup and restore', async () => {
  const { store } = await fixture();
  store.upsertProject({ id: 'class', name: 'Physics', status: 'active', createdAt: new Date(), category: 'class' });
  store.upsertProject({ id: 'work', name: 'Client', status: 'active', createdAt: new Date(), category: 'work', defaultEventDesignation: 'meeting' });
  store.setMembership('deadline', { projectId: 'work', eventDesignation: 'none' });
  store.setMembership('standalone', { eventDesignation: 'meeting' });
  const data = await store.exportWorkspace();
  await store.restoreWorkspace(data);
  expect(store.getProjects()[0].category).toBe('class');
  expect(store.getProjects()[1].defaultEventDesignation).toBe('meeting');
  expect(store.getMembership('deadline').eventDesignation).toBe('none');
  expect(store.getMembership('standalone').eventDesignation).toBe('meeting');
  store.setMembership('standalone', { eventDesignation: undefined });
  expect(store.getMembership('standalone')).toEqual({});
});

test('a class start date and weekly grouping survive backup and restore, and bad grouping is rejected', async () => {
  const { store } = await fixture();
  const start = new Date(2026, 8, 2);
  store.upsertProject({ id: 'class', name: 'IDS105', status: 'active', createdAt: new Date(), category: 'class', classStartDate: start, linkedFilesGrouping: 'week', classWeekStartsOn: 1 });
  const data = await store.exportWorkspace();
  await store.restoreWorkspace(data);
  const restored = store.getProjects().find(project => project.id === 'class')!;
  expect(restored.classStartDate).toEqual(start);
  expect(restored.classStartDate).toBeInstanceOf(Date);
  expect(restored.linkedFilesGrouping).toBe('week');
  expect(restored.classWeekStartsOn).toBe(1);

  const reloaded = new CalendarStorage();
  await reloaded.load();
  expect(reloaded.getProjects().find(project => project.id === 'class')?.classStartDate).toEqual(start);

  const bad: WorkspaceBackup = { format: 'snfolio-workspace', version: 1, createdAt: new Date().toISOString(), data: JSON.parse(JSON.stringify(data)), imports: {} };
  bad.data.projects = [{ id: 'p', name: 'Project', status: 'active', createdAt: new Date().toISOString(), linkedFilesGrouping: 'month' }];
  expect(() => parseWorkspaceBackup(JSON.stringify(bad))).toThrow('project linked-file grouping');
  bad.data.projects = [{ id: 'p', name: 'Project', status: 'active', createdAt: new Date().toISOString(), classWeekStartsOn: 7 }];
  expect(() => parseWorkspaceBackup(JSON.stringify(bad))).toThrow('project class week start');
  bad.data.projects = [{ id: 'p', name: 'Project', status: 'active', createdAt: new Date().toISOString(), recurringNotes: 'weekly' }];
  expect(() => parseWorkspaceBackup(JSON.stringify(bad))).toThrow('project recurring notes');
  bad.data.projects = [{ id: 'p', name: 'Project', status: 'active', createdAt: new Date().toISOString(), recurringNotes: 'session', autoFileMatch: 'IDS105, Acme' }];
  expect(() => parseWorkspaceBackup(JSON.stringify(bad))).not.toThrow();
  bad.data.mappings = { s: { eventUid: 's', seriesId: 'lec', notePath: '/N/S.note', perSession: true, eventStartIso: 'not a date' } };
  expect(() => parseWorkspaceBackup(JSON.stringify(bad))).toThrow('note mapping session date');
  bad.data.settings = { ...bad.data.settings, autoBackupEnabled: 'yes' };
  bad.data.mappings = {};
  expect(() => parseWorkspaceBackup(JSON.stringify(bad))).toThrow('autoBackupEnabled');
});

test('backup rejects unknown project categories and event designations', async () => {
  const { backup } = await fixture();
  backup.data.projects = [{ id: 'p', name: 'Project', status: 'active', category: 'invalid' }];
  expect(() => parseWorkspaceBackup(JSON.stringify(backup))).toThrow('project category');
  backup.data.projects = [];
  backup.data.itemMembership.event = { eventDesignation: 'invalid' };
  expect(() => parseWorkspaceBackup(JSON.stringify(backup))).toThrow('event calendar designation');
});
