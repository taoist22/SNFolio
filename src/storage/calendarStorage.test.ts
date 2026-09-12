import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CalendarStorage,
  calendarStorage,
  clearSessionPassword,
  clearSessionTaskPassword,
  getSessionPassword,
  getSessionTaskPassword,
} from './calendarStorage';

// AsyncStorage is mocked globally in jest.setup.js.

/** save() is fire-and-forget; let its promises settle before asserting on disk. */
const flushWrites = () => new Promise<void>(resolve => setTimeout(() => resolve(), 0));

describe('calendarStorage', () => {
  test('manages feeds and settings correctly', async () => {
    const settings = calendarStorage.getSettings();
    expect(settings.notesDirectory).toBe('/storage/emulated/0/Note/Meetings');

    calendarStorage.updateSettings({ seriesNotebookPrefix: 'Meeting Series - ' });
    expect(calendarStorage.getSettings().seriesNotebookPrefix).toBe('Meeting Series - ');

    const newFeed = { id: 'feed-1', name: 'Work', enabled: true };
    calendarStorage.addFeed(newFeed);
    expect(calendarStorage.getSettings().feeds.length).toBe(2);

    calendarStorage.removeFeed('feed-1');
    expect(calendarStorage.getSettings().feeds.length).toBe(1);

    calendarStorage.setMapping({
      eventUid: 'evt-1',
      seriesId: 'series-1',
      notePath: '/storage/emulated/0/Note/Meetings/Meeting.note',
      lastPageNum: 1,
      lastCreatedIso: new Date().toISOString(),
    });

    expect(calendarStorage.getMapping('evt-1')?.notePath).toBe('/storage/emulated/0/Note/Meetings/Meeting.note');
    expect(calendarStorage.getMapping('series-1')?.notePath).toBe('/storage/emulated/0/Note/Meetings/Meeting.note');
  });

  test('removes only CalDAV-backed tasks and clears their local bookkeeping', () => {
    const store = new CalendarStorage();
    const createdAt = new Date('2026-08-24T12:00:00Z');
    store.upsertTask({
      uid: 'remote-task',
      title: 'From Radicale',
      completed: false,
      createdAt,
      caldavUrl: 'https://tasks.example.test/todos/remote-task.ics',
      etag: '"one"',
    });
    store.upsertTask({
      uid: 'remote-child',
      title: 'Local child of remote task',
      completed: false,
      createdAt,
      parentId: 'remote-task',
    });
    store.upsertTask({
      uid: 'device-task',
      title: 'Device only',
      completed: false,
      createdAt,
    });
    store.setMembership('remote-task', { areaId: 'area-1' });
    store.setMembership('remote-child', { projectId: 'project-1' });
    store.setTaskPushState({
      target: 'https://tasks.example.test/todos/',
      records: {
        'remote-task': { signature: 'remote', pushedAt: 1 },
        'device-task': { signature: 'local', pushedAt: 1 },
      },
      lastSeenUids: ['remote-task', 'device-task'],
    });

    expect(store.removeSyncedTasks()).toEqual(['remote-task']);
    expect(store.getTasks().map(task => task.uid)).toEqual(['remote-child', 'device-task']);
    expect(store.getTasks().find(task => task.uid === 'remote-child')?.parentId).toBeUndefined();
    expect(store.getMembership('remote-task')).toEqual({});
    expect(store.getMembership('remote-child')).toEqual({ projectId: 'project-1' });
    expect(store.getTaskPushState('https://tasks.example.test/todos/')).toEqual({
      target: 'https://tasks.example.test/todos/',
      records: { 'device-task': { signature: 'local', pushedAt: 1 } },
      lastSeenUids: ['device-task'],
    });
  });

  test('keeps task sync history and offline deletions scoped to each collection', () => {
    const store = new CalendarStorage();
    const first = 'https://one.example.test/tasks/';
    const second = 'https://two.example.test/tasks/';
    store.setTaskPushState({
      target: first,
      records: { one: { signature: 'one', pushedAt: 1 } },
      lastSeenUids: ['one'],
    });
    store.setTaskPushState({
      target: second,
      records: { two: { signature: 'two', pushedAt: 2 } },
      lastSeenUids: ['two'],
    });
    store.queueTaskDelete({
      uid: 'one', title: 'Delete later', completed: false, createdAt: new Date(),
      caldavUrl: `${first}one.ics`, caldavCollectionUrl: first, etag: '"one"',
    });

    expect(store.getTaskPushState(first).records.one).toBeDefined();
    expect(store.getTaskPushState(second).records.two).toBeDefined();
    expect(store.getPendingTaskDeletes(first)).toHaveLength(1);
    expect(store.getPendingTaskDeletes(second)).toHaveLength(0);

    store.clearTaskAccountBookkeeping(first);
    expect(store.getPendingTaskDeletes(first)).toHaveLength(0);
    expect(store.getTaskPushState(first).records.one).toBeDefined();
    expect(store.getTaskPushState(second).records.two).toBeDefined();
  });

  test('removes synchronized tasks from only the selected account', () => {
    const store = new CalendarStorage();
    const createdAt = new Date();
    store.upsertTask({
      uid: 'one', title: 'One', completed: false, createdAt,
      caldavCollectionUrl: 'https://one.example.test/tasks/',
      caldavUrl: 'https://one.example.test/tasks/one.ics',
    });
    store.upsertTask({
      uid: 'two', title: 'Two', completed: false, createdAt,
      caldavCollectionUrl: 'https://two.example.test/tasks/',
      caldavUrl: 'https://two.example.test/tasks/two.ics',
    });

    expect(store.removeSyncedTasks('https://one.example.test/tasks/')).toEqual(['one']);
    expect(store.getTasks().map(task => task.uid)).toEqual(['two']);
  });

  test('keeps existing device tasks out of a newly connected account until enrolled', () => {
    const store = new CalendarStorage();
    const createdAt = new Date();
    store.upsertTask({ uid: 'local', title: 'Private', completed: false, createdAt });
    store.upsertTask({
      uid: 'remote', title: 'Already synced', completed: false, createdAt,
      caldavCollectionUrl: 'https://dav.example.test/tasks/',
      caldavUrl: 'https://dav.example.test/tasks/remote.ics',
    });

    expect(store.excludeDeviceOnlyTasksFromSync()).toBe(1);
    expect(store.excludeDeviceOnlyTasksFromSync()).toBe(0);
    expect(store.getTasks().find(task => task.uid === 'local')?.caldavSyncExcluded).toBe(true);
    expect(store.getTasks().find(task => task.uid === 'remote')?.caldavSyncExcluded).toBeUndefined();

    expect(store.enrollDeviceOnlyTasksForSync()).toBe(1);
    expect(store.getTasks().find(task => task.uid === 'local')?.caldavSyncExcluded).toBeUndefined();
  });

  test('load returns storage data', async () => {
    const loaded = await calendarStorage.load();
    expect(loaded.settings).toBeDefined();
    expect(loaded.mappings).toBeDefined();
  });

  test('manages user events persistence', () => {
    const mockEvt = { uid: 'user-evt-1', summary: 'Test', start: new Date(), end: new Date(), allDay: false, attendees: [] };
    calendarStorage.addUserEvent(mockEvt);
    expect(calendarStorage.getUserEvents().length).toBe(1);

    // Update existing
    calendarStorage.addUserEvent({ ...mockEvt, summary: 'Updated Test' });
    expect(calendarStorage.getUserEvents()[0].summary).toBe('Updated Test');

    calendarStorage.removeUserEvent('user-evt-1');
    expect(calendarStorage.getUserEvents().length).toBe(0);
  });
});

