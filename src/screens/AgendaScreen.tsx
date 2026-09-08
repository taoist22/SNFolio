import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Modal,
  NativeModules,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { PluginManager, FileUtils, PluginCommAPI, PluginFileAPI, RattaFileSelector } from 'sn-plugin-lib';
import { HandwritingTextInput, HandwritingTextInputHandle } from './HandwritingTextInput';
import {
  Area,
  CalendarFeed,
  CalendarEvent,
  CalendarTask,
  CalendarViewMode,
  NoteKind,
  EventType,
  Project,
  ProjectStatus,
  Resource,
  TaskPriority,
  TaskStatus,
} from '../domain/types';
import { countOpenTasks, isSameDay as isSameCalendarDay, sectionTasksForDay } from '../domain/taskFilters';
import {
  isDone,
  statusGlyph,
  taskRowLabel,
  taskStatus,
  withStatus,
} from '../domain/taskModel';
import { DAILY_NOTE_PRESETS, dailyNotePath, dateKey, formatDailyNoteName, looksMangled } from '../domain/dailyNote';
import {
  DEFAULT_SYSTEM_TEMPLATE,
  SystemTemplate,
  ICON_CHOICES,
  resolveNoteDestination,
  templateLabel,
  templateSettingKey,
} from '../domain/noteTemplates';
import { expandEventsForDate, parseIcsContent } from '../domain/icsParser';
import { feedEventHideIdentity, filterEvents } from '../domain/eventFilters';
import { meetingNoteService } from '../supernote/meetingNoteService';
import { resolveArea, resolveAreaId } from '../domain/membership';
import { calendarStorage } from '../storage/calendarStorage';
import { generateNoteFilename, noteIdentity } from '../domain/meetingSnapshot';
import {
  caldavService,
  CalendarCollection,
  CaldavProviderType,
  isTaskItem,
  isTaskMirrorEvent,
} from '../domain/caldavService';
import {
  prunePushState,
  recordPullSnapshot,
  recordPush,
  forgetPush,
  knownServerUids,
  selectItemsToPush,
  selectRemovedUids,
} from '../domain/pushState';
import {
  normaliseCollectionUrl,
  taskBelongsToCollection,
  taskFromCaldavItem,
  taskSourceCollection,
  taskToCaldavItem,
} from '../domain/taskSync';
import { LASSO_BUTTON_ID, LASSO_PRESS_EVENT } from '../domain/buttonIds';
import { parseCapturedText, resolveDateOrder, ParsedCapture } from '../domain/captureParser';
import { captureLassoText } from '../supernote/lassoCapture';
import { MonthGridView } from './MonthGridView';
import { TaskListModal } from './TaskListModal';
import { ParaView } from './ParaView';
import { ProjectDetailView } from './ProjectDetailView';
import { moveActiveProject, projectProgress } from '../domain/taskListView';
import { fetchCalendarFeed, normaliseFeedUrl, refreshCalendarFeeds } from '../domain/feedService';
import { isIcsCalendarContent, parseCalendarSetupFile } from '../domain/calendarImport';
import { projectDisplayLabel } from '../domain/projectLabel';
import { tomorrowScheduleSummary } from '../domain/tomorrowSchedule';
import { dailyFocusTasks, plannerWeekRange, projectsNeedingAttention } from '../domain/plannerReview';
import { WeeklyReviewView } from './WeeklyReviewView';
import { CalendarWeekView } from './CalendarWeekView';
import { FolderPickerModal } from './FolderPickerModal';
import { CreateEventNoteModal, EventNoteChoice, LinkedNoteKind } from './CreateEventNoteModal';
import { ExistingParaFoldersModal } from './ExistingParaFoldersModal';
import {
  PARA_ROOT_KINDS,
  PARA_ROOT_SETTING,
  ParaRootKind,
  normaliseFolderPath,
  paraChildFolder,
  paraRoot,
  safeFolderName,
} from '../domain/paraStorage';

type CalendarFileBridge = {
  readTextFile(pathOrUri: string): Promise<string>;
  storeImportedCalendar(fileName: string, content: string): Promise<string>;
};

const CalendarFile = NativeModules.CalendarFile as CalendarFileBridge | undefined;

/** Progress as solid blocks; a drawn bar smears at these widths on e-ink. */
function blockBar(percent: number): string {
  const filled = Math.round((percent / 100) * 5);
  return '█'.repeat(filled) + '░'.repeat(5 - filled);
}

function weeklyReviewNotePath(folder: string, date: Date, weekStartsOn: number): string {
  const start = plannerWeekRange(date, weekStartsOn).start;
  return `${folder.replace(/\/+$/, '')}/Week of ${dateKey(start)}.note`;
}

import { DayScheduleGrid } from './DayScheduleGrid';
import { hourLabel } from '../domain/dayGrid';
import { ItemCreationModal } from './ItemCreationModal';
import { EventDetailsModal } from './EventDetailsModal';
import { DatePickerModal } from './DatePickerModal';
import { listParaFolderEntries, moveParaFolder, openNoteInEditor, openResourceFile, ParaFolderEntry } from '../supernote/exportService';
import {
  ensureFileDeletePermission,
  ensureFileReadPermission,
  ensureInternetPermission,
} from '../supernote/pluginPermissions';
import { firstPickedFilePath, parentFolderFromPicker } from '../domain/fileSelection';
import { cleanRelativeNoteSubpath, paraEventNoteFolder } from '../domain/eventNoteRouting';
import { areaArchiveState, projectArchiveState } from '../domain/paraArchive';

type SettingsTab = 'sync' | 'notes' | 'app' | 'help';
type ConfigurableNoteKind = NoteKind | 'task';
const CONFIGURABLE_NOTE_KINDS: ConfigurableNoteKind[] = ['daily', 'meeting', 'class', 'task'];

type ArchiveFolderPrompt = {
  mode: 'archive' | 'restore';
  kind: 'project' | 'area';
  item: Project | Area;
  archiveProjects?: boolean;
  /** Active Project ids captured before an Area archive changes their status. */
  projectIds?: string[];
};

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Rows per column in the below-grid strip before collapsing to "+N more". */
const STRIP_TASK_LIMIT = 4;

/**
 * How far either side of today a CalDAV read reaches.
 *
 * The server filters to this window, so a calendar with years of history costs
 * nothing to sync. OPEN: these are placeholders until the past/future sync
 * window is settled.
 */
/**
 * Developer tooling that must not ship publicly. Set to false and the probe
 * button and its output disappear; nothing else depends on it.
 */
const SHOW_DEV_PROBE = false;

/**
 * Beat between deleting a file and opening a note.
 *
 * deleteFile navigates to the containing folder, so the open intent has to
 * land after that navigation to win. sn-shelf uses 180ms for the same class of
 * ordering problem; this is the number to tune if the folder ends up on top.
 */
const DELETE_BEFORE_OPEN_DELAY_MS = 200;

const CALDAV_WINDOW_PAST_DAYS = 30;
const CALDAV_WINDOW_FUTURE_DAYS = 365;

async function readCalendarText(pathOrUri: string): Promise<string> {
  if (CalendarFile?.readTextFile) return CalendarFile.readTextFile(pathOrUri);
  const response = await fetch(pathOrUri.startsWith('file://') ? pathOrUri : `file://${pathOrUri}`);
  return response.text();
}

function countPendingSyncItems(): number {
  const settings = calendarStorage.getSettings();
  let count = 0;
  if (
    settings.caldavEnabled && settings.caldavCalendarUrl &&
    settings.caldavAppleId && settings.caldavPassword
  ) {
    count += selectItemsToPush(
      calendarStorage.getUserEvents(),
      calendarStorage.getPushState(settings.caldavCalendarUrl)
    ).length;
  }
  if (
    settings.taskCaldavEnabled && settings.taskCaldavCollectionUrl &&
    settings.taskCaldavUsername && settings.taskCaldavPassword
  ) {
    const eligibleTasks = calendarStorage.getTasks().filter(task =>
      !task.caldavSyncExcluded &&
      taskBelongsToCollection(task, settings.taskCaldavCollectionUrl as string)
    );
    count += selectItemsToPush(
      eligibleTasks.map(taskToCaldavItem),
      calendarStorage.getTaskPushState(settings.taskCaldavCollectionUrl)
    ).length;
    count += calendarStorage.getPendingTaskDeletes(settings.taskCaldavCollectionUrl).length;
  }
  return count;
}

