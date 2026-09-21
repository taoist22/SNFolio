/** Portable, credential-free workspace format. Version changes require a migration. */
export const WORKSPACE_FIELDS = [
  'settings', 'mappings', 'userEvents', 'tasks', 'caldavPushState', 'caldavTaskPushState',
  'pendingTaskDeletes', 'caldavEvents', 'eventKinds', 'areas', 'projects', 'resources',
  'itemMembership', 'pendingNoteDeletes', 'eventTypes',
] as const;
export type WorkspaceField = typeof WORKSPACE_FIELDS[number];
export type WorkspaceData = Record<WorkspaceField, any>;
export interface WorkspaceBackup {
  format: 'snfolio-workspace';
  version: 1;
  createdAt: string;
  data: WorkspaceData;
  imports: Record<string, string>;
}
export const storageKey = (field: WorkspaceField) => `@sn-calendar/${field}`;
export const RESTORE_JOURNAL_KEY = '@sn-calendar/restoreJournal';

function requireValid(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`Invalid backup: ${label}.`);
}
const object = (value: any): value is Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const date = (value: any) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const strings = (value: any) => Array.isArray(value) && value.every(item => typeof item === 'string');

function safeTree(value: any, depth = 0): void {
  requireValid(depth < 60, 'nested data is too deep');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    requireValid(!['__proto__', 'constructor', 'prototype'].includes(key), 'unsafe field');
    safeTree(child, depth + 1);
  }
}

function pushState(value: any): boolean {
  return object(value) && typeof value.target === 'string' && object(value.records) &&
    strings(value.lastSeenUids) && Object.values(value.records).every(record =>
      object(record) && typeof record.signature === 'string' && typeof record.pushedAt === 'number');
}