describe('credential handling', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    clearSessionPassword();
    clearSessionTaskPassword();
  });

  test('the CalDAV password is never written to AsyncStorage', async () => {
    const store = new CalendarStorage();
    store.updateSettings({
      caldavAppleId: 'user@icloud.com',
      caldavPassword: 'abcd-efgh-ijkl-mnop',
      caldavCalendarUrl: 'https://p02-caldav.icloud.com/123456789/calendars/work/',
    });
    await flushWrites();

    const raw = (await AsyncStorage.getItem('@sn-calendar/settings')) as string;

    expect(raw).toBeTruthy();
    expect(raw).not.toContain('abcd-efgh-ijkl-mnop');
    expect(JSON.parse(raw).caldavPassword).toBeUndefined();

    // Everything non-secret still persists.
    expect(JSON.parse(raw).caldavAppleId).toBe('user@icloud.com');
    expect(JSON.parse(raw).caldavCalendarUrl).toContain('/calendars/work/');
  });

  test('the password stays readable in memory for the session', () => {
    const store = new CalendarStorage();
    store.updateSettings({ caldavPassword: 'in-memory-only' });

    expect(getSessionPassword()).toBe('in-memory-only');
    expect(store.getSettings().caldavPassword).toBe('in-memory-only');
  });

  test('the independent task password and server URL use encrypted storage', async () => {
    const first = new CalendarStorage();
    first.updateSettings({
      taskCaldavEnabled: true,
      taskCaldavUsername: 'tasks@example.com',
      taskCaldavPassword: 'task-secret',
      taskCaldavServerUrl: 'https://tasks.example.com/private/dav',
      taskCaldavCollectionUrl: 'https://tasks.example.com/calendars/todos/',
    });
    await first.flush();

    const raw = (await AsyncStorage.getItem('@sn-calendar/settings')) as string;
    expect(raw).not.toContain('task-secret');
    expect(raw).not.toContain('/private/dav');
    expect(getSessionTaskPassword()).toBe('task-secret');

    clearSessionTaskPassword();
    const second = new CalendarStorage();
    const { settings } = await second.load();
    expect(settings.taskCaldavPassword).toBe('task-secret');
    expect(settings.taskCaldavServerUrl).toBe('https://tasks.example.com/private/dav');
  });

  test('a reload restores a password only from encrypted native storage', async () => {
    const first = new CalendarStorage();
    first.updateSettings({ caldavAppleId: 'user@icloud.com', caldavPassword: 'gone-on-reboot' });
    await flushWrites();

    // Simulate a PluginHost restart: module scope is cleared; encrypted native
    // storage and ordinary settings survive.
    clearSessionPassword();
    clearSessionTaskPassword();

    const second = new CalendarStorage();
    const { settings } = await second.load();

    expect(settings.caldavAppleId).toBe('user@icloud.com');
    expect(settings.caldavPassword).toBe('gone-on-reboot');
  });

  test('private feed URLs are not written to shared AsyncStorage', async () => {
    const store = new CalendarStorage();
    store.addFeed({
      id: 'private-feed',
      name: 'Private',
      url: 'https://example.com/calendar/bearer-token.ics',
      enabled: true,
    });
    await store.flush();

    const raw = (await AsyncStorage.getItem('@sn-calendar/settings')) as string;
    expect(raw).not.toContain('bearer-token');

    const reloaded = new CalendarStorage();
    await reloaded.load();
    expect(reloaded.getSettings().feeds.find(feed => feed.id === 'private-feed')?.url)
      .toBe('https://example.com/calendar/bearer-token.ics');
  });

  test('does not migrate iCloud legacy Reminders into modern task sync', async () => {
    await AsyncStorage.setItem('@sn-calendar/settings', JSON.stringify({
      caldavProvider: 'icloud',
      caldavAppleId: 'user@icloud.com',
      caldavTaskListUrl: 'https://p.test/calendars/legacy-reminders/',
    }));

    const store = new CalendarStorage();
    await store.load();

    expect(store.getSettings().taskCaldavEnabled).toBe(false);
    expect(store.getSettings().taskCaldavCollectionUrl).toBeFalsy();
  });

  test('migrates a working non-iCloud same-account VTODO configuration', async () => {
    await AsyncStorage.setItem('@sn-calendar/settings', JSON.stringify({
      caldavProvider: 'custom',
      caldavAppleId: 'tasks@example.com',
      caldavTaskListUrl: 'https://tasks.example.com/calendars/todos/',
      caldavCustomUrl: 'https://tasks.example.com/dav',
    }));

    const store = new CalendarStorage();
    await store.load();

    expect(store.getSettings().taskCaldavEnabled).toBe(true);
    expect(store.getSettings().taskCaldavUsername).toBe('tasks@example.com');
    expect(store.getSettings().taskCaldavCollectionUrl).toContain('/todos/');
  });
});

