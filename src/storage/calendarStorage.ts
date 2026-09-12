import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules } from 'react-native';
import { CalendarEvent, CalendarFeed, CalendarSettings, CalendarTask, MeetingNoteMapping, NoteKind, Area, EventType, Project, Resource, ItemMembership, PendingTaskDelete } from '../domain/types';
import { isLegacyTaskEvent, taskFromLegacyEvent } from '../domain/taskFilters';
import { normaliseTask } from '../domain/taskModel';
import { DEFAULT_SYSTEM_TEMPLATE } from '../domain/noteTemplates';
import { CaldavPushState, emptyPushState, forgetPush, stateForTarget } from '../domain/pushState';
import { inferTaskCollectionUrl, normaliseCollectionUrl, taskSourceCollection } from '../domain/taskSync';

const SETTINGS_KEY = '@sn-calendar/settings';
const MAPPINGS_KEY = '@sn-calendar/mappings';
const USER_EVENTS_KEY = '@sn-calendar/userEvents';
const TASKS_KEY = '@sn-calendar/tasks';
const PUSH_STATE_KEY = '@sn-calendar/caldavPushState';
const TASK_PUSH_STATE_KEY = '@sn-calendar/caldavTaskPushState';
const PENDING_TASK_DELETES_KEY = '@sn-calendar/pendingTaskDeletes';
const CALDAV_EVENTS_KEY = '@sn-calendar/caldavEvents';
const EVENT_KINDS_KEY = '@sn-calendar/eventKinds';
const AREAS_KEY = '@sn-calendar/areas';
const PROJECTS_KEY = '@sn-calendar/projects';
const RESOURCES_KEY = '@sn-calendar/resources';
const MEMBERSHIP_KEY = '@sn-calendar/itemMembership';
const PENDING_DELETES_KEY = '@sn-calendar/pendingNoteDeletes';
const EVENT_TYPES_KEY = '@sn-calendar/eventTypes';
const SECURE_CONNECTIONS_KEY = 'calendar-connections';

type SecureStore = {
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<boolean>;
};

const secureStore = NativeModules.CalendarFile as SecureStore | undefined;

const DEFAULT_SETTINGS: CalendarSettings = {
  feeds: [
    {
      id: 'primary-cal',
      name: 'Primary Calendar',
      enabled: true,
    },
  ],
  notesDirectory: '/storage/emulated/0/Note/Meetings',
  defaultTemplate: '',
  seriesNotebookPrefix: 'Series - ',
  defaultViewMode: 'month',
  themeMode: 'business',
  timeFormat: '12h',
  hideAllDayEvents: false,
  hideSoloEvents: false,
  caldavEnabled: false,
  caldavProvider: 'icloud',
  caldavAppleId: '',
  caldavPassword: '',
  caldavCalendarUrl: '',
  caldavCustomUrl: '',
  taskCaldavEnabled: false,
  taskCaldavUsername: '',
  taskCaldavPassword: '',
  taskCaldavCollectionUrl: '',
  taskCaldavCollectionName: '',
  taskCaldavLocalEnrollmentDone: false,
  taskCaldavServerUrl: '',
  // 8mm ruled is the built-in default for every note kind; each is independently
  // changeable, and any of them may instead hold a custom PNG path.
  meetingTemplate: DEFAULT_SYSTEM_TEMPLATE,
  classTemplate: DEFAULT_SYSTEM_TEMPLATE,
  dailyNoteTemplate: DEFAULT_SYSTEM_TEMPLATE,
  classNotesDirectory: '/storage/emulated/0/Note/Classes',
  taskNotesDirectory: '/storage/emulated/0/Note/Task Notes',
  taskNoteTemplate: DEFAULT_SYSTEM_TEMPLATE,
  routeEventNotesToPara: false,
  meetingParaSubpath: 'Meetings',
  classParaSubpath: 'Classes',
  eventAreaOverridesMigrated: false,
  projectsDirectory: '/storage/emulated/0/Note/SNFolio/Projects',
  areasDirectory: '/storage/emulated/0/Note/SNFolio/Areas',
  resourcesDirectory: '/storage/emulated/0/Note/SNFolio/Resources',
  archiveDirectory: '/storage/emulated/0/Note/SNFolio/Archive',
  scheduleStartHour: 8,
  scheduleEndHour: 20,
  weekStartsOn: 0,
  calendarWeekLength: 7,
  dateOrder: 'auto',
  pushTasksAsEvents: false,
  dailyNoteFolder: '/storage/emulated/0/Note/Daily Notes',
  dailyNoteFormat: 'YYYY-MM-DD',
};

/**
 * Spreading DEFAULT_SETTINGS is a shallow copy, so every instance would share
 * the same `feeds` array — and addFeed() pushes into it, mutating the defaults
 * themselves. Hand out a fresh copy instead.
 */