export function validateWorkspaceData(data: any): asserts data is WorkspaceData {
  requireValid(object(data), 'workspace is missing');
  requireValid(Object.keys(data).length === WORKSPACE_FIELDS.length &&
    WORKSPACE_FIELDS.every(field => Object.prototype.hasOwnProperty.call(data, field)), 'workspace sections are missing or unknown');
  safeTree(data);
  const settings = data.settings;
  requireValid(object(settings) && Array.isArray(settings.feeds), 'settings');
  const feedIds = new Set<string>();
  for (const feed of settings.feeds) {
    requireValid(object(feed) && typeof feed.id === 'string' && !!feed.id &&
      typeof feed.name === 'string' && typeof feed.enabled === 'boolean' && !feedIds.has(feed.id), 'calendar feed');
    requireValid(!feed.url && (!feed.localPath || typeof feed.localPath === 'string'), 'calendar feed credentials or path');
    if (feed.projectId !== undefined) requireValid(typeof feed.projectId === 'string', 'calendar feed project');
    feedIds.add(feed.id);
  }
  for (const key of ['caldavPassword', 'taskCaldavPassword', 'caldavCustomUrl', 'taskCaldavServerUrl']) {
    requireValid(!settings[key], 'backup must not contain connection secrets');
  }
  // Older installations retain removed settings because load merges saved data
  // over defaults. Keep their original types valid without reviving the features.
  const booleans = ['hideAllDayEvents', 'hideSoloEvents', 'caldavEnabled', 'taskCaldavEnabled',
    'taskCaldavLocalEnrollmentDone', 'pushTasksAsEvents', 'routeEventNotesToPara', 'eventAreaOverridesMigrated', 'restoreSyncPaused', 'floatingLauncherEnabled', 'autoBackupEnabled'];
  const numbers = ['scheduleStartHour', 'scheduleEndHour', 'weekStartsOn', 'calendarWeekLength'];
  for (const [key, value] of Object.entries(settings)) {
    if (key === 'feeds') continue;
    if (key === 'hiddenFeedEventIds' || key === 'recentNotePaths' || key === 'collapsedProjectCards') requireValid(strings(value), key);
    else if (key === 'nomadWeeklySections' || key === 'nomadPlannerSections') {
      requireValid(object(value) && Object.values(value).every(item => typeof item === 'boolean'), key);
    } else if (booleans.includes(key)) requireValid(typeof value === 'boolean', key);
    else if (numbers.includes(key)) requireValid(typeof value === 'number' && Number.isFinite(value), key);
    else requireValid(typeof value === 'string', key);
  }
  for (const field of ['tasks', 'userEvents', 'caldavEvents', 'areas', 'projects', 'resources', 'eventTypes']) {
    requireValid(Array.isArray(data[field]), field);
    const ids = new Set<string>();
    for (const item of data[field]) {
      requireValid(object(item), `${field} record`);
      const isEvent = field === 'userEvents' || field === 'caldavEvents';
      const id = item[isEvent || field === 'tasks' ? 'uid' : 'id'];
      requireValid(typeof id === 'string' && !!id && !ids.has(id), `${field} identifier`);
      ids.add(id);
      requireValid(typeof item[isEvent ? 'summary' : field === 'tasks' ? 'title' : 'name'] === 'string', `${field} title`);
      for (const key of ['start', 'end', 'createdAt', 'dueDate', 'completedAt', 'recurrenceId', 'classStartDate']) {
        if (item[key] !== undefined) requireValid(date(item[key]), `${field}.${key}`);
      }
      if (isEvent) {
        requireValid(date(item.start) && date(item.end) && typeof item.allDay === 'boolean' && Array.isArray(item.attendees), 'event dates or attendees');
        requireValid(item.attendees.every((attendee: any) => object(attendee) && Object.values(attendee).every(v => typeof v === 'string')), 'attendee');
      }
      for (const key of ['exceptionDates', 'recurrenceExceptionInstants', 'actionItems', 'categories']) {
        if (item[key] !== undefined) requireValid(strings(item[key]), key);
      }
      for (const key of ['folder', 'notePath', 'caldavUrl', 'caldavCollectionUrl', 'etag', 'rrule', 'parentId', 'areaId',
        'description', 'notes', 'icon', 'template', 'archivedFromFolder', 'shortLabel', 'defaultAreaId', 'defaultProjectId',
        'location', 'recurringSeriesId', 'timeZone', 'recurrenceTimeZone', 'recurrenceValueType', 'recurrenceError',
        'calendarName', 'calendarColor', 'sourceKind', 'sourceFeedId']) {
        if (item[key] !== undefined) requireValid(typeof item[key] === 'string', key);
      }
      for (const key of ['completed', 'allDay', 'archived', 'caldavSyncExcluded', 'isTask', 'undatedTask', 'isTaskMirror']) {
        if (item[key] !== undefined) requireValid(typeof item[key] === 'boolean', key);
      }
      for (const key of ['order', 'sortOrder', 'priority', 'alarmMinutesBefore']) {
        if (item[key] !== undefined) requireValid(typeof item[key] === 'number' && Number.isFinite(item[key]), key);
      }
      for (const key of ['organizer', 'timezoneDefinitions']) {
        if (item[key] !== undefined) requireValid(object(item[key]) && Object.values(item[key]).every(v => typeof v === 'string'), key);
      }
      if (field === 'tasks') {
        requireValid(typeof item.completed === 'boolean', 'task completion');
        if (item.status !== undefined) requireValid(['todo', 'in-progress', 'done'].includes(item.status), 'task status');
      }
      if (field === 'projects') {
        requireValid(['active', 'done', 'archived'].includes(item.status), 'project status');
        if (item.category !== undefined) requireValid(['general', 'class', 'work'].includes(item.category), 'project category');
        if (item.defaultEventDesignation !== undefined) requireValid(['none', 'class', 'meeting'].includes(item.defaultEventDesignation), 'project default calendar designation');
        if (item.linkedFilesGrouping !== undefined) requireValid(['none', 'week'].includes(item.linkedFilesGrouping), 'project linked-file grouping');
        if (item.recurringNotes !== undefined) requireValid(['series', 'session'].includes(item.recurringNotes), 'project recurring notes');
        if (item.autoFileMatch !== undefined) requireValid(typeof item.autoFileMatch === 'string', 'project auto-file words');
        if (item.classWeekStartsOn !== undefined) requireValid(Number.isInteger(item.classWeekStartsOn) && item.classWeekStartsOn >= 0 && item.classWeekStartsOn <= 6, 'project class week start');
      }
    }
  }
  for (const field of ['mappings', 'eventKinds', 'itemMembership']) requireValid(object(data[field]), field);
  for (const mapping of Object.values(data.mappings) as any[]) {
    requireValid(object(mapping) && typeof mapping.eventUid === 'string' && typeof mapping.notePath === 'string', 'note mapping');
    if (mapping.perSession !== undefined) requireValid(typeof mapping.perSession === 'boolean', 'note mapping session flag');
    if (mapping.eventStartIso !== undefined) requireValid(typeof mapping.eventStartIso === 'string' && !Number.isNaN(Date.parse(mapping.eventStartIso)), 'note mapping session date');
  }
  requireValid(Object.values(data.eventKinds).every(kind => kind === 'meeting' || kind === 'class' || kind === 'daily'), 'note kinds');
  for (const entry of Object.values(data.itemMembership)) {
    requireValid(object(entry) && Object.values(entry).every(value => typeof value === 'string'), 'membership');
    if (entry.eventDesignation !== undefined) requireValid(['none', 'class', 'meeting'].includes(entry.eventDesignation), 'event calendar designation');
  }
  requireValid(pushState(data.caldavPushState) && object(data.caldavTaskPushState) &&
    Object.values(data.caldavTaskPushState).every(pushState), 'synchronization history');
  requireValid(strings(data.pendingNoteDeletes), 'queued note paths');
  requireValid(Array.isArray(data.pendingTaskDeletes) && data.pendingTaskDeletes.every((entry: any) =>
    object(entry) && typeof entry.uid === 'string' && typeof entry.collectionUrl === 'string' &&
    Object.values(entry).every(value => typeof value === 'string')), 'queued task deletions');
}