describe('legacy task migration on load', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    clearSessionPassword();
    clearSessionTaskPassword();
    clearSessionTaskPassword();
  });

  test('tasks stored as events are lifted into the task list and removed from events', async () => {
    await AsyncStorage.setItem(
      '@sn-calendar/userEvents',
      JSON.stringify([
        {
          uid: 'evt-1',
          summary: 'Standup',
          start: '2026-08-17T09:00:00.000Z',
          end: '2026-08-17T09:30:00.000Z',
          allDay: false,
          attendees: [],
        },
        {
          uid: 'task-1',
          summary: '[TASK] Submit lab report',
          isTask: true,
          completed: false,
          start: '2026-08-12T09:00:00.000Z',
          end: '2026-08-12T09:30:00.000Z',
          allDay: true,
          attendees: [],
        },
      ])
    );

    const store = new CalendarStorage();
    await store.load();

    // The real event stays an event.
    expect(store.getUserEvents().map(e => e.uid)).toEqual(['evt-1']);

    // The legacy task becomes a task, with the display prefix stripped.
    const tasks = store.getTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].uid).toBe('task-1');
    expect(tasks[0].title).toBe('Submit lab report');
    expect(tasks[0].dueDate).toBeInstanceOf(Date);
  });

  test('migration does not duplicate a task that already migrated', async () => {
    await AsyncStorage.setItem(
      '@sn-calendar/userEvents',
      JSON.stringify([
        {
          uid: 'task-1',
          summary: '[TASK] Already moved',
          isTask: true,
          start: '2026-08-12T09:00:00.000Z',
          end: '2026-08-12T09:30:00.000Z',
          allDay: true,
          attendees: [],
        },
      ])
    );
    await AsyncStorage.setItem(
      '@sn-calendar/tasks',
      JSON.stringify([
        {
          uid: 'task-1',
          title: 'Already moved',
          completed: true,
          createdAt: '2026-08-12T09:00:00.000Z',
        },
      ])
    );

    const store = new CalendarStorage();
    await store.load();

    expect(store.getTasks()).toHaveLength(1);
    // The already-migrated copy wins; its completion state is not clobbered.
    expect(store.getTasks()[0].completed).toBe(true);
  });
});