function makeDefaultSettings(): CalendarSettings {
  return {
    ...DEFAULT_SETTINGS,
    feeds: DEFAULT_SETTINGS.feeds.map(f => ({ ...f })),
  };
}

function parseStored(raw: string | null): any | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return undefined;
  }
}

/**
 * The CalDAV app-specific password is never persisted to AsyncStorage.
 *
 * AsyncStorage is unencrypted, and its sandbox belongs to PluginHost rather
 * than to this plugin — every installed plugin shares it, so anything written
 * here is readable by all of them. The password therefore lives in encrypted
 * native storage and is copied into module scope only while the plugin runs.
 *
 * Native builds persist it with Android Keystore-backed AES-GCM storage. The
 * module variable remains the runtime copy and the fallback for test/dev builds
 * without the native module.
 */
let sessionPassword = '';
let sessionTaskPassword = '';

export function setSessionPassword(password: string): void {
  sessionPassword = password || '';
}

export function getSessionPassword(): string {
  return sessionPassword;
}

export function clearSessionPassword(): void {
  sessionPassword = '';
}

export function setSessionTaskPassword(password: string): void {
  sessionTaskPassword = password || '';
}

export function getSessionTaskPassword(): string {
  return sessionTaskPassword;
}

export function clearSessionTaskPassword(): void {
  sessionTaskPassword = '';
}

/** Dates survive JSON as ISO strings; revive them or every date comparison breaks. */
function reviveEvent(raw: any): CalendarEvent {
  return {
    ...raw,
    start: new Date(raw.start),
    end: new Date(raw.end),
  };
}

function reviveArea(raw: any): Area {
  return { ...raw, createdAt: raw.createdAt ? new Date(raw.createdAt) : new Date() };
}

function reviveProject(raw: any): Project {
  const legacyPath = typeof raw.notePath === 'string' ? raw.notePath : undefined;
  const legacySlash = legacyPath?.lastIndexOf('/') ?? -1;
  return {
    ...raw,
    folder:
      raw.folder ||
      (legacyPath && legacySlash > 0 ? legacyPath.slice(0, legacySlash) : undefined),
    status: raw.status || 'active',
    dueDate: raw.dueDate ? new Date(raw.dueDate) : undefined,
    completedAt: raw.completedAt ? new Date(raw.completedAt) : undefined,
    createdAt: raw.createdAt ? new Date(raw.createdAt) : new Date(),
  };
}

function reviveResource(raw: any): Resource {
  const legacyPath = typeof raw.notePath === 'string' ? raw.notePath : undefined;
  const legacySlash = legacyPath?.lastIndexOf('/') ?? -1;
  return {
    ...raw,
    folder:
      raw.folder ||
      (legacyPath && legacySlash > 0 ? legacyPath.slice(0, legacySlash) : undefined),
    createdAt: raw.createdAt ? new Date(raw.createdAt) : new Date(),
  };
}

function reviveTask(raw: any): CalendarTask {
  return {
    ...raw,
    dueDate: raw.dueDate ? new Date(raw.dueDate) : undefined,
    completedAt: raw.completedAt ? new Date(raw.completedAt) : undefined,
    createdAt: raw.createdAt ? new Date(raw.createdAt) : new Date(),
    caldavCollectionUrl: raw.caldavCollectionUrl || inferTaskCollectionUrl(raw.caldavUrl),
  };
}

export class CalendarStorage {
  private settings: CalendarSettings = makeDefaultSettings();
  private mappings: Record<string, MeetingNoteMapping> = {};
  private userEvents: CalendarEvent[] = [];
  private tasks: CalendarTask[] = [];
  private pushState: CaldavPushState = emptyPushState();
  /** Sync history is retained per collection so switching accounts is safe. */
  private taskPushStates: Record<string, CaldavPushState> = {};
  private pendingTaskDeletes: PendingTaskDelete[] = [];
  /** Last read from CalDAV, cached so the calendar is populated on open. */
  private caldavEvents: CalendarEvent[] = [];
  /**
   * Whether each event is a meeting or a class, keyed by uid.
   *
   * Deliberately NOT a field on CalendarEvent. Events from CalDAV and feeds
   * are rebuilt from their ICS text on every sync — parseIcsContent carries no
   * custom fields — so anything stored on the event object is lost the next
   * time Sync Now runs. Keyed by uid it survives, exactly as note mappings and
   * push state already do.
   */
  private eventKinds: Record<string, NoteKind> = {};
  private areas: Area[] = [];
  private eventTypes: EventType[] = [];
  private projects: Project[] = [];
  private resources: Resource[] = [];
  /**
   * Area and project membership keyed by noteIdentity, so one store serves
   * events, tasks and notes alike — and so membership survives a sync
   * rebuilding the event objects.
   */
  private membership: Record<string, ItemMembership> = {};
  /**
   * Note files unlinked from their event but not yet removed from disk.
   *
   * deleteFile navigates to the containing folder, so deleting at the moment
   * the user asks would throw them out of the plugin. Deferring it until the
   * replacement note is opened hides that navigation behind one they wanted.
   * Persisted so an abandoned replacement still gets cleaned up later.
   */
  private pendingDeletes: string[] = [];
  private loaded = false;
  private lastPersistenceError = '';
  /** Native storage writes must not race when several settings change quickly. */
  private saveChain: Promise<void> = Promise.resolve();

