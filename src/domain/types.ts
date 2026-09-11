/**
 * 'para' is the Projects/Areas/Resources/Archive workspace. It is a peer of the calendar
 * views rather than a modal: it sat in the view switcher but opened an
 * overlay, which is what made it feel bolted on.
 */
export type CalendarViewMode = 'month' | 'agenda' | 'para';
/** @deprecated Note wording is selected per event or Event Type. */
export type ProfileThemeMode = 'business' | 'academic';

export interface Attendee {
  name?: string;
  email?: string;
  role?: string;
  status?: 'ACCEPTED' | 'DECLINED' | 'TENTATIVE' | 'NEEDS-ACTION';
}

/**
 * A to-do. Deliberately not a CalendarEvent: a task may have no date at all,
 * whereas an event's start and end are mandatory. Forcing tasks through the
 * event type meant inventing a start time for undated items.
 */
/**
 * PARA vocabulary, since that is the model users arrive with from Obsidian.
 *
 * The distinction that matters: an Area never completes, a Project does. That
 * single rule is what stops an active list filling up with ongoing commitments
 * that have no checkmark ending.
 */
export interface Area {
  id: string;
  name: string;
  /** Shown beside the name; one or two characters. */
  icon?: string;
  /** Folder of notes and reference files supporting this ongoing Area. */
  folder?: string;
  template?: string;
  createdAt: Date;
  /** PARA's Archive: kept for reference, hidden from active pickers. */
  archived?: boolean;
  /** Original location when SNFolio moved this folder into Archive. */
  archivedFromFolder?: string;
}

export type ProjectStatus = 'active' | 'done' | 'archived';

export interface Project {
  id: string;
  name: string;
  /** User-controlled order in the PARA project list; absent for legacy projects. */
  sortOrder?: number;
  /** Compact label used where the full project name would crowd a task row. */
  shortLabel?: string;
  /** The Area this project serves, if any. */
  areaId?: string;
  dueDate?: Date;
  status: ProjectStatus;
  /**
   * Where this project's notes are filed, overriding the per-kind folder, and
   * which background they use. Both optional: unset means fall back to the
   * note kind's own setting.
   */
  folder?: string;
  template?: string;
  createdAt: Date;
  completedAt?: Date;
  /** Legacy single-notebook field; its containing folder is migrated on load. */
  notePath?: string;
  /** Original location when SNFolio moved this folder into Archive. */
  archivedFromFolder?: string;
}

/**
 * Reference material that supports future work but has no finish line.
 * A Resource is intentionally not a Project: it has no due date, progress, or
 * tasks. Its folder of reference notes is the useful payload.
 */
export interface Resource {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  folder?: string;
  template?: string;
  /** Legacy version-9 field, retained while single notebooks migrate to folders. */
  notePath?: string;
  createdAt: Date;
  archived?: boolean;
}

/**
 * Which Area and Project an item belongs to, keyed by noteIdentity.
 *
 * Kept out of CalendarEvent for the same reason note kinds are: events from
 * CalDAV and feeds are rebuilt from their ICS text on every sync, so anything
 * held on the event object is lost. One store serves events, tasks and notes
 * alike rather than each carrying its own fields.
 */
export interface ItemMembership {
  areaId?: string;
  projectId?: string;
  /**
   * What kind of thing this event is — Class, Work, Client Visit — chosen by
   * the user rather than from a fixed list.
   *
   * Distinct from MeetingNoteMapping.kind, which records what an existing note
   * was *created as*. Retyping an event must not retroactively claim its old
   * note used a different template, since the template is baked in at
   * creation. This field decides where the *next* note goes.
   */
  typeId?: string;
}

/**
 * A user-defined kind of event: Class, Work, Personal, Client Visit.
 *
 * Replaces the hardcoded meeting/class dichotomy, which assumed everyone is
 * either in an office or at university. Carries default filing and template
 * choices that Create Note shows before the user confirms or overrides them.
 */
export interface EventType {
  id: string;
  name: string;
  /** Shown on the schedule block; one or two characters. */
  icon?: string;
  /** Where notes for this type are filed, and their background. */
  folder?: string;
  template?: string;
  /** Prefilled when filing an event of this type; never forced. */
  defaultAreaId?: string;
  defaultProjectId?: string;
  createdAt: Date;
  archived?: boolean;
}

/** Where a task is, not merely whether it is finished. */
export type TaskStatus = 'todo' | 'in-progress' | 'done';