export function AgendaScreen(): React.JSX.Element {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [calendarMode, setCalendarMode] = useState<'month' | 'week'>('month');
  const [plannerMode, setPlannerMode] = useState<'day' | 'week'>('day');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  // Modals & Popups (Defaults to FALSE on launch)
  const [showDatePickerModal, setShowDatePickerModal] = useState<boolean>(false);
  const [showPlannerMenu, setShowPlannerMenu] = useState<boolean>(false);
  const [showCalendarMenu, setShowCalendarMenu] = useState<boolean>(false);
  const [showAppMenu, setShowAppMenu] = useState<boolean>(false);
  const [showDateActionSheet, setShowDateActionSheet] = useState<boolean>(false);
  const [showItemCreationModal, setShowItemCreationModal] = useState<boolean>(false);
  const [creationType, setCreationType] = useState<'event' | 'task'>('event');

  // Deletion Modal State
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const [pendingDeleteEvent, setPendingDeleteEvent] = useState<CalendarEvent | null>(null);

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [allParsedEvents, setAllParsedEvents] = useState<CalendarEvent[]>([]);
  const [calendarFeeds, setCalendarFeeds] = useState<CalendarFeed[]>([]);
  /**
   * Whether an imported or subscribed feed is configured. Drives the Sync Now
   * button for feed-only setups.
   */
  const [hasSubscribedFeeds, setHasSubscribedFeeds] = useState<boolean>(false);
  /** UIDs from the last feed fetch, so a refresh can replace them. */
  const feedUidsRef = useRef<Set<string>>(new Set());
  const [newFeedUrl, setNewFeedUrl] = useState<string>('');
  const newFeedInputRef = useRef<HandwritingTextInputHandle>(null);
  const [targetNotesDir, setTargetNotesDir] = useState<string>('/storage/emulated/0/Note/Meetings');
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('sync');
  const settingsScrollRef = useRef<ScrollView>(null);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [syncPhase, setSyncPhase] = useState<'idle' | 'syncing' | 'success' | 'partial' | 'error'>('idle');
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState<string>('');
  const [syncDetails, setSyncDetails] = useState<string[]>([]);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);

  // Settings & CalDAV States
  const [hideAllDay, setHideAllDay] = useState<boolean>(false);
  const [hideSolo, setHideSolo] = useState<boolean>(false);
  const [caldavEnabled, setCaldavEnabled] = useState<boolean>(false);
  const [caldavProvider, setCaldavProvider] = useState<CaldavProviderType>('icloud');
  const [caldavAppleId, setCaldavAppleId] = useState<string>('');
  const [caldavPassword, setCaldavPassword] = useState<string>('');
  const caldavCustomUrlInputRef = useRef<HandwritingTextInputHandle>(null);
  const caldavAppleIdInputRef = useRef<HandwritingTextInputHandle>(null);
  const caldavPasswordInputRef = useRef<HandwritingTextInputHandle>(null);
  const [caldavUrl, setCaldavUrl] = useState<string>('');
  const [caldavTaskListUrl, setCaldavTaskListUrl] = useState<string>('');
  const [taskCaldavEnabled, setTaskCaldavEnabled] = useState<boolean>(false);
  const [taskCaldavServerUrl, setTaskCaldavServerUrl] = useState<string>('');
  const [taskCaldavUsername, setTaskCaldavUsername] = useState<string>('');
  const [taskCaldavPassword, setTaskCaldavPassword] = useState<string>('');
  const taskServerInputRef = useRef<HandwritingTextInputHandle>(null);
  const taskUsernameInputRef = useRef<HandwritingTextInputHandle>(null);
  const taskPasswordInputRef = useRef<HandwritingTextInputHandle>(null);
  const [taskCaldavCollectionUrl, setTaskCaldavCollectionUrl] = useState<string>('');
  const [confirmClearSyncedTasks, setConfirmClearSyncedTasks] = useState<boolean>(false);
  const [confirmRemoveTaskAccount, setConfirmRemoveTaskAccount] = useState<boolean>(false);
  const [confirmEnrollLocalTasks, setConfirmEnrollLocalTasks] = useState<boolean>(false);
  const [discoveredTaskLists, setDiscoveredTaskLists] = useState<CalendarCollection[]>([]);
  // Text captured from a lasso selection, prefilled into the creation modal.
  const [lassoDraftTitle, setLassoDraftTitle] = useState<string>('');
  // Parsed date/time from a lasso capture, used to prefill the modal.
  const [lassoDraftParsed, setLassoDraftParsed] = useState<ParsedCapture | null>(null);
  // Date for a lasso draft, kept off the calendar's own selection.
  const [lassoDraftDate, setLassoDraftDate] = useState<Date | null>(null);
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [pushTasksAsEvents, setPushTasksAsEvents] = useState<boolean>(false);
  const [defaultView, setDefaultView] = useState<CalendarViewMode>('month');
  const [newTypeName, setNewTypeName] = useState<string>('');
  const newTypeInputRef = useRef<HandwritingTextInputHandle>(null);
  const folderInputRefs = useRef<Partial<Record<ConfigurableNoteKind, HandwritingTextInputHandle | null>>>({});
  const meetingParaSubpathRef = useRef<HandwritingTextInputHandle>(null);
  const classParaSubpathRef = useRef<HandwritingTextInputHandle>(null);
  const [routeEventNotesToPara, setRouteEventNotesToPara] = useState<boolean>(false);
  const [meetingParaSubpath, setMeetingParaSubpath] = useState<string>('Meetings');
  const [classParaSubpath, setClassParaSubpath] = useState<string>('Classes');
  const [showAdvancedParaNoteLayout, setShowAdvancedParaNoteLayout] = useState<boolean>(false);
  const [iconPickerTypeId, setIconPickerTypeId] = useState<string | null>(null);
  /** Event type whose template is being chosen, if any. */
  const [typeTemplatePicker, setTypeTemplatePicker] = useState<EventType | null>(null);
  const [scheduleStartHour, setScheduleStartHour] = useState<number>(8);
  const [scheduleEndHour, setScheduleEndHour] = useState<number>(20);
  const [weekStartsOn, setWeekStartsOn] = useState<0 | 1 | 2 | 3 | 4 | 5 | 6>(0);
  const [calendarWeekLength, setCalendarWeekLength] = useState<5 | 7>(7);
  const [dailyNoteFolder, setDailyNoteFolder] = useState<string>('/storage/emulated/0/Note/Daily Notes');
  const [dailyNoteFormat, setDailyNoteFormat] = useState<string>('YYYY-MM-DD');
  // null while the existence check is in flight, so the button never claims
  // "Create" for a note that is actually there.
  const [dailyNoteExists, setDailyNoteExists] = useState<boolean | null>(null);
  const [weeklyNoteExists, setWeeklyNoteExists] = useState<boolean | null>(null);
  const [weekJournalDates, setWeekJournalDates] = useState<Date[]>([]);
  /** Local date keys in the visible month that have a daily note on disk. */
  const [dailyNoteDates, setDailyNoteDates] = useState<Set<string>>(new Set());
  /** The task open in the edit modal, so its pickers open on real values. */
  const [editingTask, setEditingTask] = useState<CalendarTask | null>(null);
  /** Confirms whether an event's generated note goes with it. */
  const [showDeleteNoteModal, setShowDeleteNoteModal] = useState<boolean>(false);
  const [showTaskList, setShowTaskList] = useState<boolean>(false);
  const [areas, setAreas] = useState<Area[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  /** Project whose due date is being picked, if any. */
  const [projectDueTarget, setProjectDueTarget] = useState<Project | null>(null);
  /** Project open in the detail view; null shows the browser. */
  const [openProject, setOpenProject] = useState<Project | null>(null);
  /** Confirmation before a PARA status change optionally moves user files. */
  const [archiveFolderPrompt, setArchiveFolderPrompt] = useState<ArchiveFolderPrompt | null>(null);
  /** User-selected Archive root; choosing one also makes it the future default. */
  const [archiveDestinationRoot, setArchiveDestinationRoot] = useState<string | null>(null);
  const [showArchiveRootPicker, setShowArchiveRootPicker] = useState<boolean>(false);
  const [archiveMoveError, setArchiveMoveError] = useState<string>('');
  const [archiveMoveBusy, setArchiveMoveBusy] = useState<boolean>(false);
  /** Area to reveal after correcting a Project's PARA classification. */
  const [paraFocusAreaId, setParaFocusAreaId] = useState<string | null>(null);
  /** Project a new task should be filed under, when adding from inside one. */
  const [pendingProjectId, setPendingProjectId] = useState<string | undefined>(undefined);
  /** Bumped when membership changes, so the list and pickers re-read. */
  const [membershipRevision, setMembershipRevision] = useState<number>(0);
  /** Note kind per event uid, for the month grid's M/C badges. */
  const [noteKindByEvent, setNoteKindByEvent] = useState<Record<string, NoteKind | undefined>>({});
  // Note paths found on disk for the day's events, keyed by event uid. The
  // stored mapping is not enough: it is lost if a note was made outside the
  // plugin or the mapping never got written, and the row would then offer
  // "Create" and produce a duplicate beside the existing note.
  const [eventNotePaths, setEventNotePaths] = useState<Record<string, string>>({});
  // Event opened in the detail modal, where the low-frequency actions live.
  // Non-null while the modal is editing an existing item rather than creating.
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);
  const [caldavCustomUrl, setCaldavCustomUrl] = useState<string>('');

  // Bound, not discarded: this is the token the note-existence checks depend
  // on. Discarding it meant creating a note re-rendered but never re-checked,
  // so the row kept saying "Create Note" until the date changed.
  const [refreshState, setRefreshState] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
    // Hydrate from AsyncStorage before reading anything — getSettings() is a
    // synchronous cache read and returns defaults until load() resolves.
    await calendarStorage.load();
    if (cancelled) return;

    const settings = calendarStorage.getSettings();
    if (settings.taskCaldavCollectionUrl && !settings.taskCaldavLocalEnrollmentDone) {
      calendarStorage.excludeDeviceOnlyTasksFromSync();
      calendarStorage.updateSettings({ taskCaldavLocalEnrollmentDone: true });
      await calendarStorage.flush();
    }
    setCalendarFeeds([...settings.feeds]);
    setViewMode(settings.defaultViewMode || 'month');
    setHideAllDay(settings.hideAllDayEvents);
    setHideSolo(settings.hideSoloEvents);
    setTargetNotesDir(settings.notesDirectory || '/storage/emulated/0/Note/Meetings');
    setCaldavEnabled(Boolean(settings.caldavEnabled));
    setCaldavProvider(settings.caldavProvider || 'icloud');
    setCaldavAppleId(settings.caldavAppleId || '');
    setCaldavPassword(settings.caldavPassword || '');
    setCaldavUrl(settings.caldavCalendarUrl || '');
    setCaldavTaskListUrl(settings.caldavTaskListUrl || '');
    setTaskCaldavEnabled(Boolean(settings.taskCaldavEnabled));
    setTaskCaldavServerUrl(settings.taskCaldavServerUrl || '');
    setTaskCaldavUsername(settings.taskCaldavUsername || '');
    setTaskCaldavPassword(settings.taskCaldavPassword || '');
    setTaskCaldavCollectionUrl(settings.taskCaldavCollectionUrl || '');
    setPushTasksAsEvents(Boolean(settings.pushTasksAsEvents));
    setDefaultView(settings.defaultViewMode || 'month');
    setScheduleStartHour(settings.scheduleStartHour ?? 8);
    setScheduleEndHour(settings.scheduleEndHour ?? 20);
    setWeekStartsOn(settings.weekStartsOn ?? 0);
    setCalendarWeekLength(settings.calendarWeekLength ?? 7);
    setDailyNoteFolder(settings.dailyNoteFolder || '/storage/emulated/0/Note/Daily Notes');
    setDailyNoteFormat(settings.dailyNoteFormat || 'YYYY-MM-DD');
    setRouteEventNotesToPara(Boolean(settings.routeEventNotesToPara));
    setMeetingParaSubpath(settings.meetingParaSubpath ?? 'Meetings');
    setClassParaSubpath(settings.classParaSubpath ?? 'Classes');
    setCaldavCustomUrl(settings.caldavCustomUrl || '');
    setLastSuccessfulSync(settings.lastSuccessfulSync || '');

    // Load persisted user events
    setTasks([...calendarStorage.getTasks()]);
    setAreas([...calendarStorage.getAreas()]);
    setProjects([...calendarStorage.getProjects()]);
    setResources([...calendarStorage.getResources()]);
    setEventTypes([...calendarStorage.getEventTypes()]);
    setPendingSyncCount(countPendingSyncItems());

    const savedUserEvts = calendarStorage.getUserEvents();
    // The cached CalDAV read goes on screen immediately. Without it the
    // calendar sits empty until a sync completes, and shows nothing at all
    // with no network — the subscribed feed used to cover that gap.
    const storedCaldav = calendarStorage.getCaldavEvents();
    const cachedCaldav = storedCaldav.filter(
      event => !isTaskItem(event) && !isTaskMirrorEvent(event)
    );
    if (cachedCaldav.length !== storedCaldav.length) {
      calendarStorage.setCaldavEvents(cachedCaldav);
    }
    feedUidsRef.current = new Set();
    if (savedUserEvts.length > 0 || cachedCaldav.length > 0) {
      // User events first: dedupeEvents keeps the first UID it sees, so a
      // device-side edit wins over the server's copy of the same event.
      setAllParsedEvents([...savedUserEvts, ...cachedCaldav]);
    }

    // The button itself is registered in index.js at startup; only the press
    // handler lives here, because it needs component state.
    try {
      if (PluginManager && PluginManager.registerButtonListener) {
        PluginManager.registerButtonListener({
          onButtonPress: async (msg: any) => {
            // The SDK sends { id, name, icon, pressEvent }. The previous guard
            // tested msg.action and msg.buttonId — neither field exists, so it
            // returned on every press and the handler never ran.
            if (!msg || msg.id !== LASSO_BUTTON_ID || msg.pressEvent !== LASSO_PRESS_EVENT) {
              return;
            }

            setStatusMsg('Reading selection...');
            const capture = await captureLassoText();

            if (!capture.text) {
              setStatusMsg('Nothing recognised in that selection — try selecting the writing again.');
              return;
            }

            // Pull a date/time out of the writing so the modal opens ready to
            // save, rather than making the user navigate to a date.
            const parsed = parseCapturedText(capture.text, {
              dateOrder: resolveDateOrder(calendarStorage.getSettings().dateOrder),
            });

            setStatusMsg(
              `${capture.source === 'ocr' ? 'Recognised' : 'Captured'}: "${capture.text}" → ${parsed.interpretation}`
            );

            setEditingEvent(null);
            setLassoDraftTitle(parsed.title || capture.text);
            setLassoDraftParsed({ ...parsed, sourceText: capture.text, hasDate: Boolean(parsed.date) });
            // Nothing date-like means a to-do, not an appointment.
            setCreationType(parsed.kind);
            // Carry the date on the draft rather than moving the calendar's
            // selection: an undated capture must land on today, not on
            // whatever day a previous capture left the grid sitting on.
            // An undated capture stays undated now that a No Date section exists —
            // defaulting to today buried it among things actually due today.
            setLassoDraftDate(parsed.date ?? null);
            setShowItemCreationModal(true);
          },
        });
      }
    } catch (e) {}

      const needsInternet =
        settings.feeds.some(feed => Boolean(feed.enabled && feed.url)) ||
        settings.caldavEnabled ||
        settings.taskCaldavEnabled;
      const internetAllowed = !needsInternet || await ensureInternetPermission();
      if (internetAllowed) {
        await refreshFeeds();
        // Same job the subscribed feed used to do for iCloud: populate the
        // calendar on open. Silent because encrypted credentials may be absent or
        // locked, and the cached read is already on screen.
        await handlePullCaldavEvents({ silent: true });
        await handlePullCaldavTasks({ silent: true });
      } else if (needsInternet) {
        setStatusMsg('Internet access was not allowed. Cached calendar data remains available.');
      }
    };

    void init().finally(() => setIsLoading(false));

    return () => {
      cancelled = true;
    };
    // Mount-only: this loads storage, registers the lasso button and performs
    // the opening sync. Listing refreshFeeds/handlePullCaldavEvents as deps
    // would re-run all of that on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const settings = calendarStorage.getSettings();
    const activeSettings = {
      ...settings,
      hideAllDayEvents: hideAllDay,
      hideSoloEvents: hideSolo,
    };

    const filteredAll = filterEvents(allParsedEvents, activeSettings);
    const todays = expandEventsForDate(filteredAll, selectedDate);
    setEvents(todays);
  }, [selectedDate, allParsedEvents, hideAllDay, hideSolo]);

  // Synchronous Date Selection Handler to open Day View tab
  const handleSelectDate = (d: Date) => {
    setSelectedDate(d);
    setViewMode('agenda');
  };

  const handlePrevDay = () => {
    const d = new Date(selectedDate);
    if (viewMode === 'month' && calendarMode === 'month') {
      d.setMonth(d.getMonth() - 1);
    } else if (viewMode === 'month' && calendarMode === 'week') {
      d.setDate(d.getDate() - 7);
    } else if (viewMode === 'agenda' && plannerMode === 'week') {
      d.setDate(d.getDate() - 7);
    } else {
      d.setDate(d.getDate() - 1);
    }
    setSelectedDate(d);
  };

  const handleNextDay = () => {
    const d = new Date(selectedDate);
    if (viewMode === 'month' && calendarMode === 'month') {
      d.setMonth(d.getMonth() + 1);
    } else if (viewMode === 'month' && calendarMode === 'week') {
      d.setDate(d.getDate() + 7);
    } else if (viewMode === 'agenda' && plannerMode === 'week') {
      d.setDate(d.getDate() + 7);
    } else {
      d.setDate(d.getDate() + 1);
    }
    setSelectedDate(d);
  };

  const handleToday = () => {
    const now = new Date();
    setSelectedDate(now);
    setShowDatePickerModal(false);
  };

  const handleOpenDatePicker = () => {
    setShowDatePickerModal(true);
  };

  // Picking a month reveals that month's days rather than jumping straight
  // there — the old behaviour left you on whatever day number you happened to
  // be on, which is rarely the one you wanted.


  const handleClosePlugin = () => {
    try {
      PluginManager.closePluginView();
    } catch (e) {}
  };

  const jumpToNextUpcomingEventFromToday = (newEvts: CalendarEvent[]) => {
    if (newEvts.length === 0) return;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

    const upcoming = newEvts
      .filter(e => e.start >= todayStart)
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    if (upcoming.length > 0) {
      setSelectedDate(upcoming[0].start);
    } else {
      setSelectedDate(now);
    }
  };

  const [diagLogs, setDiagLogs] = useState<string[]>([]);
  // Collapsed by default — the full trace is long enough to push the rest of
  // the Feeds / Config page off screen.
  const [showDiagLogs, setShowDiagLogs] = useState<boolean>(false);
  /** Raw output of the template/device probe, shown verbatim under the chooser. */
  const [templateProbe, setTemplateProbe] = useState<string[]>([]);
  /** Which note kind's template chooser is open, if any. */
  const [templatePickerKind, setTemplatePickerKind] = useState<ConfigurableNoteKind | null>(null);
  /** Event awaiting note-kind and destination confirmation. */
  const [noteCreationEvent, setNoteCreationEvent] = useState<CalendarEvent | null>(null);
  /** Task awaiting a named linked-note destination confirmation. */
  const [taskNoteCreationTarget, setTaskNoteCreationTarget] = useState<CalendarTask | null>(null);
  /** In-progress folder edits, so typing is not fought by the stored value. */
  const [folderDrafts, setFolderDrafts] = useState<Partial<Record<ConfigurableNoteKind, string>>>({});
  const [folderPickerTarget, setFolderPickerTarget] = useState<ConfigurableNoteKind | ParaRootKind | null>(null);
  const [paraImportKind, setParaImportKind] = useState<ParaRootKind | null>(null);
  const [paraImportFolders, setParaImportFolders] = useState<ParaFolderEntry[]>([]);
  const [systemTemplates, setSystemTemplates] = useState<SystemTemplate[]>([]);
  /** Bumped on every template/folder write so the settings rows re-read. */
  const [templateRevision, setTemplateRevision] = useState<number>(0);

  useEffect(() => {
    if (!showSettings) return;
    const timer = setTimeout(() => settingsScrollRef.current?.scrollTo({ y: 0, animated: false }), 0);
    return () => clearTimeout(timer);
  }, [showSettings, settingsTab]);

  /**
   * Swaps in a freshly fetched batch of feed events.
   *
   * Feeds used to be appended, which was harmless when they were fetched once
   * on open but duplicates on every refresh. Events held in storage are left
   * alone: those are the user's own and never came from a feed.
   */
  const applyFeedBatch = (fetched: CalendarEvent[]) => {
    const ownUids = new Set(calendarStorage.getUserEvents().map(e => e.uid));
    const stale = new Set([...feedUidsRef.current].filter(uid => !ownUids.has(uid)));
    feedUidsRef.current = new Set(fetched.map(e => e.uid).filter(Boolean));
    setAllParsedEvents(prev => [...prev.filter(e => !stale.has(e.uid)), ...fetched]);
  };

  /**
   * Fetches every subscribed feed. Feeds are how Google calendars reach the
   * plugin, since Google CalDAV needs OAuth; this runs on open and again
   * whenever Sync Now is pressed.
   */
  const refreshFeeds = async (): Promise<{ configured: number; successful: number; failed: number; events: number }> => {

    const settings = calendarStorage.getSettings();
    const savedFeeds = settings.feeds || [];
    let fetched: CalendarEvent[] = [];
    let successfulFeeds = 0;
    let failedFeeds = 0;

    // Reflects configuration, not the outcome: a feed that fails to load today
    // is still a reason to offer Sync Now.
    if (savedFeeds.some(f => f.url && f.enabled && !f.id.startsWith('default-') && f.id !== 'primary-cal')) {
      setHasSubscribedFeeds(true);
    }

    const configuredFeeds = savedFeeds.filter(
      feed => feed.url && feed.enabled && !feed.id.startsWith('default-') && feed.id !== 'primary-cal'
    );
    const localFeeds = savedFeeds.filter(feed => feed.localPath && feed.enabled);

    const feedResult = await refreshCalendarFeeds(configuredFeeds);
    fetched = feedResult.events;
    successfulFeeds = feedResult.successful;
    failedFeeds = feedResult.failed;

    for (const feed of localFeeds) {
      try {
        const path = feed.localPath as string;
        const text = await readCalendarText(path);
        if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Not an iCalendar file');
        fetched.push(...parseIcsContent(text, feed.name || 'Imported Calendar').map(event => ({
          ...event,
          sourceKind: 'feed' as const,
          sourceFeedId: feed.id,
        })));
        successfulFeeds++;
      } catch (_error) {
        failedFeeds++;
      }
    }

    if (configuredFeeds.length + localFeeds.length > 0) {
      // An empty but successful calendar is authoritative and must clear the
      // previous batch. Only retain cached events when every request failed.
      if (successfulFeeds > 0) applyFeedBatch(fetched);
      setHasSubscribedFeeds(true);
      if (successfulFeeds === 0) {
        setStatusMsg(`Could not refresh ${failedFeeds} subscribed feed(s); showing cached events.`);
      } else {
        setStatusMsg(
          `Refreshed ${fetched.length} event(s) from ${successfulFeeds} feed(s)` +
          (failedFeeds ? ` — ${failedFeeds} failed.` : '.')
        );
      }
      return {
        configured: configuredFeeds.length + localFeeds.length,
        successful: successfulFeeds,
        failed: failedFeeds,
        events: fetched.length,
      };
    }

    // Setup files are imported only through the explicit picker. Automatically
    // re-reading /Document/feeds.txt made a deliberately removed calendar come
    // back on the next launch while making the Remove button appear broken.
    // Keep the user's file untouched so it can be reused for test installs.
    return { configured: 0, successful: 0, failed: 0, events: fetched.length };
  };

  /**
   * Uploads user events that are new or edited since their last successful
   * push, using the collection already saved by Test Connection.
   *
   * Deliberately does no discovery: re-running the principal lookup on every
   * sync cost several round trips to rediscover a URL already in settings.
   */
  const pushPendingItems = async (): Promise<{
    pushed: number;
    attempted: number;
    error: string;
  }> => {
    const settings = calendarStorage.getSettings();
    const collectionUrl = settings.caldavCalendarUrl;

    const eventReady = Boolean(
      settings.caldavEnabled && collectionUrl && settings.caldavAppleId && settings.caldavPassword
    );
    const taskReady = Boolean(
      settings.taskCaldavEnabled &&
      settings.taskCaldavCollectionUrl &&
      settings.taskCaldavUsername &&
      settings.taskCaldavPassword
    );
    if (!eventReady && !taskReady) {
      return { pushed: 0, attempted: 0, error: '' };
    }

    const allUserEvts = calendarStorage.getUserEvents();

    // Upload only what is new or edited since the last successful push.
    // Re-pushing everything used to resurrect items deleted on the phone,
    // because a server-side delete leaves the local copy untouched.
    let pushState = calendarStorage.getPushState(collectionUrl || '');
    const pending = eventReady ? selectItemsToPush(allUserEvts, pushState) : [];

    let pushed = 0;
    let error = '';
    let taskDeleteAttempts = 0;
    for (const evt of pending) {
      const pushRes = await caldavService.pushIcloudEvent(evt, {
        provider: settings.caldavProvider as CaldavProviderType,
        appleId: settings.caldavAppleId as string,
        appPassword: settings.caldavPassword,
        calendarUrl: collectionUrl,
      });
      if (pushRes.success) {
        pushed++;
        const synced = {
          ...evt,
          caldavUrl: pushRes.caldavUrl || evt.caldavUrl,
          etag: pushRes.etag || evt.etag,
        };
        calendarStorage.addUserEvent(synced);
        // Recorded only on success, so a failed item retries next sync.
        pushState = recordPush(pushState, synced);
      } else {
        error = pushRes.message;
      }
    }

    if (eventReady) {
      pushState = prunePushState(pushState, allUserEvts.map(e => e.uid));
      calendarStorage.setPushState(pushState);
    }

    // Tasks live in their own store and their own VTODO-capable collection.
    // Keeping a separate push state prevents switching targets from invalidating
    // event bookkeeping or silently leaving tasks unsynchronised.
    if (taskReady && settings.taskCaldavCollectionUrl) {
      const taskCollection = normaliseCollectionUrl(settings.taskCaldavCollectionUrl);
      let taskState = calendarStorage.getTaskPushState(taskCollection);
      const queuedDeletes = calendarStorage.getPendingTaskDeletes(taskCollection);
      taskDeleteAttempts = queuedDeletes.length;
      for (const deletion of queuedDeletes) {
        const result = await caldavService.deleteIcloudEvent(deletion.uid, {
          provider: 'custom',
          appleId: settings.taskCaldavUsername as string,
          appPassword: settings.taskCaldavPassword,
          taskListUrl: taskCollection,
        }, true, { url: deletion.resourceUrl, etag: deletion.etag });
        if (result.success) {
          pushed++;
          calendarStorage.clearPendingTaskDelete(deletion.uid, taskCollection);
          taskState = forgetPush(taskState, deletion.uid);
        } else {
          error = result.message;
        }
      }

      // Never migrate tasks between providers implicitly. Device-only tasks
      // may join this collection; server-backed tasks remain with their source.
      const eligibleTasks = calendarStorage.getTasks().filter(task =>
        !task.caldavSyncExcluded && taskBelongsToCollection(task, taskCollection)
      );
      const taskItems = eligibleTasks.map(taskToCaldavItem);
      const pendingTasks = selectItemsToPush(taskItems, taskState);
      for (const item of pendingTasks) {
        const taskRes = await caldavService.pushIcloudEvent(item, {
          provider: 'custom',
          appleId: settings.taskCaldavUsername as string,
          appPassword: settings.taskCaldavPassword,
          taskListUrl: taskCollection,
        });
        if (taskRes.success) {
          pushed++;
          const task = calendarStorage.getTasks().find(candidate => candidate.uid === item.uid);
          const synced = {
            ...item,
            caldavUrl: taskRes.caldavUrl || item.caldavUrl,
            etag: taskRes.etag || item.etag,
          };
          if (task) {
            calendarStorage.upsertTask({
              ...task,
              caldavUrl: synced.caldavUrl,
              etag: synced.etag,
              caldavCollectionUrl: taskCollection,
            });
          }
          taskState = recordPush(taskState, synced);
        } else {
          error = taskRes.message;
        }
      }
      taskState = prunePushState(taskState, taskItems.map(item => item.uid));
      calendarStorage.setTaskPushState(taskState);
      pending.push(...pendingTasks);
    }

    return { pushed, attempted: pending.length + taskDeleteAttempts, error };
  };

  /**
   * Moves a schedule bound, keeping at least an hour of grid between them and
   * staying inside the day. A start after the end would draw nothing at all.
   */
  const shiftScheduleHour = (which: 'start' | 'end', delta: number) => {
    if (which === 'start') {
      const next = Math.max(0, Math.min(scheduleStartHour + delta, scheduleEndHour - 1));
      setScheduleStartHour(next);
      calendarStorage.updateSettings({ scheduleStartHour: next });
    } else {
      const next = Math.min(23, Math.max(scheduleEndHour + delta, scheduleStartHour + 1));
      setScheduleEndHour(next);
      calendarStorage.updateSettings({ scheduleEndHour: next });
    }
  };

  const handleRunDiagnostics = async () => {
    const appleId = (caldavAppleIdInputRef.current?.getValue() ?? caldavAppleId).trim();
    const password = (caldavPasswordInputRef.current?.getValue() ?? caldavPassword).trim();
    const customUrl = (caldavCustomUrlInputRef.current?.getValue() ?? caldavCustomUrl).trim();
    if (!appleId || !password) {
      setStatusMsg('Please enter your Email/Username and App-Specific Password first.');
      return;
    }
    if (!(await ensureInternetPermission())) {
      setStatusMsg('Internet access was not allowed.');
      return;
    }
    setStatusMsg('Running step-by-step CalDAV Diagnostic probe...');
    const logs = await caldavService.runCalDavDiagnostics({
      provider: caldavProvider,
      appleId,
      appPassword: password,
      customUrl,
    });
    setDiagLogs(logs);
    setStatusMsg(`Diagnostic completed (${logs.length} trace steps recorded).`);
  };

  const handleTestCaldavConnection = async () => {
    const appleId = (caldavAppleIdInputRef.current?.getValue() ?? caldavAppleId).trim();
    const password = (caldavPasswordInputRef.current?.getValue() ?? caldavPassword).trim();
    const customUrl = (caldavCustomUrlInputRef.current?.getValue() ?? caldavCustomUrl).trim();
    if (!appleId || !password) {
      setStatusMsg('Please enter your Email/Username and App-Specific Password.');
      return;
    }
    if (!(await ensureInternetPermission())) {
      setStatusMsg('Internet access was not allowed.');
      return;
    }

    const providerName = caldavProvider.toUpperCase();
    setStatusMsg(`Connecting to ${providerName} CalDAV...`);
    const res = await caldavService.discoverIcloudCalendarUrl({
      provider: caldavProvider,
      appleId,
      appPassword: password,
      customUrl,
    });

    if (res.success) {
      const resolvedUrl = res.calendarUrl || caldavService.resolveProviderInitialUrl(caldavProvider, customUrl);
      setCaldavUrl(resolvedUrl);
      setCaldavTaskListUrl('');
      setCaldavEnabled(true);

      calendarStorage.updateSettings({
        caldavEnabled: true,
        caldavProvider,
        caldavAppleId: appleId,
        caldavPassword: password,
        caldavCalendarUrl: resolvedUrl,
        // Event accounts no longer double as task accounts. In particular,
        // iCloud's advertised legacy VTODO collection is not the modern
        // Reminders database visible on current Apple devices.
        caldavTaskListUrl: '',
        caldavCustomUrl: customUrl,
      });

      const push = await pushPendingItems();

      // Preserve discovery details, including the explicit iCloud legacy-task
      // warning, rather than replacing them with a generic success message.
      if (push.pushed > 0) {
        setStatusMsg(`${res.message} Synced ${push.pushed} of ${push.attempted} changed items.`);
      } else if (push.attempted > 0) {
        setStatusMsg(`${res.message} Sync error: ${push.error}`);
      } else {
        setStatusMsg(`${res.message} Everything already up to date.`);
      }
    } else {
      setStatusMsg(`CalDAV Connection Failed: ${res.message}`);
    }
  };

  const activateTaskCollection = async (
    collection: CalendarCollection,
    credentials?: { serverUrl: string; username: string; password: string }
  ) => {
    const serverUrl = credentials?.serverUrl ?? taskCaldavServerUrl;
    const username = credentials?.username ?? taskCaldavUsername;
    const password = credentials?.password ?? taskCaldavPassword;
    const collectionUrl = normaliseCollectionUrl(collection.url);
    const foreignCount = calendarStorage.getTasks().filter(task => {
      const source = taskSourceCollection(task);
      return source && source !== collectionUrl;
    }).length;
    const excludedCount = calendarStorage.excludeDeviceOnlyTasksFromSync();

    setTaskCaldavEnabled(true);
    setTaskCaldavCollectionUrl(collectionUrl);
    setDiscoveredTaskLists([]);
    setConfirmRemoveTaskAccount(false);
    setTasks([...calendarStorage.getTasks()]);
    calendarStorage.updateSettings({
      taskCaldavEnabled: true,
      taskCaldavUsername: username,
      taskCaldavPassword: password,
      taskCaldavServerUrl: serverUrl,
      taskCaldavCollectionUrl: collectionUrl,
      taskCaldavCollectionName: collection.displayName || 'Tasks',
      taskCaldavLocalEnrollmentDone: true,
    });
    await calendarStorage.flush();
    setStatusMsg(
      `Task account connected to "${collection.displayName || 'Tasks'}". ` +
      (foreignCount > 0
        ? `${foreignCount} task(s) from another list will remain local and will not be uploaded here. `
        : '') +
      (excludedCount > 0
        ? `${excludedCount} existing device task(s) were kept device-only. `
        : '') +
      'Tap Sync Now when you are ready.'
    );
  };

  const handleTestTaskCaldavConnection = async () => {
    const serverUrl = (taskServerInputRef.current?.getValue() ?? taskCaldavServerUrl).trim();
    const username = (taskUsernameInputRef.current?.getValue() ?? taskCaldavUsername).trim();
    const password = (taskPasswordInputRef.current?.getValue() ?? taskCaldavPassword).trim();
    if (!serverUrl || !username || !password) {
      setStatusMsg('Enter the task server URL, username, and password first.');
      return;
    }
    if (!(await ensureInternetPermission())) {
      setStatusMsg('Internet access was not allowed.');
      return;
    }
    if (/\.icloud\.com(?:\/|$)/i.test(serverUrl)) {
      setStatusMsg(
        'Modern Apple Reminders is not exposed through iCloud CalDAV. Use a separate VTODO-capable CalDAV account.'
      );
      return;
    }

    setStatusMsg('Discovering VTODO task lists...');
    const res = await caldavService.discoverIcloudCalendarUrl(
      {
        provider: 'custom',
        appleId: username,
        appPassword: password,
        customUrl: serverUrl,
      },
      'tasks'
    );
    if (!res.success || !res.taskListUrl) {
      setStatusMsg(
        res.success
          ? 'Connected, but this account exposed no VTODO task list.'
          : `Task CalDAV connection failed: ${res.message}`
      );
      return;
    }

    const lists = res.taskLists?.length
      ? res.taskLists
      : [{ url: res.taskListUrl, displayName: 'Tasks', supportsVEvent: false, supportsVTodo: true }];
    if (lists.length > 1) {
      setTaskCaldavServerUrl(serverUrl);
      setTaskCaldavUsername(username);
      setTaskCaldavPassword(password);
      setDiscoveredTaskLists(lists);
      setStatusMsg(`Connected. Choose one of the ${lists.length} VTODO lists below.`);
      return;
    }
    await activateTaskCollection(lists[0], { serverUrl, username, password });
  };

  const handlePauseTaskCaldav = async () => {
    setTaskCaldavEnabled(false);
    calendarStorage.updateSettings({
      taskCaldavEnabled: false,
    });
    await calendarStorage.flush();
    setStatusMsg('Task synchronization paused. Account details, tasks, and pending changes were kept.');
  };

  const handleResumeTaskCaldav = async () => {
    if (!taskCaldavCollectionUrl || !taskCaldavUsername || !taskCaldavPassword) {
      setStatusMsg('Re-enter the account password and connect again to resume task synchronization.');
      return;
    }
    setTaskCaldavEnabled(true);
    calendarStorage.updateSettings({ taskCaldavEnabled: true });
    await calendarStorage.flush();
    setStatusMsg('Task synchronization resumed. Tap Sync Now to reconcile pending changes.');
  };

  const handleRemoveTaskAccount = async (removeLocalTasks: boolean) => {
    const collectionUrl = taskCaldavCollectionUrl;
    const removed = removeLocalTasks && collectionUrl
      ? calendarStorage.removeSyncedTasks(collectionUrl)
      : [];
    calendarStorage.clearTaskAccountBookkeeping(collectionUrl, removeLocalTasks);
    setTaskCaldavEnabled(false);
    setTaskCaldavServerUrl('');
    setTaskCaldavUsername('');
    setTaskCaldavPassword('');
    setTaskCaldavCollectionUrl('');
    setDiscoveredTaskLists([]);
    setConfirmRemoveTaskAccount(false);
    calendarStorage.updateSettings({
      taskCaldavEnabled: false,
      taskCaldavUsername: '',
      taskCaldavPassword: '',
      taskCaldavServerUrl: '',
      taskCaldavCollectionUrl: '',
      taskCaldavCollectionName: '',
      taskCaldavLocalEnrollmentDone: false,
    });
    setTasks([...calendarStorage.getTasks()]);
    setMembershipRevision(value => value + 1);
    setPendingSyncCount(countPendingSyncItems());
    const persistenceError = await calendarStorage.flush();
    setStatusMsg(
      persistenceError
        ? `Account removed for this session, but could not save: ${persistenceError}`
        : removeLocalTasks
          ? `Task account removed. Removed ${removed.length} local synchronized task(s); the server was unchanged.`
          : 'Task account removed. Local tasks were kept; the server was unchanged.'
    );
  };

  const handleClearSyncedTasks = async () => {
    if (taskCaldavCollectionUrl) {
      setConfirmClearSyncedTasks(false);
      setStatusMsg('Remove the task account before clearing its local synchronized tasks.');
      return;
    }
    const removed = calendarStorage.removeSyncedTasks();
    setTasks([...calendarStorage.getTasks()]);
    setConfirmClearSyncedTasks(false);
    setMembershipRevision(value => value + 1);
    setPendingSyncCount(countPendingSyncItems());
    const persistenceError = await calendarStorage.flush();
    setStatusMsg(
      persistenceError
        ? `Removed ${removed.length} synced task(s) from this session, but could not save: ${persistenceError}`
        : `Removed ${removed.length} synced task(s) from SNFolio. The remote account was not changed.`
    );
  };

  const handleEnrollLocalTasks = async () => {
    const enrolled = calendarStorage.enrollDeviceOnlyTasksForSync();
    setTasks([...calendarStorage.getTasks()]);
    setConfirmEnrollLocalTasks(false);
    setPendingSyncCount(countPendingSyncItems());
    const persistenceError = await calendarStorage.flush();
    setStatusMsg(
      persistenceError
        ? `Selected ${enrolled} local task(s), but could not save: ${persistenceError}`
        : `${enrolled} existing device task(s) are now eligible for the active task account. Tap Sync Now to upload them.`
    );
  };

  /**
   * Pulls events down from CalDAV.
   *
   * Everything before this only ever wrote to CalDAV; what appeared on the
   * device came from a subscribed .ics feed. A calendar-query REPORT asks the
   * server for the events themselves, and the time-range filter keeps the
   * response to the window below rather than the whole calendar.
   *
   * Uses the collection already saved by Test Connection, so a routine sync
   * costs one request instead of re-running principal discovery.
   */
  const handlePullCaldavEvents = async (
    options: { silent?: boolean } = {}
  ): Promise<{ configured: boolean; success: boolean; count: number; error?: string }> => {
    const { silent = false } = options;
    const settings = calendarStorage.getSettings();
    const collectionUrl = settings.caldavCalendarUrl;

    if (!settings.caldavEnabled || !collectionUrl || !settings.caldavAppleId || !settings.caldavPassword) {
      // Encrypted credentials may be unavailable after a reinstall or keystore
      // reset. On the automatic pull that is not worth interrupting the user.
      if (!silent) setStatusMsg('Connect a CalDAV account first (Calendar & Sync).');
      return { configured: false, success: false, count: 0 };
    }

    if (!silent) setStatusMsg('Reading events from CalDAV...');

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - CALDAV_WINDOW_PAST_DAYS);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + CALDAV_WINDOW_FUTURE_DAYS);

    const { events: pulled, error } = await caldavService.fetchEventsInRange(
      collectionUrl,
      {
        provider: settings.caldavProvider as CaldavProviderType,
        appleId: settings.caldavAppleId,
        appPassword: settings.caldavPassword,
        calendarUrl: collectionUrl,
      },
      start,
      end,
      'CalDAV'
    );

    if (error) {
      if (!silent) setStatusMsg(`CalDAV read failed: ${error}`);
      return { configured: true, success: false, count: 0, error };
    }

    // Items the plugin pushed itself come back as ordinary VEVENTs carrying
    // the legacy "[TASK] " prefix. They already exist locally, and dedupeEvents
    // keeps the local copy, so they are dropped here rather than re-added as
    // appointments.
    const incoming = pulled.filter(e => !isTaskItem(e) && !isTaskMirrorEvent(e));

    // Reconcile deletions. The read is the authoritative list of what exists
    // in the window, so anything known to be server-backed and missing from it
    // was deleted elsewhere and must go here too. Only reached on a successful
    // read: a network failure returned above, so it can never be mistaken for
    // an empty calendar.
    const serverUids = pulled.map(e => e.uid).filter(Boolean);

    // Compared against stored state rather than the rendered list: the pull on
    // open runs inside the mount effect, where the allParsedEvents closure is
    // still the empty initial value. These two collections are also exactly
    // the items that can be server-backed.
    const reconcilable = [...calendarStorage.getUserEvents(), ...calendarStorage.getCaldavEvents()];

    const removed = selectRemovedUids({
      local: reconcilable,
      serverUids,
      state: calendarStorage.getPushState(collectionUrl),
      windowStart: start,
      windowEnd: end,
    });

    for (const uid of removed) {
      // Drops the stored copy and its push record together, so a later
      // re-create uploads instead of looking already-synced.
      calendarStorage.removeUserEvent(uid);
    }

    // Drop the previous read's events before adding this one, so repeated
    // syncs replace rather than stack up. Events held in storage are excluded:
    // those are the user's own, and a server copy must not displace an edit
    // made on the device.
    const ownUids = new Set(calendarStorage.getUserEvents().map(e => e.uid));
    const stale = new Set(
      calendarStorage
        .getCaldavEvents()
        .map(e => e.uid)
        .filter(uid => !ownUids.has(uid))
    );
    const gone = new Set([...removed, ...stale]);

    setAllParsedEvents(prev => {
      // Local edits load first and dedupeEvents keeps the first UID it sees,
      // so appending leaves anything edited on the device untouched.
      const kept = prev.filter(e => !gone.has(e.uid));
      return [...kept, ...incoming];
    });

    // Cache the read so the calendar is populated the next time the plugin
    // opens, instead of staying blank until a sync finishes.
    calendarStorage.setCaldavEvents(incoming);

    // Remember what the server holds now, so the next read can tell a deletion
    // apart from an item it has simply never seen.
    calendarStorage.setPushState(
      recordPullSnapshot(calendarStorage.getPushState(collectionUrl), serverUids)
    );

    const parts: string[] = [];
    parts.push(
      incoming.length > 0
        ? `Read ${incoming.length} event(s) from CalDAV.`
        : 'CalDAV connected — no events in the sync window.'
    );
    if (removed.length > 0) parts.push(`Removed ${removed.length} deleted elsewhere.`);
    if (!silent) setStatusMsg(parts.join(' '));
    return { configured: true, success: true, count: incoming.length };
  };

  /** Pulls VTODO tasks from the independently configured task account. */
  const handlePullCaldavTasks = async (
    options: { silent?: boolean } = {}
  ): Promise<{ configured: boolean; success: boolean; count: number; error?: string }> => {
    const { silent = false } = options;
    const settings = calendarStorage.getSettings();
    const collectionUrl = settings.taskCaldavCollectionUrl;
    if (
      !settings.taskCaldavEnabled ||
      !collectionUrl ||
      !settings.taskCaldavUsername ||
      !settings.taskCaldavPassword
    ) {
      return { configured: false, success: false, count: 0 };
    }

    const remote = await caldavService.fetchTasks(collectionUrl, {
      provider: 'custom',
      appleId: settings.taskCaldavUsername,
      appPassword: settings.taskCaldavPassword,
      taskListUrl: collectionUrl,
    });
    if (remote.error) {
      if (!silent) setStatusMsg(`Task read failed: ${remote.error}`);
      return { configured: true, success: false, count: 0, error: remote.error };
    }

    const taskCollection = normaliseCollectionUrl(collectionUrl);
    const taskState = calendarStorage.getTaskPushState(taskCollection);
    const pendingDeleteUids = new Set(
      calendarStorage.getPendingTaskDeletes(taskCollection).map(item => item.uid)
    );
    const remoteUids = new Set(remote.tasks.map(item => item.uid));
    for (const item of remote.tasks) {
      // A failed queued DELETE must not immediately resurrect its local task.
      if (pendingDeleteUids.has(item.uid)) continue;
      const existing = calendarStorage.getTasks().find(task => task.uid === item.uid);
      if (!existing || selectItemsToPush([taskToCaldavItem(existing)], taskState).length === 0) {
        calendarStorage.upsertTask(taskFromCaldavItem(item, existing, taskCollection));
      }
    }
    for (const uid of knownServerUids(taskState)) {
      if (remoteUids.has(uid)) continue;
      const existing = calendarStorage.getTasks().find(task => task.uid === uid);
      if (existing && selectItemsToPush([taskToCaldavItem(existing)], taskState).length === 0) {
        calendarStorage.removeTask(uid);
      }
    }
    const liveTaskUids = calendarStorage.getTasks().map(task => task.uid);
    calendarStorage.setTaskPushState(
      prunePushState(recordPullSnapshot(taskState, [...remoteUids]), liveTaskUids)
    );
    setTasks([...calendarStorage.getTasks()]);
    if (!silent) setStatusMsg(`Read ${remote.tasks.length} task(s) from the external task account.`);
    return { configured: true, success: true, count: remote.tasks.length };
  };

  /**
   * Sync Now: refresh everything the plugin knows about, in one press.
   *
   * Covers both providers, which is why it is no longer called Sync CalDAV.
   * Google reaches the plugin as a subscribed feed because Google CalDAV needs
   * OAuth, and feeds previously refreshed only when the plugin opened.
   *
   * Push runs before pull on purpose: pushing sends local changes up, and the
   * pull that follows is then reconciling against a server that already has
   * them, so an item is never judged missing merely because it had not been
   * uploaded yet.
   */
  const handleSyncNow = async () => {
    if (!(await ensureInternetPermission())) {
      setStatusMsg('Internet access was not allowed.');
      setSyncPhase('error');
      return;
    }
    setStatusMsg('Syncing...');
    setSyncPhase('syncing');
    setSyncDetails([]);
    const feed = await refreshFeeds();

    const settings = calendarStorage.getSettings();
    const caldavReady =
      settings.caldavEnabled &&
      settings.caldavCalendarUrl &&
      settings.caldavAppleId &&
      settings.caldavPassword;
    const taskCaldavReady =
      settings.taskCaldavEnabled &&
      settings.taskCaldavCollectionUrl &&
      settings.taskCaldavUsername &&
      settings.taskCaldavPassword;

    if (!caldavReady && !taskCaldavReady) {
      // Feed-only setups are a complete configuration, not a broken one.
      if (settings.caldavEnabled && !settings.caldavPassword) {
        setStatusMsg('Feeds refreshed. Re-enter your CalDAV password to sync that account.');
      }
      const now = new Date().toISOString();
      const details = feed.configured > 0
        ? [`Feeds: ${feed.successful}/${feed.configured} refreshed · ${feed.events} events`]
        : ['No synchronization sources configured.'];
      setSyncDetails(details);
      setSyncPhase(feed.failed > 0 ? 'partial' : feed.configured > 0 ? 'success' : 'idle');
      setPendingSyncCount(countPendingSyncItems());
      if (feed.failed === 0 && feed.configured > 0) {
        setLastSuccessfulSync(now);
        calendarStorage.updateSettings({ lastSuccessfulSync: now });
      }
      return;
    }

    const push = await pushPendingItems();
    const eventPull = caldavReady ? await handlePullCaldavEvents({ silent: true }) : null;
    const taskPull = taskCaldavReady ? await handlePullCaldavTasks({ silent: true }) : null;
    const details: string[] = [];
    if (feed.configured > 0) {
      details.push(`Feeds: ${feed.successful}/${feed.configured} refreshed · ${feed.events} events`);
    }
    details.push(`Uploads: ${push.pushed}/${push.attempted} changed items`);
    if (eventPull) details.push(`Event calendar: ${eventPull.success ? `${eventPull.count} read` : `failed — ${eventPull.error}`}`);
    if (taskPull) details.push(`Task account: ${taskPull.success ? `${taskPull.count} read` : `failed — ${taskPull.error}`}`);

    const failed = feed.failed > 0 || push.pushed < push.attempted ||
      eventPull?.success === false || taskPull?.success === false;
    const succeeded = feed.successful > 0 || push.pushed > 0 || push.attempted === 0 ||
      eventPull?.success === true || taskPull?.success === true;
    const phase = failed ? (succeeded ? 'partial' : 'error') : 'success';
    const pending = countPendingSyncItems();
    setSyncDetails(details);
    setSyncPhase(phase);
    setPendingSyncCount(pending);

    if (!failed) {
      const now = new Date().toISOString();
      setLastSuccessfulSync(now);
      calendarStorage.updateSettings({ lastSuccessfulSync: now });
      setStatusMsg(`Sync complete. ${pending > 0 ? `${pending} item(s) still pending.` : 'Everything is up to date.'}`);
    } else {
      setStatusMsg(`Sync ${phase === 'partial' ? 'completed with warnings' : 'failed'}. Open Calendar & Sync for details.`);
    }
  };

  /**
   * Picks a .txt off the device and subscribes to every calendar URL in it,
   * one per line. Saves the hassle of typing a long iCal secret address into
   * a text box on an e-ink keyboard.
   */
  const handleImportFeedsFromTxt = async () => {
    try {
      if (!(await ensureFileReadPermission())) {
        setStatusMsg('File access was not allowed.');
        return;
      }
      if (!RattaFileSelector || !RattaFileSelector.selectFile) {
        setStatusMsg('Native file picker unavailable on this device.');
        return;
      }

      setStatusMsg('Opening file picker...');

      const result: any = await RattaFileSelector.selectFile({
        // selectType MUST be 0. Mode 1 ("single file") opens the picked file
        // in the NOTE app and never resolves the promise — root-caused in
        // sn-pages 2026-07-12 after it broke sn-merge the same way.
        selectType: 0,
        maxNum: 1,
        title: 'Select a .txt of calendar URLs, or an .ics file',
        rightButtonText: 'Import',
        needSelectFolder: '/storage/emulated/0',
        suffixList: ['txt', 'ics'],
      });

      // The picker's return shape is not guaranteed to be string[]; surface
      // whatever came back rather than returning silently, which is what made
      // this look like "nothing happened".
      const chosenPath: string | undefined = Array.isArray(result)
        ? typeof result[0] === 'string'
          ? result[0]
          : result[0]?.path || result[0]?.uri || result[0]?.filePath
        : typeof result === 'string'
          ? result
          : result?.path || result?.uri || result?.filePath;

      if (!chosenPath) {
        setStatusMsg(`No file selected (picker returned: ${JSON.stringify(result)?.slice(0, 120)})`);
        return;
      }

      setStatusMsg(`Reading ${chosenPath.split('/').pop()}...`);

      let content = '';
      try {
        content = await readCalendarText(chosenPath);
      } catch (readErr: any) {
        setStatusMsg(`Could not read ${chosenPath}: ${readErr?.message || 'read failed'}`);
        return;
      }

      if (!content.trim()) {
        setStatusMsg(`${chosenPath.split('/').pop()} is empty.`);
        return;
      }

      const fileName = chosenPath.split('/').pop() || 'file';

      // An .ics holds calendar data directly; a .txt holds URLs to subscribe
      // to. Sniff the content rather than trusting the extension.
      if (isIcsCalendarContent(content)) {
        const existingLocalFeed = calendarStorage.getSettings().feeds.find(
          feed => feed.localPath === chosenPath || feed.name === fileName
        );
        const localFeedId = existingLocalFeed?.id || `file-${Date.now()}`;
        const evts = parseIcsContent(content, fileName).map(event => ({
          ...event,
          sourceKind: 'feed' as const,
          sourceFeedId: localFeedId,
        }));
        if (evts.length === 0) {
          setStatusMsg(`${fileName} looks like a calendar but no events parsed out of it.`);
          return;
        }
        let retainedPath = chosenPath;
        if (CalendarFile?.storeImportedCalendar) {
          retainedPath = await CalendarFile.storeImportedCalendar(fileName, content);
        }
        if (!existingLocalFeed) {
          const updatedFeeds = calendarStorage.addFeed({
            id: localFeedId,
            name: fileName,
            localPath: retainedPath,
            enabled: true,
            lastFetched: new Date().toISOString(),
          });
          setCalendarFeeds([...updatedFeeds]);
        }
        feedUidsRef.current = new Set([
          ...feedUidsRef.current,
          ...evts.map(event => event.uid).filter(Boolean),
        ]);
        setAllParsedEvents(prev => [...prev, ...evts]);
        setHasSubscribedFeeds(true);
        jumpToNextUpcomingEventFromToday(evts);
        setStatusMsg(
          `Imported ${evts.length} events from ${fileName} and retained a private plugin copy.`
        );
        return;
      }

      const setup = parseCalendarSetupFile(content);

      if (setup.feeds.length === 0) {
        setStatusMsg(
          `No calendar data or valid HTTPS/webcal feed lines found in ${fileName}` +
          (setup.invalidLines ? ` (${setup.invalidLines} invalid line(s)).` : '.')
        );
        return;
      }

      if (!(await ensureInternetPermission())) {
        setStatusMsg('Internet access was not allowed.');
        return;
      }

      const existing = calendarStorage.getSettings().feeds;
      let added = 0;
      let failed = 0;
      const imported: CalendarEvent[] = [];

      for (const definition of setup.feeds) {
        if (existing.some(f => f.url === definition.url)) {
          continue;
        }

        // Validate by fetching before saving, so a bad URL never becomes a
        // stored feed that fails silently on every future startup.
        try {
          const feedId = `feed-import-${Date.now()}-${added}`;
          const evts = await fetchCalendarFeed(definition.url, definition.name, fetch, feedId);

          const updatedFeeds = calendarStorage.addFeed({
            id: feedId,
            name: definition.name,
            url: definition.url,
            enabled: true,
            lastFetched: new Date().toISOString(),
          });
          setCalendarFeeds([...updatedFeeds]);

          imported.push(...evts);
          added++;
        } catch (feedErr) {
          failed++;
        }
      }

      if (imported.length > 0) {
        setAllParsedEvents(prev => [...prev, ...imported]);
      }
      setRefreshState(n => n + 1);

      if (added > 0) {
        setHasSubscribedFeeds(true);
        setStatusMsg(
          `Imported ${added} named feed(s), ${imported.length} events` +
          `${failed > 0 ? ` — ${failed} URL(s) failed` : ''}` +
          `${setup.invalidLines > 0 ? ` — ${setup.invalidLines} invalid line(s) skipped` : ''}. ` +
          `Remove the plaintext setup file after confirming the feeds.`
        );
      } else if (failed > 0) {
        setStatusMsg(`All ${failed} URL(s) failed to load. Check the URLs in that file.`);
      } else {
        setStatusMsg('Those feeds are already subscribed.');
      }
    } catch (e: any) {
      setStatusMsg(`Import failed: ${e?.message || 'Picker closed'}`);
    }
  };

  /**
   * Reports what the device actually offers, rather than what we assume.
   *
   * Two open questions in one press. First, the built-in templates: the SDK
   * exposes getNoteSystemTemplates() and createNote documents its `template`
   * as a system template *name* or an image path, but the plugin has only ever
   * passed paths — so the 8mm ruled preset has never been asked for. The raw
   * result is printed unparsed because the shape is exactly what is unknown.
   *
   * Second, screen size: the reference docs give page pixels (Nomad 1404x1872,
   * Manta 1920x2560) while layout works in dp, and only the Manta's dp width
   * has ever been measured. `scale` is the density that connects the two.
   */
  useEffect(() => {
    let cancelled = false;
    meetingNoteService
      .getSystemTemplates()
      .then(list => {
        if (!cancelled) setSystemTemplates(list);
      })
      .catch(() => {
        // An empty list leaves only the custom-PNG option, which still works.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleProbeDevice = async () => {
    const lines: string[] = [];

    const win = Dimensions.get('window');
    const scr = Dimensions.get('screen');
    lines.push(`window: ${win.width} x ${win.height} dp`);
    lines.push(`screen: ${scr.width} x ${scr.height} dp`);
    lines.push(`scale (density): ${win.scale} · fontScale: ${win.fontScale}`);
    lines.push(`implied pixels: ${Math.round(win.width * win.scale)} x ${Math.round(win.height * win.scale)}`);
    lines.push('---');

    try {
      const templates: any = await PluginCommAPI.getNoteSystemTemplates();

      if (templates === null || templates === undefined) {
        lines.push('getNoteSystemTemplates returned null/undefined');
      } else if (!Array.isArray(templates)) {
        lines.push(`unexpected shape (${typeof templates}):`);
        lines.push(`  ${JSON.stringify(templates).slice(0, 400)}`);
      } else if (templates.length === 0) {
        lines.push('getNoteSystemTemplates returned an empty array');
      } else {
        lines.push(`${templates.length} system template(s):`);
        templates.forEach((t: any, i: number) => {
          lines.push(`  [${i}] ${JSON.stringify(t)}`);
        });
      }
    } catch (e: any) {
      lines.push(`getNoteSystemTemplates threw: ${e?.message || 'unknown error'}`);
    }

    setTemplateProbe(lines);
    setStatusMsg(`Probe complete (${lines.length} lines).`);
  };

  const noteTemplateFor = (kind: ConfigurableNoteKind): string => {
    const settings = calendarStorage.getSettings();
    // templateRevision is read so the row re-renders after a write.
    void templateRevision;
    if (kind === 'task') return settings.taskNoteTemplate || DEFAULT_SYSTEM_TEMPLATE;
    return (settings[templateSettingKey(kind)] as string) || DEFAULT_SYSTEM_TEMPLATE;
  };

  const noteFolderFor = (kind: ConfigurableNoteKind): string => {
    const settings = calendarStorage.getSettings();
    void templateRevision;
    if (kind === 'daily') return settings.dailyNoteFolder || '/storage/emulated/0/Note/Daily Notes';
    if (kind === 'class') {
      return settings.classNotesDirectory || '/storage/emulated/0/Note/Classes';
    }
    if (kind === 'task') return settings.taskNotesDirectory || '/storage/emulated/0/Note/Task Notes';
    return settings.notesDirectory || '/storage/emulated/0/Note/Meetings';
  };

  const setNoteTemplate = (kind: ConfigurableNoteKind, value: string) => {
    calendarStorage.updateSettings(kind === 'task'
      ? { taskNoteTemplate: value }
      : { [templateSettingKey(kind)]: value });
    setTemplateRevision(n => n + 1);
    setTemplatePickerKind(null);
    setStatusMsg(`${kind} template set to ${templateLabel(value)}.`);
  };

  /**
   * Folder picker per note kind. The device's own browser is the only picker
   * available — the SDK exposes no folder-creation call of its own — so if it
   * cannot make a folder, ensureDirectory creates the chosen path anyway.
   */
  const saveNoteFolder = async (kind: ConfigurableNoteKind, folder: string) => {
    const trimmed = folder.trim().replace(/\/+$/, '');
    if (!trimmed.startsWith('/')) {
      setStatusMsg('Folder must be a full path, e.g. /storage/emulated/0/Note/Classes');
      return;
    }

    // Typed folders may not exist yet — creating one here is the only way to
    // name a new folder at all, since no folder picker exists.
    await meetingNoteService.ensureDirectory(trimmed);
    applyNoteFolder(kind, trimmed);
  };

  /**
   * "Browse" for a folder by picking any file inside it and taking its parent.
   *
   * There is no folder picker in the SDK — the file selector always returns
   * files, and sn-shelf reaches a folder the same way, from the path of the
   * note you are in. A folder that does not exist yet cannot be reached at
   * all this way, which is why the path is editable above.
   */
  const handleChooseNoteFolder = (kind: ConfigurableNoteKind) => setFolderPickerTarget(kind);

  const applyNoteFolder = (kind: ConfigurableNoteKind, folder: string) => {
    if (kind === 'daily') {
      setDailyNoteFolder(folder);
      calendarStorage.updateSettings({ dailyNoteFolder: folder });
    } else if (kind === 'class') {
      calendarStorage.updateSettings({ classNotesDirectory: folder });
    } else if (kind === 'task') {
      calendarStorage.updateSettings({ taskNotesDirectory: folder });
    } else {
      setTargetNotesDir(folder);
      calendarStorage.updateSettings({ notesDirectory: folder });
    }

    setFolderDrafts(prev => ({ ...prev, [kind]: folder }));
    setTemplateRevision(n => n + 1);
    setStatusMsg(`${kind} notes folder: ${folder}`);
  };

  const paraRootFor = (kind: ParaRootKind): string => {
    void templateRevision;
    return paraRoot(calendarStorage.getSettings(), kind);
  };

  const applyParaRoot = (kind: ParaRootKind, folder: string) => {
    calendarStorage.updateSettings({ [PARA_ROOT_SETTING[kind]]: folder });
    setTemplateRevision(n => n + 1);
    setStatusMsg(`${kind[0].toUpperCase()}${kind.slice(1)} root: ${folder}`);
  };

  const scanParaRoot = async (kind: ParaRootKind) => {
    try {
      const folders = (await listParaFolderEntries(paraRootFor(kind))).filter(entry => entry.isFolder);
      setParaImportFolders(folders);
      setParaImportKind(kind);
    } catch (e: any) {
      setStatusMsg(`Could not read ${kind}: ${e?.message || 'folder unavailable'}`);
    }
  };

  const importParaFolder = (
    kind: ParaRootKind,
    entry: ParaFolderEntry,
    archiveAs?: 'project' | 'area' | 'resource',
  ) => {
    const now = new Date();
    const effectiveKind = kind === 'archive'
      ? archiveAs === 'project' ? 'projects' : archiveAs === 'area' ? 'areas' : archiveAs === 'resource' ? 'resources' : undefined
      : kind;
    if (!effectiveKind) return;
    if (effectiveKind === 'projects') {
      const existing = calendarStorage.getProjects().find(item => item.name.toLowerCase() === entry.name.toLowerCase());
      calendarStorage.upsertProject(existing ? {
        ...existing,
        folder: entry.path,
        status: kind === 'archive' ? 'archived' : existing.status,
      } : {
        id: `proj-${Date.now()}`,
        name: entry.name,
        folder: entry.path,
        status: kind === 'archive' ? 'archived' : 'active',
        createdAt: now,
      });
      setProjects([...calendarStorage.getProjects()]);
    } else if (effectiveKind === 'areas') {
      const existing = calendarStorage.getAreas().find(item => item.name.toLowerCase() === entry.name.toLowerCase());
      calendarStorage.upsertArea(existing ? {
        ...existing,
        folder: entry.path,
        archived: kind === 'archive' ? true : existing.archived,
      } : {
        id: `area-${Date.now()}`,
        name: entry.name,
        folder: entry.path,
        createdAt: now,
        archived: kind === 'archive' ? true : undefined,
      });
      setAreas([...calendarStorage.getAreas()]);
    } else {
      const existing = calendarStorage.getResources().find(item => item.name.toLowerCase() === entry.name.toLowerCase());
      calendarStorage.upsertResource(existing ? {
        ...existing,
        folder: entry.path,
        notePath: undefined,
        archived: kind === 'archive' ? true : existing.archived,
      } : {
        id: `resource-${Date.now()}`,
        name: entry.name,
        folder: entry.path,
        createdAt: now,
        archived: kind === 'archive' ? true : undefined,
      });
      setResources([...calendarStorage.getResources()]);
    }
    setStatusMsg(`${kind === 'archive' ? 'Imported archived' : 'Associated'} ${entry.name} with ${entry.path}.`);
  };

  const handleChooseCustomTemplate = async (kind: ConfigurableNoteKind) => {
    try {
      if (!RattaFileSelector || !RattaFileSelector.selectFile) {
        setStatusMsg('Native file picker unavailable on this device.');
        return;
      }
      const result: any = await RattaFileSelector.selectFile({
        // selectType MUST be 0. Mode 1 ("single file") opens the picked file
        // in the NOTE app and never resolves the promise — root-caused in
        // sn-pages 2026-07-12 after it broke sn-merge the same way.
        selectType: 0,
        maxNum: 1,
        title: 'Select Background Template PNG',
        rightButtonText: 'Select',
      });
      if (result && Array.isArray(result) && result.length > 0 && typeof result[0] === 'string') {
        setNoteTemplate(kind, result[0]);
      }
    } catch (e: any) {
      setStatusMsg(`Template picker error: ${e?.message || 'Picker closed'}`);
    }
  };

  const handleChooseCustomTypeTemplate = async (type: EventType) => {
    try {
      if (!RattaFileSelector?.selectFile) {
        setStatusMsg('Native file picker unavailable on this device.');
        return;
      }
      const result: any = await RattaFileSelector.selectFile({
        selectType: 0,
        maxNum: 1,
        title: `Select ${type.name} Background Template PNG`,
        rightButtonText: 'Select',
        suffixList: ['png'],
      });
      const path = Array.isArray(result) && typeof result[0] === 'string' ? result[0] : undefined;
      if (path) {
        handleUpdateEventType({ ...type, template: path });
        setTypeTemplatePicker(null);
      }
    } catch (e: any) {
      setStatusMsg(`Template picker error: ${e?.message || 'Picker closed'}`);
    }
  };

  /** Opens note-specific choices at the moment the file is actually created. */
  const handleRequestNoteCreation = (event: CalendarEvent) => {
    setShowDateActionSheet(false);
    setNoteCreationEvent(event);
  };

  const noteChoiceFor = (event: CalendarEvent, kind: 'meeting' | 'class'): EventNoteChoice => {
    const settings = calendarStorage.getSettings();
    const typeId = calendarStorage.getEventType(noteIdentity(event));
    const eventType = typeId ? calendarStorage.getEventTypes().find(type => type.id === typeId) : undefined;
    const fallbackFolder = kind === 'class'
      ? settings.classNotesDirectory || settings.notesDirectory
      : settings.notesDirectory;
    const fallbackTemplate = (kind === 'class' ? settings.classTemplate : settings.meetingTemplate) || DEFAULT_SYSTEM_TEMPLATE;
    const destination = resolveNoteDestination(eventType, {
      folder: fallbackFolder || '/storage/emulated/0/Note/Meetings',
      template: fallbackTemplate,
    });
    const membership = calendarStorage.getMembership(noteIdentity(event));
    const project = membership.projectId
      ? calendarStorage.getProjects().find(candidate => candidate.id === membership.projectId)
      : undefined;
    const area = resolveArea(
      membership,
      calendarStorage.getProjects(),
      calendarStorage.getAreas(),
      calendarStorage.getEventTypes()
    );
    const contextFolder = paraEventNoteFolder(
      settings,
      kind,
      project ? folderForParaItem('project', project) : undefined,
      area ? folderForParaItem('area', area) : undefined
    );

    return {
      contextFolder,
      contextLabel: project ? `Project: ${project.name}` : area ? `Area: ${area.name}` : undefined,
      defaultFolder: normaliseFolderPath(destination.folder),
      defaultLabel: eventType?.folder ? `Event Type: ${eventType.name}` : `Standard ${kind === 'class' ? 'Class' : 'Meeting'} folder`,
      templateLabel: templateLabel(destination.template),
    };
  };

  const suggestedEventNoteName = (event: CalendarEvent, kind: 'meeting' | 'class'): string =>
    generateNoteFilename(
      event,
      Boolean(event.recurringSeriesId),
      calendarStorage.getSettings().seriesNotebookPrefix,
      kind
    ).replace(/\.note$/i, '');

  const handleConfirmNoteCreation = (kind: LinkedNoteKind, folder: string, name: string) => {
    const event = noteCreationEvent;
    setNoteCreationEvent(null);
    if (!event || kind === 'task') return;
    calendarStorage.setEventKind(noteIdentity(event), kind);
    setNoteKindByEvent(prev => ({ ...prev, [noteIdentity(event)]: kind }));
    void handleExecuteNoteCreation(event, kind, folder, name);
  };

  const handleExecuteNoteCreation = async (
    event: CalendarEvent,
    kind: 'meeting' | 'class' = 'meeting',
    selectedFolder?: string,
    noteName?: string
  ) => {
    setShowDateActionSheet(false);
    setStatusMsg(`Creating ${eventTypeName(event) || kind} note...`);

    const typeId = calendarStorage.getEventType(noteIdentity(event));
    const eventType = typeId ? eventTypes.find(t => t.id === typeId) : undefined;

    const result = await meetingNoteService.createOrAppendMeetingNote(
      event,
      false,
      kind,
      eventType,
      selectedFolder,
      noteName
    );
    if (result.success) {
      const actionText = result.isNewFile ? 'Created' : `Appended page ${result.pageNum} of`;
      setRefreshState(prev => prev + 1);

      // Optimistic, so the row flips to "Open Note" straight away rather than
      // waiting for the next existence sweep.
      setEventNotePaths(prev => ({ ...prev, [event.uid]: result.notePath }));

      // The replacement exists, so the old file can go now. Its folder
      // navigation is about to be overwritten by opening this note.
      const removed = await flushPendingNoteDeletions();
      if (removed > 0) {
        await new Promise<void>(resolve => setTimeout(() => resolve(), DELETE_BEFORE_OPEN_DELAY_MS));
      }

      // Open it the way daily notes do — through the native intent. The service
      // used to call openFilePath, which drops you in the file manager.
      // Open the page just created. Omitting pageNum reopens the notebook on
      // its last-used page, which is often the previous meeting occurrence.
      await prepareForNativeFileOpen();
      const opened = await openNoteInEditor(result.notePath, result.pageNum);
      if (opened.success) closePanel();
      setStatusMsg(
        opened.success
          ? `${actionText} ${result.notePath.split('/').pop()}${result.warning ? ` — ${result.warning}` : ''}`
          : `${actionText} ${result.notePath.split('/').pop()} — could not open it: ${opened.message}`
      );
    } else {
      setStatusMsg(`Could not create note: ${result.error || 'Unknown error'}`);
    }
  };

  const isWideScreen = Dimensions.get('window').width >= 800;
  const connectedCalendarFeeds = calendarFeeds.filter(feed =>
    (feed.url || feed.localPath) &&
    !feed.id.startsWith('default-') &&
    feed.id !== 'primary-cal'
  );
  const syncedTaskCount = tasks.filter(task => Boolean(taskSourceCollection(task))).length;
  const excludedLocalTaskCount = tasks.filter(task =>
    task.caldavSyncExcluded && !taskSourceCollection(task)
  ).length;

  // Fifteen days forward from whichever day is selected, so the one- and
  // two-week marks mean "from the day you are looking at" rather than always
  // from today. Forward-only: past days are not worth the strip space.
  const weekDays = (() => {
    const base = new Date(selectedDate);
    base.setHours(0, 0, 0, 0);
    return Array.from({ length: 15 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return d;
    });
  })();

  // Project cards show the next two months of assigned events, including
  // expanded recurring occurrences. A bounded window keeps PARA responsive.
  const paraUpcomingEvents = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const seen = new Set<string>();
    const result: CalendarEvent[] = [];
    for (let offset = 0; offset < 60; offset++) {
      const day = new Date(start);
      day.setDate(day.getDate() + offset);
      for (const event of expandEventsForDate(allParsedEvents, day)) {
        if (event.isTask || event.isTaskMirror) continue;
        const key = `${event.uid}-${event.start.toISOString()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(event);
      }
    }
    return result.sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [allParsedEvents]);

  /**
   * Opens the day's journal note, creating it if absent. The plugin cannot
   * list a directory (FileUtils.listFiles is unavailable), so the path is
   * computed from the configured folder and format and checked with exists().
   */
  // Whether the day's journal note already exists, so the button can say
  // Create rather than Open. Re-checked when the day or naming settings
  // change; exists() is async, so the answer has to be held in state.
  const visibleYear = selectedDate.getFullYear();
  const visibleMonth = selectedDate.getMonth();

  useEffect(() => {
    let cancelled = false;
    const path = dailyNotePath(dailyNoteFolder, dailyNoteFormat, selectedDate);

    setDailyNoteExists(null);
    Promise.resolve(FileUtils.exists(path))
      .then((found: any) => {
        if (!cancelled) setDailyNoteExists(Boolean(found));
      })
      .catch(() => {
        // A failed check is not proof of absence — leave it unknown rather
        // than offering "Create" for a note that is really there.
        if (!cancelled) setDailyNoteExists(null);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedDate, dailyNoteFolder, dailyNoteFormat]);

  // Weekly Review reuses the daily-note folder and template, but has its own
  // deterministic file. The seven daily paths are checked individually so the
  // review can link to journal entries without requiring a directory scan.
  useEffect(() => {
    let cancelled = false;
    const range = plannerWeekRange(selectedDate, weekStartsOn);
    const days = Array.from({ length: 7 }, (_, offset) => {
      const day = new Date(range.start);
      day.setDate(day.getDate() + offset);
      return day;
    });

    setWeeklyNoteExists(null);
    Promise.all([
      Promise.resolve(FileUtils.exists(weeklyReviewNotePath(dailyNoteFolder, selectedDate, weekStartsOn)))
        .then(Boolean)
        .catch(() => false),
      Promise.all(days.map(async day => {
        try {
          return await FileUtils.exists(dailyNotePath(dailyNoteFolder, dailyNoteFormat, day)) ? day : null;
        } catch (_error) {
          return null;
        }
      })),
    ]).then(([weeklyExists, journalDays]) => {
      if (cancelled) return;
      setWeeklyNoteExists(weeklyExists);
      setWeekJournalDates(journalDays.filter((day): day is Date => day !== null));
    });

    return () => { cancelled = true; };
  }, [selectedDate, dailyNoteFolder, dailyNoteFormat, weekStartsOn]);

  // Mappings are the only record of which events have notes; unlike the daily
  // check this costs nothing, since they are already in memory. Rebuilt when
  // the notes directory or theme changes, both of which follow note creation.
  useEffect(() => {
    // Mappings only — a badge means a note exists on that day. An event that
    // merely has a kind recorded has no note behind it, so badging it would
    // make the flag say something it does not mean.
    const mappings = calendarStorage.getAllMappings();
    const byEvent: Record<string, NoteKind | undefined> = {};
    for (const mapping of Object.values(mappings)) {
      if (!mapping?.eventUid) continue;
      const identity = mapping.seriesId || mapping.eventUid;
      byEvent[identity] = mapping.kind;
    }
    setNoteKindByEvent(byEvent);
  }, [events, targetNotesDir, eventNotePaths, refreshState]);

  // Same check as above, across the whole visible month so the grid can badge
  // the days that have one. There is no index to consult — listFiles is
  // unavailable — so this is one exists() per day, roughly thirty native calls
  // whenever the month changes. Only days of the month itself are checked; the
  // greyed spill from neighbouring months is left unbadged.
  useEffect(() => {
    let cancelled = false;

    const daysInMonth = new Date(visibleYear, visibleMonth + 1, 0).getDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => new Date(visibleYear, visibleMonth, i + 1));

    Promise.all(
      days.map(async day => {
        try {
          const found = await FileUtils.exists(dailyNotePath(dailyNoteFolder, dailyNoteFormat, day));
          return found ? dateKey(day) : null;
        } catch (e) {
          // A failed check reads as "no badge". The button still re-checks at
          // press time, so nothing acts on this being wrong.
          return null;
        }
      })
    ).then(keys => {
      if (!cancelled) setDailyNoteDates(new Set(keys.filter((k): k is string => k !== null)));
    });

    return () => {
      cancelled = true;
    };
  }, [visibleYear, visibleMonth, dailyNoteFolder, dailyNoteFormat]);

  // Look for an existing note per event, by the same deterministic filename
  // the plugin would create. Runs for the visible day only — a handful of
  // exists() calls, not a directory scan, which is not available anyway.
  useEffect(() => {
    let cancelled = false;
    const settings = calendarStorage.getSettings();
    const dir = (settings.notesDirectory || '/storage/emulated/0/Note/Meetings').replace(/\/+$/, '');

    const check = async () => {
      const found: Record<string, string> = {};

      for (const evt of events) {
        const mapped =
          calendarStorage.getMapping(evt.uid) ||
          (evt.recurringSeriesId ? calendarStorage.getMapping(evt.recurringSeriesId) : undefined);
        if (mapped?.notePath) {
          found[evt.uid] = mapped.notePath;
          continue;
        }

        const name = generateNoteFilename(
          evt,
          Boolean(evt.recurringSeriesId),
          settings.seriesNotebookPrefix,
          // Inlined rather than calling kindForEvent: that helper is rebuilt
          // every render, so listing it as a dependency would re-run this
          // sweep continuously. Untyped events default to meeting; Class is
          // chosen per event or by its Event Type, never by a global mode.
          calendarStorage.getEventKind(noteIdentity(evt)) || 'meeting'
        );
        const path = `${dir}/${name}`;
        try {
          if (await FileUtils.exists(path)) {
            found[evt.uid] = path;
          }
        } catch (e) {
          // Unknown rather than absent; leaving it out means the row offers
          // Create, which is the safe default only when we truly cannot tell.
        }
      }

      if (!cancelled) setEventNotePaths(found);
    };

    void check();
    return () => {
      cancelled = true;
    };
  }, [events, targetNotesDir, refreshState]);

  const handleOpenDailyNoteForDate = async (targetDate: Date) => {
    const settings = calendarStorage.getSettings();
    const folder = settings.dailyNoteFolder || '/storage/emulated/0/Note/Daily Notes';
    const format = settings.dailyNoteFormat || 'YYYY-MM-DD';
    const fileName = formatDailyNoteName(format, targetDate);
    const path = dailyNotePath(folder, format, targetDate);

    if (!(await ensureFileReadPermission())) {
      setStatusMsg('Could not open daily note: File read access was not allowed.');
      return;
    }

    try {
      const exists = await FileUtils.exists(path);
      if (exists) {
        await handleOpenExistingNote(path);
        return;
      }
    } catch (e) {
      // exists() failing is not fatal; fall through to creation.
    }

    setStatusMsg(`Creating ${fileName}.note...`);
    const res = await meetingNoteService.createDailyNote(path, calendarStorage.getSettings());
    if (!res.success) {
      setStatusMsg(`Could not create daily note: ${res.error}`);
      return;
    }
    // The month check ran before this note existed, so add it now rather than
    // making the user page away and back to see the badge.
    if (dateKey(targetDate) === dateKey(selectedDate)) setDailyNoteExists(true);
    setDailyNoteDates(prev => new Set(prev).add(dateKey(targetDate)));

    await prepareForNativeFileOpen();
    const opened = await openNoteInEditor(path);
    setStatusMsg(opened.success ? `Created and opened ${fileName}.note` : opened.message);
    if (opened.success) closePanel();
  };

  const handleOpenDailyNote = () => handleOpenDailyNoteForDate(selectedDate);

  const handleOpenWeeklyNote = async () => {
    const settings = calendarStorage.getSettings();
    const folder = settings.dailyNoteFolder || '/storage/emulated/0/Note/Daily Notes';
    const path = weeklyReviewNotePath(folder, selectedDate, weekStartsOn);
    const fileName = path.split('/').pop() || 'Weekly Review.note';

    if (!(await ensureFileReadPermission())) {
      setStatusMsg('Could not open weekly review: File read access was not allowed.');
      return;
    }
    try {
      if (await FileUtils.exists(path)) {
        await handleOpenExistingNote(path);
        return;
      }
    } catch (_error) {}

    setStatusMsg(`Creating ${fileName}...`);
    const res = await meetingNoteService.createDailyNote(path, settings);
    if (!res.success) {
      setStatusMsg(`Could not create weekly review: ${res.error}`);
      return;
    }
    setWeeklyNoteExists(true);
    await prepareForNativeFileOpen();
    const opened = await openNoteInEditor(path);
    setStatusMsg(opened.success ? `Created and opened ${fileName}` : opened.message);
    if (opened.success) closePanel();
  };

  // Tasks are grouped by the day being viewed. Past Due and No Date only
  // surface on today — see sectionTasksForDay for why.
  const daySections = sectionTasksForDay(tasks, selectedDate);
  const focusTasks = dailyFocusTasks(tasks, selectedDate);
  const attentionProjects = projectsNeedingAttention(
    projects,
    tasks,
    uid => calendarStorage.getMembership(uid).projectId,
    selectedDate
  );
  // Always relative to today, regardless of which month the grid is showing.
  const todayTaskSections = sectionTasksForDay(tasks, new Date());

  /**
   * Optionally mirrors a task onto the event calendar. This is independent of
   * VTODO synchronization and is the direct Apple-visible fallback when no
   * separate task account is configured.
   * Completion is reflected with a ✓ in the title, matching the in-app check.
   */
  const pushTaskAsEvent = async (task: CalendarTask) => {
    if (!calendarStorage.getSettings().pushTasksAsEvents) return;
    if (!caldavEnabled || !caldavAppleId || !caldavPassword) return;
    // An undated task has no day to occupy on a calendar.
    if (!task.dueDate) return;

    const start = new Date(task.dueDate);
    // A date-only task needs a clock time for Apple Calendar to deliver an
    // alert. Timed tasks retain their chosen due time.
    if (task.allDay !== false) start.setHours(9, 0, 0, 0);

    await caldavService.pushIcloudEvent(
      {
        uid: task.uid,
        summary: `${task.completed ? '✓ ' : ''}${task.title}`,
        isTaskMirror: true,
        description: task.notes,
        start,
        end: new Date(start.getTime() + 30 * 60 * 1000),
        allDay: false,
        alarmMinutesBefore: 0,
        attendees: [],
      },
      {
        provider: caldavProvider,
        appleId: caldavAppleId,
        appPassword: caldavPassword,
        calendarUrl: caldavUrl,
        taskListUrl: caldavTaskListUrl,
      }
    );
  };

  const pushTaskToCaldav = async (task: CalendarTask): Promise<string> => {
    const settings = calendarStorage.getSettings();
    if (task.caldavSyncExcluded) return '';
    if (!settings.taskCaldavEnabled || !settings.taskCaldavCollectionUrl ||
        !settings.taskCaldavUsername || !settings.taskCaldavPassword) return '';
    const taskCollection = normaliseCollectionUrl(settings.taskCaldavCollectionUrl);
    if (!taskBelongsToCollection(task, taskCollection)) {
      return 'This task belongs to a different CalDAV list and was kept local.';
    }
    const item = taskToCaldavItem(task);
    const res = await caldavService.pushIcloudEvent(item, {
      provider: 'custom',
      appleId: settings.taskCaldavUsername,
      appPassword: settings.taskCaldavPassword,
      taskListUrl: taskCollection,
    });
    if (res.success) {
      calendarStorage.upsertTask({
        ...task,
        caldavUrl: res.caldavUrl || task.caldavUrl,
        etag: res.etag || task.etag,
        caldavCollectionUrl: taskCollection,
      });
      calendarStorage.setTaskPushState(
        recordPush(calendarStorage.getTaskPushState(taskCollection), item)
      );
      return '';
    }
    return res.message;
  };

  /**
   * Tap always settles the common case in one press: anything not done becomes
   * done, and a done task reopens. Reaching In Progress by tapping would cost
   * two presses to finish a task, which is the action people take most.
   */
  const handleToggleTask = async (task: CalendarTask) => {
    const next = withStatus(task, isDone(task) ? 'todo' : 'done');
    calendarStorage.upsertTask(next);
    setTasks([...calendarStorage.getTasks()]);
    setStatusMsg(next.completed ? `Done: "${next.title}"` : `Reopened: "${next.title}"`);
    const taskSyncError = await pushTaskToCaldav(next);
    setTasks([...calendarStorage.getTasks()]);
    await pushTaskAsEvent(next);
    if (taskSyncError) setStatusMsg(`Updated "${next.title}" locally. CalDAV: ${taskSyncError}`);
  };

  /**
   * Opens a task in the creation modal. The modal still speaks CalendarEvent,
   * so the task is projected into that shape and diverted back on save by uid.
   */
  const handleEditTask = (task: CalendarTask) => {
    // Held so the form can show the task's real status and priority, and
    // offer Delete. Without it editingTask stays null and both are missing.
    setEditingTask(task);
    const due = task.dueDate ? new Date(task.dueDate) : undefined;
    setEditingEvent({
      uid: task.uid,
      summary: `[TASK] ${task.title}`,
      isTask: true,
      completed: task.completed,
      description: task.notes,
      start: due ?? new Date(),
      end: due ?? new Date(),
      // An undated task opens as all-day; giving it a date is what moves it
      // out of the No Date section.
      allDay: !due || task.allDay !== false,
      attendees: [],
    });
    setLassoDraftTitle('');
    setLassoDraftParsed(null);
    setLassoDraftDate(due ?? null);
    setCreationType('task');
    setShowItemCreationModal(true);
  };

  const handleDeleteTask = async (task: CalendarTask) => {
    const settings = calendarStorage.getSettings();
    let remoteError = '';
    const sourceCollection = taskSourceCollection(task);
    const activeCollection = settings.taskCaldavCollectionUrl
      ? normaliseCollectionUrl(settings.taskCaldavCollectionUrl)
      : undefined;
    const matchingAccountConfigured = Boolean(
      sourceCollection && activeCollection === sourceCollection
    );
    const matchingAccountActive = Boolean(
      matchingAccountConfigured &&
      settings.taskCaldavEnabled &&
      settings.taskCaldavCollectionUrl &&
      settings.taskCaldavUsername && settings.taskCaldavPassword
    );
    if (matchingAccountActive) {
      const result = await caldavService.deleteIcloudEvent(task.uid, {
        provider: 'custom',
        appleId: settings.taskCaldavUsername as string,
        appPassword: settings.taskCaldavPassword,
        taskListUrl: settings.taskCaldavCollectionUrl,
      }, true, { url: task.caldavUrl, etag: task.etag });
      if (!result.success) remoteError = result.message;
    } else if (sourceCollection && matchingAccountConfigured) {
      // Keep a tombstone so reconnecting the owning account does not pull the
      // task straight back or silently lose the user's offline deletion.
      calendarStorage.queueTaskDelete(task);
    }
    if (settings.pushTasksAsEvents && settings.caldavEnabled && settings.caldavCalendarUrl &&
        settings.caldavAppleId && settings.caldavPassword) {
      await caldavService.deleteIcloudEvent(task.uid, {
        provider: settings.caldavProvider as CaldavProviderType,
        appleId: settings.caldavAppleId,
        appPassword: settings.caldavPassword,
        calendarUrl: settings.caldavCalendarUrl,
      });
    }
    if (remoteError) {
      setStatusMsg(`Could not delete task "${task.title}" from CalDAV: ${remoteError}`);
      return;
    }
    calendarStorage.removeTask(task.uid);
    if (sourceCollection && matchingAccountActive) {
      calendarStorage.forgetTaskPush(task.uid, sourceCollection);
    }
    setTasks([...calendarStorage.getTasks()]);
    setStatusMsg(
      sourceCollection && matchingAccountConfigured && !matchingAccountActive
        ? `Deleted task "${task.title}" locally. Its server deletion is queued for the matching account.`
        : sourceCollection && !matchingAccountConfigured
          ? `Deleted task "${task.title}" locally. Its source account is not configured, so the server was unchanged.`
        : `Deleted task "${task.title}".`
    );
  };

  const eventIsEditable = (event: CalendarEvent): boolean => {
    const identity = noteIdentity(event);
    return calendarStorage.getUserEvents().some(item => item.uid === identity) ||
      calendarStorage.getCaldavEvents().some(item => item.uid === identity);
  };

  const handleOpenEventDetails = (event: CalendarEvent) => {
    setDetailEvent(event);
  };

  const handleBeginEditEvent = (event: CalendarEvent) => {
    if (!eventIsEditable(event)) return;
    setDetailEvent(null);
    // Editing an event must not leave a task from a previous open behind.
    setEditingTask(null);
    // An expanded occurrence has a synthetic uid. Editing that object would
    // create a detached duplicate; edit the stored master so changes apply to
    // the series and overwrite the original CalDAV resource in place.
    const identity = noteIdentity(event);
    const master = calendarStorage.getUserEvents().find(item => item.uid === identity) ||
      calendarStorage.getCaldavEvents().find(item => item.uid === identity) ||
      allParsedEvents.find(item => item.uid === identity);
    setEditingEvent(master || event);
    setLassoDraftTitle('');
    setLassoDraftParsed(null);
    setCreationType(isTaskItem(event) ? 'task' : 'event');
    setShowItemCreationModal(true);
  };

  /**
   * Removes the note generated for an event, if there is one.
   *
   * Handwritten pages cannot be recovered and there is no undo, so this only
   * ever runs against a path the mapping actually records — never a guessed
   * filename — and the caller confirms first.
   */
  /**
   * Unlinks a note from its event and queues the file for removal.
   *
   * Nothing is destroyed yet: the file goes once the replacement note is
   * opened, so the folder navigation deleteFile performs is hidden behind a
   * navigation the user asked for. If no replacement is ever made, the queue
   * survives a restart and is flushed the next time any note opens.
   */
  const unlinkNoteForEvent = (event: CalendarEvent): string | null => {
    const identity = noteIdentity(event);
    const mapping = calendarStorage.getMapping(identity);
    const path = mapping?.notePath;
    if (!path) return null;

    calendarStorage.queueNoteDeletion(path);
    calendarStorage.setMapping({ ...mapping, notePath: '' });
    calendarStorage.clearEventKind(identity);

    setNoteKindByEvent(prev => {
      const next = { ...prev };
      delete next[identity];
      return next;
    });
    setEventNotePaths(prev => {
      const next = { ...prev };
      delete next[event.uid];
      return next;
    });
    return path;
  };

  /**
   * Removes anything queued. Called immediately before opening a note, so the
   * folder deleteFile navigates to is replaced by the note a moment later.
   */
  const flushPendingNoteDeletions = async (): Promise<number> => {
    const queued = [...calendarStorage.getPendingNoteDeletions()];
    if (queued.length === 0) return 0;
    if (!(await ensureFileDeletePermission())) return 0;

    let removed = 0;
    for (const path of queued) {
      try {
        if (!FileUtils.deleteFile) break;
        const gone = await FileUtils.deleteFile(path);
        // A file already absent counts as done; leaving it queued forever
        // would delay every note open from here on.
        if (gone !== false) {
          calendarStorage.clearPendingNoteDeletion(path);
          removed++;
        }
      } catch (e) {
        // Left queued: the Note app may have it open. Next time, then.
      }
    }
    return removed;
  };

  const deleteNoteForEvent = async (event: CalendarEvent): Promise<string | null> => {
    const mapping = calendarStorage.getMapping(noteIdentity(event));
    const path = mapping?.notePath;
    if (!path) return null;
    if (!(await ensureFileDeletePermission())) return null;

    try {
      // Reported as a failure rather than skipped silently: clearing the
      // mapping while the file remained would claim a deletion that never
      // happened, and the note would still be sitting in the folder.
      if (!FileUtils.deleteFile) return null;

      const removed = await FileUtils.deleteFile(path);
      if (removed === false) return null;

      calendarStorage.setMapping({ ...mapping, notePath: '' });
      // The recorded kind goes with the note. Without this a wrong answer to
      // the Meeting-or-Class prompt could never be corrected: the prompt only
      // fires when nothing is recorded.
      calendarStorage.clearEventKind(noteIdentity(event));
      setNoteKindByEvent(prev => {
        const next = { ...prev };
        delete next[noteIdentity(event)];
        return next;
      });
      setEventNotePaths(prev => {
        const next = { ...prev };
        delete next[event.uid];
        return next;
      });
      return path;
    } catch (e) {
      return null;
    }
  };

  const removeEventEverywhere = async (event: CalendarEvent): Promise<string> => {
    if (caldavEnabled && caldavAppleId && caldavPassword) {
      const removed = await caldavService.deleteIcloudEvent(
        event.uid,
        {
          provider: caldavProvider,
          appleId: caldavAppleId,
          appPassword: caldavPassword,
          calendarUrl: caldavUrl,
          taskListUrl: caldavTaskListUrl,
        },
        isTaskItem(event),
        { url: event.caldavUrl, etag: event.etag }
      );
      if (!removed.success) return removed.message;
    }
    setAllParsedEvents(prev => prev.filter(e => e.uid !== event.uid));
    calendarStorage.removeUserEvent(event.uid);
    calendarStorage.setCaldavEvents(
      calendarStorage.getCaldavEvents().filter(item => item.uid !== event.uid)
    );
    return '';
  };

  const handleConfirmDeleteWithNote = async (choice: 'both' | 'event' | 'note') => {
    const event = pendingDeleteEvent;
    setShowDeleteNoteModal(false);
    setPendingDeleteEvent(null);
    if (!event) return;

    if (choice === 'event') {
      const error = await removeEventEverywhere(event);
      setStatusMsg(error
        ? `Could not delete "${event.summary}" from CalDAV: ${error}`
        : `Deleted "${event.summary}". Its note was kept.`);
      return;
    }

    if (choice === 'note') {
      // Unlinked rather than deleted on the spot: the file goes when the
      // replacement note opens, so deleteFile's jump to the folder is hidden
      // behind a navigation the user actually wanted.
      const unlinked = unlinkNoteForEvent(event);
      setStatusMsg(
        unlinked
          ? `Note unlinked. Create Note will ask again — the old file is removed when the new note opens.`
          : `No note to remove for "${event.summary}".`
      );
      return;
    }

    const remoteError = await removeEventEverywhere(event);
    if (remoteError) {
      setStatusMsg(`Nothing was deleted because CalDAV rejected the event deletion: ${remoteError}`);
      return;
    }
    const removedNote = await deleteNoteForEvent(event);
    // A failed delete used to report identically to a chosen keep, so a locked
    // file looked like the user's own decision.
    setStatusMsg(
      removedNote
        ? `Deleted "${event.summary}" and its note.`
        : `Deleted "${event.summary}", but its note could not be removed — close it in the Note app first.`
    );
  };

  const handleDeleteItem = async (event: CalendarEvent) => {
    const identity = noteIdentity(event);
    const editable = calendarStorage.getUserEvents().some(item => item.uid === identity) ||
      calendarStorage.getCaldavEvents().some(item => item.uid === identity);
    if (!editable) {
      setStatusMsg('Subscribed iCalendar feeds are read-only and cannot be deleted here.');
      return;
    }
    // A note is the one thing here that cannot be recreated, so its presence
    // is checked rather than assumed and the user is asked by name.
    const notePath = calendarStorage.getMapping(noteIdentity(event))?.notePath;
    if (notePath && !event.recurringSeriesId && !event.rrule) {
      setPendingDeleteEvent(event);
      setShowDeleteNoteModal(true);
      return;
    }

    if (event.recurringSeriesId || event.rrule) {
      setPendingDeleteEvent(event);
      setShowDeleteModal(true);
    } else {
      const error = await removeEventEverywhere(event);
      setStatusMsg(error
        ? `Could not delete "${event.summary}" from CalDAV: ${error}`
        : `Deleted event "${event.summary}".`);
    }
  };

  const handleDeleteSingleOccurrence = async () => {
    if (!pendingDeleteEvent) return;
    const event = pendingDeleteEvent;
    const targetId = noteIdentity(event);
    const dateStr = dateKey(selectedDate);
    const storedLocal = calendarStorage.getUserEvents().find(evt => evt.uid === targetId);
    const storedRemote = calendarStorage.getCaldavEvents().find(evt => evt.uid === targetId);
    const master = allParsedEvents.find(evt => evt.uid === targetId) || storedLocal || storedRemote;
    if (master) {
      const serverBacked = Boolean(storedRemote || master.caldavUrl);
      const updated = {
        ...master,
        exceptionDates: [...new Set([...(master.exceptionDates || []), dateStr])],
      };
      if (serverBacked && caldavEnabled && caldavAppleId && caldavPassword) {
        const pushed = await caldavService.pushIcloudEvent(updated, {
          provider: caldavProvider,
          appleId: caldavAppleId,
          appPassword: caldavPassword,
          calendarUrl: caldavUrl,
          taskListUrl: caldavTaskListUrl,
        });
        if (!pushed.success) {
          setStatusMsg(`Could not delete this occurrence: ${pushed.message}`);
          setShowDeleteModal(false);
          setPendingDeleteEvent(null);
          return;
        }
      }
      setAllParsedEvents(prev => prev.map(evt => evt.uid === targetId ? updated : evt));
      if (storedLocal) calendarStorage.addUserEvent(updated);
      if (storedRemote) {
        calendarStorage.setCaldavEvents(
          calendarStorage.getCaldavEvents().map(evt => evt.uid === targetId ? updated : evt)
        );
      }
      setStatusMsg(serverBacked
        ? 'Deleted this occurrence and synced the exception.'
        : `Deleted occurrence for ${selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.`);
    }
    setShowDeleteModal(false);
    setPendingDeleteEvent(null);
  };

  const handleDeleteEntireSeries = async () => {
    if (!pendingDeleteEvent) return;
    const targetId = pendingDeleteEvent.recurringSeriesId || pendingDeleteEvent.uid;

    if (caldavEnabled && caldavAppleId && caldavPassword) {
      const removed = await caldavService.deleteIcloudEvent(
        targetId,
        {
          provider: caldavProvider,
          appleId: caldavAppleId,
          appPassword: caldavPassword,
          calendarUrl: caldavUrl,
          taskListUrl: caldavTaskListUrl,
        },
        isTaskItem(pendingDeleteEvent),
        { url: pendingDeleteEvent.caldavUrl, etag: pendingDeleteEvent.etag }
      );
      if (!removed.success) {
        setStatusMsg(`Could not delete the series from CalDAV: ${removed.message}`);
        setShowDeleteModal(false);
        setPendingDeleteEvent(null);
        return;
      }
    }

    setAllParsedEvents(prev =>
      prev.filter(evt => evt.uid !== targetId && evt.recurringSeriesId !== targetId && !evt.uid.startsWith(targetId))
    );
    calendarStorage.removeUserEvent(targetId);
    calendarStorage.setCaldavEvents(
      calendarStorage.getCaldavEvents().filter(evt => evt.uid !== targetId)
    );

    setStatusMsg(`Deleted entire recurring series "${pendingDeleteEvent.summary}".`);
    setShowDeleteModal(false);
    setPendingDeleteEvent(null);
  };

  const handleCreateNewEvent = async (
    newEvent: CalendarEvent,
    targetFeedId: string,
    typeId?: string,
    projectId?: string,
    areaId?: string
  ) => {
    // Stored beside the event rather than on it: a sync rebuilds the event
    // object from ICS, and anything held on it would be lost.
    const identity = noteIdentity(newEvent);
    // A Project owns its Area. Without a Project, an explicit Area wins over
    // the Event Type's default; leaving it blank continues to follow the type.
    calendarStorage.setMembership(identity, { typeId, projectId, areaId: projectId ? undefined : areaId });
    setMembershipRevision(n => n + 1);

    // Same uid means this is an edit: replace in place rather than appending a
    // second copy. addUserEvent already upserts by uid.
    // The modal still builds the event shape. Tasks now live in their own
    // store, so divert them here rather than reworking the modal's output.
    if (isTaskItem(newEvent)) {
      const existing = calendarStorage.getTasks().find(t => t.uid === newEvent.uid);
      const asTask: CalendarTask = {
        uid: newEvent.uid,
        title: newEvent.summary.replace(/^\[TASK\]\s*/i, '').trim(),
        // An all-day task carries a due date; a timed one keeps the time too.
        dueDate: newEvent.start ? new Date(newEvent.start) : undefined,
        allDay: newEvent.allDay,
        completed: existing?.completed ?? false,
        completedAt: existing?.completedAt,
        parentId: existing?.parentId,
        createdAt: existing?.createdAt ?? new Date(),
        notes: newEvent.description,
      };

      calendarStorage.upsertTask(asTask);
      setTasks([...calendarStorage.getTasks()]);
      setStatusMsg(`${existing ? 'Updated' : 'Added'} task "${asTask.title}".`);

      if (lassoDraftParsed !== null) {
        setLassoDraftParsed(null);
        setLassoDraftTitle('');
        setLassoDraftDate(null);
        try {
          PluginManager.closePluginView();
        } catch (e) {}
      }
      return;
    }

    const isUpdate = allParsedEvents.some(e => e.uid === newEvent.uid);
    const verb = isUpdate ? 'Updated' : 'Created';
    // A lasso capture is an interruption mid-writing; hand the user back to
    // their note rather than leaving them parked in the calendar.
    const cameFromLasso = lassoDraftParsed !== null;

    setAllParsedEvents(prev =>
      isUpdate ? prev.map(e => (e.uid === newEvent.uid ? newEvent : e)) : [...prev, newEvent]
    );
    calendarStorage.addUserEvent(newEvent);
    setStatusMsg(`${verb} "${newEvent.summary}".`);

    if (caldavEnabled && caldavAppleId && caldavPassword) {
      const syncRes = await caldavService.pushIcloudEvent(newEvent, {
        provider: caldavProvider,
        appleId: caldavAppleId,
        appPassword: caldavPassword,
        calendarUrl: caldavUrl,
        taskListUrl: caldavTaskListUrl,
      });
      if (syncRes.success) {
        const syncedEvent = {
          ...newEvent,
          caldavUrl: syncRes.caldavUrl || newEvent.caldavUrl,
          etag: syncRes.etag || newEvent.etag,
        };
        calendarStorage.addUserEvent(syncedEvent);
        setAllParsedEvents(prev => prev.map(event => event.uid === syncedEvent.uid ? syncedEvent : event));
        // Already on the server, so the next sync has nothing to do for it.
        calendarStorage.setPushState(
          recordPush(calendarStorage.getPushState(caldavUrl), newEvent)
        );
        setStatusMsg(`${verb} "${newEvent.summary}" — ${syncRes.message}`);
      } else {
        setStatusMsg(`${verb} "${newEvent.summary}" locally. CalDAV: ${syncRes.message}`);
      }
    }

    if (cameFromLasso) {
      setLassoDraftParsed(null);
      setLassoDraftTitle('');
      try {
        PluginManager.closePluginView();
      } catch (e) {}
    }
  };

  const handleCopyFeedEvent = async (event: CalendarEvent) => {
    setDetailEvent(null);
    const copy: CalendarEvent = {
      ...event,
      uid: `evt-user-${Date.now()}`,
      // Copy the occurrence the user can see, not an invisible relationship
      // to a read-only recurring master in the subscription.
      rrule: undefined,
      recurringSeriesId: undefined,
      recurrenceId: undefined,
      exceptionDates: undefined,
      caldavUrl: undefined,
      etag: undefined,
      sourceKind: 'local',
      calendarName: 'Local Calendar',
    };
    await handleCreateNewEvent(copy, 'primary-cal');
    setStatusMsg(`Created an editable copy of "${event.summary}". The Google event was unchanged.`);
  };

  const handleHideFeedEvent = (event: CalendarEvent) => {
    const identity = feedEventHideIdentity(event);
    const settings = calendarStorage.getSettings();
    calendarStorage.updateSettings({
      hiddenFeedEventIds: [...new Set([...(settings.hiddenFeedEventIds || []), identity])],
    });
    setDetailEvent(null);
    // Filtering reads settings synchronously; a new array reruns the filter
    // effect without discarding any cached source data.
    setAllParsedEvents(previous => [...previous]);
    setStatusMsg(`Hidden "${event.summary}" on this Supernote. The Google event was unchanged.`);
  };

  const areaOfTask = (uid: string): string | undefined => {
    void membershipRevision;
    // Derived, not read: a project owns its items' area, so moving a project
    // between areas moves everything filed under it.
    return resolveAreaId(
      calendarStorage.getMembership(uid),
      calendarStorage.getProjects(),
      calendarStorage.getEventTypes()
    );
  };

  const countTasksInArea = (areaId: string): number => {
    void membershipRevision;
    return calendarStorage.getTasks().filter(t => areaOfTask(t.uid) === areaId).length;
  };

  const handleRenameArea = (areaId: string, name: string, icon?: string) => {
    const existing = calendarStorage.getAreas().find(a => a.id === areaId);
    if (!existing) return;
    calendarStorage.upsertArea({ ...existing, name, icon: icon ?? existing.icon });
    setAreas([...calendarStorage.getAreas()]);
  };

  const handleRenameProject = (projectId: string, name: string, shortLabel?: string) => {
    const existing = calendarStorage.getProjects().find(p => p.id === projectId);
    if (!existing) return;
    calendarStorage.upsertProject({ ...existing, name, shortLabel });
    setProjects([...calendarStorage.getProjects()]);
  };

  const handleSetProjectStatus = (projectId: string, status: ProjectStatus) => {
    const existing = calendarStorage.getProjects().find(p => p.id === projectId);
    if (!existing) return;
    calendarStorage.upsertProject({
      ...existing,
      status,
      // Stamped on finishing and cleared on reopening, so a project that comes
      // back does not keep claiming it was completed.
      completedAt: status === 'done' ? existing.completedAt || new Date() : undefined,
    });
    setProjects([...calendarStorage.getProjects()]);
  };

  type ArchiveMove = {
    kind: 'project' | 'area';
    id: string;
    name: string;
    source: string;
    destination: string;
  };

  function folderForParaItem(kind: 'project' | 'area' | 'resource', item: Project | Area | Resource): string {
    if (item.folder) return normaliseFolderPath(item.folder);
    if (kind !== 'area') {
      const legacyPath = (item as Project | Resource).notePath;
      if (legacyPath) {
        const slash = legacyPath.lastIndexOf('/');
        if (slash > 0) return legacyPath.slice(0, slash);
      }
    }
    const rootKind = kind === 'project' ? 'projects' : kind === 'area' ? 'areas' : 'resources';
    return paraChildFolder(calendarStorage.getSettings(), rootKind, item.name);
  }

  const applyArchiveMetadata = (prompt: ArchiveFolderPrompt, moved: ArchiveMove[] = []) => {
    const movedById = new Map(moved.map(move => [move.id, move]));
    if (prompt.kind === 'project') {
      const project = calendarStorage.getProjects().find(candidate => candidate.id === prompt.item.id);
      if (!project) return;
      const move = movedById.get(project.id);
      if (prompt.mode === 'archive') {
        calendarStorage.upsertProject(projectArchiveState(project, 'archive', move));
        if (openProject?.id === project.id) setOpenProject(null);
      } else {
        const area = project.areaId
          ? calendarStorage.getAreas().find(candidate => candidate.id === project.areaId)
          : undefined;
        if (area?.archived) calendarStorage.upsertArea({ ...area, archived: false });
        calendarStorage.upsertProject(projectArchiveState(project, 'restore', move));
      }
    } else {
      const area = calendarStorage.getAreas().find(candidate => candidate.id === prompt.item.id);
      if (!area) return;
      const areaMove = movedById.get(area.id);
      calendarStorage.upsertArea(areaArchiveState(area, prompt.mode, areaMove));
      if (prompt.mode === 'archive') {
        for (const project of calendarStorage.getProjects()) {
          const wasActiveWhenPrompted = prompt.projectIds
            ? prompt.projectIds.includes(project.id)
            : project.status === 'active';
          if (
            project.areaId !== area.id ||
            (!wasActiveWhenPrompted && !movedById.has(project.id))
          ) continue;
          const projectMove = movedById.get(project.id);
          calendarStorage.upsertProject({
            ...project,
            areaId: prompt.archiveProjects ? project.areaId : undefined,
            status: prompt.archiveProjects ? 'archived' : 'active',
            folder: projectMove?.destination || project.folder,
            archivedFromFolder: projectMove?.source || project.archivedFromFolder,
          });
        }
      }
    }
    setAreas([...calendarStorage.getAreas()]);
    setProjects([...calendarStorage.getProjects()]);
  };

  const archiveMovesFor = (prompt: ArchiveFolderPrompt): ArchiveMove[] => {
    if (prompt.mode === 'restore') {
      const item = prompt.item;
      const original = item.archivedFromFolder;
      if (!original) return [];
      return [{
        kind: prompt.kind,
        id: item.id,
        name: item.name,
        source: folderForParaItem(prompt.kind, item),
        destination: normaliseFolderPath(original),
      }];
    }

    const archiveRoot = archiveDestinationRoot || paraRoot(calendarStorage.getSettings(), 'archive');
    const moves: ArchiveMove[] = [{
      kind: prompt.kind,
      id: prompt.item.id,
      name: prompt.item.name,
      source: folderForParaItem(prompt.kind, prompt.item),
      destination: `${archiveRoot}/${prompt.kind === 'area' ? 'Areas' : 'Projects'}/${safeFolderName(prompt.item.name)}`,
    }];
    if (prompt.kind === 'area' && prompt.archiveProjects) {
      for (const projectId of prompt.projectIds || []) {
        const project = calendarStorage.getProjects().find(candidate => candidate.id === projectId);
        if (!project) continue;
        moves.push({
          kind: 'project',
          id: project.id,
          name: project.name,
          source: folderForParaItem('project', project),
          destination: `${archiveRoot}/Projects/${safeFolderName(project.name)}`,
        });
      }
    }
    return moves;
  };

  const finishArchiveChoice = async (moveFolders: boolean) => {
    const prompt = archiveFolderPrompt;
    if (!prompt || archiveMoveBusy) return;
    setArchiveMoveError('');
    setArchiveMoveBusy(true);

    // Status is the core PARA action. Persist it before asking Android to
    // touch files so a denied permission, unsupported rename, or plugin-panel
    // transition can never leave the item active.
    const moves = moveFolders ? archiveMovesFor(prompt) : [];
    applyArchiveMetadata(prompt);
    const statusPersistenceError = await calendarStorage.flush();
    const verb = prompt.mode === 'archive' ? 'Archived' : 'Restored';
    if (statusPersistenceError) {
      const message = `${verb} for this session, but SNFolio could not save the status: ${statusPersistenceError}`;
      setArchiveMoveError(message);
      setStatusMsg(message);
      setArchiveMoveBusy(false);
      return;
    }

    if (!moveFolders) {
      setArchiveFolderPrompt(null);
      setArchiveMoveBusy(false);
      setStatusMsg(`${verb} ${prompt.kind} "${prompt.item.name}" without moving its folder.`);
      return;
    }

    if (moves.length === 0) {
      setArchiveFolderPrompt(null);
      setArchiveMoveBusy(false);
      setStatusMsg(`Restored ${prompt.kind} "${prompt.item.name}". No previous folder location was recorded.`);
      return;
    }
    const normalized = moves.map(move => ({
      ...move,
      source: normaliseFolderPath(move.source),
      destination: normaliseFolderPath(move.destination),
    }));
    const sources = normalized.map(move => move.source);
    const destinations = normalized.map(move => move.destination);
    const overlaps = sources.some((source, index) =>
      sources.some((other, otherIndex) => index !== otherIndex && other.startsWith(`${source}/`))
    );
    if (overlaps || new Set(sources).size !== sources.length || new Set(destinations).size !== destinations.length) {
      const message = 'Folders overlap or share a destination. Choose separate folders or archive without moving.';
      setArchiveMoveError(message);
      setStatusMsg(`${verb} ${prompt.kind} "${prompt.item.name}", but its folder stayed in place. ${message}`);
      setArchiveMoveBusy(false);
      return;
    }

    const completed: ArchiveMove[] = [];
    for (const move of normalized) {
      const result = await moveParaFolder(move.source, move.destination);
      if (!result.success) {
        const rollbackFailures: string[] = [];
        for (const prior of [...completed].reverse()) {
          const rollback = await moveParaFolder(prior.destination, prior.source);
          if (!rollback.success) rollbackFailures.push(prior.name);
        }
        const message = `Could not move "${move.name}": ${result.message}`;
        const rollbackMessage = rollbackFailures.length > 0
          ? ` Rollback also failed for: ${rollbackFailures.join(', ')}.`
          : '';
        setArchiveMoveError(`${verb} status was saved, but ${message}${rollbackMessage}`);
        setStatusMsg(`${verb} ${prompt.kind} "${prompt.item.name}"; its folder stayed in place. ${message}${rollbackMessage}`);
        setArchiveMoveBusy(false);
        return;
      }
      completed.push(move);
    }

    for (const move of completed) calendarStorage.rewritePathPrefix(move.source, move.destination);
    applyArchiveMetadata(prompt, completed);
    setEventNotePaths(current => Object.fromEntries(
      Object.entries(current).map(([key, value]) => {
        let next = value;
        for (const move of completed) {
          if (next === move.source) next = move.destination;
          else if (next.startsWith(`${move.source}/`)) next = `${move.destination}${next.slice(move.source.length)}`;
        }
        return [key, next];
      })
    ));
    setEventTypes([...calendarStorage.getEventTypes()]);
    setResources([...calendarStorage.getResources()]);
    const persistenceError = await calendarStorage.flush();
    if (persistenceError) {
      setArchiveFolderPrompt(null);
      setArchiveMoveBusy(false);
      setStatusMsg(`Folder moved, but SNFolio could not save all path updates: ${persistenceError}`);
      return;
    }
    setArchiveFolderPrompt(null);
    setArchiveMoveBusy(false);
    setStatusMsg(`${verb} ${prompt.kind} "${prompt.item.name}" and moved ${completed.length === 1 ? 'its folder' : `${completed.length} folders`}.`);
  };

  const handleArchiveProject = (project: Project) => {
    setArchiveDestinationRoot(null);
    setArchiveMoveError('');
    setArchiveMoveBusy(false);
    setArchiveFolderPrompt({ mode: 'archive', kind: 'project', item: project });
  };

  const handleRestoreProject = (project: Project) => {
    setArchiveMoveError('');
    setArchiveMoveBusy(false);
    setArchiveFolderPrompt({ mode: 'restore', kind: 'project', item: project });
  };

  const handleArchiveArea = (area: Area, archiveProjects: boolean) => {
    setArchiveDestinationRoot(null);
    setArchiveMoveError('');
    setArchiveMoveBusy(false);
    setArchiveFolderPrompt({
      mode: 'archive',
      kind: 'area',
      item: area,
      archiveProjects,
      projectIds: calendarStorage.getProjects()
        .filter(project => project.areaId === area.id && project.status === 'active')
        .map(project => project.id),
    });
  };

  const handleRestoreArea = (area: Area) => {
    setArchiveMoveError('');
    setArchiveMoveBusy(false);
    setArchiveFolderPrompt({ mode: 'restore', kind: 'area', item: area });
  };

  const handleCreateResource = (name: string): string => {
    const folder = paraChildFolder(calendarStorage.getSettings(), 'resources', name);
    const resource: Resource = {
      id: `resource-${Date.now()}`,
      name,
      folder,
      createdAt: new Date(),
    };
    calendarStorage.upsertResource(resource);
    setResources([...calendarStorage.getResources()]);
    void meetingNoteService.ensureDirectory(folder).catch((e: any) => {
      setStatusMsg(`Resource saved, but its folder could not be created: ${e?.message || 'write failed'}`);
    });
    return resource.id;
  };

  const handleArchiveResource = (resource: Resource) => {
    calendarStorage.upsertResource({ ...resource, archived: true });
    setResources([...calendarStorage.getResources()]);
    setStatusMsg(`Archived resource "${resource.name}".`);
  };

  const handleRestoreResource = (resource: Resource) => {
    calendarStorage.upsertResource({ ...resource, archived: false });
    setResources([...calendarStorage.getResources()]);
    setStatusMsg(`Restored resource "${resource.name}".`);
  };

  const handleAssignProjectArea = (projectId: string, areaId?: string) => {
    const existing = calendarStorage.getProjects().find(p => p.id === projectId);
    if (!existing) return;

    const moved = { ...existing, areaId };
    calendarStorage.upsertProject(moved);
    setProjects([...calendarStorage.getProjects()]);
    // The detail screen holds its own copy, so it has to be told, or the
    // breadcrumb keeps naming the area the project just left.
    setOpenProject(current => (current && current.id === moved.id ? moved : current));
  };

  const handleMoveProject = (project: Project, direction: 'up' | 'down') => {
    const current = calendarStorage.getProjects();
    const reordered = moveActiveProject(current, project.id, direction);
    if (reordered === current) return;
    reordered
      .filter(candidate => candidate.status === 'active')
      .forEach(candidate => calendarStorage.upsertProject(candidate));
    setProjects([...calendarStorage.getProjects()]);
  };

  const handleDeleteProject = (projectId: string) => {
    // Storage detaches its tasks rather than deleting them with it.
    calendarStorage.removeProject(projectId);
    setProjects([...calendarStorage.getProjects()]);
    setMembershipRevision(n => n + 1);
  };

  const handleDeleteArea = (areaId: string) => {
    // Storage detaches its items rather than deleting them with it.
    calendarStorage.removeArea(areaId);
    setAreas([...calendarStorage.getAreas()]);
    setMembershipRevision(n => n + 1);
  };

  /** Corrects an item created under Projects when it is really an Area. */
  const handleConvertProjectToArea = (project: Project) => {
    const existingArea = calendarStorage.getAreas().find(
      area => area.name.trim().toLocaleLowerCase() === project.name.trim().toLocaleLowerCase()
    );
    const area: Area = existingArea
      ? {
          ...existingArea,
          archived: false,
          folder: existingArea.folder || project.folder,
          template: existingArea.template || project.template,
        }
      : {
          id: `area-${Date.now()}`,
          name: project.name,
          folder: project.folder,
          template: project.template,
          createdAt: project.createdAt,
        };
    // Always upsert: an archived same-name Area is restored rather than used
    // as an invisible destination.
    calendarStorage.upsertArea(area);

    // Tasks, events and notes filed directly under the old Project become
    // Area items. Their content and files are untouched.
    for (const [identity, membership] of Object.entries(calendarStorage.getAllMemberships())) {
      if (membership.projectId === project.id) {
        calendarStorage.setMembership(identity, {
          ...membership,
          projectId: undefined,
          areaId: area.id,
        });
      }
    }
    calendarStorage.removeProject(project.id);
    setAreas([...calendarStorage.getAreas()]);
    setProjects([...calendarStorage.getProjects()]);
    setMembershipRevision(value => value + 1);
    setParaFocusAreaId(area.id);
    setOpenProject(null);
    setStatusMsg(existingArea
      ? `Moved “${project.name}” into the existing Area and kept its items.`
      : `Converted “${project.name}” from a Project to an Area.`);
  };

  /** Area label for a task row, e.g. "[Home]". Empty when unfiled. */
  const areaTagFor = (uid: string): string => {
    void membershipRevision;
    const area = resolveArea(
      calendarStorage.getMembership(uid),
      calendarStorage.getProjects(),
      areas,
      calendarStorage.getEventTypes()
    );
    return area ? `[${area.name}]` : '';
  };

  /** Project is the most useful task context; Area remains the unfiled fallback. */
  const taskContextTagFor = (uid: string): string => {
    const projectId = calendarStorage.getMembership(uid).projectId;
    const project = projectId ? projects.find(candidate => candidate.id === projectId) : undefined;
    return project ? projectDisplayLabel(project) : areaTagFor(uid);
  };

  /** Tomorrow's first calendar event; tasks already have a richer section above. */
  const lookaheadSummary = (() => {
    const tomorrow = new Date(selectedDate);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const evts = expandEventsForDate(
      filterEvents(allParsedEvents, {
        ...calendarStorage.getSettings(),
        hideAllDayEvents: hideAllDay,
        hideSoloEvents: hideSolo,
      }),
      tomorrow
    );
    return tomorrowScheduleSummary(evts);
  })();

  /** Display name of an event's type, for status lines and schedule blocks. */
  const eventTypeName = (event: CalendarEvent): string => {
    void membershipRevision;
    const id = calendarStorage.getEventType(noteIdentity(event));
    return eventTypes.find(t => t.id === id)?.name || '';
  };

  const projectOfTask = (uid: string): string | undefined => {
    void membershipRevision;
    return calendarStorage.getMembership(uid).projectId;
  };

  const taskNoteChoiceFor = (task: CalendarTask): EventNoteChoice => {
    const settings = calendarStorage.getSettings();
    const projectId = projectOfTask(task.uid);
    const project = projectId ? projects.find(candidate => candidate.id === projectId) : undefined;
    const areaId = areaOfTask(task.uid);
    const area = areaId ? areas.find(candidate => candidate.id === areaId) : undefined;
    return {
      contextFolder: project
        ? folderForParaItem('project', project)
        : area
          ? folderForParaItem('area', area)
          : undefined,
      contextLabel: project ? `Project: ${project.name}` : area ? `Area: ${area.name}` : undefined,
      defaultFolder: normaliseFolderPath(settings.taskNotesDirectory || '/storage/emulated/0/Note/Task Notes'),
      defaultLabel: 'Standard Task Notes folder',
      templateLabel: templateLabel(settings.taskNoteTemplate || DEFAULT_SYSTEM_TEMPLATE),
    };
  };

  const handleRequestTaskNote = (task: CalendarTask) => {
    const existingPath = calendarStorage.getMapping(task.uid)?.notePath;
    if (existingPath) {
      void handleOpenExistingNote(existingPath);
      return;
    }
    setShowItemCreationModal(false);
    setTaskNoteCreationTarget(task);
  };

  const handleLinkExistingTaskNote = async (selectedTask?: CalendarTask) => {
    const task = selectedTask || taskNoteCreationTarget;
    if (!task) return;
    if (!RattaFileSelector?.selectFile) {
      setStatusMsg('Native file picker unavailable on this device.');
      return;
    }
    setTaskNoteCreationTarget(null);
    setShowItemCreationModal(false);
    setShowTaskList(false);
    try {
      const result = await RattaFileSelector.selectFile({
        selectType: 0,
        maxNum: 1,
        title: 'Select a note to link to this task',
        rightButtonText: 'Link Note',
        needSelectFolder: '/storage/emulated/0/Note',
        suffixList: ['note'],
      });
      const notePath = firstPickedFilePath(result);
      if (!notePath) {
        setTaskNoteCreationTarget(task);
        return;
      }
      if (!/\.note$/i.test(notePath)) {
        setStatusMsg('Choose a Supernote .note file.');
        setTaskNoteCreationTarget(task);
        return;
      }
      const note: any = await PluginFileAPI.getNoteTotalPageNum(notePath);
      if (!note?.success || typeof note.data !== 'number' || note.data < 1) {
        setStatusMsg('Could not read the selected note.');
        setTaskNoteCreationTarget(task);
        return;
      }
      calendarStorage.setMapping({
        eventUid: task.uid,
        seriesId: task.uid,
        notePath,
        lastPageNum: note.data,
        lastCreatedIso: new Date().toISOString(),
      });
      setMembershipRevision(value => value + 1);
      setStatusMsg(`Linked ${notePath.split('/').pop()} to "${task.title}".`);
    } catch (error: any) {
      setStatusMsg(`Could not link note: ${error?.message || 'Picker closed'}`);
      setTaskNoteCreationTarget(task);
    }
  };

  const handleConfirmTaskNote = async (kind: LinkedNoteKind, folder: string, name: string) => {
    const task = taskNoteCreationTarget;
    setTaskNoteCreationTarget(null);
    if (!task || kind !== 'task') return;
    setStatusMsg(`Creating note for "${task.title}"...`);
    const settings = calendarStorage.getSettings();
    const result = await meetingNoteService.createTaskNote(
      task,
      name,
      folder,
      settings.taskNoteTemplate || DEFAULT_SYSTEM_TEMPLATE
    );
    if (!result.success) {
      setStatusMsg(`Could not create task note: ${result.error || 'unknown error'}`);
      return;
    }
    setMembershipRevision(value => value + 1);
    await prepareForNativeFileOpen();
    const opened = await openNoteInEditor(result.notePath);
    setStatusMsg(opened.success
      ? `Created ${result.notePath.split('/').pop()}`
      : `Created ${result.notePath.split('/').pop()}, but could not open it: ${opened.message}`);
    if (opened.success) closePanel();
  };

  /** Folder for a type's notes. Same browse-a-file-take-its-parent as elsewhere. */
  const handleChooseTypeFolder = async (type: EventType) => {
    try {
      if (!RattaFileSelector?.selectFile) {
        setStatusMsg('Native file picker unavailable on this device.');
        return;
      }
      const result: any = await RattaFileSelector.selectFile({
        selectType: 0,
        maxNum: 1,
        title: `Pick any file in the ${type.name} folder`,
        rightButtonText: 'Use folder',
        needSelectFolder: type.folder || '/storage/emulated/0/Note',
      });
      const folder = parentFolderFromPicker(result);
      if (!folder || folder === '/storage/emulated/0') {
        setStatusMsg('Could not determine a usable folder from that file.');
        return;
      }
      await meetingNoteService.ensureDirectory(folder);
      handleUpdateEventType({ ...type, folder });
    } catch (e: any) {
      setStatusMsg(`Folder picker error: ${e?.message || 'Picker closed'}`);
    }
  };

  /**
   * Notes written for this project's events and tasks.
   *
   * Read from the note mappings rather than the filesystem: the mapping is
   * what records that a note was made for a given event, including notes filed
   * outside the Project's own folder.
   */
  const linkedNotesForProject = (project: Project): Array<{ label: string; path: string }> => {
    void membershipRevision;
    const seen = new Set<string>();
    const out: Array<{ label: string; path: string }> = [];

    for (const mapping of Object.values(calendarStorage.getAllMappings())) {
      if (!mapping?.notePath || seen.has(mapping.notePath)) continue;
      const identity = mapping.seriesId || mapping.eventUid;
      if (calendarStorage.getMembership(identity).projectId !== project.id) continue;
      seen.add(mapping.notePath);
      out.push({ label: mapping.notePath.split('/').pop() || 'Note', path: mapping.notePath });
    }
    return out;
  };

  type ParaFolderKind = 'project' | 'area' | 'resource';
  type ParaFolderItem = Project | Area | Resource;

  const paraFolder = (kind: ParaFolderKind, item: ParaFolderItem): string => {
    return folderForParaItem(kind, item);
  };

  const persistParaFolder = (kind: ParaFolderKind, item: ParaFolderItem, folder: string) => {
    if (kind === 'project') {
      calendarStorage.upsertProject({ ...(item as Project), folder });
      setProjects([...calendarStorage.getProjects()]);
      setOpenProject(current => current?.id === item.id ? { ...current, folder } : current);
    } else if (kind === 'area') {
      calendarStorage.upsertArea({ ...(item as Area), folder });
      setAreas([...calendarStorage.getAreas()]);
    } else {
      calendarStorage.upsertResource({ ...(item as Resource), folder, notePath: undefined });
      setResources([...calendarStorage.getResources()]);
    }
  };

  const handleNewParaNote = async (
    kind: ParaFolderKind,
    item: ParaFolderItem,
    noteName: string,
    targetFolder?: string
  ) => {
    const settings = calendarStorage.getSettings();
    const folder = targetFolder || paraFolder(kind, item);
    const safeNoteName = noteName
      .replace(/[/\\?%*:|"<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'Note';
    const proposedPath = `${folder}/${safeNoteName}.note`;
    try {
      if (await FileUtils.exists(proposedPath)) {
        setStatusMsg(`${safeNoteName}.note already exists in ${item.name}. Choose another name.`);
        return;
      }
    } catch (e) {
      // Let createNote report the authoritative device result.
    }
    const result = await meetingNoteService.createProjectNote(
      safeNoteName,
      folder,
      item.template || settings.meetingTemplate || ''
    );
    if (!result.success || !result.notePath) {
      setStatusMsg(`Could not create the note: ${result.error || 'unknown error'}`);
      return;
    }
    persistParaFolder(kind, item, folder);
    await prepareForNativeFileOpen();
    const opened = await openNoteInEditor(result.notePath);
    setStatusMsg(opened.success ? `Opened ${safeNoteName}.note` : opened.message);
    if (opened.success) closePanel();
  };

  const handleChooseParaFolder = async (
    kind: ParaFolderKind,
    item: ParaFolderItem,
    folder: string
  ) => {
    try {
      if (folder === '/storage/emulated/0') {
        setStatusMsg('Choose a folder inside device storage, not the storage root itself.');
        return;
      }
      await meetingNoteService.ensureDirectory(folder);
      persistParaFolder(kind, item, folder);
      setStatusMsg(`${item.name} now uses ${folder}.`);
    } catch (e: any) {
      setStatusMsg(`Folder picker error: ${e?.message || 'Picker closed'}`);
    }
  };

  const handleListParaEntries = async (
    kind: ParaFolderKind,
    item: ParaFolderItem,
    folder: string
  ) => {
    // Browsing only needs read access. Folder creation is handled when the
    // PARA item's folder is assigned or a note is created.
    return listParaFolderEntries(folder);
  };

  const handleBrowseParaFiles = async (kind: ParaFolderKind, item: ParaFolderItem) => {
    try {
      if (!RattaFileSelector?.selectFile) {
        setStatusMsg('Native file picker unavailable on this device.');
        return;
      }
      const folder = paraFolder(kind, item);
      await meetingNoteService.ensureDirectory(folder);
      const result: any = await RattaFileSelector.selectFile({
        selectType: 0,
        maxNum: 1,
        title: `Open a file from ${item.name}`,
        rightButtonText: 'Open File',
        needSelectFolder: folder,
      });
      const pickedPath = firstPickedFilePath(result);
      if (!pickedPath) {
        setStatusMsg('No note selected.');
        return;
      }
      await prepareForNativeFileOpen();
      const opened = await openResourceFile(pickedPath);
      setStatusMsg(opened.message);
      if (opened.success) closePanel();
    } catch (e: any) {
      setStatusMsg(`Could not browse files: ${e?.message || 'Picker closed'}`);
    }
  };

  const handleOpenResourceFile = async (path: string) => {
    await prepareForNativeFileOpen();
    const result = await openResourceFile(path);
    setStatusMsg(result.message);
    if (result.success) closePanel();
  };

  const handleCreateEventType = (name: string): string => {
    const type: EventType = { id: `type-${Date.now()}`, name, createdAt: new Date() };
    calendarStorage.upsertEventType(type);
    setEventTypes([...calendarStorage.getEventTypes()]);
    return type.id;
  };

  const handleUpdateEventType = (type: EventType) => {
    calendarStorage.upsertEventType(type);
    setEventTypes([...calendarStorage.getEventTypes()]);
  };

  const handleDeleteEventType = (typeId: string) => {
    // Untags its events; nothing else is destroyed.
    calendarStorage.removeEventType(typeId);
    setEventTypes([...calendarStorage.getEventTypes()]);
    setMembershipRevision(n => n + 1);
  };

  const handleCreateProject = (name: string, areaId?: string): string => {
    const folder = paraChildFolder(calendarStorage.getSettings(), 'projects', name);
    const project: Project = {
      id: `proj-${Date.now()}`,
      name,
      // Filed on creation when made from inside an area. A project created
      // while looking at Home belongs to Home; making that a second step is
      // how one ends up unfiled and hard to find.
      areaId,
      folder,
      status: 'active',
      createdAt: new Date(),
    };
    calendarStorage.upsertProject(project);
    setProjects([...calendarStorage.getProjects()]);
    void meetingNoteService.ensureDirectory(folder).catch((e: any) => {
      setStatusMsg(`Project saved, but its folder could not be created: ${e?.message || 'write failed'}`);
    });
    return project.id;
  };

  const handleCreateArea = (name: string): string => {
    const folder = paraChildFolder(calendarStorage.getSettings(), 'areas', name);
    const area: Area = { id: `area-${Date.now()}`, name, folder, createdAt: new Date() };
    calendarStorage.upsertArea(area);
    setAreas([...calendarStorage.getAreas()]);
    void meetingNoteService.ensureDirectory(folder).catch((e: any) => {
      setStatusMsg(`Area saved, but its folder could not be created: ${e?.message || 'write failed'}`);
    });
    return area.id;
  };

  const handleCreateNewTask = (input: {
    uid?: string;
    title: string;
    dueDate?: Date;
    allDay?: boolean;
    notes?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    areaId?: string;
    projectId?: string;
  }) => {
    const existing = input.uid ? calendarStorage.getTasks().find(t => t.uid === input.uid) : undefined;

    const task: CalendarTask = {
      uid: input.uid ?? `task-${Date.now()}`,
      title: input.title,
      // Undefined stays undefined — that is what puts it in No Date.
      dueDate: input.dueDate,
      allDay: input.allDay,
      completed: existing?.completed ?? false,
      completedAt: existing?.completedAt,
      parentId: existing?.parentId,
      createdAt: existing?.createdAt ?? new Date(),
      notes: input.notes,
      priority: input.priority && input.priority > 1 ? input.priority : undefined,
      caldavUrl: existing?.caldavUrl,
      etag: existing?.etag,
      caldavCollectionUrl: existing?.caldavCollectionUrl,
    };

    // withStatus rather than assigning the field: completed and completedAt
    // have to move with it, and they are what the rest of the app reads.
    const withState = withStatus(task, input.status || taskStatus(task));

    calendarStorage.upsertTask(withState);
    // Membership is stored beside the task, not on it, so that one mechanism
    // serves events and notes too and survives a sync rebuilding them.
    calendarStorage.setMembership(withState.uid, {
      areaId: input.areaId,
      projectId: input.projectId,
    });
    setMembershipRevision(n => n + 1);
    setTasks([...calendarStorage.getTasks()]);
    setStatusMsg(`${existing ? 'Updated' : 'Added'} task "${task.title}".`);
    void pushTaskToCaldav(withState).then(error => {
      setTasks([...calendarStorage.getTasks()]);
      if (error) setStatusMsg(`${existing ? 'Updated' : 'Added'} task locally. CalDAV: ${error}`);
    });
    void pushTaskAsEvent(withState);

    if (lassoDraftParsed !== null) {
      setLassoDraftParsed(null);
      setLassoDraftTitle('');
      setLassoDraftDate(null);
      try {
        PluginManager.closePluginView();
      } catch (e) {}
    }
  };

  /**
   * Hides the plugin panel. Required whenever a note is opened: the panel sits
   * in front of the note app, so the note otherwise launches behind it and
   * looks like the tap did nothing.
   */
  const closePanel = () => {
    try {
      PluginManager.closePluginView();
    } catch (e) {}
  };

  /**
   * Removes any source-note selection/recognizer state before changing files.
   *
   * The note app can create a transient lasso state even when the user did not
   * deliberately draw a lasso. Launching another note while that source editor
   * is still active lets the host carry those strokes into the destination.
   * Clear it while SNFolio still owns the foreground, let the note host settle,
   * then launch the destination. The caller closes SNFolio only after Android
   * has accepted that launch, so the previous note cannot flash in front.
   */
  const prepareForNativeFileOpen = async () => {
    try {
      await PluginCommAPI.cancelRecognize();
    } catch (e) {}
    try {
      // SDK: 2 = completely remove the lasso box without deleting its ink.
      await PluginCommAPI.setLassoBoxState(2);
    } catch (e) {}
    await new Promise<void>(resolve => setTimeout(resolve, 180));
  };

  const handleOpenExistingNote = async (notePath: string) => {
    setShowDateActionSheet(false);
    // Catches anything unlinked and then abandoned: the user is navigating
    // away regardless, so this is the free moment to remove it.
    const removed = await flushPendingNoteDeletions();
    if (removed > 0) {
      await new Promise<void>(resolve => setTimeout(() => resolve(), DELETE_BEFORE_OPEN_DELAY_MS));
    }
    await prepareForNativeFileOpen();
    const res = await openNoteInEditor(notePath);
    setStatusMsg(res.message);
    if (res.success) closePanel();
  };

  const handleFetchFeedUrl = async () => {
    const draftUrl = (newFeedInputRef.current?.getValue() ?? newFeedUrl).trim();
    if (!draftUrl) return;
    const feedUrl = normaliseFeedUrl(draftUrl);
    if (!feedUrl) {
      setStatusMsg('Calendar subscriptions must use HTTPS (webcal:// is accepted and upgraded).');
      return;
    }
    if (!(await ensureInternetPermission())) {
      setStatusMsg('Internet access was not allowed.');
      return;
    }
    setStatusMsg('Fetching calendar feed securely...');
    try {
      const feedId = `url-${Date.now()}`;
      const newEvts = await fetchCalendarFeed(feedUrl, 'Subscribed Calendar', fetch, feedId);
      setAllParsedEvents(prev => [...prev, ...newEvts]);
      jumpToNextUpcomingEventFromToday(newEvts);
      const updatedFeeds = calendarStorage.addFeed({
        id: feedId,
        name: 'iCal Feed',
        url: feedUrl,
        enabled: true,
      });
      setCalendarFeeds([...updatedFeeds]);
      setNewFeedUrl('');
      newFeedInputRef.current?.setValue('');
      setStatusMsg(`Loaded ${newEvts.length} events from feed!`);
    } catch (err: any) {
      setStatusMsg(`Failed to fetch feed: ${err?.message || 'Network error'}`);
    }
  };

  const handleRemoveCalendarFeed = async (feed: CalendarFeed) => {
    const updatedFeeds = calendarStorage.removeFeed(feed.id);
    setCalendarFeeds([...updatedFeeds]);
    setNewFeedUrl('');
    newFeedInputRef.current?.setValue('');
    setAllParsedEvents(previous => {
      const remaining = previous.filter(event => event.sourceFeedId !== feed.id);
      feedUidsRef.current = new Set(
        remaining
          .filter(event => event.sourceKind === 'feed')
          .map(event => event.uid)
          .filter(Boolean)
      );
      return remaining;
    });
    const remainingFeeds = updatedFeeds.filter(
      item => item.enabled && (item.url || item.localPath)
    );
    setHasSubscribedFeeds(remainingFeeds.length > 0);
    setRefreshState(value => value + 1);
    const persistenceError = await calendarStorage.flush();
    setStatusMsg(
      persistenceError
        ? `Removed ${feed.name} from this session, but could not save the change: ${persistenceError}`
        : `Removed ${feed.name}. Its source calendar was not changed.`
    );
  };


  const handleToggleHideAllDay = (val: boolean) => {
    setHideAllDay(val);
    calendarStorage.updateSettings({ hideAllDayEvents: val });
  };

  const handleToggleHideSolo = (val: boolean) => {
    setHideSolo(val);
    calendarStorage.updateSettings({ hideSoloEvents: val });
  };

  const dateHeading = (() => {
    if (viewMode === 'month' && calendarMode === 'month') {
      return selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    if ((viewMode === 'month' && calendarMode === 'week') || (viewMode === 'agenda' && plannerMode === 'week')) {
      const { start } = plannerWeekRange(selectedDate, weekStartsOn);
      const end = new Date(start);
      end.setDate(end.getDate() + (viewMode === 'month' && calendarMode === 'week' ? calendarWeekLength - 1 : 6));
      const startText = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const endText = start.getMonth() === end.getMonth()
        ? `${end.getDate()}, ${end.getFullYear()}`
        : end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return `${startText}–${endText}`;
    }
    return selectedDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  })();

  return (
    <SafeAreaView style={styles.root}>
      {/* Top Header Bar */}
      <View style={styles.headerBar}>
        <View style={styles.titleWithSwitcher}>
          <Text allowFontScaling={false} style={styles.appTitle}>SNFolio</Text>
          <View style={styles.viewSwitcherBar}>
            <TouchableOpacity
              style={[styles.switcherBtn, viewMode === 'month' && styles.switcherBtnActive]}
              onPress={() => setShowCalendarMenu(true)}
            >
              <Text allowFontScaling={false} style={[styles.switcherBtnText, viewMode === 'month' && styles.switcherBtnTextActive]}>
                📅 {viewMode === 'month' ? (calendarMode === 'month' ? 'Month' : 'Week') : 'Calendar'} ▾
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.switcherBtn, viewMode === 'agenda' && styles.switcherBtnActive]}
              onPress={() => setShowPlannerMenu(true)}
            >
              <Text allowFontScaling={false} style={[styles.switcherBtnText, viewMode === 'agenda' && styles.switcherBtnTextActive]}>
                📋 {viewMode === 'agenda' ? (plannerMode === 'day' ? 'Day' : 'Week') : 'Planner'} ▾
              </Text>
            </TouchableOpacity>

            {/* A real view, not a modal opened from the switcher. Looking like
                a peer of Month and Day View while behaving like an overlay is
                what made it feel bolted on. */}
            <TouchableOpacity
              style={[styles.switcherBtn, viewMode === 'para' && styles.switcherBtnActive]}
              onPress={() => {
                setViewMode('para');
                setShowSettings(false);
              }}
            >
              <Text allowFontScaling={false}
                style={[styles.switcherBtnText, viewMode === 'para' && styles.switcherBtnTextActive]}
              >
                📁 PARA
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={styles.appMenuBtn} onPress={() => setShowAppMenu(true)}>
          <Text allowFontScaling={false} style={styles.appMenuBtnText}>
            {syncPhase === 'success' ? '✓ ' : syncPhase === 'error' || syncPhase === 'partial' ? '! ' : ''}⚙
          </Text>
        </TouchableOpacity>
      </View>

      {isLoading && (
        <View style={styles.loadingBanner}>
          <Text allowFontScaling={false} style={styles.loadingBannerText}>Loading calendar and tasks…</Text>
        </View>
      )}

      <Modal visible={showCalendarMenu} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowCalendarMenu(false)}>
          <View style={styles.actionSheetContentCompact}>
            <Text allowFontScaling={false} style={styles.actionSheetTitle}>Calendar View</Text>
            <TouchableOpacity style={styles.actionSheetBtn} onPress={() => {
              setCalendarMode('month');
              setViewMode('month');
              setShowSettings(false);
              setShowCalendarMenu(false);
            }}>
              <Text allowFontScaling={false} style={styles.actionSheetBtnText}>📅 Month View</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionSheetBtn} onPress={() => {
              setCalendarMode('week');
              setViewMode('month');
              setShowSettings(false);
              setShowCalendarMenu(false);
            }}>
              <Text allowFontScaling={false} style={styles.actionSheetBtnText}>🗓 Week View</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowCalendarMenu(false)}>
              <Text allowFontScaling={false} style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showPlannerMenu} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowPlannerMenu(false)}>
          <View style={styles.actionSheetContentCompact}>
            <Text allowFontScaling={false} style={styles.actionSheetTitle}>Planner View</Text>
            <TouchableOpacity style={styles.actionSheetBtn} onPress={() => {
              setPlannerMode('day');
              setViewMode('agenda');
              setShowSettings(false);
              setShowPlannerMenu(false);
            }}>
              <Text allowFontScaling={false} style={styles.actionSheetBtnText}>📋 Day Planner</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionSheetBtn} onPress={() => {
              setPlannerMode('week');
              setViewMode('agenda');
              setShowSettings(false);
              setShowPlannerMenu(false);
            }}>
              <Text allowFontScaling={false} style={styles.actionSheetBtnText}>🗓 Weekly Review</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowPlannerMenu(false)}>
              <Text allowFontScaling={false} style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showAppMenu} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowAppMenu(false)}>
          <View style={styles.actionSheetContentCompact}>
            <Text allowFontScaling={false} style={styles.actionSheetTitle}>SNFolio</Text>
            <TouchableOpacity
              style={styles.actionSheetBtn}
              disabled={!(caldavEnabled || taskCaldavEnabled || hasSubscribedFeeds)}
              onPress={() => {
                setShowAppMenu(false);
                void handleSyncNow();
              }}
            >
              <Text allowFontScaling={false} style={styles.actionSheetBtnText}>
                🔄 {caldavEnabled || taskCaldavEnabled || hasSubscribedFeeds ? 'Sync Now' : 'Sync Not Configured'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionSheetBtn} onPress={() => {
              setShowAppMenu(false);
              setShowSettings(value => !value);
            }}>
              <Text allowFontScaling={false} style={styles.actionSheetBtnText}>
                ⚙ {showSettings ? 'Close Settings' : 'Connections & Settings'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.deleteOptionBtnDanger} onPress={() => {
              setShowAppMenu(false);
              handleClosePlugin();
            }}>
              <Text allowFontScaling={false} style={styles.deleteOptionBtnTextDanger}>✕ Exit SNFolio</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAppMenu(false)}>
              <Text allowFontScaling={false} style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={archiveFolderPrompt !== null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.archiveMoveModal}>
            <Text allowFontScaling={false} style={styles.actionSheetTitle}>
              {archiveFolderPrompt?.mode === 'restore' ? 'Restore from Archive' : 'Archive Folder?'}
            </Text>
            <Text allowFontScaling={false} style={styles.bodyTextCenter}>
              {archiveFolderPrompt?.item.name}
            </Text>
            {archiveFolderPrompt && archiveMovesFor(archiveFolderPrompt).length > 0 && (
              <>
                <Text allowFontScaling={false} style={styles.archivePathLabel}>From</Text>
                <Text allowFontScaling={false} style={styles.codePath} numberOfLines={2}>
                  {archiveMovesFor(archiveFolderPrompt)[0].source}
                </Text>
                <Text allowFontScaling={false} style={styles.archivePathLabel}>To</Text>
                <Text allowFontScaling={false} style={styles.codePath} numberOfLines={2}>
                  {archiveMovesFor(archiveFolderPrompt)[0].destination}
                </Text>
                {archiveMovesFor(archiveFolderPrompt).length > 1 && (
                  <Text allowFontScaling={false} style={styles.previewHint}>
                    This will also move {archiveMovesFor(archiveFolderPrompt).length - 1} active Project folder(s).
                  </Text>
                )}
              </>
            )}
            {archiveFolderPrompt?.mode === 'archive' && (
              <TouchableOpacity
                disabled={archiveMoveBusy}
                style={[styles.archiveLocationBtn, archiveMoveBusy && styles.disabledBtn]}
                onPress={() => setShowArchiveRootPicker(true)}
              >
                <Text allowFontScaling={false} style={styles.archiveLocationBtnText}>
                  📁 Choose a Different Archive Root…
                </Text>
                <Text allowFontScaling={false} style={styles.archiveLocationHint} numberOfLines={2}>
                  Current: {archiveDestinationRoot || paraRoot(calendarStorage.getSettings(), 'archive')}
                </Text>
              </TouchableOpacity>
            )}
            <View style={styles.archiveWarning}>
              <Text allowFontScaling={false} style={styles.archiveWarningText}>
                ⚠ Moving folders can break links inside Supernote notes, Recent files, shortcuts,
                and links saved by other apps. SNFolio can update only paths it owns. Close files
                in these folders before continuing. Supernote calls moving a folder “delete”
                permission because the old path is removed; SNFolio does not delete its contents.
              </Text>
            </View>
            {archiveMoveError !== '' && (
              <View style={styles.archiveErrorBox}>
                <Text allowFontScaling={false} style={styles.archiveErrorText}>{archiveMoveError}</Text>
              </View>
            )}
            <TouchableOpacity
              disabled={archiveMoveBusy}
              style={[styles.actionSheetBtn, archiveMoveBusy && styles.disabledBtn]}
              onPress={() => void finishArchiveChoice(false)}
            >
              <Text allowFontScaling={false} style={styles.actionSheetBtnText}>
                {archiveFolderPrompt?.mode === 'restore'
                  ? 'Restore Only — Keep Folder Here'
                  : 'Archive Only — Keep Folder Here'}
              </Text>
            </TouchableOpacity>
            {archiveFolderPrompt && (
              archiveFolderPrompt.mode === 'archive' || archiveMovesFor(archiveFolderPrompt).length > 0
            ) && (
              <TouchableOpacity
                disabled={archiveMoveBusy}
                style={[styles.deleteOptionBtnDanger, archiveMoveBusy && styles.disabledBtn]}
                onPress={() => void finishArchiveChoice(true)}
              >
                <Text allowFontScaling={false} style={styles.deleteOptionBtnTextDanger}>
                  {archiveMoveBusy ? 'Moving Folder…' : archiveFolderPrompt.mode === 'restore'
                    ? 'Restore & Move Folder Back'
                    : 'Archive & Move Folder'}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              disabled={archiveMoveBusy}
              style={[styles.cancelBtn, archiveMoveBusy && styles.disabledBtn]}
              onPress={() => {
                setArchiveMoveError('');
                setArchiveFolderPrompt(null);
              }}
            >
              <Text allowFontScaling={false} style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <FolderPickerModal
        visible={showArchiveRootPicker}
        title="Choose Archive root folder"
        initialPath={archiveDestinationRoot || paraRoot(calendarStorage.getSettings(), 'archive')}
        onCancel={() => setShowArchiveRootPicker(false)}
        onSelect={async folder => {
          const selected = normaliseFolderPath(folder);
          const previous = calendarStorage.getSettings().archiveDirectory;
          calendarStorage.updateSettings({ archiveDirectory: selected });
          const persistenceError = await calendarStorage.flush();
          if (persistenceError) {
            calendarStorage.updateSettings({ archiveDirectory: previous });
            throw new Error(persistenceError);
          }
          setArchiveDestinationRoot(selected);
          setShowArchiveRootPicker(false);
        }}
      />

      {statusMsg !== '' && (
        <View style={styles.statusBanner}>
          <Text allowFontScaling={false} style={styles.statusText}>{statusMsg}</Text>
        </View>
      )}

      {/* Deleting an event that generated a note. Handwritten pages cannot be
          recovered and there is no undo, so the file is named and keeping it
          is offered as a first-class choice rather than a cancel. */}
      <Modal visible={showDeleteNoteModal} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => {
            setShowDeleteNoteModal(false);
            setPendingDeleteEvent(null);
          }}
        >
          <View style={styles.actionSheetContentCompact}>
            <Text allowFontScaling={false} style={styles.actionSheetTitle}>Delete…</Text>
            <Text allowFontScaling={false} style={styles.bodyTextCenter} numberOfLines={2}>
              "{pendingDeleteEvent?.summary}"
            </Text>
            <Text allowFontScaling={false} style={styles.previewHint}>
              Replacing unlinks the note now and removes the file when its replacement opens.
              Deleting outright leaves the plugin and shows the folder — that is the device's
              own behaviour, and the deletion still happens.
            </Text>
            <Text allowFontScaling={false} style={styles.previewHint}>
              It has a note:{' '}
              {pendingDeleteEvent
                ? calendarStorage
                    .getMapping(noteIdentity(pendingDeleteEvent))
                    ?.notePath?.split('/')
                    .pop()
                : ''}
            </Text>

            {/* Deleting only the note is how a wrong Meeting-or-Class answer
                gets fixed: the recorded kind goes with the note, so Create
                Note asks again, and the event itself is untouched. */}
            <TouchableOpacity
              style={styles.deleteOptionBtn}
              onPress={() => handleConfirmDeleteWithNote('note')}
            >
              <Text allowFontScaling={false} style={styles.deleteOptionBtnText}>📝 Replace the note, keep the event</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.deleteOptionBtn}
              onPress={() => handleConfirmDeleteWithNote('event')}
            >
              <Text allowFontScaling={false} style={styles.deleteOptionBtnText}>🗑️ Delete the event, keep the note</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.deleteOptionBtnDanger}
              onPress={() => handleConfirmDeleteWithNote('both')}
            >
              <Text allowFontScaling={false} style={styles.deleteOptionBtnTextDanger}>🗑️ Delete both</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => {
                setShowDeleteNoteModal(false);
                setPendingDeleteEvent(null);
              }}
            >
              <Text allowFontScaling={false} style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <TaskListModal
        visible={showTaskList}
        tasks={tasks}
        areas={areas}
        areaOf={areaOfTask}
        projects={projects}
        projectOf={projectOfTask}
        onClose={() => setShowTaskList(false)}
        onToggle={handleToggleTask}
        onEdit={task => {
          setShowTaskList(false);
          handleEditTask(task);
        }}
        onLinkNote={task => { void handleLinkExistingTaskNote(task); }}
        notePathFor={uid => calendarStorage.getMapping(uid)?.notePath}
        onNoteAction={(task, existingPath) => {
          setShowTaskList(false);
          if (existingPath) {
            void handleOpenExistingNote(existingPath);
          } else {
            handleRequestTaskNote(task);
          }
        }}
      />

      {noteCreationEvent && (
        <CreateEventNoteModal
          visible
          eventKey={noteIdentity(noteCreationEvent)}
          eventTitle={noteCreationEvent.summary}
          initialKind={calendarStorage.getEventKind(noteIdentity(noteCreationEvent)) === 'class' ? 'class' : 'meeting'}
          initialName={suggestedEventNoteName(
            noteCreationEvent,
            calendarStorage.getEventKind(noteIdentity(noteCreationEvent)) === 'class' ? 'class' : 'meeting'
          )}
          preferContext={Boolean(calendarStorage.getSettings().routeEventNotesToPara)}
          meeting={noteChoiceFor(noteCreationEvent, 'meeting')}
          classNote={noteChoiceFor(noteCreationEvent, 'class')}
          onCancel={() => setNoteCreationEvent(null)}
          onCreate={handleConfirmNoteCreation}
        />
      )}

      {taskNoteCreationTarget && (
        <CreateEventNoteModal
          visible
          mode="task"
          eventKey={taskNoteCreationTarget.uid}
          eventTitle={taskNoteCreationTarget.title}
          initialKind="task"
          initialName={taskNoteCreationTarget.title}
          preferContext
          taskNote={taskNoteChoiceFor(taskNoteCreationTarget)}
          onCancel={() => setTaskNoteCreationTarget(null)}
          onCreate={handleConfirmTaskNote}
          onLinkExisting={handleLinkExistingTaskNote}
        />
      )}

      <DatePickerModal
        visible={projectDueTarget !== null}
        value={projectDueTarget?.dueDate || new Date()}
        weekStartsOn={weekStartsOn}
        onSelect={date => {
          if (!projectDueTarget) return;
          calendarStorage.upsertProject({ ...projectDueTarget, dueDate: date });
          setProjects([...calendarStorage.getProjects()]);
          setProjectDueTarget(null);
        }}
        onClose={() => setProjectDueTarget(null)}
      />

      {/* Template chooser. Rendered outside the settings/calendar ternary: it is
          opened from Settings, and living in the calendar branch meant it was
          never mounted while Settings was open. The SDK exposes the built-in
          template list but no native picker UI for it, so the list is ours;
          the file picker survives as the custom-PNG option at the bottom. */}
        <Modal
        visible={templatePickerKind !== null || typeTemplatePicker !== null}
        transparent
        animationType="fade"
      >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => {
              setTemplatePickerKind(null);
              setTypeTemplatePicker(null);
            }}
          >
            <View style={styles.actionSheetContentCompact}>
              <Text allowFontScaling={false} style={styles.actionSheetTitle}>
                {typeTemplatePicker
                  ? typeTemplatePicker.name
                  : templatePickerKind === 'daily'
                  ? 'Daily'
                  : templatePickerKind === 'class'
                  ? 'Class'
                  : templatePickerKind === 'task'
                  ? 'Task'
                  : 'Meeting'}{' '}
                Note Template
              </Text>

              <ScrollView style={styles.templateScroll} keyboardShouldPersistTaps="handled">
                {systemTemplates.length === 0 && (
                  <Text allowFontScaling={false} style={styles.bodyTextCenter}>
                    No built-in templates reported by this device. A custom PNG still works.
                  </Text>
                )}

                {systemTemplates.map(tpl => {
                  const active = typeTemplatePicker
                    ? typeTemplatePicker.template === tpl.name
                    : templatePickerKind !== null && noteTemplateFor(templatePickerKind) === tpl.name;
                  return (
                    <TouchableOpacity
                      key={tpl.name}
                      style={[styles.templateOptionRow, active && styles.templateOptionRowActive]}
                      onPress={() => {
                        if (typeTemplatePicker) {
                          handleUpdateEventType({ ...typeTemplatePicker, template: tpl.name });
                          setTypeTemplatePicker(null);
                          return;
                        }
                        if (templatePickerKind) setNoteTemplate(templatePickerKind, tpl.name);
                      }}
                    >
                      <Text allowFontScaling={false}
                        style={[styles.templateOptionText, active && styles.templateOptionTextActive]}
                      >
                        {active ? '✓ ' : ''}
                        {templateLabel(tpl.name)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <TouchableOpacity
                style={styles.pickerOpenBtn}
                onPress={() => {
                  if (typeTemplatePicker) {
                    void handleChooseCustomTypeTemplate(typeTemplatePicker);
                  } else if (templatePickerKind) {
                    void handleChooseCustomTemplate(templatePickerKind);
                  }
                }}
              >
                <Text allowFontScaling={false} style={styles.pickerOpenBtnText}>🎨 Custom PNG...</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelBtn} onPress={() => {
                setTemplatePickerKind(null);
                setTypeTemplatePicker(null);
              }}>
                <Text allowFontScaling={false} style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

        <FolderPickerModal
          visible={folderPickerTarget !== null}
          title={folderPickerTarget && CONFIGURABLE_NOTE_KINDS.includes(folderPickerTarget as ConfigurableNoteKind)
            ? `Choose ${folderPickerTarget} notes folder`
            : `Choose ${folderPickerTarget || 'PARA'} root`}
          initialPath={folderPickerTarget && CONFIGURABLE_NOTE_KINDS.includes(folderPickerTarget as ConfigurableNoteKind)
            ? noteFolderFor(folderPickerTarget as ConfigurableNoteKind)
            : folderPickerTarget ? paraRootFor(folderPickerTarget as ParaRootKind) : '/storage/emulated/0'}
          onCancel={() => setFolderPickerTarget(null)}
          onSelect={async folder => {
            const target = folderPickerTarget;
            if (!target) return;
            if (CONFIGURABLE_NOTE_KINDS.includes(target as ConfigurableNoteKind)) {
              applyNoteFolder(target as ConfigurableNoteKind, folder);
            } else {
              applyParaRoot(target as ParaRootKind, folder);
            }
            const persistenceError = await calendarStorage.flush();
            if (persistenceError) throw new Error(persistenceError);
            setFolderPickerTarget(null);
          }}
        />

        <ExistingParaFoldersModal
          visible={paraImportKind !== null}
          kind={paraImportKind || 'projects'}
          root={paraImportKind ? paraRootFor(paraImportKind) : ''}
          folders={paraImportFolders}
          existing={paraImportKind === 'projects'
            ? projects
            : paraImportKind === 'areas'
            ? areas
            : paraImportKind === 'resources'
            ? resources
            : [...projects, ...areas, ...resources]}
          onClose={() => setParaImportKind(null)}
          onImport={(entry, archiveAs) => {
            if (paraImportKind) importParaFolder(paraImportKind, entry, archiveAs);
          }}
        />

      {showSettings ? (
        <ScrollView
          ref={settingsScrollRef}
          style={styles.settingsContainer}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={settingsTab === 'notes' ? styles.settingsContentCompact : styles.settingsContent}
        >
          <View style={styles.settingsHeader}>
            <Text allowFontScaling={false} style={styles.settingsHeaderTitle}>⚙️ SETTINGS &amp; CONFIGURATION</Text>
            <TouchableOpacity onPress={() => setShowSettings(false)}>
              <Text allowFontScaling={false} style={styles.settingsHeaderClose}>✕ Close</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.settingsTabRow}>
            {([
              ['sync', '🔄 Calendars & Sync'],
              ['notes', '📁 Notes & Storage'],
              ['app', '🎨 App & View'],
              ['help', '🛠 Help & Setup'],
            ] as Array<[SettingsTab, string]>).map(([key, label]) => (
              <TouchableOpacity
                key={key}
                style={[styles.settingsTab, settingsTab === key && styles.settingsTabActive]}
                onPress={() => setSettingsTab(key)}
              >
                <Text allowFontScaling={false} style={[styles.settingsTabText, settingsTab === key && styles.settingsTabTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {settingsTab === 'sync' && (
            <>
          {(syncPhase !== 'idle' || lastSuccessfulSync) && (
            <View style={styles.hintBox}>
              <Text allowFontScaling={false} style={styles.checkSettingLabel}>
                Sync status: {syncPhase === 'syncing' ? 'Syncing…' :
                  syncPhase === 'success' ? 'Up to date' :
                  syncPhase === 'partial' ? 'Completed with warnings' :
                  syncPhase === 'error' ? 'Failed' : 'Not run this session'}
              </Text>
              {lastSuccessfulSync !== '' && (
                <Text allowFontScaling={false} style={styles.checkSettingHint}>
                  Last fully successful: {new Date(lastSuccessfulSync).toLocaleString()}
                </Text>
              )}
              <Text allowFontScaling={false} style={styles.checkSettingHint}>
                Pending uploads: {pendingSyncCount}
              </Text>
              {syncDetails.map((detail, index) => (
                <Text key={`${detail}-${index}`} allowFontScaling={false} style={styles.checkSettingHint}>
                  {detail}
                </Text>
              ))}
            </View>
          )}
          <View style={[styles.syncColumns, !isWideScreen && styles.syncColumnsStacked]}>
          <View style={[styles.syncColumn, isWideScreen && styles.syncColumnLeft]}>
          <Text allowFontScaling={false} style={styles.sectionTitle}>Calendar CalDAV Two-Way Sync</Text>
          <Text allowFontScaling={false} style={styles.bodyText}>Select your event calendar provider:</Text>

          {/* Provider Preset Selector Row */}
          <View style={styles.providerGrid}>
            <TouchableOpacity
              style={[styles.providerBtn, caldavProvider === 'icloud' && styles.providerBtnActive]}
              onPress={() => {
                setCaldavProvider('icloud');
                calendarStorage.updateSettings({ caldavProvider: 'icloud' });
              }}
            >
              <Text allowFontScaling={false} style={[styles.providerBtnText, caldavProvider === 'icloud' && styles.providerBtnTextActive]}>
                🍏 Apple iCloud
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.providerBtn, caldavProvider === 'custom' && styles.providerBtnActive]}
              onPress={() => {
                setCaldavProvider('custom');
                calendarStorage.updateSettings({ caldavProvider: 'custom' });
              }}
            >
              <Text allowFontScaling={false} style={[styles.providerBtnText, caldavProvider === 'custom' && styles.providerBtnTextActive]}>
                📧 Custom / Other
              </Text>
            </TouchableOpacity>
          </View>

          {caldavProvider === 'custom' && (
            <View style={styles.inputRow}>
              <HandwritingTextInput
                ref={caldavCustomUrlInputRef}
                style={[styles.textInput, styles.compactTextInput]}
                value={caldavCustomUrl}
                onChangeText={setCaldavCustomUrl}
                placeholder="CalDAV Server URL (e.g. https://caldav.fastmail.com/)"
                placeholderTextColor="#707070"
                autoCapitalize="none"
              />
            </View>
          )}

          <View style={styles.inputRow}>
            <HandwritingTextInput
              ref={caldavAppleIdInputRef}
              style={[styles.textInput, styles.compactTextInput]}
              value={caldavAppleId}
              onChangeText={setCaldavAppleId}
              placeholder={caldavProvider === 'google' ? 'Google Account Email' : 'Account Email / Username'}
              placeholderTextColor="#707070"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputRow}>
            <HandwritingTextInput
              ref={caldavPasswordInputRef}
              style={[styles.textInput, styles.compactTextInput]}
              value={caldavPassword}
              onChangeText={setCaldavPassword}
              placeholder="App-Specific Password / Passcode"
              placeholderTextColor="#707070"
              secureTextEntry
              autoCapitalize="none"
            />
          </View>

          <TouchableOpacity style={styles.connectCaldavBtn} onPress={handleTestCaldavConnection}>
            <Text allowFontScaling={false} style={styles.connectCaldavBtnText}>
              🔒 Connect & Test {caldavProvider.toUpperCase()} CalDAV
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.diagRunBtn} onPress={handleRunDiagnostics}>
            <Text allowFontScaling={false} style={styles.diagRunBtnText}>
              🔍 Run CalDAV Diagnostic Test (Trace HTTP Steps)
            </Text>
          </TouchableOpacity>

          {caldavEnabled && (
            <View style={styles.caldavActiveBadge}>
              <Text allowFontScaling={false} style={styles.caldavActiveBadgeText}>
                ✓ {caldavProvider.toUpperCase()} CalDAV Push Active
              </Text>
              {/* Persistent readout — a status message scrolls away, and
                  whether tasks have a destination must stay checkable. */}
              <Text allowFontScaling={false} style={styles.caldavTargetText}>
                Events → {caldavUrl ? decodeURIComponent(caldavUrl.replace(/\/$/, '').split('/').pop() || '?') : 'not set'}
              </Text>
              {caldavProvider === 'icloud' && (
                <Text allowFontScaling={false} style={styles.caldavTargetText}>
                  Tasks stay local unless a separate task account is connected below.
                </Text>
              )}
            </View>
          )}

          </View>
          <View style={styles.syncColumn}>
          <Text allowFontScaling={false} style={styles.sectionTitle}>Optional Task CalDAV Account</Text>
          <Text allowFontScaling={false} style={styles.bodyText}>
            Modern iCloud Reminders does not expose its lists through iCloud CalDAV. To show
            Supernote tasks in Apple's Reminders app, use a separate CalDAV service that supports
            VTODO, then add that same account to your Apple device. This does not move existing
            iCloud reminders.
          </Text>

          <View style={styles.inputRow}>
            <HandwritingTextInput
              ref={taskServerInputRef}
              style={[styles.textInput, styles.compactTextInput]}
              value={taskCaldavServerUrl}
              onChangeText={setTaskCaldavServerUrl}
              placeholder="Task CalDAV server URL"
              placeholderTextColor="#707070"
              autoCapitalize="none"
            />
          </View>
          <View style={styles.inputRow}>
            <HandwritingTextInput
              ref={taskUsernameInputRef}
              style={[styles.textInput, styles.compactTextInput]}
              value={taskCaldavUsername}
              onChangeText={setTaskCaldavUsername}
              placeholder="Task account username"
              placeholderTextColor="#707070"
              autoCapitalize="none"
            />
          </View>
          <View style={styles.inputRow}>
            <HandwritingTextInput
              ref={taskPasswordInputRef}
              style={[styles.textInput, styles.compactTextInput]}
              value={taskCaldavPassword}
              onChangeText={setTaskCaldavPassword}
              placeholder="Task account password"
              placeholderTextColor="#707070"
              secureTextEntry
              autoCapitalize="none"
            />
          </View>
          <TouchableOpacity style={styles.connectCaldavBtn} onPress={handleTestTaskCaldavConnection}>
            <Text allowFontScaling={false} style={styles.connectCaldavBtnText}>
              Connect &amp; Find VTODO List
            </Text>
          </TouchableOpacity>

          {discoveredTaskLists.length > 1 && (
            <View style={styles.syncedTaskCleanupBox}>
              <Text allowFontScaling={false} style={styles.checkSettingLabel}>Choose the task list to synchronize</Text>
              {discoveredTaskLists.map(list => (
                <TouchableOpacity
                  key={list.url}
                  style={styles.cancelBtn}
                  onPress={() => void activateTaskCollection(list)}
                >
                  <Text allowFontScaling={false} style={styles.cancelBtnText}>
                    {list.displayName || decodeURIComponent(list.url.replace(/\/$/, '').split('/').pop() || 'Tasks')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {Boolean(taskCaldavCollectionUrl) && (
            <View style={styles.caldavActiveBadge}>
              <Text allowFontScaling={false} style={styles.caldavActiveBadgeText}>
                {taskCaldavEnabled ? '✓ External task synchronization active' : '⏸ Task synchronization paused'}
              </Text>
              <Text allowFontScaling={false} style={styles.caldavTargetText}>
                Tasks → {calendarStorage.getSettings().taskCaldavCollectionName || decodeURIComponent(taskCaldavCollectionUrl.replace(/\/$/, '').split('/').pop() || '?')}
                {taskCaldavUsername ? ` (${taskCaldavUsername})` : ''}
              </Text>
              {excludedLocalTaskCount > 0 && (
                <View style={styles.syncedTaskCleanupBox}>
                  <Text allowFontScaling={false} style={styles.checkSettingLabel}>
                    {excludedLocalTaskCount} existing device task{excludedLocalTaskCount === 1 ? '' : 's'} kept device-only
                  </Text>
                  <Text allowFontScaling={false} style={styles.checkSettingHint}>
                    New tasks can synchronize normally. Existing tasks are not uploaded unless you explicitly include them.
                  </Text>
                  {confirmEnrollLocalTasks ? (
                    <View>
                      <Text allowFontScaling={false} style={styles.cleanupWarningText}>
                        This will make all {excludedLocalTaskCount} existing device task{excludedLocalTaskCount === 1 ? '' : 's'} eligible for upload to this list.
                      </Text>
                      <TouchableOpacity style={styles.connectCaldavBtn} onPress={() => void handleEnrollLocalTasks()}>
                        <Text allowFontScaling={false} style={styles.connectCaldavBtnText}>Include Existing Device Tasks</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.cancelBtn} onPress={() => setConfirmEnrollLocalTasks(false)}>
                        <Text allowFontScaling={false} style={styles.cancelBtnText}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.cancelBtn} onPress={() => setConfirmEnrollLocalTasks(true)}>
                      <Text allowFontScaling={false} style={styles.cancelBtnText}>Upload Existing Device Tasks…</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => void (taskCaldavEnabled ? handlePauseTaskCaldav() : handleResumeTaskCaldav())}
              >
                <Text allowFontScaling={false} style={styles.cancelBtnText}>
                  {taskCaldavEnabled ? 'Pause Task Sync' : 'Resume Task Sync'}
                </Text>
              </TouchableOpacity>
              {confirmRemoveTaskAccount ? (
                <View>
                  <Text allowFontScaling={false} style={styles.cleanupWarningText}>
                    Removing the account never changes its server. Choose whether its synchronized tasks remain on this Supernote.
                  </Text>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => void handleRemoveTaskAccount(false)}>
                    <Text allowFontScaling={false} style={styles.cancelBtnText}>Remove Account — Keep Local Tasks</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.deleteOptionBtnDanger} onPress={() => void handleRemoveTaskAccount(true)}>
                    <Text allowFontScaling={false} style={styles.deleteOptionBtnTextDanger}>Remove Account &amp; Local Synced Tasks</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setConfirmRemoveTaskAccount(false)}>
                    <Text allowFontScaling={false} style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setConfirmRemoveTaskAccount(true)}>
                  <Text allowFontScaling={false} style={styles.cancelBtnText}>Remove Task Account…</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {syncedTaskCount > 0 && (
            <View style={styles.syncedTaskCleanupBox}>
              <Text allowFontScaling={false} style={styles.checkSettingLabel}>
                {syncedTaskCount} CalDAV-backed task{syncedTaskCount === 1 ? '' : 's'} stored on this Supernote
              </Text>
              <Text allowFontScaling={false} style={styles.checkSettingHint}>
                Pausing sync or removing an account with Keep Local Tasks preserves these copies. Removing them here never changes a server.
              </Text>
              {taskCaldavCollectionUrl ? (
                <Text allowFontScaling={false} style={styles.checkSettingHint}>
                  Use Remove Task Account above to keep or remove this account's local task copies safely.
                </Text>
              ) : confirmClearSyncedTasks ? (
                <View>
                  <Text allowFontScaling={false} style={styles.cleanupWarningText}>
                    Device-only tasks will be kept. This cannot be undone unless the account is reconnected and synced.
                  </Text>
                  <TouchableOpacity
                    style={styles.deleteOptionBtnDanger}
                    onPress={() => void handleClearSyncedTasks()}
                  >
                    <Text allowFontScaling={false} style={styles.deleteOptionBtnTextDanger}>
                      Remove {syncedTaskCount} Synced Task{syncedTaskCount === 1 ? '' : 's'} from SNFolio
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setConfirmClearSyncedTasks(false)}>
                    <Text allowFontScaling={false} style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setConfirmClearSyncedTasks(true)}>
                  <Text allowFontScaling={false} style={styles.cancelBtnText}>Remove Synced Tasks from SNFolio</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          </View>
          </View>

          <View style={[styles.syncColumns, !isWideScreen && styles.syncColumnsStacked]}>
          <View style={[styles.syncColumn, isWideScreen && styles.syncColumnLeft]}>
          <Text allowFontScaling={false} style={styles.sectionTitle}>Add a Calendar</Text>
          <TouchableOpacity style={styles.pickerOpenBtn} onPress={handleImportFeedsFromTxt}>
            <Text allowFontScaling={false} style={styles.pickerOpenBtnText}>📂 Import Setup or Calendar File...</Text>
          </TouchableOpacity>
          <Text allowFontScaling={false} style={styles.checkSettingHint}>
            Setup file: one HTTPS/webcal address per line, or Name|Address. Imported .ics files are copied into private plugin storage.
          </Text>
          {(calendarStorage.getSettings().hiddenFeedEventIds || []).length > 0 && (
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => {
                const count = calendarStorage.getSettings().hiddenFeedEventIds?.length || 0;
                calendarStorage.updateSettings({ hiddenFeedEventIds: [] });
                setAllParsedEvents(previous => [...previous]);
                setStatusMsg(`Restored ${count} hidden subscribed event(s).`);
              }}
            >
              <Text allowFontScaling={false} style={styles.cancelBtnText}>Show Hidden Feed Events</Text>
            </TouchableOpacity>
          )}
          <View style={styles.inputRow}>
            <HandwritingTextInput
              ref={newFeedInputRef}
              style={[styles.textInput, styles.compactTextInput]}
              value={newFeedUrl}
              onChangeText={setNewFeedUrl}
              placeholder="https://example.com/calendar.ics"
              placeholderTextColor="#707070"
            />
            <TouchableOpacity style={styles.addBtn} onPress={handleFetchFeedUrl}>
              <Text allowFontScaling={false} style={styles.addBtnText}>Subscribe</Text>
            </TouchableOpacity>
          </View>
          </View>

          <View style={styles.syncColumn}>
          <Text allowFontScaling={false} style={styles.sectionTitle}>Connected Calendars</Text>
          {connectedCalendarFeeds.length === 0 ? (
            <Text allowFontScaling={false} style={styles.checkSettingHint}>No imported or subscribed calendars.</Text>
          ) : connectedCalendarFeeds.map(feed => (
            <View key={feed.id} style={styles.connectedFeedRow}>
              <View style={styles.connectedFeedDetails}>
                <Text allowFontScaling={false} style={styles.connectedFeedName} numberOfLines={1}>
                  {feed.name}
                </Text>
                <Text allowFontScaling={false} style={styles.connectedFeedKind}>
                  {feed.localPath ? 'Imported calendar file' : 'Subscribed calendar'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.removeFeedBtn}
                onPress={() => void handleRemoveCalendarFeed(feed)}
              >
                <Text allowFontScaling={false} style={styles.removeFeedBtnText}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))}

          <Text allowFontScaling={false} style={[styles.sectionTitle, { marginTop: 12 }]}>Smart Event Filters</Text>
          <View style={styles.filterToggleRow}>
            <Text allowFontScaling={false} style={styles.bodyText}>Hide All-Day Events (Holidays, Reminders):</Text>
            <Switch value={hideAllDay} onValueChange={handleToggleHideAllDay} />
          </View>
          <View style={styles.filterToggleRow}>
            <Text allowFontScaling={false} style={styles.bodyText}>Hide Solo Events (0 Attendees):</Text>
            <Switch value={hideSolo} onValueChange={handleToggleHideSolo} />
          </View>
          </View>
          </View>
            </>
          )}

          {settingsTab === 'notes' && (
            <>
          <View style={styles.notesSettingsStack}>
            <View>
              <Text allowFontScaling={false} style={styles.sectionTitle}>Daily Note Filename</Text>
              <View style={styles.dailyFormatColumns}>
                <View style={styles.dailyFormatColumn}>
                  <Text allowFontScaling={false} style={styles.compactHelp}>
                    Match existing filenames. Omit .note; wrap literal words in [brackets].
                  </Text>
                  <HandwritingTextInput
                    style={[styles.textInput, styles.compactInput]}
                    value={dailyNoteFormat}
                    onChangeText={value => {
                      setDailyNoteFormat(value);
                      calendarStorage.updateSettings({ dailyNoteFormat: value });
                    }}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#707070"
                    autoCapitalize="none"
                  />
                  <View style={styles.formatPresetRow}>
                    {DAILY_NOTE_PRESETS.map(preset => (
                      <TouchableOpacity
                        key={preset}
                        style={[styles.formatPreset, dailyNoteFormat === preset && styles.formatPresetActive]}
                        onPress={() => {
                          setDailyNoteFormat(preset);
                          calendarStorage.updateSettings({ dailyNoteFormat: preset });
                        }}
                      >
                        <Text allowFontScaling={false} style={[styles.formatPresetText, dailyNoteFormat === preset && styles.formatPresetTextActive]}>{preset}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                <View style={[styles.previewBox, styles.dailyPreview]}>
                  <Text allowFontScaling={false} style={styles.previewLabel}>Today would open</Text>
                  <Text allowFontScaling={false} style={styles.previewPath} numberOfLines={2}>{dailyNotePath(dailyNoteFolder, dailyNoteFormat, new Date())}</Text>
                  {looksMangled(formatDailyNoteName(dailyNoteFormat, new Date())) ? <Text allowFontScaling={false} style={styles.previewWarn}>⚠ Put literal words in [brackets].</Text> : null}
                  {/\.note$/i.test(dailyNoteFormat.trim()) ? <Text allowFontScaling={false} style={styles.previewWarn}>⚠ Remove the .note extension.</Text> : null}
                  <Text allowFontScaling={false} style={styles.previewHint}>YYYY · MMMM · MM · DD · dddd</Text>
                </View>
              </View>

              <Text allowFontScaling={false} style={[styles.sectionTitle, styles.compactSectionTitle]}>Note Templates &amp; Folders</Text>
              {CONFIGURABLE_NOTE_KINDS.map(kind => {
                const label = kind === 'daily' ? 'Daily' : kind === 'class' ? 'Class' : kind === 'task' ? 'Task' : 'Meeting';
                const value = noteTemplateFor(kind);
                const folder = noteFolderFor(kind);
                return (
                  <View key={kind} style={styles.compactNoteRow}>
                    <Text allowFontScaling={false} style={styles.compactNoteLabel}>{label}</Text>
                    <TouchableOpacity style={styles.compactChoice} onPress={() => setTemplatePickerKind(kind)}>
                      <Text allowFontScaling={false} style={styles.compactChoiceText} numberOfLines={1}>🎨 {templateLabel(value)}</Text>
                    </TouchableOpacity>
                    <HandwritingTextInput
                      ref={input => { folderInputRefs.current[kind] = input; }}
                      style={[styles.textInput, styles.compactPathInput]}
                      value={folderDrafts[kind] ?? folder}
                      onChangeText={text => setFolderDrafts(prev => ({ ...prev, [kind]: text }))}
                      onEndEditing={() => saveNoteFolder(
                        kind,
                        folderInputRefs.current[kind]?.getValue() ?? folderDrafts[kind] ?? folder
                      )}
                      placeholder="/storage/..."
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <TouchableOpacity style={styles.compactBrowse} onPress={() => handleChooseNoteFolder(kind)}>
                      <Text allowFontScaling={false} style={styles.compactBrowseText}>Browse</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}

              <View style={styles.paraNoteRoutingCard}>
                <View style={styles.paraNoteRoutingHeader}>
                  <View style={styles.paraNoteRoutingCopy}>
                    <Text allowFontScaling={false} style={styles.paraNoteRoutingTitle}>
                      Default Event Note Location
                    </Text>
                    <Text allowFontScaling={false} style={styles.paraNoteRoutingSummary}>
                      Create Note always shows the destination and lets you change it first.
                    </Text>
                  </View>
                </View>
                <View style={styles.noteLocationPolicyRow}>
                  <TouchableOpacity
                    style={[styles.noteLocationPolicy, routeEventNotesToPara && styles.noteLocationPolicySelected]}
                    onPress={() => {
                      setRouteEventNotesToPara(true);
                      calendarStorage.updateSettings({ routeEventNotesToPara: true });
                    }}
                  >
                    <Text
                      allowFontScaling={false}
                      style={[
                        styles.noteLocationPolicyText,
                        routeEventNotesToPara && styles.noteLocationPolicyTextSelected,
                      ]}
                    >
                      Project / Area
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.noteLocationPolicy, !routeEventNotesToPara && styles.noteLocationPolicySelected]}
                    onPress={() => {
                      setRouteEventNotesToPara(false);
                      calendarStorage.updateSettings({ routeEventNotesToPara: false });
                    }}
                  >
                    <Text
                      allowFontScaling={false}
                      style={[
                        styles.noteLocationPolicyText,
                        !routeEventNotesToPara && styles.noteLocationPolicyTextSelected,
                      ]}
                    >
                      Standard Folders
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text allowFontScaling={false} style={styles.checkSettingHint}>
                  {routeEventNotesToPara
                    ? 'Prefer the assigned Project, then Area. Unassigned events use the folders above.'
                    : 'Prefer the Meeting or Class folder above, even when the event has a Project or Area.'}
                </Text>
                {routeEventNotesToPara && (
                  <>
                    <TouchableOpacity
                      style={styles.advancedLayoutButton}
                      onPress={() => setShowAdvancedParaNoteLayout(value => !value)}
                    >
                      <Text allowFontScaling={false} style={styles.advancedLayoutButtonText}>
                        {showAdvancedParaNoteLayout ? '▾ Hide' : '▸ Show'} advanced folder layout
                      </Text>
                    </TouchableOpacity>
                  {showAdvancedParaNoteLayout && (
                    <View style={styles.relativePathRow}>
                    <View style={styles.relativePathField}>
                      <Text allowFontScaling={false} style={[styles.compactNoteLabel, styles.relativePathLabel]}>Meeting subpath</Text>
                      <HandwritingTextInput
                        ref={meetingParaSubpathRef}
                        style={[styles.textInput, styles.compactPathInput]}
                        value={meetingParaSubpath}
                        onChangeText={setMeetingParaSubpath}
                        onEndEditing={() => {
                          const value = cleanRelativeNoteSubpath(
                            meetingParaSubpathRef.current?.getValue() ?? meetingParaSubpath
                          );
                          setMeetingParaSubpath(value);
                          calendarStorage.updateSettings({ meetingParaSubpath: value });
                        }}
                        placeholder="Meetings (blank = item root)"
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </View>
                    <View style={styles.relativePathField}>
                      <Text allowFontScaling={false} style={[styles.compactNoteLabel, styles.relativePathLabel]}>Class subpath</Text>
                      <HandwritingTextInput
                        ref={classParaSubpathRef}
                        style={[styles.textInput, styles.compactPathInput]}
                        value={classParaSubpath}
                        onChangeText={setClassParaSubpath}
                        onEndEditing={() => {
                          const value = cleanRelativeNoteSubpath(
                            classParaSubpathRef.current?.getValue() ?? classParaSubpath
                          );
                          setClassParaSubpath(value);
                          calendarStorage.updateSettings({ classParaSubpath: value });
                        }}
                        placeholder="Classes (blank = item root)"
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </View>
                    </View>
                  )}
                  </>
                )}
              </View>
            </View>

            <View style={styles.paraRootsSection}>
              <Text allowFontScaling={false} style={[styles.sectionTitle, styles.compactSectionTitle]}>PARA Folder Roots</Text>
              <Text allowFontScaling={false} style={styles.compactHelp}>
                New items get a subfolder here. Browse all mounted storage, including SD cards. Existing folders are linked only when you choose them.
              </Text>
              <View style={styles.paraRootGrid}>
                {PARA_ROOT_KINDS.map(kind => (
                  <View key={kind} style={[styles.paraRootCard, isWideScreen && styles.paraRootCardWide]}>
                    <Text allowFontScaling={false} style={styles.paraRootLabel}>{kind}</Text>
                    <Text allowFontScaling={false} style={styles.paraRootPath} numberOfLines={2}>{paraRootFor(kind)}</Text>
                    <View style={styles.paraRootActions}>
                      <TouchableOpacity style={styles.compactBrowse} onPress={() => setFolderPickerTarget(kind)}>
                        <Text allowFontScaling={false} style={styles.compactBrowseText}>Browse</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.compactBrowse} onPress={() => void scanParaRoot(kind)}>
                        <Text allowFontScaling={false} style={styles.compactBrowseText}>Find Existing</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
              <Text allowFontScaling={false} style={styles.previewHint}>
                Archive imports require you to classify each folder. Changing a root never relocates existing files.
              </Text>
            </View>
          </View>

          {SHOW_DEV_PROBE && (
            <>
          <Text allowFontScaling={false} style={[styles.sectionTitle, { marginTop: 15 }]}>Device &amp; Template Probe</Text>
          <Text allowFontScaling={false} style={styles.bodyText}>
            Lists the built-in note templates this device offers, and reports the real screen
            size in dp. Read-only — nothing is changed.
          </Text>
          <TouchableOpacity style={styles.diagRunBtn} onPress={handleProbeDevice}>
            <Text allowFontScaling={false} style={styles.diagRunBtnText}>🔍 Probe Templates &amp; Screen Size</Text>
          </TouchableOpacity>

          {templateProbe.length > 0 && (
            <View style={styles.diagLogBox}>
              {templateProbe.map((line, idx) => (
                <Text allowFontScaling={false} key={`probe-${idx}`} style={styles.diagLogLine}>
                  {line}
                </Text>
              ))}
            </View>
          )}
            </>
          )}

            </>
          )}

          {settingsTab === 'app' && (
            <>
          <Text allowFontScaling={false} style={[styles.sectionTitle, { marginTop: 15 }]}>Event Types</Text>
          <Text allowFontScaling={false} style={styles.bodyText}>
            What kinds of event you have — Class, Work, Personal. Each carries where its notes are
            filed and what they look like, so tagging an event settles both and no prompt appears
            when you create a note. When PARA-relative filing is enabled, a Project or Area folder
            wins; the Event Type folder remains the fallback.
          </Text>

          {eventTypes.map(type => (
            <View key={type.id} style={styles.typeRow}>
              {/* Same reason as areas: there is no emoji keyboard here, so an
                  icon has to be chosen rather than typed. */}
              <TouchableOpacity
                style={styles.typeIconBtn}
                onPress={() => setIconPickerTypeId(iconPickerTypeId === type.id ? null : type.id)}
              >
                <Text allowFontScaling={false} style={styles.typeIconText}>
                  {type.icon || '·'}
                </Text>
              </TouchableOpacity>
              <HandwritingTextInput
                style={[styles.textInput, styles.typeNameInput]}
                value={type.name}
                onChangeText={text => handleUpdateEventType({ ...type, name: text })}
                autoCorrect={false}
              />
              <TouchableOpacity
                style={styles.typeFolderBtn}
                onPress={() => handleChooseTypeFolder(type)}
              >
                <Text allowFontScaling={false} style={styles.typeBtnText} numberOfLines={1}>
                  {type.folder ? type.folder.split('/').pop() : 'Folder…'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.typeFolderBtn}
                onPress={() => setTypeTemplatePicker(type)}
              >
                <Text allowFontScaling={false} style={styles.typeBtnText} numberOfLines={1}>
                  {type.template ? templateLabel(type.template) : 'Template…'}
                </Text>
              </TouchableOpacity>
              {/* Cycles through the areas, wrapping through none. A text
                  button rather than a glyph: an unverified symbol rendered as
                  tofu here once already. */}
              <TouchableOpacity
                style={styles.typeFolderBtn}
                onPress={() => {
                  const ids: Array<string | undefined> = [...areas.map(a => a.id), undefined];
                  const at = ids.indexOf(type.defaultAreaId);
                  handleUpdateEventType({ ...type, defaultAreaId: ids[(at + 1) % ids.length] });
                }}
              >
                <Text allowFontScaling={false} style={styles.typeBtnText} numberOfLines={1}>
                  {areas.find(a => a.id === type.defaultAreaId)?.name || 'Area…'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.deleteTypeBtn}
                onPress={() => handleDeleteEventType(type.id)}
              >
                <Text allowFontScaling={false} style={styles.typeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}

          {iconPickerTypeId !== null && (
            <View style={styles.iconRow}>
              {ICON_CHOICES.map(icon => (
                <TouchableOpacity
                  key={icon}
                  style={styles.iconChoice}
                  onPress={() => {
                    const type = eventTypes.find(t => t.id === iconPickerTypeId);
                    if (type) handleUpdateEventType({ ...type, icon });
                    setIconPickerTypeId(null);
                  }}
                >
                  <Text allowFontScaling={false} style={styles.iconChoiceText}>
                    {icon}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.iconChoice}
                onPress={() => {
                  const type = eventTypes.find(t => t.id === iconPickerTypeId);
                  if (type) handleUpdateEventType({ ...type, icon: '' });
                  setIconPickerTypeId(null);
                }}
              >
                <Text allowFontScaling={false} style={styles.iconChoiceText}>
                  ✕
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={[styles.timeRow, { maxWidth: 660 }]}>
            <HandwritingTextInput
              ref={newTypeInputRef}
              style={[styles.textInput, styles.typeNameInput]}
              value={newTypeName}
              onChangeText={setNewTypeName}
              placeholder="New event type"
              placeholderTextColor="#707070"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={styles.nudgeBtn}
              onPress={() => {
                const name = (newTypeInputRef.current?.getValue() ?? newTypeName).trim();
                if (!name) return;
                handleCreateEventType(name);
                setNewTypeName('');
              }}
            >
              <Text allowFontScaling={false} style={styles.nudgeText}>Add</Text>
            </TouchableOpacity>
          </View>

          <Text allowFontScaling={false} style={[styles.sectionTitle, { marginTop: 15 }]}>Calendar Week Layout</Text>
          <Text allowFontScaling={false} style={styles.bodyText}>
            Week View shows five or seven consecutive days beginning on the selected weekday.
            The same starting day is used by Month View, Weekly Review, and date pickers.
          </Text>
          <Text allowFontScaling={false} style={styles.fieldLabel}>Week begins on</Text>
          <View style={styles.weekOptionRow}>
            {(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const).map((label, index) => (
              <TouchableOpacity
                key={label}
                style={[styles.weekOption, weekStartsOn === index && styles.weekOptionActive]}
                onPress={() => {
                  const next = index as 0 | 1 | 2 | 3 | 4 | 5 | 6;
                  setWeekStartsOn(next);
                  calendarStorage.updateSettings({ weekStartsOn: next });
                }}
              >
                <Text allowFontScaling={false} style={[styles.weekOptionText, weekStartsOn === index && styles.weekOptionTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text allowFontScaling={false} style={styles.fieldLabel}>Calendar Week View</Text>
          <View style={styles.weekOptionRow}>
            {([5, 7] as const).map(length => (
              <TouchableOpacity
                key={length}
                style={[styles.weekLengthOption, calendarWeekLength === length && styles.weekOptionActive]}
                onPress={() => {
                  setCalendarWeekLength(length);
                  calendarStorage.updateSettings({ calendarWeekLength: length });
                }}
              >
                <Text allowFontScaling={false} style={[styles.weekOptionText, calendarWeekLength === length && styles.weekOptionTextActive]}>
                  {length} days
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text allowFontScaling={false} style={[styles.sectionTitle, { marginTop: 15 }]}>Day View Schedule Hours</Text>
          <Text allowFontScaling={false} style={styles.bodyText}>
            Which hours the Day View draws. Anything outside is still shown, pulled to the nearest
            edge — a longer day makes a taller page rather than a squashed one.
          </Text>

          <View style={styles.timeRow}>
            <Text allowFontScaling={false} style={styles.fieldLabel}>Start</Text>
            <TouchableOpacity style={styles.nudgeBtn} onPress={() => shiftScheduleHour('start', -1)}>
              <Text allowFontScaling={false} style={styles.nudgeText}>−</Text>
            </TouchableOpacity>
            <Text allowFontScaling={false} style={styles.hourValue}>{hourLabel(scheduleStartHour)}</Text>
            <TouchableOpacity style={styles.nudgeBtn} onPress={() => shiftScheduleHour('start', 1)}>
              <Text allowFontScaling={false} style={styles.nudgeText}>+</Text>
            </TouchableOpacity>

            <Text allowFontScaling={false} style={[styles.fieldLabel, { marginLeft: 16 }]}>End</Text>
            <TouchableOpacity style={styles.nudgeBtn} onPress={() => shiftScheduleHour('end', -1)}>
              <Text allowFontScaling={false} style={styles.nudgeText}>−</Text>
            </TouchableOpacity>
            <Text allowFontScaling={false} style={styles.hourValue}>{hourLabel(scheduleEndHour)}</Text>
            <TouchableOpacity style={styles.nudgeBtn} onPress={() => shiftScheduleHour('end', 1)}>
              <Text allowFontScaling={false} style={styles.nudgeText}>+</Text>
            </TouchableOpacity>
          </View>

          <Text allowFontScaling={false} style={[styles.sectionTitle, { marginTop: 15 }]}>Opening View</Text>
          <View style={styles.providerGrid}>
            {(['month', 'agenda'] as CalendarViewMode[]).map(mode => (
              <TouchableOpacity
                key={mode}
                style={[styles.providerBtn, defaultView === mode && styles.providerBtnActive]}
                onPress={() => {
                  setDefaultView(mode);
                  calendarStorage.updateSettings({ defaultViewMode: mode });
                }}
              >
                <Text allowFontScaling={false} style={[styles.providerBtnText, defaultView === mode && styles.providerBtnTextActive]}>
                  {mode === 'month' ? '📅 Month Grid' : '📋 Day View'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text allowFontScaling={false} style={[styles.sectionTitle, { marginTop: 15 }]}>Tasks</Text>
          <TouchableOpacity
            style={styles.checkSettingRow}
            onPress={() => {
              const next = !pushTasksAsEvents;
              setPushTasksAsEvents(next);
              calendarStorage.updateSettings({ pushTasksAsEvents: next });
            }}
          >
            <Text allowFontScaling={false} style={styles.checkSettingBox}>{pushTasksAsEvents ? '☑' : '☐'}</Text>
            <View style={styles.checkSettingBody}>
              <Text allowFontScaling={false} style={styles.checkSettingLabel}>Push tasks to my calendar as events</Text>
              <Text allowFontScaling={false} style={styles.checkSettingHint}>
                This is the simplest way to make dated Supernote tasks visible on Apple devices.
                It creates calendar events with an alert at the task's due time, not Apple
                Reminders. Date-only tasks alert at 9:00 AM; completed tasks get a ✓ in the title;
                undated tasks cannot be mirrored onto a day.
              </Text>
            </View>
          </TouchableOpacity>

            </>
          )}

          {settingsTab === 'help' && (
            <>
          <Text allowFontScaling={false} style={[styles.sectionTitle, { marginTop: 15 }]}>Start Here</Text>
          <View style={styles.hintBox}>
            <Text allowFontScaling={false} style={styles.hintTitle}>1. Choose only what you need</Text>
            <Text allowFontScaling={false} style={styles.hintText}>
              Local only: create events, tasks, notes, and PARA folders without connecting an
              account. Google: import its Secret address in iCal format for a read-only schedule.
              Apple or another CalDAV provider: connect it under Calendars &amp; Sync for editable,
              two-way calendar events.
            </Text>

            <Text allowFontScaling={false} style={styles.hintTitle}>2. Set up notes when you are ready</Text>
            <Text allowFontScaling={false} style={styles.hintText}>
              The defaults work immediately. Notes &amp; Storage lets you choose different folders,
              templates, and a daily-note filename. When browsing for a folder, select any file
              inside it; once the Supernote picker opens, it selects files rather than folders.
            </Text>

            <Text allowFontScaling={false} style={styles.hintTitle}>3. Add PARA gradually</Text>
            <Text allowFontScaling={false} style={styles.hintText}>
              Projects have a finish line. Areas are ongoing responsibilities. Resources are
              reference folders. Archive holds inactive items. You do not need to create all four
              before using SNFolio.
            </Text>
          </View>

          <Text allowFontScaling={false} style={[styles.sectionTitle, { marginTop: 15 }]}>Calendar Connection Guide</Text>
          <View style={styles.hintBox}>
            <Text allowFontScaling={false} style={styles.hintTitle}>Google Calendar</Text>
            <Text allowFontScaling={false} style={styles.hintText}>
              Use Google Calendar's Secret address in iCal format under Add a Calendar. It is a
              subscription: Google events can be viewed but not edited or deleted from SNFolio.
              To avoid typing the long address, put it in a .txt file on your computer, transfer
              that file to Supernote, then use Import Setup or Calendar File.
            </Text>

            <Text allowFontScaling={false} style={styles.hintTitle}>Apple iCloud Calendar</Text>
            <Text allowFontScaling={false} style={styles.hintText}>
              Use your Apple Account email and an app-specific password under Calendars &amp; Sync.
              This provides two-way calendar events. It does not place SNFolio tasks in modern
              Apple Reminders; keep tasks local or mirror dated tasks as calendar events.
            </Text>

            <Text allowFontScaling={false} style={styles.hintTitle}>What the terms mean</Text>
            <Text allowFontScaling={false} style={styles.hintText}>
              ICS/iCal feed = read-only calendar subscription. CalDAV = an account connection that
              can read and write. VTODO = the CalDAV task format, supported only by some services.
            </Text>
          </View>

          <Text allowFontScaling={false} style={[styles.sectionTitle, { marginTop: 15 }]}>Adding Items by Handwriting</Text>
          <View style={styles.hintBox}>
            <Text allowFontScaling={false} style={styles.hintTitle}>Write it on one line</Text>
            <Text allowFontScaling={false} style={styles.hintText}>
              Lasso your writing, then tap Add to Calendar. Keep the date, time and title on a
              single line:
            </Text>
            <Text allowFontScaling={false} style={styles.hintExample}>08-20-2026 10:00A Meeting B</Text>
            <Text allowFontScaling={false} style={styles.hintText}>
              Splitting them across lines confuses the handwriting recogniser and it misreads
              times. With no date or time, the item becomes an undated task.
            </Text>
          </View>

          <Text allowFontScaling={false} style={[styles.sectionTitle, { marginTop: 15 }]}>If Something Does Not Appear</Text>
          <View style={styles.hintBox}>
            <Text allowFontScaling={false} style={styles.hintText}>
              Tap Sync Now and read the source-by-source result. A Google feed must use the Secret
              iCal address, not a normal calendar web page. For folder contents, select a file
              inside the intended folder and then tap Refresh Files. Run the CalDAV diagnostic
              below only when an editable account will not connect or sync.
            </Text>
          </View>

          {diagLogs.length > 0 && (
            <View style={styles.diagLogBox}>
              <TouchableOpacity onPress={() => setShowDiagLogs(!showDiagLogs)}>
                <Text allowFontScaling={false} style={styles.diagLogTitle}>
                  {showDiagLogs ? '▾' : '▸'} CalDAV Diagnostic Trace Log ({diagLogs.length} lines) —
                  tap to {showDiagLogs ? 'hide' : 'show'}
                </Text>
              </TouchableOpacity>
              {showDiagLogs &&
                diagLogs.map((logLine, idx) => (
                  <Text allowFontScaling={false} key={idx} style={styles.diagLogLine}>
                    {logLine}
                  </Text>
                ))}
            </View>
          )}

            </>
          )}

        </ScrollView>
      ) : (
        <View style={styles.mainContent}>
          {/* Touch Navigation Bar */}
          {/* Equal-weight side groups so the date sits optically centred.
              Previously Prev on the left and Today+Next on the right were
              different widths, pushing the heading off-centre. */}
          <View style={styles.dateNavRow}>
            <View style={styles.dateNavSide}>
              <TouchableOpacity style={styles.navBtn} onPress={handlePrevDay}>
                <Text allowFontScaling={false} style={styles.navBtnText}>
                  {(viewMode === 'agenda' && plannerMode === 'week') || (viewMode === 'month' && calendarMode === 'week') ? '‹ Week' : '‹ Prev'}
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.dateNavCenter} onPress={handleOpenDatePicker}>
              <Text allowFontScaling={false} style={styles.todayBtnText}>{dateHeading} ▾</Text>
            </TouchableOpacity>

            <View style={[styles.dateNavSide, styles.dateNavSideRight]}>
              <TouchableOpacity style={styles.jumpTodayHeaderBtn} onPress={handleToday}>
                <Text allowFontScaling={false} style={styles.jumpTodayHeaderBtnText}>🎯 Today</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.navBtn} onPress={handleNextDay}>
                <Text allowFontScaling={false} style={styles.navBtnText}>
                  {(viewMode === 'agenda' && plannerMode === 'week') || (viewMode === 'month' && calendarMode === 'week') ? 'Week ›' : 'Next ›'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Recurring Deletion Modal */}
          <Modal visible={showDeleteModal} transparent animationType="fade">
            <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowDeleteModal(false)}>
              <View style={styles.actionSheetContentCompact}>
                <Text allowFontScaling={false} style={styles.actionSheetTitle}>Delete Recurring Event</Text>
                <Text allowFontScaling={false} style={styles.bodyTextCenter}>"{pendingDeleteEvent?.summary}"</Text>

                <TouchableOpacity style={styles.deleteOptionBtn} onPress={() => void handleDeleteSingleOccurrence()}>
                  <Text allowFontScaling={false} style={styles.deleteOptionBtnText}>
                    🗑️ Delete This Occurrence Only ({selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.deleteOptionBtnDanger} onPress={() => void handleDeleteEntireSeries()}>
                  <Text allowFontScaling={false} style={styles.deleteOptionBtnTextDanger}>🗑️ Delete Entire Recurring Series</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowDeleteModal(false)}>
                  <Text allowFontScaling={false} style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </Modal>

          {/* Date Long-Press Action Sheet (Compact Half-Width: 52%) */}
          <Modal visible={showDateActionSheet} transparent animationType="fade">
            <TouchableOpacity
              style={styles.modalOverlay}
              activeOpacity={1}
              onPress={() => setShowDateActionSheet(false)}
            >
              <View style={styles.actionSheetContentCompact}>
                <Text allowFontScaling={false} style={styles.actionSheetTitle}>
                  Create Item for {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </Text>

                <TouchableOpacity
                  style={styles.actionSheetBtn}
                  onPress={() => {
                    setShowDateActionSheet(false);
                    const blankEvt: CalendarEvent = {
                      uid: `blank-${Date.now()}`,
                      summary: 'Notes',
                      start: selectedDate,
                      end: new Date(selectedDate.getTime() + 60 * 60 * 1000),
                      allDay: false,
                      attendees: [],
                    };
                    handleRequestNoteCreation(blankEvt);
                  }}
                >
                  <Text allowFontScaling={false} style={styles.actionSheetBtnText}>📝 Create Blank Note</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionSheetBtn}
                  onPress={() => {
                    setShowDateActionSheet(false);
                    setEditingEvent(null);
                    setLassoDraftTitle('');
                    setLassoDraftParsed(null);
                    setCreationType('event');
                    setShowItemCreationModal(true);
                  }}
                >
                  <Text allowFontScaling={false} style={styles.actionSheetBtnText}>📅 Add Event</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionSheetBtn}
                  onPress={() => {
                    setShowDateActionSheet(false);
                    setEditingEvent(null);
                    setLassoDraftTitle('');
                    setLassoDraftParsed(null);
                    setCreationType('task');
                    setShowItemCreationModal(true);
                  }}
                >
                  <Text allowFontScaling={false} style={styles.actionSheetBtnText}>☑️ Add Task</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </Modal>

          {/* Quick Date Picker Overlay Modal */}
          <DatePickerModal
            visible={showDatePickerModal}
            value={selectedDate}
            weekStartsOn={weekStartsOn}
            onSelect={setSelectedDate}
            onClose={() => setShowDatePickerModal(false)}
          />


          {/* Item Creation Modal (Events & Tasks) */}
          <EventDetailsModal
            event={detailEvent}
            readOnly={detailEvent ? !eventIsEditable(detailEvent) : true}
            onClose={() => setDetailEvent(null)}
            onEdit={handleBeginEditEvent}
            onDelete={event => {
              setDetailEvent(null);
              void handleDeleteItem(event);
            }}
            onCopy={event => void handleCopyFeedEvent(event)}
            onHide={handleHideFeedEvent}
            notePath={detailEvent ? eventNotePaths[detailEvent.uid] : undefined}
            onNoteAction={(event, existingPath) => {
              setDetailEvent(null);
              if (existingPath) void handleOpenExistingNote(existingPath);
              else handleRequestNoteCreation(event);
            }}
          />

          <ItemCreationModal
            visible={showItemCreationModal}
            type={creationType}
            targetDate={lassoDraftDate ?? selectedDate}
            weekStartsOn={weekStartsOn}
            initialTitle={lassoDraftTitle}
            initialParsed={lassoDraftParsed}
            editingEvent={editingEvent}
            availableFeeds={calendarStorage.getSettings().feeds}
            onClose={() => {
              setShowItemCreationModal(false);
              setLassoDraftTitle('');
              setLassoDraftParsed(null);
              setLassoDraftDate(null);
              setEditingEvent(null);
              setEditingTask(null);
              setPendingProjectId(undefined);
            }}
            onCreateEvent={handleCreateNewEvent}
            eventTypes={eventTypes}
            eventTypeId={
              editingEvent ? calendarStorage.getEventType(noteIdentity(editingEvent)) : undefined
            }
            eventProjectId={
              editingEvent
                ? calendarStorage.getMembership(noteIdentity(editingEvent)).projectId
                : undefined
            }
            eventAreaId={
              editingEvent
                ? calendarStorage.getMembership(noteIdentity(editingEvent)).areaId
                : undefined
            }
            onCreateTask={handleCreateNewTask}
            editingTask={editingTask}
            taskNotePath={editingTask ? calendarStorage.getMapping(editingTask.uid)?.notePath : undefined}
            onLinkTaskNote={task => { void handleLinkExistingTaskNote(task); }}
            onTaskNoteAction={(task, existingPath) => {
              if (existingPath) {
                setShowItemCreationModal(false);
                void handleOpenExistingNote(existingPath);
              } else {
                handleRequestTaskNote(task);
              }
            }}
            areas={areas}
            taskAreaId={editingTask ? areaOfTask(editingTask.uid) : undefined}
            onCreateArea={handleCreateArea}
            projects={projects}
            taskProjectId={
              editingTask ? projectOfTask(editingTask.uid) : pendingProjectId
            }
            onCreateProject={handleCreateProject}
            onDeleteTask={uid => {
              const task = calendarStorage.getTasks().find(t => t.uid === uid);
              if (task) void handleDeleteTask(task);
            }}
          />

          {/* Month view scrolls as one page: grid plus the task strip below it.
              Previously both competed for a fixed screen height, so shrinking
              the cells only revealed a strip that was still clipped and could
              never show more than a row. */}
          {viewMode === 'month' && calendarMode === 'month' && (
            <ScrollView
              style={styles.monthScroll}
              contentContainerStyle={styles.monthScrollContent}
              keyboardShouldPersistTaps="handled"
            >
            <MonthGridView
              allTasks={tasks}
              weekStartsOn={weekStartsOn}
              currentDate={selectedDate}
              selectedDate={selectedDate}
              dailyNoteDates={dailyNoteDates}
              noteKindByEvent={noteKindByEvent}
              allEvents={filterEvents(allParsedEvents, {
                ...calendarStorage.getSettings(),
                hideAllDayEvents: hideAllDay,
                hideSoloEvents: hideSolo,
              })}
              onSelectDate={handleSelectDate}
              onOpenActionSheet={d => {
                setSelectedDate(d);
                setShowDateActionSheet(true);
              }}
            />

            {/* The two task pools a date grid structurally cannot show: undated
                tasks have no cell to sit in, and overdue ones are stranded on a
                past date nobody is looking at. Without this they are invisible
                unless you happen to be on today's Day View. */}
            <View style={styles.gridStrip}>
              {([
                ['Today', todayTaskSections.dueToday, false],
                ['Upcoming', todayTaskSections.upcoming, true],
                ['No Date', todayTaskSections.noDate, false],
                ['Past Due', todayTaskSections.pastDue, true],
              ] as Array<[string, CalendarTask[], boolean]>).map(([label, items, showDate]) => (
                <View key={label} style={styles.gridStripCol}>
                  <Text allowFontScaling={false} style={styles.gridStripLabel}>
                    {label} ({items.length})
                  </Text>

                  {items.length === 0 ? (
                    <Text allowFontScaling={false} style={styles.gridStripEmpty}>—</Text>
                  ) : (
                    <>
                      {items.slice(0, STRIP_TASK_LIMIT).map(task => (
                        <View key={task.uid} style={styles.gridStripRow}>
                          <TouchableOpacity
                            onPress={() => handleToggleTask(task)}
                          >
                            <Text allowFontScaling={false} style={styles.gridStripCheck}>{statusGlyph(taskStatus(task))}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.gridStripBody} onPress={() => handleEditTask(task)}>
                            {/* One string, date first. As a separate element
                                after the body the date floated at the right
                                edge of the column and read as belonging to the
                                next one. */}
                            <Text allowFontScaling={false} style={styles.gridStripText} numberOfLines={1}>
                              {taskRowLabel(task, showDate)}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                      {items.length > STRIP_TASK_LIMIT && (
                        <Text allowFontScaling={false} style={styles.gridStripEmpty}>
                          +{items.length - STRIP_TASK_LIMIT} more
                        </Text>
                      )}
                    </>
                  )}
                </View>
              ))}
            </View>
            </ScrollView>
          )}

          {viewMode === 'month' && calendarMode === 'week' && (
            <CalendarWeekView
              selectedDate={selectedDate}
              weekStartsOn={weekStartsOn}
              dayCount={calendarWeekLength}
              events={filterEvents(allParsedEvents, {
                ...calendarStorage.getSettings(),
                hideAllDayEvents: hideAllDay,
                hideSoloEvents: hideSolo,
              })}
              tasks={tasks}
              onOpenDay={date => {
                setSelectedDate(date);
                setPlannerMode('day');
                setViewMode('agenda');
              }}
              onOpenEvent={handleOpenEventDetails}
              onToggleTask={handleToggleTask}
              onEditTask={handleEditTask}
              taskContextLabel={taskContextTagFor}
              weeklyNoteExists={Boolean(weeklyNoteExists)}
              onOpenWeeklyNote={() => void handleOpenWeeklyNote()}
            />
          )}

          {viewMode === 'para' && openProject && (
            <ProjectDetailView
              project={openProject}
              area={areas.find(a => a.id === openProject.areaId)}
              areas={areas}
              tasks={tasks}
              projectOf={projectOfTask}
              linkedNotes={linkedNotesForProject(openProject)}
              onBack={() => setOpenProject(null)}
              onSetDue={() => setProjectDueTarget(openProject)}
              onAssignArea={areaId => handleAssignProjectArea(openProject.id, areaId)}
              onCreateArea={handleCreateArea}
              onRename={(name, shortLabel) => {
                handleRenameProject(openProject.id, name, shortLabel);
                setOpenProject({ ...openProject, name, shortLabel });
              }}
              onToggleStatus={() => {
                const next = openProject.status === 'active' ? 'done' : 'active';
                handleSetProjectStatus(openProject.id, next);
                setOpenProject({ ...openProject, status: next });
              }}
              onArchive={() => handleArchiveProject(openProject)}
              onConvertToArea={() => handleConvertProjectToArea(openProject)}
              onDelete={() => {
                handleDeleteProject(openProject.id);
                // Nothing left to show, so fall back to the list.
                setOpenProject(null);
              }}
              folder={paraFolder('project', openProject)}
              onListEntries={folder => handleListParaEntries('project', openProject, folder)}
              onNewNote={(name, folder) => handleNewParaNote('project', openProject, name, folder)}
              onChooseFolder={folder => handleChooseParaFolder('project', openProject, folder)}
              onOpenFile={path => void handleOpenResourceFile(path)}
              onOpenNote={path => void handleOpenExistingNote(path)}
              onAddTask={() => {
                setEditingTask(null);
                setEditingEvent(null);
                setLassoDraftTitle('');
                setLassoDraftParsed(null);
                setCreationType('task');
                setPendingProjectId(openProject.id);
                setShowItemCreationModal(true);
              }}
              onToggleTask={handleToggleTask}
              onEditTask={handleEditTask}
            />
          )}

          {viewMode === 'para' && !openProject && (
            <ParaView
              initialAreaId={paraFocusAreaId}
              onInitialAreaShown={() => setParaFocusAreaId(null)}
              areas={areas}
              projects={projects}
              resources={resources}
              tasks={tasks}
              events={paraUpcomingEvents}
              projectOf={projectOfTask}
              projectOfEvent={event => calendarStorage.getMembership(noteIdentity(event)).projectId}
              areaOfEvent={event => resolveAreaId(
                calendarStorage.getMembership(noteIdentity(event)),
                calendarStorage.getProjects(),
                calendarStorage.getEventTypes()
              )}
              areaOf={areaOfTask}
              onNewProject={(name, areaId) => handleCreateProject(name, areaId)}
              onNewArea={name => handleCreateArea(name)}
              onNewResource={name => handleCreateResource(name)}
              onRenameArea={handleRenameArea}
              onDeleteArea={handleDeleteArea}
              onArchiveArea={handleArchiveArea}
              onRestoreArea={handleRestoreArea}
              areaTaskCount={countTasksInArea}
              onOpenProject={setOpenProject}
              onSetProjectDue={project => setProjectDueTarget(project)}
              onArchiveProject={handleArchiveProject}
              onRestoreProject={handleRestoreProject}
              onBrowseFiles={(kind, item) => void handleBrowseParaFiles(kind, item)}
              folderFor={paraFolder}
              onListEntries={handleListParaEntries}
              onOpenFile={path => void handleOpenResourceFile(path)}
              onNewNote={handleNewParaNote}
              onChooseFolder={handleChooseParaFolder}
              onUpdateResource={resource => {
                calendarStorage.upsertResource(resource);
                setResources([...calendarStorage.getResources()]);
              }}
              onArchiveResource={handleArchiveResource}
              onRestoreResource={handleRestoreResource}
              onToggleTask={handleToggleTask}
              onEditTask={handleEditTask}
              onEditEvent={handleOpenEventDetails}
              onAddTaskToProject={project => {
                // Opens the task form already filed under this project, so
                // adding from inside a project does not mean re-selecting it.
                setEditingTask(null);
                setEditingEvent(null);
                setLassoDraftTitle('');
                setLassoDraftParsed(null);
                setCreationType('task');
                setPendingProjectId(project.id);
                setShowItemCreationModal(true);
              }}
              onMoveProject={handleMoveProject}
            />
          )}

          {/* ── Day View: planner layout ─────────────────────────────
              Two framed panels side by side on a Manta; stacked on a Nomad,
              where 1404px cannot carry two columns without wrapping badly. */}
          {viewMode === 'agenda' && plannerMode === 'day' && (
            <ScrollView style={styles.agendaViewList} keyboardShouldPersistTaps="handled">
              {/* Weekday strip for jumping within the current week. */}
              <View style={styles.weekStrip}>
                {weekDays.map((d, offset) => {
                  const isSel = offset === 0;
                  const isToday = isSameCalendarDay(d, new Date());
                  // Marks measured from today, not from the selected day.
                  const milestone = offset === 7 ? '1 week' : offset === 14 ? '2 weeks' : null;
                  return (
                    <TouchableOpacity
                      key={d.toISOString()}
                      style={[styles.weekDayCell, isSel && styles.weekDayCellActive]}
                      onPress={() => setSelectedDate(d)}
                    >
                      <Text allowFontScaling={false} style={[styles.weekDayLetter, isSel && styles.weekDayTextActive]}>
                        {DAY_LETTERS[d.getDay()]}
                      </Text>
                      <Text allowFontScaling={false} style={[styles.weekDayNum, isSel && styles.weekDayTextActive]}>
                        {isToday ? `(${d.getDate()})` : d.getDate()}
                      </Text>
                      {milestone ? (
                        <Text allowFontScaling={false} style={[styles.weekDayMilestone, isSel && styles.weekDayTextActive]}>
                          {milestone}
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={isWideScreen ? styles.planeRow : styles.planeStack}>
                {/* ── SCHEDULE ─────────────────────────────────────────── */}
                <View style={[styles.panel, isWideScreen && styles.panelHalf]}>
                  <View style={styles.panelHeader}>
                    <Text allowFontScaling={false} style={styles.panelHeaderText}>
                      📅 SCHEDULE ({events.length})
                    </Text>
                    <TouchableOpacity
                      onPress={() => {
                        setEditingEvent(null);
                        setLassoDraftTitle('');
                        setLassoDraftParsed(null);
                        setLassoDraftDate(null);
                        setCreationType('event');
                        setShowItemCreationModal(true);
                      }}
                    >
                      <Text allowFontScaling={false} style={styles.panelHeaderAction}>+ Event</Text>
                    </TouchableOpacity>
                  </View>

                  <DayScheduleGrid
                    events={events}
                    startHour={scheduleStartHour}
                    endHour={scheduleEndHour}
                    notePaths={eventNotePaths}
                    onEditEvent={handleOpenEventDetails}
                    onNoteAction={(evt, existingPath) => {
                      if (existingPath) handleOpenExistingNote(existingPath);
                      else handleRequestNoteCreation(evt);
                    }}
                    onDeleteEvent={handleDeleteItem}
                    typeLabel={evt => {
                      const id = calendarStorage.getEventType(noteIdentity(evt));
                      const type = eventTypes.find(t => t.id === id);
                      return type ? `${type.icon ? `${type.icon} ` : ''}${type.name}` : '';
                    }}
                  />
                </View>

                {/* ── DAY FOCUS & TASKS ────────────────────────────────── */}
                <View style={[styles.panel, isWideScreen && styles.panelHalf]}>
                  <View style={styles.panelHeader}>
                    <Text allowFontScaling={false} style={styles.panelHeaderText}>❤️ FOCUS &amp; DAILY JOURNAL</Text>
                  </View>

                  {/* The journal is a card rather than a button: it is the
                      first thing on this side of the page, so it should read
                      as a place rather than an action. */}
                  <View style={styles.journalCard}>
                    <Text allowFontScaling={false} style={styles.journalTitle}>
                      📝 Daily Journal:{' '}
                      {selectedDate.toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </Text>
                    <TouchableOpacity style={styles.journalBtn} onPress={handleOpenDailyNote}>
                      <Text allowFontScaling={false} style={styles.journalBtnText}>
                        {dailyNoteExists === false ? '📂 Create' : '📂 Open'} This Day's Journal Note
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.subHeader}>
                    <Text allowFontScaling={false} style={styles.subHeaderText}>★ FOCUS FOR THIS DAY</Text>
                    <Text allowFontScaling={false} style={styles.subHeaderMeta}>Top priorities</Text>
                  </View>
                  {focusTasks.length === 0 ? (
                    <Text allowFontScaling={false} style={styles.panelEmpty}>No open tasks.</Text>
                  ) : (
                    <View style={isWideScreen ? styles.focusPriorityRow : styles.focusPriorityStack}>
                      {focusTasks.map((task, index) => {
                        const contextTag = taskContextTagFor(task.uid);
                        return (
                          <TouchableOpacity key={task.uid} style={styles.focusPriorityItem} onPress={() => handleEditTask(task)}>
                            <Text allowFontScaling={false} style={styles.focusPriorityNumber}>{index + 1}{contextTag ? ` · ${contextTag}` : ''}</Text>
                            <Text allowFontScaling={false} style={styles.focusPriorityTitle} numberOfLines={2}>{task.title}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}

                  <View style={styles.subHeader}>
                    <Text allowFontScaling={false} style={styles.subHeaderText}>
                      ☑ TASKS &amp; DELIVERABLES ({countOpenTasks(daySections)})
                    </Text>
                    <TouchableOpacity
                      onPress={() => {
                        setEditingEvent(null);
                        setLassoDraftTitle('');
                        setLassoDraftParsed(null);
                        setLassoDraftDate(null);
                        setCreationType('task');
                        setShowItemCreationModal(true);
                      }}
                    >
                      <Text allowFontScaling={false} style={styles.panelHeaderAction}>+ Add Task</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Upcoming is counted here but deliberately not in
                      countOpenTasks: the header badge means "needs attention
                      now", while the empty state must not claim there is
                      nothing when a section below it has rows. */}
                  {countOpenTasks(daySections) === 0 &&
                  daySections.completed.length === 0 &&
                  daySections.upcoming.length === 0 ? (
                    <Text allowFontScaling={false} style={styles.panelEmpty}>Nothing to do.</Text>
                  ) : (
                    ([
                      // Same labels and order as the month-grid strip, so the
                      // two task surfaces read as one system.
                      ['Today', daySections.dueToday, false],
                      ['Upcoming', daySections.upcoming, true],
                      ['No Date', daySections.noDate, false],
                      ['Past Due', daySections.pastDue, true],
                      ['Completed', daySections.completed, false],
                    ] as Array<[string, CalendarTask[], boolean]>).map(([label, items, showDate]) =>
                      items.length === 0 ? null : (
                        <View key={label || 'due'}>
                          {label ? <Text allowFontScaling={false} style={styles.taskGroupLabel}>{label}</Text> : null}
                          {items.map(task => {
                            const contextTag = taskContextTagFor(task.uid);
                            return (
                              <View key={task.uid} style={styles.focusTaskRow}>
                                <TouchableOpacity
                                  onPress={() => handleToggleTask(task)}
                                >
                                  <Text allowFontScaling={false} style={styles.focusCheck}>{statusGlyph(taskStatus(task))}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.focusTaskBody} onPress={() => handleEditTask(task)}>
                                  <Text allowFontScaling={false}
                                    style={[styles.focusTaskText, task.completed && styles.focusTaskDone]}
                                    numberOfLines={1}
                                  >
                                    {taskRowLabel(task, showDate, contextTag)}
                                  </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                  style={styles.focusTaskDelete}
                                  onPress={() => handleDeleteTask(task)}
                                >
                                  <Text allowFontScaling={false} style={styles.focusTaskDeleteText}>✕</Text>
                                </TouchableOpacity>
                              </View>
                            );
                          })}
                        </View>
                      )
                    )
                  )}

                  <View style={styles.subHeader}>
                    <Text allowFontScaling={false} style={styles.subHeaderText}>🚀 PROJECTS NEEDING ATTENTION</Text>
                  </View>

                  {attentionProjects.length === 0 ? (
                    <Text allowFontScaling={false} style={styles.panelEmpty}>No projects need attention.</Text>
                  ) : (
                    attentionProjects.map(project => {
                      const progress = projectProgress(tasks, project.id, {
                        projectOf: projectOfTask,
                        nameOf: () => project.name,
                      });
                      return (
                        <TouchableOpacity
                          key={project.id}
                          style={styles.dayProjectRow}
                          onPress={() => setViewMode('para')}
                        >
                          <Text allowFontScaling={false} style={styles.dayProjectName} numberOfLines={1}>
                            {project.name}
                          </Text>
                          <Text allowFontScaling={false} style={styles.dayProjectMeta}>
                            {blockBar(progress.percent)} {progress.done}/{progress.total} tasks
                          </Text>
                        </TouchableOpacity>
                      );
                    })
                  )}

                  {/* A calendar preview and direct route to tomorrow. Tasks are
                      already named and actionable in the section above. */}
                  <View style={styles.subHeader}>
                    <Text allowFontScaling={false} style={styles.subHeaderText}>🔮 TOMORROW'S SCHEDULE</Text>
                  </View>
                  <TouchableOpacity style={styles.lookaheadRow} onPress={handleNextDay}>
                    <Text allowFontScaling={false} style={styles.lookaheadText} numberOfLines={2}>
                      {lookaheadSummary}
                    </Text>
                    <Text allowFontScaling={false} style={styles.lookaheadAction}>View ›</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          )}

          {viewMode === 'agenda' && plannerMode === 'week' && (
            <WeeklyReviewView
              selectedDate={selectedDate}
              weekStartsOn={weekStartsOn}
              tasks={tasks}
              projects={projects}
              projectOf={projectOfTask}
              journalDates={weekJournalDates}
              weeklyNoteExists={weeklyNoteExists}
              onOpenWeeklyNote={() => void handleOpenWeeklyNote()}
              onEditTask={handleEditTask}
              onOpenProject={project => {
                setOpenProject(project);
                setViewMode('para');
              }}
              onOpenJournal={date => void handleOpenDailyNoteForDate(date)}
            />
          )}


        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#ffffff',
    padding: 10,
  },
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: '#000000',
    marginBottom: 10,
  },
  titleWithSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  appTitle: {
    color: '#000000',
    fontSize: 20,
    fontWeight: 'bold',
  },
  viewSwitcherBar: {
    flexDirection: 'row',
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    overflow: 'hidden',
  },
  switcherBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#ffffff',
    minHeight: 44,
    justifyContent: 'center',
  },
  switcherBtnActive: {
    backgroundColor: '#000000',
  },
  switcherBtnText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000000',
  },
  switcherBtnTextActive: {
    color: '#ffffff',
  },
  headerBtnGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  appMenuBtn: {
    width: 48,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    backgroundColor: '#ffffff',
  },
  appMenuBtnText: { color: '#000000', fontSize: 20, fontWeight: 'bold' },
  syncNowBtn: {
    backgroundColor: '#000000',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  syncNowBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  settingsBtn: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  settingsBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: 'bold',
  },
  closePluginBtn: {
    backgroundColor: '#000000',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  closePluginBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  statusBanner: {
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    padding: 10,
    marginBottom: 10,
  },
  statusText: {
    color: '#000000',
    fontSize: 13,
  },
  mainContent: {
    flex: 1,
  },
  dateNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  // Equal flex on both sides is what actually centres the heading; the
  // buttons inside them differ in width.
  dateNavSide: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateNavSideRight: {
    justifyContent: 'flex-end',
  },
  dateNavCenter: {
    flexShrink: 0,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  navBtn: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  navBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: 'bold',
  },
  todayBtn: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  todayBtnText: {
    color: '#000000',
    fontSize: 17,
    fontWeight: 'bold',
  },
  jumpTodayHeaderBtn: {
    marginRight: 10,
    backgroundColor: '#000000',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  jumpTodayHeaderBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  agendaViewList: {
    flex: 1,
  },
  eventsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#d0d0d0',
    paddingBottom: 6,
    marginBottom: 8,
  },
  eventsHeaderTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#000000',
  },
  dayViewHeaderGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  backMonthBtn: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#ffffff',
  },
  backMonthBtnText: {
    color: '#000000',
    fontWeight: 'bold',
    fontSize: 12,
  },
  addSmallBtn: {
    backgroundColor: '#000000',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  addSmallBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  emptyState: {
    padding: 24,
    alignItems: 'center',
  },
  emptyStateText: {
    color: '#505050',
    fontSize: 15,
    fontStyle: 'italic',
    textAlign: 'center',
    marginBottom: 12,
  },
  emptyTodayBtn: {
    backgroundColor: '#000000',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 6,
  },
  emptyTodayBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  eventCard: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    backgroundColor: '#ffffff',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timeBadge: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#000000',
  },
  createdBadge: {
    fontSize: 11,
    fontWeight: 'bold',
    backgroundColor: '#000000',
    color: '#ffffff',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  recurringTag: {
    fontSize: 11,
    fontWeight: 'bold',
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  eventTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 4,
  },
  eventLocation: {
    fontSize: 13,
    color: '#202020',
    marginBottom: 4,
  },
  attendeeSummary: {
    fontSize: 13,
    color: '#303030',
    marginBottom: 6,
  },
  eventDescSnippet: {
    fontSize: 12,
    color: '#505050',
    fontStyle: 'italic',
    marginBottom: 10,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 6,
  },
  iconBtn: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    justifyContent: 'center',
    backgroundColor: '#f8f8f8',
  },
  iconBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: 'bold',
  },
  exportDropdownBtn: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
  },
  exportDropdownBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: 'bold',
  },
  createNoteBtn: {
    backgroundColor: '#000000',
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  createNoteBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  openNoteBtn: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  openNoteBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: 'bold',
  },
  exportFormatMenu: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 6,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  exportFormatOption: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  exportFormatText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#000000',
  },
  settingsContainer: {
    flex: 1,
    paddingVertical: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 8,
  },
  bodyText: {
    fontSize: 14,
    color: '#202020',
    marginBottom: 6,
  },
  bodyTextCenter: {
    fontSize: 14,
    color: '#202020',
    marginBottom: 12,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  providerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  syncColumns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  syncColumnsStacked: {
    flexDirection: 'column',
  },
  syncColumn: {
    flex: 1,
    marginBottom: 8,
  },
  syncColumnLeft: {
    marginRight: 18,
  },
  providerBtn: {
    alignSelf: 'flex-start',
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginRight: 8,
    marginBottom: 6,
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  providerBtnActive: {
    backgroundColor: '#000000',
  },
  providerBtnText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#000000',
  },
  providerBtnTextActive: {
    color: '#ffffff',
  },
  connectCaldavBtn: {
    backgroundColor: '#000000',
    borderRadius: 6,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  connectCaldavBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  caldavActiveBadge: {
    backgroundColor: '#e6ffe6',
    borderWidth: 1,
    borderColor: '#008000',
    borderRadius: 6,
    padding: 8,
    marginBottom: 14,
  },
  syncedTaskCleanupBox: {
    borderWidth: 1,
    borderColor: '#707070',
    borderRadius: 6,
    padding: 8,
    marginBottom: 10,
    backgroundColor: '#f5f5f5',
  },
  cleanupWarningText: {
    color: '#202020',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  taskSection: {
    marginBottom: 10,
  },
  taskSectionLabel: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#303030',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#303030',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 6,
    backgroundColor: '#ffffff',
  },
  taskCheckbox: {
    paddingRight: 10,
    paddingVertical: 2,
  },
  taskCheckboxText: {
    fontSize: 22,
    color: '#000000',
  },
  taskBody: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 15,
    color: '#000000',
  },
  taskTitleDone: {
    textDecorationLine: 'line-through',
    color: '#606060',
  },
  taskMeta: {
    fontSize: 11,
    color: '#505050',
    marginTop: 2,
  },
  taskDeleteBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  taskDeleteBtnText: {
    fontSize: 16,
    color: '#404040',
  },
  fieldLabel: { fontSize: 12, fontWeight: 'bold', color: '#303030', marginTop: 8, marginBottom: 4 },
  notesSettingsStack: { flex: 1 },
  paraRootsSection: { marginTop: 7 },
  dailyFormatColumns: { flexDirection: 'row', alignItems: 'stretch', marginBottom: 6 },
  dailyFormatColumn: { flex: 1, minWidth: 0, marginRight: 8 },
  compactHelp: { fontSize: 12, lineHeight: 15, color: '#303030', marginBottom: 5 },
  compactInput: { paddingVertical: 4, fontSize: 13 },
  dailyPreview: { flex: 1, marginTop: 0, padding: 6 },
  compactSectionTitle: { marginTop: 5, marginBottom: 4 },
  compactNoteRow: {
    minHeight: 45,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#b0b0b0',
    paddingVertical: 4,
  },
  compactNoteLabel: { width: 58, fontSize: 13, fontWeight: 'bold', color: '#000000' },
  compactChoice: { width: 138, borderWidth: 1, borderColor: '#000000', borderRadius: 4, paddingVertical: 7, paddingHorizontal: 7, marginRight: 6 },
  compactChoiceText: { fontSize: 12, fontWeight: 'bold', color: '#000000' },
  compactPathInput: { minWidth: 80, paddingVertical: 3, paddingHorizontal: 6, fontSize: 11, marginRight: 6 },
  compactBrowse: { borderWidth: 1, borderColor: '#000000', borderRadius: 4, paddingVertical: 7, paddingHorizontal: 9, marginRight: 5 },
  compactBrowseText: { fontSize: 11, fontWeight: 'bold', color: '#000000' },
  paraNoteRoutingCard: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    padding: 10,
    marginTop: 10,
  },
  paraNoteRoutingHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  paraNoteRoutingCopy: { flex: 1, marginRight: 12 },
  paraNoteRoutingTitle: { fontSize: 14, lineHeight: 18, fontWeight: 'bold', color: '#000000' },
  paraNoteRoutingSummary: { fontSize: 11, lineHeight: 15, color: '#303030', marginTop: 2 },
  noteLocationPolicyRow: { flexDirection: 'row', marginVertical: 6 },
  noteLocationPolicy: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingVertical: 7,
    paddingHorizontal: 8,
    marginRight: 6,
    alignItems: 'center',
  },
  noteLocationPolicySelected: { backgroundColor: '#000000' },
  noteLocationPolicyText: { fontSize: 12, fontWeight: 'bold', color: '#000000' },
  noteLocationPolicyTextSelected: { color: '#ffffff' },
  advancedLayoutButton: { alignSelf: 'flex-start', paddingVertical: 6, paddingRight: 10 },
  advancedLayoutButtonText: { fontSize: 11, fontWeight: 'bold', color: '#000000' },
  relativePathRow: { flexDirection: 'row', marginTop: 4 },
  relativePathField: { flex: 1, minWidth: 0, marginRight: 8 },
  relativePathLabel: { width: 'auto', marginBottom: 3 },
  paraRootGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  paraRootCard: { width: '49%', borderWidth: 1, borderColor: '#707070', borderRadius: 5, padding: 7, marginBottom: 7, minHeight: 105 },
  paraRootCardWide: { width: '24%' },
  paraRootLabel: { fontSize: 13, fontWeight: 'bold', color: '#000000', textTransform: 'capitalize' },
  paraRootPath: { minHeight: 30, fontSize: 10, lineHeight: 13, fontFamily: 'monospace', color: '#303030', marginVertical: 4 },
  paraRootActions: { flexDirection: 'row', flexWrap: 'wrap' },
  formatPresetRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  formatPreset: { borderWidth: 1, borderColor: '#000000', borderRadius: 4, paddingVertical: 4, paddingHorizontal: 8, marginRight: 6, marginBottom: 6 },
  formatPresetActive: { backgroundColor: '#000000' },
  formatPresetText: { fontSize: 11, fontFamily: 'monospace', color: '#000000' },
  formatPresetTextActive: { color: '#ffffff' },
  weekOptionRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6, marginBottom: 6 },
  weekOption: {
    minWidth: 58,
    minHeight: 42,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 5,
    marginBottom: 5,
  },
  weekLengthOption: {
    minWidth: 110,
    minHeight: 42,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 7,
  },
  weekOptionActive: { backgroundColor: '#000000' },
  weekOptionText: { fontSize: 13, fontWeight: 'bold', color: '#000000' },
  weekOptionTextActive: { color: '#ffffff' },
  previewBox: { alignSelf: 'flex-start', maxWidth: 560, borderWidth: 2, borderColor: '#000000', borderRadius: 6, padding: 8, marginTop: 4, backgroundColor: '#f5f5f5' },
  previewLabel: { fontSize: 11, fontWeight: 'bold', color: '#303030' },
  previewPath: { fontSize: 12, fontFamily: 'monospace', color: '#000000', marginVertical: 3 },
  previewHint: { fontSize: 10, color: '#505050' },
  previewWarn: { fontSize: 11, fontWeight: 'bold', color: '#000000', marginBottom: 3 },
  bodyStrong: { fontWeight: 'bold' },
  settingsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 2, borderColor: '#000000', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 6, backgroundColor: '#ffffff' },
  settingsHeaderTitle: { fontSize: 14, fontWeight: 'bold', color: '#000000' },
  settingsHeaderClose: { fontSize: 13, fontWeight: 'bold', color: '#000000' },
  settingsTabRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 },
  settingsTab: { borderWidth: 2, borderColor: '#000000', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12, marginRight: 6, marginBottom: 6, backgroundColor: '#ffffff' },
  settingsTabActive: { backgroundColor: '#000000' },
  settingsTabText: { fontSize: 12, fontWeight: 'bold', color: '#000000' },
  settingsTabTextActive: { color: '#ffffff' },
  weekStrip: { flexDirection: 'row', marginBottom: 8 },
  weekDayCell: { flex: 1, alignItems: 'center', paddingVertical: 3, borderWidth: 1, borderColor: '#000000', borderRadius: 3, marginHorizontal: 1, backgroundColor: '#ffffff' },
  weekDayCellActive: { backgroundColor: '#000000' },
  weekDayLetter: { fontSize: 9, fontWeight: 'bold', color: '#000000' },
  weekDayNum: { fontSize: 12, color: '#000000' },
  weekDayMilestone: { fontSize: 7, color: '#404040' },
  weekDayTextActive: { color: '#ffffff' },
  planeRow: { flexDirection: 'row' },
  planeStack: { flexDirection: 'column' },
  panel: { borderWidth: 2, borderColor: '#000000', borderRadius: 6, backgroundColor: '#ffffff', marginBottom: 10, marginHorizontal: 3 },
  panelHalf: { flex: 1 },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: '#000000', paddingHorizontal: 10, paddingVertical: 8 },
  panelHeaderText: { fontSize: 13, fontWeight: 'bold', color: '#000000' },
  panelHeaderAction: { fontSize: 13, fontWeight: 'bold', color: '#000000' },
  panelEmpty: { fontSize: 12, color: '#606060', padding: 10 },
  allDayRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#000000' },
  allDayTag: { fontSize: 11, fontWeight: 'bold', color: '#000000', marginRight: 8 },
  allDayTitle: { flex: 1, fontSize: 14, color: '#000000' },
  scheduleInlineAction: { marginTop: 4 },
  scheduleInlineActionText: { fontSize: 12, fontWeight: 'bold', color: '#000000' },
  scheduleEndTime: { fontSize: 13, color: '#404040' },
  journalCard: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 6,
    padding: 8,
    margin: 8,
    backgroundColor: '#ffffff',
  },
  journalTitle: { fontSize: 12, fontWeight: 'bold', color: '#000000', marginBottom: 6 },
  journalBtn: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingVertical: 7,
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  journalBtnText: { fontSize: 12, fontWeight: 'bold', color: '#000000' },
  dayProjectRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  dayProjectName: { flex: 1, fontSize: 12, fontWeight: 'bold', color: '#000000' },
  dayProjectMeta: { fontSize: 11, color: '#303030', marginLeft: 8 },
  timeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  // Constrained rather than full width: a name and two short buttons do not
  // need the whole page, and a row that wide is harder to scan than a narrow one.
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    maxWidth: 660,
  },
  typeIconBtn: {
    width: 46,
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingVertical: 6,
    marginRight: 4,
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  typeIconText: { fontSize: 16, color: '#000000' },
  iconRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8, maxWidth: 660 },
  iconChoice: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginRight: 5,
    marginBottom: 5,
    backgroundColor: '#ffffff',
  },
  iconChoiceText: { fontSize: 18, color: '#000000' },
  typeNameInput: { width: 150, marginRight: 4 },
  typeFolderBtn: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginRight: 4,
    maxWidth: 120,
    backgroundColor: '#ffffff',
  },
  deleteTypeBtn: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: '#ffffff',
  },
  typeBtnText: { fontSize: 11, fontWeight: 'bold', color: '#000000' },
  nudgeBtn: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginHorizontal: 3,
    backgroundColor: '#ffffff',
  },
  nudgeText: { fontSize: 14, fontWeight: 'bold', color: '#000000' },
  hourValue: { fontSize: 13, fontWeight: 'bold', color: '#000000', width: 58, textAlign: 'center' },
  lookaheadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  lookaheadText: { flex: 1, fontSize: 15, color: '#000000', marginRight: 12 },
  lookaheadAction: { fontSize: 13, fontWeight: 'bold', color: '#000000' },
  subHeaderMeta: { fontSize: 12, color: '#303030' },
  focusPriorityRow: { flexDirection: 'row' },
  focusPriorityStack: { flexDirection: 'column' },
  focusPriorityItem: {
    flex: 1,
    minHeight: 72,
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#000000',
  },
  focusPriorityNumber: { fontSize: 12, fontWeight: 'bold', color: '#303030' },
  focusPriorityTitle: { fontSize: 14, fontWeight: 'bold', color: '#000000', marginTop: 5 },
  focusSummary: { fontSize: 13, fontWeight: 'bold', color: '#000000', padding: 10 },
  subHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#000000', paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#f2f2f2' },
  subHeaderText: { fontSize: 12, fontWeight: 'bold', color: '#000000' },
  taskGroupLabel: { fontSize: 11, fontWeight: 'bold', color: '#303030', paddingHorizontal: 10, paddingTop: 6 },
  focusTaskRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4 },
  focusCheck: { fontSize: 17, color: '#000000', marginRight: 8 },
  focusTaskBody: { flex: 1 },
  focusTaskDelete: { paddingHorizontal: 6, paddingVertical: 2 },
  focusTaskDeleteText: { fontSize: 13, color: '#606060' },
  focusTaskText: { fontSize: 13, color: '#000000' },
  focusTaskDone: { textDecorationLine: 'line-through', color: '#606060' },
  dailyNoteBtn: { alignSelf: 'flex-start', margin: 10, paddingHorizontal: 16, borderWidth: 2, borderColor: '#000000', borderRadius: 6, paddingVertical: 10, alignItems: 'center' },
  dailyNoteBtnText: { fontSize: 13, fontWeight: 'bold', color: '#000000' },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: 1,
    borderColor: '#303030',
    borderRadius: 6,
    marginBottom: 6,
    backgroundColor: '#ffffff',
  },
  // A fixed-width time gutter is what makes a list read as a schedule.
  scheduleGutter: {
    // Wide enough for "12:00 AM" on one line at the sizes below.
    width: 96,
    borderRightWidth: 1,
    borderRightColor: '#303030',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    backgroundColor: '#f2f2f2',
  },
  scheduleTime: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000000',
  },
  scheduleBody: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  scheduleTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#000000',
  },
  scheduleMeta: {
    fontSize: 11,
    color: '#505050',
    marginTop: 2,
  },
  scheduleNoteBtn: {
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderLeftWidth: 1,
    borderLeftColor: '#303030',
  },
  scheduleNoteBtnText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#000000',
  },
  monthScroll: {
    flex: 1,
  },
  monthScrollContent: {
    paddingBottom: 12,
  },
  gridStrip: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    marginTop: 8,
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    padding: 8,
    backgroundColor: '#ffffff',
  },
  gridStripCol: {
    flex: 1,
    paddingHorizontal: 4,
  },
  gridStripLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  gridStripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
  },
  gridStripCheck: {
    fontSize: 16,
    color: '#000000',
    marginRight: 6,
  },
  gridStripBody: {
    flex: 1,
  },
  gridStripText: {
    fontSize: 12,
    color: '#000000',
  },
  gridStripDate: {
    fontSize: 10,
    color: '#505050',
    marginLeft: 6,
  },
  gridStripEmpty: {
    fontSize: 11,
    color: '#707070',
  },
  checkSettingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    alignSelf: 'flex-start',
    maxWidth: 560,
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
    backgroundColor: '#ffffff',
  },
  checkSettingBox: {
    fontSize: 20,
    color: '#000000',
    marginRight: 8,
  },
  checkSettingBody: {
    flex: 1,
  },
  checkSettingLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 2,
  },
  checkSettingHint: {
    fontSize: 12,
    color: '#404040',
  },
  dayGridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    marginBottom: 8,
  },
  dayPickCell: {
    width: '13.5%',
    aspectRatio: 1,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    margin: '0.5%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  dayPickCellActive: {
    backgroundColor: '#000000',
  },
  dayPickText: {
    fontSize: 14,
    color: '#000000',
  },
  dayPickTextActive: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  pickerBackBtn: {
    paddingVertical: 6,
    marginBottom: 6,
  },
  pickerBackBtnText: {
    fontSize: 13,
    color: '#101010',
  },
  hidden: {
    display: 'none',
  },
  hintBox: {
    alignSelf: 'flex-start',
    maxWidth: 560,
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    backgroundColor: '#f5f5f5',
    padding: 10,
    marginBottom: 8,
  },
  hintTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 4,
  },
  hintText: {
    fontSize: 13,
    color: '#202020',
    marginBottom: 4,
  },
  hintExample: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#000000',
    marginBottom: 6,
  },
  caldavTargetText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#101010',
    marginTop: 3,
  },
  caldavActiveBadgeText: {
    color: '#006000',
    fontWeight: 'bold',
    fontSize: 13,
    textAlign: 'center',
  },
  pickerOpenBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#000000',
    borderRadius: 6,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  pickerOpenBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  filterToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  importBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  importFileBtn: {
    flex: 1,
    backgroundColor: '#000000',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  importFileBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  inputRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  textInput: {
    maxWidth: 560,
    flex: 1,
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: '#000000',
    fontSize: 14,
    marginRight: 8,
  },
  compactTextInput: {
    paddingVertical: 3,
    fontSize: 13,
  },
  addBtn: {
    backgroundColor: '#000000',
    borderRadius: 6,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  addBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  connectedFeedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#606060',
    borderRadius: 6,
    paddingVertical: 6,
    paddingLeft: 9,
    paddingRight: 6,
    marginBottom: 6,
    backgroundColor: '#ffffff',
  },
  connectedFeedDetails: {
    flex: 1,
    marginRight: 8,
  },
  connectedFeedName: {
    color: '#000000',
    fontSize: 13,
    fontWeight: 'bold',
  },
  connectedFeedKind: {
    color: '#505050',
    fontSize: 11,
  },
  removeFeedBtn: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 5,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#ffffff',
  },
  removeFeedBtnText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: 'bold',
  },
  codePath: {
    maxWidth: 560,
    fontFamily: 'monospace',
    backgroundColor: '#e8e8e8',
    padding: 6,
    borderRadius: 4,
    marginBottom: 6,
    color: '#000000',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  actionSheetContentCompact: {
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 8,
    padding: 16,
    width: '48%',
    maxWidth: 420,
  },
  archiveMoveModal: {
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 8,
    padding: 16,
    width: '62%',
    maxWidth: 560,
  },
  archivePathLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#505050',
    marginTop: 6,
    marginBottom: 2,
  },
  archiveLocationBtn: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingVertical: 9,
    paddingHorizontal: 10,
    marginTop: 6,
    backgroundColor: '#ffffff',
  },
  archiveLocationBtnText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#000000',
    textAlign: 'center',
  },
  archiveLocationHint: {
    fontSize: 10,
    color: '#505050',
    marginTop: 4,
    textAlign: 'center',
  },
  archiveWarning: {
    borderWidth: 2,
    borderColor: '#000000',
    backgroundColor: '#eeeeee',
    borderRadius: 6,
    padding: 10,
    marginVertical: 10,
  },
  archiveWarningText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: 'bold',
    color: '#000000',
  },
  archiveErrorBox: {
    borderWidth: 2,
    borderColor: '#000000',
    backgroundColor: '#ffffff',
    padding: 8,
    marginBottom: 10,
  },
  archiveErrorText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: 'bold',
    color: '#000000',
  },
  disabledBtn: {
    opacity: 0.45,
  },
  loadingBanner: { borderWidth: 1, borderColor: '#000000', backgroundColor: '#eeeeee', marginHorizontal: 8, marginBottom: 6, paddingVertical: 9, alignItems: 'center' },
  loadingBannerText: { fontSize: 13, fontWeight: 'bold', color: '#000000' },
  actionSheetTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 8,
    textAlign: 'center',
  },
  actionSheetBtn: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 8,
    backgroundColor: '#ffffff',
  },
  actionSheetBtnText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#000000',
  },
  deleteOptionBtn: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    marginBottom: 8,
    backgroundColor: '#ffffff',
  },
  deleteOptionBtnText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#000000',
  },
  deleteOptionBtnDanger: {
    backgroundColor: '#000000',
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    marginBottom: 8,
  },
  deleteOptionBtnTextDanger: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  cancelBtn: {
    borderWidth: 1,
    borderColor: '#707070',
    borderRadius: 6,
    paddingVertical: 8,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#505050',
  },
  pickerModalContent: {
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 8,
    padding: 16,
    width: '90%',
  },
  pickerModalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 12,
    textAlign: 'center',
  },
  yearPickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  yearBtn: {
    borderWidth: 2,
    borderColor: '#000000',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  yearBtnText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000000',
  },
  currentYearText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000000',
  },
  monthGridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 14,
  },
  monthCell: {
    width: '22%',
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  monthCellActive: {
    backgroundColor: '#000000',
  },
  monthCellText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000000',
  },
  monthCellTextActive: {
    color: '#ffffff',
  },
  pickerTodayBtn: {
    backgroundColor: '#000000',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  pickerTodayBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  diagRunBtn: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 10,
    backgroundColor: '#ffffff',
  },
  diagRunBtnText: {
    color: '#000000',
    fontWeight: 'bold',
    fontSize: 13,
  },
  // Room to lift the last settings field above the on-screen keyboard.
  settingsContent: {
    paddingBottom: 260,
  },
  settingsContentCompact: {
    paddingBottom: 8,
  },
  templateScroll: {
    maxHeight: 360,
    marginBottom: 8,
  },
  templateColumns: {
    flexDirection: 'row',
  },
  templateCol: {
    flex: 1,
    paddingRight: 8,
  },
  // Half-width: the full path rarely needs reading in full, and two columns
  // only fit if the field stops claiming the whole row.
  folderInput: {
    fontSize: 12,
  },
  templateBlock: {
    borderTopWidth: 1,
    borderTopColor: '#c0c0c0',
    paddingTop: 4,
  },
  templateOptionRow: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
    backgroundColor: '#ffffff',
  },
  templateOptionRowActive: {
    backgroundColor: '#000000',
  },
  templateOptionText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000000',
  },
  templateOptionTextActive: {
    color: '#ffffff',
  },
  diagLogBox: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    padding: 10,
    backgroundColor: '#f5f5f5',
    marginBottom: 12,
  },
  diagLogTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 6,
  },
  diagLogLine: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#101010',
    marginBottom: 2,
  },
});