  async load(): Promise<{ settings: CalendarSettings; mappings: Record<string, MeetingNoteMapping> }> {
    let shouldSaveAreaMigration = false;
    try {
      const [rawSettings, rawMappings, rawEvents, rawTasks, rawPushState, rawTaskPushState, rawCaldavEvents, rawEventKinds, rawAreas, rawProjects, rawResources, rawMembership, rawPendingDeletes, rawEventTypes, rawPendingTaskDeletes] =
        await Promise.all([
        AsyncStorage.getItem(SETTINGS_KEY),
        AsyncStorage.getItem(MAPPINGS_KEY),
        AsyncStorage.getItem(USER_EVENTS_KEY),
        AsyncStorage.getItem(TASKS_KEY),
        AsyncStorage.getItem(PUSH_STATE_KEY),
        AsyncStorage.getItem(TASK_PUSH_STATE_KEY),
        AsyncStorage.getItem(CALDAV_EVENTS_KEY),
        AsyncStorage.getItem(EVENT_KINDS_KEY),
        AsyncStorage.getItem(AREAS_KEY),
        AsyncStorage.getItem(PROJECTS_KEY),
        AsyncStorage.getItem(RESOURCES_KEY),
        AsyncStorage.getItem(MEMBERSHIP_KEY),
        AsyncStorage.getItem(PENDING_DELETES_KEY),
        AsyncStorage.getItem(EVENT_TYPES_KEY),
        AsyncStorage.getItem(PENDING_TASK_DELETES_KEY),
      ]);

      if (rawSettings) {
        // Merge over defaults so a settings blob written by an older version
        // that lacks newer keys still yields a complete object.
        this.settings = { ...makeDefaultSettings(), ...(parseStored(rawSettings) || {}) };
      }
      if (secureStore?.getSecret) {
        try {
          const secureRaw = await secureStore.getSecret(SECURE_CONNECTIONS_KEY);
          const secure = parseStored(secureRaw);
          if (secure) {
            const urls = secure.feedUrls || {};
            this.settings.feeds = this.settings.feeds.map(feed => ({ ...feed, url: urls[feed.id] }));
            this.settings.caldavCustomUrl = secure.caldavCustomUrl || this.settings.caldavCustomUrl;
            if (secure.caldavPassword) setSessionPassword(secure.caldavPassword);
            this.settings.taskCaldavServerUrl = secure.taskCaldavServerUrl || this.settings.taskCaldavServerUrl;
            if (secure.taskCaldavPassword) setSessionTaskPassword(secure.taskCaldavPassword);
          }
        } catch (e: any) {
          this.lastPersistenceError = e?.message || 'Could not read encrypted calendar connections.';
        }
      }
      if (rawMappings) {
        this.mappings = parseStored(rawMappings) || {};
      }
      if (rawTasks) {
        // normaliseTask fills in a status for anything stored before statuses
        // existed, so nothing has to be migrated on disk.
        const parsed = parseStored(rawTasks);
        this.tasks = Array.isArray(parsed) ? parsed.map(reviveTask).map(normaliseTask) : [];
      }
      if (rawEventTypes) {
        const parsed = parseStored(rawEventTypes);
        this.eventTypes = Array.isArray(parsed) ? parsed.map(reviveArea) as EventType[] : [];
      }
      if (rawAreas) {
        const parsed = parseStored(rawAreas);
        this.areas = Array.isArray(parsed) ? parsed.map(reviveArea) : [];
      }
      if (rawProjects) {
        const parsed = parseStored(rawProjects);
        this.projects = Array.isArray(parsed) ? parsed.map(reviveProject) : [];
      }
      if (rawResources) {
        const parsed = parseStored(rawResources);
        this.resources = Array.isArray(parsed) ? parsed.map(reviveResource) : [];
      }
      if (rawMembership) {
        const parsed = parseStored(rawMembership);
        this.membership = parsed && typeof parsed === 'object' ? parsed : {};
      }
      if (!this.settings.eventAreaOverridesMigrated) {
        // Before events offered a direct Area picker, old builds sometimes
        // copied an Event Type's default Area into membership. It was not an
        // explicit user choice, so clear only those typed legacy values once;
        // future explicit overrides are then safe to preserve.
        this.membership = Object.fromEntries(
          Object.entries(this.membership).map(([identity, entry]) => [
            identity,
            entry.typeId && !entry.projectId ? { ...entry, areaId: undefined } : entry,
          ])
        );
        this.settings.eventAreaOverridesMigrated = true;
        shouldSaveAreaMigration = true;
      }
      if (rawPendingDeletes) {
        const parsed = parseStored(rawPendingDeletes);
        this.pendingDeletes = Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string') : [];
      }
      if (rawEventKinds) {
        const parsed = parseStored(rawEventKinds);
        this.eventKinds = parsed && typeof parsed === 'object' ? parsed : {};
      }
      if (rawCaldavEvents) {
        const parsed = parseStored(rawCaldavEvents);
        this.caldavEvents = Array.isArray(parsed) ? parsed.map(reviveEvent) : [];
      }
      if (rawPushState) {
        const parsed = parseStored(rawPushState);
        // Guard the shape: a truncated or older blob must not make every item
        // look already-pushed.
        this.pushState =
          parsed && typeof parsed.target === 'string' && parsed.records
            ? parsed
            : emptyPushState();
      }
      if (rawTaskPushState) {
        const parsed = parseStored(rawTaskPushState);
        // Migrate the original single-target shape into the per-collection map.
        if (parsed && typeof parsed.target === 'string' && parsed.records) {
          if (parsed.target) this.taskPushStates[normaliseCollectionUrl(parsed.target)] = parsed;
        } else if (parsed && typeof parsed === 'object') {
          this.taskPushStates = Object.fromEntries(
            Object.values(parsed)
              .filter((state: any) => state && typeof state.target === 'string' && state.records)
              .map((state: any) => [normaliseCollectionUrl(state.target), {
                ...state,
                target: normaliseCollectionUrl(state.target),
              }])
          ) as Record<string, CaldavPushState>;
        }
      }
      if (rawPendingTaskDeletes) {
        const parsed = parseStored(rawPendingTaskDeletes);
        this.pendingTaskDeletes = Array.isArray(parsed)
          ? parsed.filter(item => item && typeof item.uid === 'string' && typeof item.collectionUrl === 'string')
          : [];
      }

      if (rawEvents) {
        const parsed = parseStored(rawEvents);
        const revived = Array.isArray(parsed) ? parsed.map(reviveEvent) : [];

        // Tasks used to be stored as CalendarEvents carrying isTask or a
        // "[TASK] " prefix. Lift any of those across to the dedicated task
        // list once, then keep them out of userEvents so they cannot appear
        // twice. Runs only while legacy rows remain.
        const legacy = revived.filter(isLegacyTaskEvent);
        this.userEvents = revived.filter(e => !isLegacyTaskEvent(e));

        if (legacy.length > 0) {
          const known = new Set(this.tasks.map(t => t.uid));
          const migrated = legacy.filter(e => !known.has(e.uid)).map(taskFromLegacyEvent);
          this.tasks = [...this.tasks, ...migrated];
          void this.save();
        }
      }

      // Before task accounts were independent, a non-iCloud CalDAV account
      // could use its VTODO collection through the event credentials. Preserve
      // that working setup once. iCloud is deliberately excluded: its legacy
      // VTODO collection is not the modern Reminders database shown on Apple
      // devices, even though the server still advertises and accepts it.
      if (
        !this.settings.taskCaldavEnabled &&
        this.settings.caldavProvider !== 'icloud' &&
        this.settings.caldavTaskListUrl
      ) {
        this.settings.taskCaldavEnabled = true;
        this.settings.taskCaldavUsername = this.settings.caldavAppleId || '';
        this.settings.taskCaldavCollectionUrl = this.settings.caldavTaskListUrl;
        this.settings.taskCaldavServerUrl = this.settings.caldavCustomUrl || '';
        setSessionTaskPassword(sessionPassword);
      }
    } catch (e: any) {
      // Preserve whatever was already loaded. One unavailable storage read must
      // not reset every independent data set to defaults.
      this.lastPersistenceError = e?.message || 'Could not read plugin storage.';
    }

    // Restored from encrypted native storage when available, otherwise held
    // only in this process's session memory.
    this.settings.caldavPassword = sessionPassword;
    this.settings.taskCaldavPassword = sessionTaskPassword;
    this.loaded = true;
    if (shouldSaveAreaMigration) await this.save();

    return { settings: this.settings, mappings: this.mappings };
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  private save(): Promise<void> {
    const operation = this.saveChain.then(
      () => this.performSave(),
      () => this.performSave(),
    );
    this.saveChain = operation;
    return operation;
  }

  private async performSave(): Promise<void> {
    try {
      // Strip the password on the way out. updateSettings already diverts it to
      // module scope; this is the second guard, so a future call site that sets
      // it directly on the object still cannot write it to disk.
      const { caldavPassword, taskCaldavPassword, ...settingsWithoutPassword } = this.settings;
      void caldavPassword;
      void taskCaldavPassword;
      const persistable = {
        ...settingsWithoutPassword,
        // Private calendar URLs are bearer credentials. They belong in the
        // native encrypted store, not PluginHost-wide AsyncStorage.
        feeds: settingsWithoutPassword.feeds.map(feed => ({ ...feed, url: undefined })),
        caldavCustomUrl: '',
        taskCaldavServerUrl: '',
      };

      if (secureStore?.setSecret) {
        await secureStore.setSecret(SECURE_CONNECTIONS_KEY, JSON.stringify({
          feedUrls: Object.fromEntries(
            this.settings.feeds.filter(feed => feed.url).map(feed => [feed.id, feed.url])
          ),
          caldavCustomUrl: this.settings.caldavCustomUrl || '',
          caldavPassword: sessionPassword,
          taskCaldavServerUrl: this.settings.taskCaldavServerUrl || '',
          taskCaldavPassword: sessionTaskPassword,
        }));
      } else if (this.settings.feeds.some(feed => feed.url)) {
        throw new Error('Encrypted connection storage is unavailable in this build.');
      }

      await Promise.all([
        AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(persistable)),
        AsyncStorage.setItem(MAPPINGS_KEY, JSON.stringify(this.mappings)),
        AsyncStorage.setItem(USER_EVENTS_KEY, JSON.stringify(this.userEvents)),
        AsyncStorage.setItem(TASKS_KEY, JSON.stringify(this.tasks)),
        AsyncStorage.setItem(PUSH_STATE_KEY, JSON.stringify(this.pushState)),
        AsyncStorage.setItem(TASK_PUSH_STATE_KEY, JSON.stringify(this.taskPushStates)),
        AsyncStorage.setItem(PENDING_TASK_DELETES_KEY, JSON.stringify(this.pendingTaskDeletes)),
        AsyncStorage.setItem(CALDAV_EVENTS_KEY, JSON.stringify(this.caldavEvents)),
        AsyncStorage.setItem(EVENT_KINDS_KEY, JSON.stringify(this.eventKinds)),
        AsyncStorage.setItem(AREAS_KEY, JSON.stringify(this.areas)),
        AsyncStorage.setItem(PROJECTS_KEY, JSON.stringify(this.projects)),
        AsyncStorage.setItem(RESOURCES_KEY, JSON.stringify(this.resources)),
        AsyncStorage.setItem(MEMBERSHIP_KEY, JSON.stringify(this.membership)),
        AsyncStorage.setItem(PENDING_DELETES_KEY, JSON.stringify(this.pendingDeletes)),
        AsyncStorage.setItem(EVENT_TYPES_KEY, JSON.stringify(this.eventTypes)),
      ]);
      this.lastPersistenceError = '';
    } catch (e: any) {
      this.lastPersistenceError = e?.message || 'Could not save plugin data.';
    }
  }