/**
 * Todoist's scale, so a future sync adapter is a straight mapping rather than
 * a translation: 1 normal, 2 low, 3 medium, 4 high. Undefined means unset.
 */
export type TaskPriority = 1 | 2 | 3 | 4;

export interface CalendarTask {
  uid: string;
  title: string;
  /** Undefined means no date — the task sits in the "No date" section. */
  dueDate?: Date;
  /** True when the due value is a date without a specific clock time. */
  allDay?: boolean;
  /**
   * Denormalised mirror of `status === 'done'`.
   *
   * Read in a couple of dozen places and written into the outbound VTODO, so
   * it stays the stored source of done-ness. Never set it directly — use the
   * helpers in taskModel, which keep the two in step.
   */
  completed: boolean;
  /**
   * Absent on tasks stored before statuses existed; reviveTask derives it from
   * `completed` on load, so nothing needs migrating on disk.
   */
  status?: TaskStatus;
  priority?: TaskPriority;
  /** Recurrence rule. Reserved: no expander or generator exists yet. */
  rrule?: string;
  /**
   * When it was ticked off. Drives which day the completed task is shown on,
   * so finished work appears on the day you did it rather than lingering in
   * Past Due forever.
   */
  completedAt?: Date;
  /** Reserved for subtasks. Not surfaced in the UI yet; present so adding
   *  them later is additive rather than a stored-data migration. */
  parentId?: string;
  createdAt: Date;
  notes?: string;
  /** Manual ordering within a section; lower sorts first. */
  order?: number;
  caldavUrl?: string;
  etag?: string;
  /**
   * Collection that owns this task. Kept separately from caldavUrl so a task
   * can never be written to a newly connected provider by accident.
   */
  caldavCollectionUrl?: string;
  /** Existing device-only task withheld from a newly connected task account. */
  caldavSyncExcluded?: boolean;
}

export interface PendingTaskDelete {
  uid: string;
  collectionUrl: string;
  resourceUrl?: string;
  etag?: string;
}

export interface CalendarEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  allDay: boolean;
  organizer?: {
    name?: string;
    email?: string;
  };
  attendees: Attendee[];
  actionItems?: string[];
  /**
   * True for items that are tasks rather than calendar events. Drives the
   * VTODO-vs-VEVENT split on push, so a task reaches Apple Reminders instead
   * of showing up as an event. Older stored items predate this flag and are
   * still detected by the legacy "[TASK] " summary prefix.
   */
  isTask?: boolean;
  completed?: boolean;
  priority?: TaskPriority;
  /** A VTODO without DUE; start/end are compatibility placeholders only. */
  undatedTask?: boolean;
  rrule?: string;
  recurringSeriesId?: string;
  exceptionDates?: string[];
  /** Exact recurrence instants excluded by imported EXDATE or RECURRENCE-ID. */
  recurrenceExceptionInstants?: string[];
  /** IANA zone carried by DTSTART, e.g. Pacific/Honolulu. */
  timeZone?: string;
  /** Zone used to expand RRULEs. UTC is explicit; undefined means floating/device-local. */
  recurrenceTimeZone?: string;
  /** DTSTART value domain used to validate RRULE and exception semantics. */
  recurrenceValueType?: 'date' | 'floating' | 'utc' | 'zoned';
  /** Present when recurrence data is preserved but unsafe to expand automatically. */
  recurrenceError?: string;
  /** Original instance replaced by a RECURRENCE-ID override. */
  recurrenceId?: Date;
  /** CalDAV resource metadata used for conflict-safe updates. */
  caldavUrl?: string;
  etag?: string;
  calendarName?: string;
  calendarColor?: string;
  /** Origin controls whether changes can be written back. */
  sourceKind?: 'feed' | 'caldav' | 'local';
  /** A VEVENT created only to make a local task visible on a calendar. */
  isTaskMirror?: boolean;
  /** The subscribed/imported feed that produced this event. */
  sourceFeedId?: string;
  /** Optional display alert written as a VEVENT VALARM. */
  alarmMinutesBefore?: number;
}

export interface MeetingSnapshot {
  eventUid: string;
  seriesId: string;
  title: string;
  dateStr: string;
  timeStr: string;
  organizerStr: string;
  attendeesStr: string;
  locationStr: string;
  descriptionStr: string;
  actionItemsStr: string;
  formattedHeaderText: string;
}

export interface CalendarFeed {
  id: string;
  name: string;
  url?: string;
  localPath?: string;
  color?: string;
  enabled: boolean;
  lastFetched?: string;
}