describe('task storage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    clearSessionPassword();
    clearSessionTaskPassword();
    clearSessionPassword();
  });

  test('tasks round-trip with their dates revived', async () => {
    const first = new CalendarStorage();
    first.upsertTask({
      uid: 't-1',
      title: 'Read chapter 4',
      dueDate: new Date('2026-08-20T00:00:00.000Z'),
      completed: false,
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
    });
    await flushWrites();

    const second = new CalendarStorage();
    await second.load();
    const [t] = second.getTasks();

    expect(t.title).toBe('Read chapter 4');
    expect(t.dueDate).toBeInstanceOf(Date);
    expect(t.createdAt).toBeInstanceOf(Date);
  });

  test('upsert replaces by uid rather than duplicating', () => {
    const store = new CalendarStorage();
    const base = { uid: 't-1', title: 'A', completed: false, createdAt: new Date() };
    store.upsertTask(base);
    store.upsertTask({ ...base, completed: true, completedAt: new Date() });

    expect(store.getTasks()).toHaveLength(1);
    expect(store.getTasks()[0].completed).toBe(true);
  });

  test('removing a task also removes its subtasks', () => {
    const store = new CalendarStorage();
    const now = new Date();
    store.upsertTask({ uid: 'parent', title: 'P', completed: false, createdAt: now });
    store.upsertTask({ uid: 'child', title: 'C', completed: false, createdAt: now, parentId: 'parent' });
    store.upsertTask({ uid: 'other', title: 'O', completed: false, createdAt: now });

    store.removeTask('parent');

    expect(store.getTasks().map(t => t.uid)).toEqual(['other']);
  });
});