  /** Forces pending in-memory state to disk and returns a user-facing error. */
  async flush(): Promise<string> {
    await this.save();
    return this.lastPersistenceError;
  }

  getPersistenceError(): string {
    return this.lastPersistenceError;
  }

  getSettings(): CalendarSettings {
    return this.settings;
  }

  updateSettings(newSettings: Partial<CalendarSettings>): CalendarSettings {
    const { caldavPassword, taskCaldavPassword, ...persistable } = newSettings;

    if (caldavPassword !== undefined) {
      setSessionPassword(caldavPassword);
    }
    if (taskCaldavPassword !== undefined) {
      setSessionTaskPassword(taskCaldavPassword);
    }

    this.settings = {
      ...this.settings,
      ...persistable,
      caldavPassword: sessionPassword,
      taskCaldavPassword: sessionTaskPassword,
    };
    void this.save();
    return this.settings;
  }

  addFeed(feed: CalendarFeed): CalendarFeed[] {
    this.settings.feeds.push(feed);
    void this.save();
    return this.settings.feeds;
  }

  removeFeed(feedId: string): CalendarFeed[] {
    this.settings.feeds = this.settings.feeds.filter(f => f.id !== feedId);
    void this.save();
    return this.settings.feeds;
  }

  getMapping(eventOrSeriesId: string): MeetingNoteMapping | undefined {
    return this.mappings[eventOrSeriesId];
  }