export function parseWorkspaceBackup(text: string): WorkspaceBackup {
  requireValid(text.length <= 32 * 1024 * 1024, 'backup exceeds the 32 MB limit');
  let backup: any;
  try { backup = JSON.parse(text); } catch (_) { throw new Error('Backup is not valid JSON. It may be incomplete.'); }
  requireValid(object(backup) && backup.format === 'snfolio-workspace', 'not an SNFolio backup');
  requireValid(backup.version === 1, 'unsupported backup version');
  requireValid(date(backup.createdAt), 'backup date');
  validateWorkspaceData(backup.data);
  requireValid(object(backup.imports), 'imported calendars');
  safeTree(backup.imports);
  const localFeeds = backup.data.settings.feeds.filter((feed: any) => feed.localPath);
  requireValid(Object.keys(backup.imports).length === localFeeds.length && localFeeds.every((feed: any) =>
    typeof backup.imports[feed.id] === 'string' && /^BEGIN:VCALENDAR\s*$/m.test(backup.imports[feed.id]) &&
      /^END:VCALENDAR\s*$/m.test(backup.imports[feed.id])), 'missing or invalid imported calendar');
  return backup as unknown as WorkspaceBackup;
}

export function pausedWorkspace(data: WorkspaceData): WorkspaceData {
  const copy: WorkspaceData = JSON.parse(JSON.stringify(data));
  copy.settings = { ...copy.settings, caldavEnabled: false, taskCaldavEnabled: false,
    caldavTaskListUrl: '', restoreSyncPaused: true, eventAreaOverridesMigrated: true,
    feeds: copy.settings.feeds.map((feed: any) => ({ ...feed, enabled: false })) };
  return copy;
}