describe('persistence round-trip', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    clearSessionPassword();
  });

  test('settings, feeds, mappings and events survive a reload', async () => {
    const first = new CalendarStorage();
    first.updateSettings({ notesDirectory: '/storage/emulated/0/Note/Custom', caldavEnabled: true });
    first.addFeed({ id: 'feed-school', name: 'School', url: 'https://example.com/x.ics', enabled: true });
    first.setMapping({
      eventUid: 'evt-9',
      seriesId: 'series-9',
      notePath: '/storage/emulated/0/Note/Meetings/Standup.note',
      lastPageNum: 4,
      lastCreatedIso: '2026-08-16T10:00:00.000Z',
    });
    first.addUserEvent({
      uid: 'evt-persist',
      summary: 'Persisted Event',
      start: new Date('2026-08-25T10:00:00Z'),
      end: new Date('2026-08-25T11:00:00Z'),
      allDay: false,
      attendees: [],
    });
    await flushWrites();

    const second = new CalendarStorage();
    const { settings } = await second.load();

    expect(settings.notesDirectory).toBe('/storage/emulated/0/Note/Custom');
    expect(settings.caldavEnabled).toBe(true);
    expect(settings.feeds.some(f => f.id === 'feed-school')).toBe(true);
    expect(second.getMapping('series-9')?.lastPageNum).toBe(4);
    expect(second.getUserEvents()).toHaveLength(1);
  });

  test('event dates revive as Date objects, not ISO strings', async () => {
    const first = new CalendarStorage();
    first.addUserEvent({
      uid: 'evt-date',
      summary: 'Date Check',
      start: new Date('2026-08-25T10:00:00Z'),
      end: new Date('2026-08-25T11:30:00Z'),
      allDay: false,
      attendees: [],
    });
    await flushWrites();

    const second = new CalendarStorage();
    await second.load();
    const revived = second.getUserEvents()[0];

    expect(revived.start).toBeInstanceOf(Date);
    expect(revived.end).toBeInstanceOf(Date);
    expect(revived.start.toISOString()).toBe('2026-08-25T10:00:00.000Z');
    expect(revived.end.getTime() - revived.start.getTime()).toBe(90 * 60 * 1000);
  });

  test('a settings blob missing newer keys still yields a complete object', async () => {
    await AsyncStorage.setItem('@sn-calendar/settings', JSON.stringify({ notesDirectory: '/old/path' }));

    const store = new CalendarStorage();
    const { settings } = await store.load();

    expect(settings.notesDirectory).toBe('/old/path');
    expect(settings.seriesNotebookPrefix).toBe('Series - ');
    expect(settings.feeds).toHaveLength(1);
  });
});