  /** Every note mapping, keyed by event uid and series id. */
  getAllMappings(): Record<string, MeetingNoteMapping> {
    return this.mappings;
  }

  /**
   * Rewrites paths owned by SNFolio after a folder rename/move.
   * Native Supernote links and other apps' records are intentionally outside
   * this store and are covered by the warning shown before a move.
   */
  rewritePathPrefix(fromPath: string, toPath: string): void {
    const from = fromPath.replace(/\/+$/, '');
    const to = toPath.replace(/\/+$/, '');
    if (!from || !to || from === to) return;
    const rewrite = (value: string | undefined): string | undefined => {
      if (!value) return value;
      if (value === from) return to;
      return value.startsWith(`${from}/`) ? `${to}${value.slice(from.length)}` : value;
    };

    this.mappings = Object.fromEntries(
      Object.entries(this.mappings).map(([key, mapping]) => [
        key,
        { ...mapping, notePath: rewrite(mapping.notePath) || mapping.notePath },
      ])
    );
    this.pendingDeletes = this.pendingDeletes.map(path => rewrite(path) || path);
    this.areas = this.areas.map(area => ({ ...area, folder: rewrite(area.folder) }));
    this.projects = this.projects.map(project => ({
      ...project,
      folder: rewrite(project.folder),
      notePath: rewrite(project.notePath),
    }));
    this.resources = this.resources.map(resource => ({
      ...resource,
      folder: rewrite(resource.folder),
      notePath: rewrite(resource.notePath),
    }));
    this.eventTypes = this.eventTypes.map(type => ({ ...type, folder: rewrite(type.folder) }));
    void this.save();
  }