export interface CalendarSettings {
  feeds: CalendarFeed[];
  notesDirectory: string; // default: "/storage/emulated/0/Note/Meetings"
  defaultTemplate: string; // default: ""
  seriesNotebookPrefix: string; // default: "Series - "
  defaultViewMode: CalendarViewMode; // default: "agenda"
  /** @deprecated Retained only so older stored settings still deserialize. */
  themeMode: ProfileThemeMode;
  hideAllDayEvents: boolean; // default: false
  hideSoloEvents: boolean; // default: false
  caldavEnabled?: boolean;
  caldavProvider?: 'icloud' | 'google' | 'nextcloud' | 'fastmail' | 'yahoo' | 'custom';
  caldavAppleId?: string;
  caldavPassword?: string;
  caldavCalendarUrl?: string;
  /** @deprecated Legacy same-account VTODO collection. Kept only for migration. */
  caldavTaskListUrl?: string;
  caldavCustomUrl?: string;
  /** Optional independent CalDAV account used only for VTODO task sync. */
  taskCaldavEnabled?: boolean;
  taskCaldavUsername?: string;
  taskCaldavPassword?: string;
  taskCaldavCollectionUrl?: string;
  taskCaldavCollectionName?: string;
  /** True after existing local tasks were explicitly kept out of task sync. */
  taskCaldavLocalEnrollmentDone?: boolean;
  taskCaldavServerUrl?: string;
  /** Tie-breaker for ambiguous all-numeric dates; 'auto' uses device region. */
  dateOrder?: 'MDY' | 'DMY' | 'auto';
  /** Mirror tasks onto the calendar as all-day events. Off by default. */
  pushTasksAsEvents?: boolean;
  /** ISO timestamp of the last fully successful manual synchronization. */
  lastSuccessfulSync?: string;
  /** Feed event or series identities hidden only on this device. */
  hiddenFeedEventIds?: string[];
  /** Where the user's daily journal notes live. */
  dailyNoteFolder?: string;
  /** Filename pattern for daily notes; [literals] in brackets. */
  dailyNoteFormat?: string;
  /**
   * Background template for each kind of note. A value is either a system
   * template name from getNoteSystemTemplates (e.g. "style_8mm_ruled_line") or
   * an absolute path to a custom PNG.
   *
   * dailyNoteTemplate predates the other two; meetingTemplate and classTemplate
   * replace the single shared defaultTemplate, which is kept only so an
   * existing setting is not silently discarded.
   */
  dailyNoteTemplate?: string;
  meetingTemplate?: string;
  classTemplate?: string;
  /** Where class notes are filed. Meeting notes use notesDirectory. */
  classNotesDirectory?: string;
  /** Defaults used by notes linked directly to tasks. */
  taskNotesDirectory?: string;
  taskNoteTemplate?: string;
  /** Whether Create Note initially selects its Project/Area rather than its standard folder. */
  routeEventNotesToPara?: boolean;
  /** Relative subfolders used beneath a Project/Area; blank means its root. */
  meetingParaSubpath?: string;
  classParaSubpath?: string;
  /** One-time cleanup for Area values written from Event Type defaults by older builds. */
  eventAreaOverridesMigrated?: boolean;
  /** Configurable PARA roots. Existing installs retain the original SNFolio paths. */
  projectsDirectory?: string;
  areasDirectory?: string;
  resourcesDirectory?: string;
  archiveDirectory?: string;
  /**
   * Hours the Day View's schedule grid draws, 0–23. Anything outside is
   * clamped into view rather than hidden, but a day that starts at 6am is
   * better drawn from 6am than squashed against the top.
   */
  scheduleStartHour?: number;
  scheduleEndHour?: number;
  /** First displayed weekday, using JavaScript's 0=Sunday through 6=Saturday. */
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** Number of consecutive days shown by Calendar Week View. */
  calendarWeekLength?: 5 | 7;
}

/**
 * What a generated note is. Recorded at creation because it is decided by the
 * theme mode at that moment and cannot be recovered afterwards — which is why
 * per-type templates and the grid's M/C badges both needed it.
 */
export type NoteKind = 'meeting' | 'class' | 'daily';

export interface MeetingNoteMapping {
  eventUid: string;
  /** Absent on mappings written before note kinds were recorded. */
  kind?: NoteKind;
  seriesId: string;
  notePath: string;
  lastPageNum: number;
  lastCreatedIso: string;
}