describe('PARA areas, projects and membership', () => {
  const area = (over = {}) => ({
    id: 'area-1',
    name: 'ENG 102',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    ...over,
  });
  const project = (over = {}) => ({
    id: 'proj-1',
    name: 'Draft term paper',
    status: 'active' as const,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    ...over,
  });

  test('an area is stored and read back', () => {
    calendarStorage.upsertArea(area());
    expect(calendarStorage.getAreas().map(a => a.name)).toContain('ENG 102');
  });

  test('upsert replaces rather than duplicating', () => {
    calendarStorage.upsertArea(area());
    calendarStorage.upsertArea(area({ name: 'ENG 102 renamed' }));
    expect(calendarStorage.getAreas().filter(a => a.id === 'area-1')).toHaveLength(1);
  });

  test('membership is keyed by identity, so it serves events and tasks alike', () => {
    calendarStorage.setMembership('phys301', { areaId: 'area-1', projectId: 'proj-1' });
    expect(calendarStorage.getMembership('phys301')).toEqual({
      areaId: 'area-1',
      projectId: 'proj-1',
    });
  });

  test('setting one field leaves the other intact', () => {
    calendarStorage.setMembership('item-merge', { areaId: 'area-1' });
    calendarStorage.setMembership('item-merge', { projectId: 'proj-1' });
    expect(calendarStorage.getMembership('item-merge')).toEqual({
      areaId: 'area-1',
      projectId: 'proj-1',
    });
  });

  test('an unassigned item reports empty rather than undefined', () => {
    expect(calendarStorage.getMembership('never-assigned')).toEqual({});
  });

  test('clearing both fields drops the row entirely', () => {
    calendarStorage.setMembership('item-clear', { areaId: 'area-1' });
    calendarStorage.setMembership('item-clear', { areaId: undefined });
    expect(calendarStorage.getAllMemberships()).not.toHaveProperty('item-clear');
  });

  test('deleting an area detaches its projects instead of deleting them', () => {
    // Losing a project because its area was tidied away would be a
    // destructive surprise.
    calendarStorage.upsertArea(area({ id: 'area-doomed' }));
    calendarStorage.upsertProject(project({ id: 'proj-orphan', areaId: 'area-doomed' }));
    calendarStorage.setMembership('task-x', { areaId: 'area-doomed', projectId: 'proj-orphan' });

    calendarStorage.removeArea('area-doomed');

    expect(calendarStorage.getProjects().find(p => p.id === 'proj-orphan')).toBeDefined();
    expect(calendarStorage.getProjects().find(p => p.id === 'proj-orphan')?.areaId).toBeUndefined();
    expect(calendarStorage.getMembership('task-x').areaId).toBeUndefined();
    // The project assignment is untouched.
    expect(calendarStorage.getMembership('task-x').projectId).toBe('proj-orphan');
  });

  test('deleting a project detaches its items rather than deleting them', () => {
    calendarStorage.upsertProject(project({ id: 'proj-doomed' }));
    calendarStorage.setMembership('task-y', { projectId: 'proj-doomed' });

    calendarStorage.removeProject('proj-doomed');

    expect(calendarStorage.getProjects().find(p => p.id === 'proj-doomed')).toBeUndefined();
    expect(calendarStorage.getMembership('task-y')).toEqual({});
  });

  test('resources upsert, archive, and remove independently of projects', () => {
    const store = new CalendarStorage();
    store.upsertResource({
      id: 'resource-writing',
      name: 'Writing reference',
      createdAt: new Date('2026-08-20T00:00:00Z'),
    });
    store.upsertResource({
      ...store.getResources()[0],
      description: 'Style guides and examples',
      archived: true,
    });

    expect(store.getResources()).toHaveLength(1);
    expect(store.getResources()[0]).toMatchObject({
      name: 'Writing reference',
      description: 'Style guides and examples',
      archived: true,
    });

    store.removeResource('resource-writing');
    expect(store.getResources()).toEqual([]);
  });

  test('legacy resource notebooks migrate to folders on storage reload', async () => {
    await AsyncStorage.clear();
    const first = new CalendarStorage();
    first.upsertResource({
      id: 'resource-travel',
      name: 'Travel research',
      notePath: '/storage/emulated/0/Note/Resources/Travel research.note',
      createdAt: new Date('2026-08-20T00:00:00Z'),
    });
    await first.flush();

    const second = new CalendarStorage();
    await second.load();
    expect(second.getResources()[0].createdAt).toBeInstanceOf(Date);
    expect(second.getResources()[0].folder).toBe('/storage/emulated/0/Note/Resources');
    expect(second.getResources()[0].notePath).toContain('/Note/Resources/');
  });

  test('legacy project notebooks migrate to their containing folder', async () => {
    await AsyncStorage.clear();
    const first = new CalendarStorage();
    first.upsertProject({
      id: 'project-legacy-note',
      name: 'Kitchen remodel',
      status: 'active',
      notePath: '/storage/emulated/0/Note/Old Projects/Kitchen remodel.note',
      createdAt: new Date('2026-08-20T00:00:00Z'),
    });
    await first.flush();

    const second = new CalendarStorage();
    await second.load();
    expect(second.getProjects()[0].folder).toBe('/storage/emulated/0/Note/Old Projects');
    expect(second.getProjects()[0].notePath).toContain('Kitchen remodel.note');
  });

  test('project short labels survive a storage reload', async () => {
    await AsyncStorage.clear();
    const first = new CalendarStorage();
    first.upsertProject({
      id: 'project-management',
      name: 'MGT120 Principles of Management',
      shortLabel: 'MGT120',
      status: 'active',
      createdAt: new Date('2026-08-25T00:00:00Z'),
    });
    await first.flush();

    const second = new CalendarStorage();
    await second.load();
    expect(second.getProjects()[0].shortLabel).toBe('MGT120');
  });

  test('area folders survive a storage reload', async () => {
    await AsyncStorage.clear();
    const first = new CalendarStorage();
    first.upsertArea({
      id: 'area-health',
      name: 'Health',
      folder: '/storage/emulated/0/Note/SNFolio/Areas/Health',
      createdAt: new Date('2026-08-20T00:00:00Z'),
    });
    await first.flush();

    const second = new CalendarStorage();
    await second.load();
    expect(second.getAreas()[0].folder).toBe('/storage/emulated/0/Note/SNFolio/Areas/Health');
    expect(second.getAreas()[0].createdAt).toBeInstanceOf(Date);
  });
});