  setMapping(mapping: MeetingNoteMapping): void {
    this.mappings[mapping.eventUid] = mapping;
    if (mapping.seriesId) {
      this.mappings[mapping.seriesId] = mapping;
    }
    void this.save();
  }

  getUserEvents(): CalendarEvent[] {
    return this.userEvents;
  }

  addUserEvent(event: CalendarEvent): CalendarEvent[] {
    const existingIdx = this.userEvents.findIndex(e => e.uid === event.uid);
    if (existingIdx >= 0) {
      this.userEvents[existingIdx] = event;
    } else {
      this.userEvents.push(event);
    }
    void this.save();
    return this.userEvents;
  }

  getTasks(): CalendarTask[] {
    return this.tasks;
  }

  /** Upsert by uid, so editing a task replaces rather than duplicates it. */
  upsertTask(task: CalendarTask): CalendarTask[] {
    const idx = this.tasks.findIndex(t => t.uid === task.uid);
    if (idx >= 0) {
      this.tasks[idx] = task;
    } else {
      this.tasks.push(task);
    }
    void this.save();
    return this.tasks;
  }

  removeTask(uid: string): CalendarTask[] {
    // Removes any subtasks with it, so orphans cannot accumulate once
    // subtasks are surfaced.
    this.tasks = this.tasks.filter(t => t.uid !== uid && t.parentId !== uid);
    void this.save();
    return this.tasks;
  }

  /** Keeps pre-existing device tasks private when a task account is connected. */
  excludeDeviceOnlyTasksFromSync(): number {
    let changed = 0;
    this.tasks = this.tasks.map(task => {
      if (taskSourceCollection(task) || task.caldavSyncExcluded) return task;
      changed++;
      return { ...task, caldavSyncExcluded: true };
    });
    if (changed > 0) void this.save();
    return changed;
  }

  /** Explicitly enrolls previously excluded local tasks in the active account. */
  enrollDeviceOnlyTasksForSync(): number {
    let changed = 0;
    this.tasks = this.tasks.map(task => {
      if (!task.caldavSyncExcluded || taskSourceCollection(task)) return task;
      changed++;
      const { caldavSyncExcluded, ...enrolled } = task;
      void caldavSyncExcluded;
      return enrolled;
    });
    if (changed > 0) void this.save();
    return changed;
  }

  /**
   * Removes tasks that were read from or successfully written to a CalDAV
   * VTODO collection. A resource URL is the durable source marker; device-only
   * tasks never receive one. The remote server is deliberately not contacted.
   */
  removeSyncedTasks(collectionUrl?: string): string[] {
    const target = collectionUrl ? normaliseCollectionUrl(collectionUrl) : undefined;
    const removed = new Set(
      this.tasks
        .filter(task => {
          const source = taskSourceCollection(task);
          return Boolean(source) && (!target || source === target);
        })
        .map(task => task.uid)
    );

    if (removed.size === 0) return [];
    // A device-only subtask is still device-only data. Preserve it and detach
    // it from a removed server-backed parent instead of silently deleting it.
    this.tasks = this.tasks
      .filter(task => !removed.has(task.uid))
      .map(task => task.parentId && removed.has(task.parentId)
        ? { ...task, parentId: undefined }
        : task);
    for (const uid of removed) {
      delete this.membership[uid];
      for (const [stateTarget, state] of Object.entries(this.taskPushStates)) {
        this.taskPushStates[stateTarget] = forgetPush(state, uid);
      }
    }
    if (target) {
      delete this.taskPushStates[target];
      this.pendingTaskDeletes = this.pendingTaskDeletes.filter(
        item => normaliseCollectionUrl(item.collectionUrl) !== target
      );
    } else {
      this.pendingTaskDeletes = [];
    }
    void this.save();
    return [...removed];
  }

  // ── PARA: Areas, Projects, and membership ──────────────────────────────
  // An Area never completes; a Project does. That is the whole distinction,
  // and it is what keeps ongoing commitments out of an active project list.

  getEventTypes(): EventType[] {
    return this.eventTypes;
  }

  upsertEventType(type: EventType): EventType[] {
    const idx = this.eventTypes.findIndex(t => t.id === type.id);
    if (idx >= 0) this.eventTypes[idx] = type;
    else this.eventTypes.push(type);
    void this.save();
    return this.eventTypes;
  }

  /** Removes a type and untags its events; nothing else is destroyed. */
  removeEventType(typeId: string): EventType[] {
    this.eventTypes = this.eventTypes.filter(t => t.id !== typeId);
    for (const [identity, entry] of Object.entries(this.membership)) {
      if (entry.typeId === typeId) this.setMembership(identity, { typeId: undefined });
    }
    void this.save();
    return this.eventTypes;
  }

  /**
   * The type an event carries now.
   *
   * Deliberately does NOT consult the note mapping. getEventKind does, because
   * what a note was created as outranks a later tag — but a type is about what
   * happens next, so the event's current tag wins.
   */
  getEventType(identity: string): string | undefined {
    return this.membership[identity]?.typeId;
  }

  getAreas(): Area[] {
    return this.areas;
  }

  upsertArea(area: Area): Area[] {
    const idx = this.areas.findIndex(a => a.id === area.id);
    if (idx >= 0) this.areas[idx] = area;
    else this.areas.push(area);
    void this.save();
    return this.areas;
  }

  /**
   * Removes an Area and detaches anything filed under it. Projects survive as
   * unfiled rather than being deleted with it — losing a project because its
   * Area was tidied away would be a destructive surprise.
   */
  removeArea(areaId: string): Area[] {
    this.areas = this.areas.filter(a => a.id !== areaId);
    this.projects = this.projects.map(p => (p.areaId === areaId ? { ...p, areaId: undefined } : p));
    for (const [identity, entry] of Object.entries(this.membership)) {
      if (entry.areaId === areaId) this.membership[identity] = { ...entry, areaId: undefined };
    }
    void this.save();
    return this.areas;
  }

  getProjects(): Project[] {
    return this.projects;
  }

  upsertProject(project: Project): Project[] {
    const idx = this.projects.findIndex(p => p.id === project.id);
    if (idx >= 0) this.projects[idx] = project;
    else this.projects.push(project);
    void this.save();
    return this.projects;
  }

  /** Removes a Project and detaches its items, which are not deleted with it. */
  removeProject(projectId: string): Project[] {
    this.projects = this.projects.filter(p => p.id !== projectId);
    for (const [identity, entry] of Object.entries(this.membership)) {
      if (entry.projectId === projectId) {
        this.membership[identity] = { ...entry, projectId: undefined };
      }
    }
    void this.save();
    return this.projects;
  }

  getResources(): Resource[] {
    return this.resources;
  }

  upsertResource(resource: Resource): Resource[] {
    const idx = this.resources.findIndex(item => item.id === resource.id);
    if (idx >= 0) this.resources[idx] = resource;
    else this.resources.push(resource);
    void this.save();
    return this.resources;
  }

  removeResource(resourceId: string): Resource[] {
    this.resources = this.resources.filter(item => item.id !== resourceId);
    void this.save();
    return this.resources;
  }

  /** Membership for an item, keyed by noteIdentity. Never empty-checked away. */
  getMembership(identity: string): ItemMembership {
    return this.membership[identity] || {};
  }

  setMembership(identity: string, entry: ItemMembership): void {
    const merged = { ...this.getMembership(identity), ...entry };
    // Dropping empty entries keeps the store from growing a row per item that
    // was assigned and then cleared.
    if (!merged.areaId && !merged.projectId && !merged.typeId) delete this.membership[identity];
    else this.membership[identity] = merged;
    void this.save();
  }

  /** Queues a note file for removal once the user is next navigating anyway. */
  queueNoteDeletion(path: string): void {
    if (!path || this.pendingDeletes.includes(path)) return;
    this.pendingDeletes.push(path);
    void this.save();
  }

  getPendingNoteDeletions(): string[] {
    return this.pendingDeletes;
  }

  clearPendingNoteDeletion(path: string): void {
    this.pendingDeletes = this.pendingDeletes.filter(p => p !== path);
    void this.save();
  }