describe('clearing a note kind', () => {
  test('a deleted note lets the prompt ask again', () => {
    // The only correction for a wrong Meeting-or-Class answer: changing it
    // after the fact cannot move the note already written.
    calendarStorage.setEventKind('evt-kind-1', 'class');
    expect(calendarStorage.getEventKind('evt-kind-1')).toBe('class');

    calendarStorage.clearEventKind('evt-kind-1');
    expect(calendarStorage.getEventKind('evt-kind-1')).toBeUndefined();
  });

  test('a kind recorded on the mapping is cleared too', () => {
    // getEventKind consults the mapping first, so clearing only the side
    // store would leave the prompt still suppressed.
    calendarStorage.setMapping({
      eventUid: 'evt-kind-2',
      seriesId: 'evt-kind-2',
      kind: 'class',
      notePath: '/storage/emulated/0/Note/Classes/x.note',
      lastPageNum: 1,
      lastCreatedIso: new Date().toISOString(),
    });
    expect(calendarStorage.getEventKind('evt-kind-2')).toBe('class');

    calendarStorage.clearEventKind('evt-kind-2');
    expect(calendarStorage.getEventKind('evt-kind-2')).toBeUndefined();
  });

  test('clearing an unknown item is harmless', () => {
    expect(() => calendarStorage.clearEventKind('never-seen')).not.toThrow();
  });
});

describe('storage failure isolation', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('one corrupt blob does not erase valid independent data', async () => {
    await AsyncStorage.setItem('@sn-calendar/settings', '{broken json');
    await AsyncStorage.setItem('@sn-calendar/areas', JSON.stringify([
      { id: 'area-safe', name: 'Safe', createdAt: new Date().toISOString() },
    ]));

    const store = new CalendarStorage();
    await store.load();

    expect(store.getSettings().notesDirectory).toContain('/Note/Meetings');
    expect(store.getAreas().map(area => area.id)).toEqual(['area-safe']);
  });
});

describe('PARA folder moves', () => {
  test('rewrites only SNFolio-owned paths inside the moved folder', () => {
    const store = new CalendarStorage();
    const from = '/storage/emulated/0/Note/Clients/Acme';
    const to = '/storage/emulated/0/Note/Archive/Projects/Acme';
    const createdAt = new Date('2026-08-30T12:00:00Z');

    store.upsertArea({ id: 'area', name: 'Clients', folder: '/storage/emulated/0/Note/Clients', createdAt });
    store.upsertProject({ id: 'project', name: 'Acme', folder: from, status: 'active', createdAt });
    store.upsertResource({
      id: 'resource', name: 'Brief', folder: `${from}/Research`, notePath: `${from}/Research/Brief.note`, createdAt,
    });
    store.upsertEventType({ id: 'type', name: 'Client', folder: `${from}/Meetings`, createdAt });
    store.setMapping({
      eventUid: 'event', seriesId: 'series', notePath: `${from}/Meetings/Kickoff.note`,
      lastPageNum: 1, lastCreatedIso: createdAt.toISOString(),
    });
    store.queueNoteDeletion(`${from}/Old.note`);

    store.rewritePathPrefix(from, to);

    expect(store.getProjects()[0].folder).toBe(to);
    expect(store.getResources()[0]).toEqual(expect.objectContaining({
      folder: `${to}/Research`, notePath: `${to}/Research/Brief.note`,
    }));
    expect(store.getEventTypes()[0].folder).toBe(`${to}/Meetings`);
    expect(store.getMapping('event')?.notePath).toBe(`${to}/Meetings/Kickoff.note`);
    expect(store.getMapping('series')?.notePath).toBe(`${to}/Meetings/Kickoff.note`);
    expect(store.getPendingNoteDeletions()).toEqual([`${to}/Old.note`]);
    expect(store.getAreas()[0].folder).toBe('/storage/emulated/0/Note/Clients');
  });

  test('does not rewrite sibling folders with the same prefix', () => {
    const store = new CalendarStorage();
    const createdAt = new Date('2026-08-30T12:00:00Z');
    store.upsertProject({
      id: 'sibling', name: 'Acme Old', folder: '/storage/emulated/0/Note/Clients/Acme Old', status: 'active', createdAt,
    });

    store.rewritePathPrefix(
      '/storage/emulated/0/Note/Clients/Acme',
      '/storage/emulated/0/Note/Archive/Projects/Acme'
    );

    expect(store.getProjects()[0].folder).toBe('/storage/emulated/0/Note/Clients/Acme Old');
  });
});

describe('event Area override migration', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('clears copied type defaults once without affecting task Areas', async () => {
    await AsyncStorage.setItem('@sn-calendar/settings', JSON.stringify({
      feeds: [],
      eventAreaOverridesMigrated: false,
    }));
    await AsyncStorage.setItem('@sn-calendar/itemMembership', JSON.stringify({
      typedEvent: { typeId: 'type-work', areaId: 'old-type-default' },
      task: { areaId: 'chosen-task-area' },
    }));

    const store = new CalendarStorage();
    await store.load();

    expect(store.getMembership('typedEvent')).toEqual({ typeId: 'type-work', areaId: undefined });
    expect(store.getMembership('task')).toEqual({ areaId: 'chosen-task-area' });
    expect(store.getSettings().eventAreaOverridesMigrated).toBe(true);
  });
});

describe('task account lifecycle persistence', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('retains independent collection histories and offline deletions after restart', async () => {
    const firstUrl = 'https://one.example.test/tasks/';
    const secondUrl = 'https://two.example.test/tasks/';
    const first = new CalendarStorage();
    first.setTaskPushState({
      target: firstUrl,
      records: { one: { signature: 'one', pushedAt: 1 } },
      lastSeenUids: ['one'],
    });
    first.setTaskPushState({
      target: secondUrl,
      records: { two: { signature: 'two', pushedAt: 2 } },
      lastSeenUids: ['two'],
    });
    first.queueTaskDelete({
      uid: 'one', title: 'Delete after reconnect', completed: false, createdAt: new Date(),
      caldavCollectionUrl: firstUrl, caldavUrl: `${firstUrl}one.ics`,
    });
    await first.flush();

    const second = new CalendarStorage();
    await second.load();
    expect(second.getTaskPushState(firstUrl).records.one).toBeDefined();
    expect(second.getTaskPushState(secondUrl).records.two).toBeDefined();
    expect(second.getPendingTaskDeletes(firstUrl)).toEqual([
      expect.objectContaining({ uid: 'one', collectionUrl: firstUrl }),
    ]);
  });

  test('migrates the previous single-collection push history', async () => {
    const target = 'https://legacy.example.test/tasks/';
    await AsyncStorage.setItem('@sn-calendar/caldavTaskPushState', JSON.stringify({
      target,
      records: { legacy: { signature: 'legacy', pushedAt: 1 } },
      lastSeenUids: ['legacy'],
    }));

    const store = new CalendarStorage();
    await store.load();
    expect(store.getTaskPushState(target).records.legacy).toBeDefined();
  });
});

test('time format defaults to 12-hour and survives a storage reload', async () => {
  const store = new CalendarStorage();
  expect(store.getSettings().timeFormat).toBe('12h');
  store.updateSettings({ timeFormat: '24h' });
  await flushWrites();
  const restored = new CalendarStorage();
  await restored.load();
  expect(restored.getSettings().timeFormat).toBe('24h');
});