  getAllMemberships(): Record<string, ItemMembership> {
    return this.membership;
  }

  removeUserEvent(eventUid: string): CalendarEvent[] {
    this.userEvents = this.userEvents.filter(e => e.uid !== eventUid && e.recurringSeriesId !== eventUid);
    // Forget the push record too: if the same uid is ever created again it
    // must upload rather than be mistaken for something already on the server.
    this.pushState = forgetPush(this.pushState, eventUid);
    void this.save();
    return this.userEvents;
  }

  /**
   * Push bookkeeping for the CalDAV sync. Scoped to a collection, so pointing
   * the plugin at a different calendar starts from nothing.
   */
  getPushState(target: string): CaldavPushState {
    return stateForTarget(this.pushState, target);
  }

  setPushState(state: CaldavPushState): void {
    this.pushState = state;
    void this.save();
  }

  getTaskPushState(target: string): CaldavPushState {
    const key = normaliseCollectionUrl(target);
    return stateForTarget(this.taskPushStates[key], key);
  }

  setTaskPushState(state: CaldavPushState): void {
    const key = normaliseCollectionUrl(state.target);
    this.taskPushStates[key] = { ...state, target: key };
    void this.save();
  }

  forgetTaskPush(uid: string, collectionUrl?: string): void {
    const onlyTarget = collectionUrl ? normaliseCollectionUrl(collectionUrl) : undefined;
    for (const [target, state] of Object.entries(this.taskPushStates)) {
      if (!onlyTarget || target === onlyTarget) this.taskPushStates[target] = forgetPush(state, uid);
    }
    void this.save();
  }

  queueTaskDelete(task: CalendarTask): void {
    const collectionUrl = taskSourceCollection(task);
    if (!collectionUrl || this.pendingTaskDeletes.some(item => item.uid === task.uid && item.collectionUrl === collectionUrl)) return;
    this.pendingTaskDeletes.push({
      uid: task.uid,
      collectionUrl,
      resourceUrl: task.caldavUrl,
      etag: task.etag,
    });
    void this.save();
  }

  getPendingTaskDeletes(collectionUrl?: string): PendingTaskDelete[] {
    if (!collectionUrl) return [...this.pendingTaskDeletes];
    const target = normaliseCollectionUrl(collectionUrl);
    return this.pendingTaskDeletes.filter(item => normaliseCollectionUrl(item.collectionUrl) === target);
  }

  clearPendingTaskDelete(uid: string, collectionUrl: string): void {
    const target = normaliseCollectionUrl(collectionUrl);
    this.pendingTaskDeletes = this.pendingTaskDeletes.filter(
      item => item.uid !== uid || normaliseCollectionUrl(item.collectionUrl) !== target
    );
    void this.save();
  }

  clearTaskAccountBookkeeping(collectionUrl?: string, clearHistory = false): void {
    if (collectionUrl) {
      const target = normaliseCollectionUrl(collectionUrl);
      if (clearHistory) delete this.taskPushStates[target];
      this.pendingTaskDeletes = this.pendingTaskDeletes.filter(
        item => normaliseCollectionUrl(item.collectionUrl) !== target
      );
    }
    void this.save();
  }

  /**
   * Events from the last CalDAV read. Cached so the calendar is populated the
   * moment the plugin opens, rather than staying blank until a sync finishes —
   * and so it still shows something with no network at all.
   */
  getCaldavEvents(): CalendarEvent[] {
    return this.caldavEvents;
  }

  /**
   * The kind recorded for an event, or undefined if it has never been asked.
   * A note mapping is consulted first: if a note already exists, what it was
   * created as is the stronger answer.
   */
  getEventKind(uid: string): NoteKind | undefined {
    return this.mappings[uid]?.kind || this.eventKinds[uid];
  }

  setEventKind(uid: string, kind: NoteKind): void {
    this.eventKinds[uid] = kind;
    void this.save();
  }

  /**
   * Forgets what kind an item was, so the next Create Note asks again.
   *
   * Called when a note is deleted. Changing a kind after the fact cannot move
   * the note already written or restyle its background, so the real correction
   * for a wrong answer is to delete the note and make it again — which only
   * works if the recorded answer goes with it.
   */
  clearEventKind(identity: string): void {
    delete this.eventKinds[identity];
    const mapping = this.mappings[identity];
    if (mapping?.kind) {
      this.mappings[identity] = { ...mapping, kind: undefined };
    }
    void this.save();
  }

  getAllEventKinds(): Record<string, NoteKind> {
    return this.eventKinds;
  }

  /** Replaces the cache wholesale: a read is the full picture for its window. */
  setCaldavEvents(events: CalendarEvent[]): void {
    this.caldavEvents = events;
    void this.save();
  }
}

export const calendarStorage = new CalendarStorage();
