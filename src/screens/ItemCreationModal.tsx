import React, { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Area,
  CalendarEvent,
  CalendarFeed,
  CalendarTask,
  EventType,
  Project,
  TaskPriority,
  TaskStatus,
} from '../domain/types';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  priorityLabel,
  statusGlyph,
  statusLabel,
  taskStatus,
} from '../domain/taskModel';
import { areaIsDerived } from '../domain/membership';
import { DatePickerModal } from './DatePickerModal';
import { TimePickerModal } from './TimePickerModal';
import { HandwritingTextInput, HandwritingTextInputHandle } from './HandwritingTextInput';
import {
  TimeRange,
  formatDuration,
  formatTimeOfDay,
  minutesFromDate,
  normaliseRange,
  withTimeOfDay,
} from '../domain/timeOfDay';
import {
  RepeatChoice,
  RepeatEndMode,
  RepeatSettings,
  WEEKDAY_OPTIONS,
  repeatSettingsFromRrule,
  rruleForRepeat,
} from '../domain/recurrence';

interface ItemCreationModalProps {
  visible: boolean;
  type: 'event' | 'task';
  targetDate: Date;
  weekStartsOn?: number;
  availableFeeds: CalendarFeed[];
  /**
   * Text captured from a lasso selection. Prefills the title so the user can
   * correct it before saving — OCR is fallible and must never be committed
   * silently.
   */
  initialTitle?: string;
  /** Date/time parsed from a lasso capture; seeds the time controls. */
  initialParsed?: {
    hours?: number;
    minutes?: number;
    allDay: boolean;
    /** Raw recognised text, so a bad OCR read is visible before saving. */
    sourceText?: string;
    interpretation?: string;
    hasDate?: boolean;
    ambiguousDateOrder?: boolean;
  } | null;
  /**
   * When set, the modal edits this item instead of creating one. Its uid is
   * preserved so the CalDAV PUT overwrites the same .ics rather than creating
   * a second copy on the server.
   */
  editingEvent?: CalendarEvent | null;
  onClose: () => void;
  onCreateEvent: (
    event: CalendarEvent,
    targetFeedId: string,
    typeId?: string,
    projectId?: string,
    areaId?: string
  ) => void;
  /** dueDate omitted means a genuinely undated task, not one dated today. */
  onCreateTask: (task: {
    uid?: string;
    title: string;
    dueDate?: Date;
    allDay?: boolean;
    notes?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    areaId?: string;
    projectId?: string;
  }) => void;
  /**
   * The task being edited, when one is. Passed whole rather than as separate
   * status/priority props so the pickers cannot open showing stale defaults
   * while the real values sit elsewhere.
   */
  editingTask?: CalendarTask | null;
  /** Linked handwritten note for this task, if one exists. */
  taskNotePath?: string;
  onLinkTaskNote?: (task: CalendarTask) => void;
  onTaskNoteAction?: (task: CalendarTask, existingPath?: string) => void;
  /** Only offered while editing an existing item, never while creating one. */
  onDeleteTask?: (uid: string) => void;
  /** PARA areas to choose from, and the one this task is filed under. */
  areas?: Area[];
  taskAreaId?: string;
  onCreateArea?: (name: string) => string;
  /** Active projects to file this task under, and its current one. */
  projects?: Project[];
  taskProjectId?: string;
  onCreateProject?: (name: string) => string;
  /** Event types to tag this event with, and its current one. */
  eventTypes?: EventType[];
  eventTypeId?: string;
  eventProjectId?: string;
  eventAreaId?: string;
}


export function ItemCreationModal({
  visible,
  type,
  targetDate,
  weekStartsOn = 0,
  availableFeeds,
  initialTitle,
  initialParsed,
  editingEvent,
  onClose,
  onCreateEvent,
  onCreateTask,
  onDeleteTask,
  editingTask,
  taskNotePath,
  onTaskNoteAction,
  onLinkTaskNote,
  areas = [],
  taskAreaId,
  onCreateArea,
  projects = [],
  taskProjectId,
  onCreateProject,
  eventTypes = [],
  eventTypeId,
  eventProjectId,
  eventAreaId,
}: ItemCreationModalProps): React.JSX.Element {
  const [title, setTitle] = useState<string>('');
  const titleInputRef = useRef<HandwritingTextInputHandle>(null);

  // The caller's `type` is only the starting point — the user picks Event or
  // Task in the modal, which decides whether it becomes a calendar event or
  // a to-do in the task list.
  const [itemKind, setItemKind] = useState<'event' | 'task'>(type);
  const [location, setLocation] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const locationInputRef = useRef<HandwritingTextInputHandle>(null);
  const descriptionInputRef = useRef<HandwritingTextInputHandle>(null);
  const [isAllDay, setIsAllDay] = useState<boolean>(type === 'task');
  const [timeRange, setTimeRange] = useState<TimeRange>({ start: 9 * 60, end: 10 * 60 });
  const [timePickerTarget, setTimePickerTarget] = useState<'start' | 'end' | null>(null);

  const applyRange = (range: TimeRange) => {
    setTimeRange(normaliseRange(range));
  };

  const selectStartTime = (start: number) => {
    const duration = Math.max(15, timeRange.end - timeRange.start);
    applyRange({ start, end: Math.min(23 * 60 + 59, start + duration) });
  };

  const selectDuration = (duration: number) => {
    applyRange({ start: timeRange.start, end: Math.min(23 * 60 + 59, timeRange.start + duration) });
  };

  // The date is editable here rather than inherited from the calendar
  // selection — a lasso can happen on any page with no idea what day the grid
  // is sitting on, and editing an item must be able to move it.
  const [itemDate, setItemDate] = useState<Date>(targetDate);
  // Tasks may have no date at all; events always have one.
  const [noDueDate, setNoDueDate] = useState<boolean>(false);
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false);
  /**
   * Whether this form is editing or creating a task. Derived from the task
   * itself when there is one: itemKind is set by an effect, so gating on it
   * alone meant the task controls could be absent on the first render.
   */
  const isTaskForm = Boolean(editingTask) || itemKind === 'task';

  const [taskStatusValue, setTaskStatusValue] = useState<TaskStatus>('todo');
  const [taskPriorityValue, setTaskPriorityValue] = useState<TaskPriority>(1);
  const [areaValue, setAreaValue] = useState<string | undefined>(undefined);
  const [newAreaName, setNewAreaName] = useState<string>('');
  const newAreaInputRef = useRef<HandwritingTextInputHandle>(null);
  const [addingArea, setAddingArea] = useState<boolean>(false);
  const [projectValue, setProjectValue] = useState<string | undefined>(undefined);
  // A chosen project decides the area; the form shows the answer rather than
  // asking a question whose reply would be discarded.
  const derivedArea = areaIsDerived({ projectId: projectValue }, projects);
  const derivedAreaName =
    areas.find(a => a.id === projects.find(p => p.id === projectValue)?.areaId)?.name ||
    'No area';
  const [newProjectName, setNewProjectName] = useState<string>('');
  const newProjectInputRef = useRef<HandwritingTextInputHandle>(null);
  const [addingProject, setAddingProject] = useState<boolean>(false);
  const [typeValue, setTypeValue] = useState<string | undefined>(undefined);
  const [repeatSettings, setRepeatSettings] = useState<RepeatSettings>(() =>
    repeatSettingsFromRrule(undefined, targetDate)
  );
  const [repeatRuleTouched, setRepeatRuleTouched] = useState<boolean>(false);
  const [showRepeatUntilPicker, setShowRepeatUntilPicker] = useState<boolean>(false);

  const updateRepeat = (change: Partial<RepeatSettings>) => {
    setRepeatRuleTouched(true);
    setRepeatSettings(current => ({ ...current, ...change }));
  };

  // Reseed every time the modal opens: with the edited item's values, or with
  // freshly captured lasso text, so a second open never shows stale state.
  useEffect(() => {
    if (!visible) return;

    if (editingEvent) {
      const isEditingTask = editingEvent.isTask === true || /^\[TASK\]\s*/i.test(editingEvent.summary);
      setTitle(editingEvent.summary.replace(/^\[TASK\]\s*/i, ''));
      setItemKind(isEditingTask ? 'task' : 'event');
      setLocation(editingEvent.location || '');
      setDescription(editingEvent.description || '');
      setIsAllDay(editingEvent.allDay);
      setItemDate(new Date(editingEvent.start));

      const start = new Date(editingEvent.start);
      const seeded = normaliseRange({
        start: minutesFromDate(start),
        end: minutesFromDate(new Date(editingEvent.end)),
      });
      setTimeRange(seeded);
      setNoDueDate(false);
      setTaskStatusValue(editingTask ? taskStatus(editingTask) : 'todo');
      setTaskPriorityValue(editingTask?.priority || 1);
      setAreaValue(isEditingTask ? taskAreaId : eventAreaId);
      setAddingArea(false);
      setNewAreaName('');
      setProjectValue(taskProjectId ?? eventProjectId);
      setTypeValue(eventTypeId);
      setRepeatSettings(repeatSettingsFromRrule(editingEvent.rrule, start));
      setRepeatRuleTouched(false);
      setShowRepeatUntilPicker(false);
      setAddingProject(false);
      setNewProjectName('');
      return;
    }

    setTitle(initialTitle || '');
    setItemKind(type);
    setTaskStatusValue('todo');
    setTaskPriorityValue(1);
    setAreaValue(undefined);
    setAddingArea(false);
    setNewAreaName('');
    setProjectValue(undefined);
    setTypeValue(eventTypeId);
    setRepeatSettings(repeatSettingsFromRrule(undefined, targetDate));
    setRepeatRuleTouched(false);
    setShowRepeatUntilPicker(false);
    setAddingProject(false);
    setNewProjectName('');
    setTimeRange({ start: 9 * 60, end: 10 * 60 });
    setLocation('');
    setDescription('');
    setItemDate(targetDate);
    // A lasso capture with no recognised date opens as an undated task.
    setNoDueDate(type === 'task' && !initialParsed?.hasDate && Boolean(initialParsed));

    // A lasso capture may already carry a time; seed the controls from it so
    // the user only has to confirm rather than re-enter what they wrote.
    if (initialParsed && !initialParsed.allDay && initialParsed.hours !== undefined) {
      const captured = initialParsed.hours * 60 + (initialParsed.minutes ?? 0);
      const range = normaliseRange({ start: captured, end: captured + 60 });
      setTimeRange(range);
      setIsAllDay(false);
    } else {
      setIsAllDay(initialParsed ? initialParsed.allDay : type === 'task');
    }
  }, [visible, initialTitle, initialParsed, type, editingEvent, targetDate, editingTask, taskAreaId, taskProjectId, eventTypeId, eventProjectId, eventAreaId]);

  const shiftDate = (days: number) => {
    setItemDate(prev => {
      const next = new Date(prev);
      next.setDate(next.getDate() + days);
      return next;
    });
  };

  const cleanFeeds = availableFeeds.length > 0
    ? availableFeeds.filter(f => f.name && !f.id.startsWith('default-sample'))
    : [{ id: 'primary-cal', name: 'Primary Calendar', enabled: true }];

  const [selectedFeedId] = useState<string>(cleanFeeds[0]?.id || 'primary-cal');

  const handleSave = () => {
    const currentTitle = titleInputRef.current?.getValue() ?? title;
    const currentLocation = locationInputRef.current?.getValue() ?? location;
    const currentDescription = descriptionInputRef.current?.getValue() ?? description;
    if (!currentTitle.trim()) return;

    const start = new Date(itemDate);
    if (!isAllDay) {
      start.setHours(Math.floor(timeRange.start / 60), timeRange.start % 60, 0, 0);
    } else {
      start.setHours(0, 0, 0, 0);
    }

    // End comes from its own control now, so any length is expressible.
    const end = isAllDay
      ? (() => {
          // RFC 5545 DATE-valued DTEND is exclusive. Keeping the end on the
          // same date produces a zero-length event once its time is stripped.
          const nextDay = new Date(start);
          nextDay.setDate(nextDay.getDate() + 1);
          return nextDay;
        })()
      : withTimeOfDay(start, timeRange.end);

    if (itemKind === 'event') {
      const newEvt: CalendarEvent = {
        // Reuse the uid when editing so the CalDAV PUT overwrites the same
        // .ics; a fresh uid would leave the original behind as a duplicate.
        uid: editingEvent ? editingEvent.uid : `evt-user-${Date.now()}`,
        summary: currentTitle.trim(),
        location: currentLocation.trim() || undefined,
        description: currentDescription.trim() || undefined,
        start,
        end,
        allDay: isAllDay,
        attendees: editingEvent?.attendees || [],
        organizer: editingEvent?.organizer,
        recurringSeriesId: editingEvent?.recurringSeriesId,
        // Preserve imported rules with advanced clauses (for example the
        // first Monday of each month) until the user actually changes Repeat.
        rrule: editingEvent?.rrule && !repeatRuleTouched
          ? editingEvent.rrule
          : rruleForRepeat(repeatSettings, start, isAllDay),
        exceptionDates: !repeatRuleTouched ? editingEvent?.exceptionDates : undefined,
        recurrenceExceptionInstants: !repeatRuleTouched ? editingEvent?.recurrenceExceptionInstants : undefined,
        timeZone: !repeatRuleTouched ? editingEvent?.timeZone : undefined,
        // The editor displays device-local time. Preserve the imported series
        // zone so the selected instant is converted back to that zone's wall
        // time for future occurrences instead of silently changing semantics.
        recurrenceTimeZone: !repeatRuleTouched ? editingEvent?.recurrenceTimeZone : undefined,
        recurrenceValueType: !repeatRuleTouched ? editingEvent?.recurrenceValueType : undefined,
        recurrenceError: !repeatRuleTouched ? editingEvent?.recurrenceError : undefined,
        caldavUrl: editingEvent?.caldavUrl,
        etag: editingEvent?.etag,
        sourceKind: editingEvent?.sourceKind || 'local',
        calendarName:
          editingEvent?.calendarName ||
          cleanFeeds.find(f => f.id === selectedFeedId)?.name ||
          'Primary Calendar',
      };

      onCreateEvent(
        newEvt,
        selectedFeedId,
        typeValue,
        projectValue,
        derivedArea ? undefined : areaValue
      );
    } else {
      onCreateTask({
        uid: editingEvent?.uid,
        status: taskStatusValue,
        priority: taskPriorityValue,
        // Omitted when a project decides it, so the record never carries a
        // second answer that disagrees with the one actually used.
        areaId: derivedArea ? undefined : areaValue,
        projectId: projectValue,
        title: currentTitle.trim(),
        // Omitted entirely when the user has said it has no due date, so the
        // task lands in No Date rather than being silently dated today.
        dueDate: noDueDate ? undefined : start,
        allDay: isAllDay,
        notes: currentDescription.trim() || undefined,
      });
    }

    setTitle('');
    setLocation('');
    setDescription('');
    onClose();
  };

  const formattedDateStr = itemDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  // Unmount native inputs between openings so Android starts each handwriting
  // composition from the freshly seeded form values.
  if (!visible) return <></>;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
          <View style={styles.modalHeader}>
            {/* The same form both creates and edits, so it has to say which. */}
            <Text allowFontScaling={false} style={styles.modalTitle}>
              {`${editingEvent ? 'Edit' : 'New'} ${itemKind === 'event' ? 'Event' : 'Task'}`}
            </Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text allowFontScaling={false} style={styles.closeBtnText}>✕ Close</Text>
            </TouchableOpacity>
          </View>

          {/* What the handwriting was read as. This lives in the modal, not in
              the screen's status line, because the modal covers that line —
              the check was invisible exactly when it mattered. */}
          {initialParsed?.interpretation ? (
            <View style={styles.captureBox}>
              {initialParsed.sourceText ? (
                <Text allowFontScaling={false} style={styles.captureRead}>read: "{initialParsed.sourceText}"</Text>
              ) : null}
              <Text allowFontScaling={false} style={styles.captureInterp}>→ {initialParsed.interpretation}</Text>
              {initialParsed.ambiguousDateOrder ? (
                <Text allowFontScaling={false} style={styles.captureWarn}>
                  ⚠ Ambiguous date — check the day and month are the right way round.
                </Text>
              ) : null}
            </View>
          ) : null}

          <DatePickerModal
            visible={showDatePicker}
            value={itemDate}
            weekStartsOn={weekStartsOn}
            onSelect={setItemDate}
            onClose={() => setShowDatePicker(false)}
          />

          <DatePickerModal
            visible={showRepeatUntilPicker}
            value={repeatSettings.until || itemDate}
            weekStartsOn={weekStartsOn}
            onSelect={value => updateRepeat({ until: value })}
            onClose={() => setShowRepeatUntilPicker(false)}
          />

          <TimePickerModal
            visible={timePickerTarget !== null}
            title={timePickerTarget === 'end' ? 'Choose exact end time' : itemKind === 'task' ? 'Choose due time' : 'Choose start time'}
            value={timePickerTarget === 'end' ? timeRange.end : timeRange.start}
            onSelect={value => {
              if (timePickerTarget === 'end') applyRange({ start: timeRange.start, end: value });
              else selectStartTime(value);
            }}
            onClose={() => setTimePickerTarget(null)}
          />

          {/* Event vs Task: decides which store the item lands in. */}
          <View style={styles.kindToggleRow}>
            <TouchableOpacity
              style={[styles.kindBtn, itemKind === 'event' && styles.kindBtnActive]}
              onPress={() => setItemKind('event')}
            >
              <Text allowFontScaling={false} style={[styles.kindBtnText, itemKind === 'event' && styles.kindBtnTextActive]}>
                📅 Calendar Event
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.kindBtn, itemKind === 'task' && styles.kindBtnActive]}
              onPress={() => setItemKind('task')}
            >
              <Text allowFontScaling={false} style={[styles.kindBtnText, itemKind === 'task' && styles.kindBtnTextActive]}>
                ✅ Task
              </Text>
            </TouchableOpacity>
          </View>

          {/* keyboardShouldPersistTaps: with an input focused, the first tap
              elsewhere is otherwise consumed dismissing focus, so a duration
              chip needed tapping twice. "handled" still lets a tap on blank
              space close the keyboard. */}
          <ScrollView
            style={styles.formContent}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.formContentInner}
          >
            <Text allowFontScaling={false} style={styles.label}>{itemKind === 'event' ? 'Event Title:' : 'Task Name:'}</Text>
            <HandwritingTextInput
              ref={titleInputRef}
              style={styles.textInput}
              value={title}
              onChangeText={setTitle}
              placeholder={itemKind === 'event' ? 'e.g. Executive Sync' : 'e.g. Submit Lab Report'}
              placeholderTextColor="#707070"
            />

            {/* Date, all-day state and time are one decision. Keeping them in
                one framed block avoids the previous gap where the date lived
                above the kind switch and the time was several fields below. */}
            <View style={styles.whenBox}>
              <Text allowFontScaling={false} style={styles.whenHeading}>When</Text>
              {!(itemKind === 'task' && noDueDate) && (
                <View style={styles.dateRow}>
                  <TouchableOpacity style={styles.dateNavBtn} onPress={() => shiftDate(-1)}>
                    <Text allowFontScaling={false} style={styles.dateNavBtnText}>◀</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.dateDisplay} onPress={() => setShowDatePicker(true)}>
                    <Text allowFontScaling={false} style={styles.dateLabel}>{formattedDateStr} ▾</Text>
                    <Text allowFontScaling={false} style={styles.dateHint}>tap to change</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.dateNavBtn} onPress={() => shiftDate(1)}>
                    <Text allowFontScaling={false} style={styles.dateNavBtnText}>▶</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Compact checkbox toggles. A full-width Switch row read as an
                unrelated setting rather than an on/off for this item. */}
              <View style={styles.checkRow}>
              {itemKind === 'task' && (
                <TouchableOpacity style={styles.checkToggle} onPress={() => setNoDueDate(!noDueDate)}>
                  <Text allowFontScaling={false} style={styles.checkToggleBox}>{noDueDate ? '☑' : '☐'}</Text>
                  <Text allowFontScaling={false} style={styles.checkToggleLabel}>No due date</Text>
                </TouchableOpacity>
              )}

              {!(itemKind === 'task' && noDueDate) && (
                <TouchableOpacity style={styles.checkToggle} onPress={() => setIsAllDay(!isAllDay)}>
                  <Text allowFontScaling={false} style={styles.checkToggleBox}>{isAllDay ? '☑' : '☐'}</Text>
                  <Text allowFontScaling={false} style={styles.checkToggleLabel}>
                    {itemKind === 'task' ? 'No specific time' : 'All day'}
                  </Text>
                </TouchableOpacity>
              )}
              </View>

              {!isAllDay && !(itemKind === 'task' && noDueDate) && (
              <>
                <Text allowFontScaling={false} style={styles.label}>
                  {itemKind === 'event' ? 'Start time:' : 'Due time:'}
                </Text>
                <TouchableOpacity style={styles.timeDisplayButton} onPress={() => setTimePickerTarget('start')}>
                  <Text allowFontScaling={false} style={styles.timeDisplayText}>
                    {formatTimeOfDay(timeRange.start)} ▾
                  </Text>
                  <Text allowFontScaling={false} style={styles.timeDisplayHint}>tap to choose</Text>
                </TouchableOpacity>

                {itemKind === 'event' && (
                  <>
                    <Text allowFontScaling={false} style={styles.label}>Duration:</Text>
                    <View style={styles.chipRow}>
                      {[15, 30, 45, 60, 90, 120].map(duration => {
                        const selected = timeRange.end - timeRange.start === duration;
                        return (
                          <TouchableOpacity
                            key={duration}
                            style={[styles.stateChip, selected && styles.stateChipSelected]}
                            onPress={() => selectDuration(duration)}
                          >
                            <Text allowFontScaling={false} style={[styles.stateChipText, selected && styles.stateChipTextSelected]}>
                              {formatDuration(duration)}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                      <TouchableOpacity style={styles.stateChip} onPress={() => setTimePickerTarget('end')}>
                        <Text allowFontScaling={false} style={styles.stateChipText}>Exact end…</Text>
                      </TouchableOpacity>
                    </View>
                    <Text allowFontScaling={false} style={styles.durationHint}>
                      Ends {formatTimeOfDay(timeRange.end)} · {formatDuration(timeRange.end - timeRange.start)}
                    </Text>
                  </>
                )}
              </>
              )}
            </View>

            {itemKind === 'event' && (
              <>
                <Text allowFontScaling={false} style={styles.label}>Repeat:</Text>
                <View style={styles.chipRow}>
                  {(['none', 'daily', 'weekly', 'monthly', 'yearly'] as RepeatChoice[]).map(choice => (
                    <TouchableOpacity
                      key={choice}
                      style={[styles.stateChip, repeatSettings.choice === choice && styles.stateChipSelected]}
                      onPress={() => updateRepeat({ choice })}
                    >
                      <Text
                        allowFontScaling={false}
                        style={[styles.stateChipText, repeatSettings.choice === choice && styles.stateChipTextSelected]}
                      >
                        {choice === 'none' ? 'Does not repeat' : choice.charAt(0).toUpperCase() + choice.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {repeatSettings.choice !== 'none' && (
                  <View style={styles.recurrenceBox}>
                    <Text allowFontScaling={false} style={styles.label}>Every:</Text>
                    <View style={styles.chipRow}>
                      {[...new Set([1, 2, 3, 4, repeatSettings.interval])].sort((a, b) => a - b).map(interval => (
                        <TouchableOpacity
                          key={interval}
                          style={[styles.stateChip, repeatSettings.interval === interval && styles.stateChipSelected]}
                          onPress={() => updateRepeat({ interval })}
                        >
                          <Text
                            allowFontScaling={false}
                            style={[styles.stateChipText, repeatSettings.interval === interval && styles.stateChipTextSelected]}
                          >
                            {interval} {repeatSettings.choice === 'daily' ? 'day' : repeatSettings.choice === 'weekly' ? 'week' : repeatSettings.choice === 'monthly' ? 'month' : 'year'}{interval === 1 ? '' : 's'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {repeatSettings.choice === 'weekly' && (
                      <>
                        <Text allowFontScaling={false} style={styles.label}>On:</Text>
                        <View style={styles.chipRow}>
                          {WEEKDAY_OPTIONS.map(day => {
                            const selected = repeatSettings.weekDays.includes(day.code);
                            return (
                              <TouchableOpacity
                                key={day.code}
                                style={[styles.stateChip, selected && styles.stateChipSelected]}
                                onPress={() => {
                                  const next = selected
                                    ? repeatSettings.weekDays.filter(code => code !== day.code)
                                    : [...repeatSettings.weekDays, day.code];
                                  if (next.length > 0) updateRepeat({ weekDays: next });
                                }}
                              >
                                <Text
                                  allowFontScaling={false}
                                  style={[styles.stateChipText, selected && styles.stateChipTextSelected]}
                                >
                                  {day.short}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </>
                    )}

                    <Text allowFontScaling={false} style={styles.label}>Ends:</Text>
                    <View style={styles.chipRow}>
                      {(['never', 'until', 'count'] as RepeatEndMode[]).map(endMode => (
                        <TouchableOpacity
                          key={endMode}
                          style={[styles.stateChip, repeatSettings.endMode === endMode && styles.stateChipSelected]}
                          onPress={() => {
                            if (endMode === 'until' && !repeatSettings.until) {
                              const until = new Date(itemDate);
                              until.setMonth(until.getMonth() + 1);
                              updateRepeat({ endMode, until });
                            } else {
                              updateRepeat({ endMode });
                            }
                          }}
                        >
                          <Text
                            allowFontScaling={false}
                            style={[styles.stateChipText, repeatSettings.endMode === endMode && styles.stateChipTextSelected]}
                          >
                            {endMode === 'never' ? 'Never' : endMode === 'until' ? 'On date' : 'After count'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {repeatSettings.endMode === 'until' && (
                      <TouchableOpacity style={styles.timeDisplayButton} onPress={() => setShowRepeatUntilPicker(true)}>
                        <Text allowFontScaling={false} style={styles.timeDisplayText}>
                          {(repeatSettings.until || itemDate).toLocaleDateString('en-US', {
                            month: 'short', day: 'numeric', year: 'numeric',
                          })} ▾
                        </Text>
                        <Text allowFontScaling={false} style={styles.timeDisplayHint}>last possible date</Text>
                      </TouchableOpacity>
                    )}

                    {repeatSettings.endMode === 'count' && (
                      <View style={styles.countRow}>
                        <TouchableOpacity style={styles.stateChip} onPress={() => updateRepeat({ count: Math.max(1, repeatSettings.count - 1) })}>
                          <Text allowFontScaling={false} style={styles.stateChipText}>−</Text>
                        </TouchableOpacity>
                        <Text allowFontScaling={false} style={styles.countValue}>{repeatSettings.count} occurrences</Text>
                        <TouchableOpacity style={styles.stateChip} onPress={() => updateRepeat({ count: repeatSettings.count + 1 })}>
                          <Text allowFontScaling={false} style={styles.stateChipText}>+</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                )}
                {editingEvent?.rrule ? (
                  <Text allowFontScaling={false} style={styles.durationHint}>
                    Editing applies to the entire recurring series.
                  </Text>
                ) : null}
              </>
            )}

            {itemKind === 'event' && (
              <>
                <Text allowFontScaling={false} style={styles.label}>Location / Room (Optional):</Text>
                <HandwritingTextInput
                  ref={locationInputRef}
                  style={styles.textInput}
                  value={location}
                  onChangeText={setLocation}
                  placeholder="e.g. Room 204 or Zoom"
                  placeholderTextColor="#707070"
                />
              </>
            )}

            {isTaskForm && (
              <>
                <Text allowFontScaling={false} style={styles.label}>Status:</Text>
                <View style={styles.chipRow}>
                  {TASK_STATUSES.map(st => (
                    <TouchableOpacity
                      key={st}
                      style={[styles.stateChip, taskStatusValue === st && styles.stateChipSelected]}
                      onPress={() => setTaskStatusValue(st)}
                    >
                      <Text allowFontScaling={false}
                        style={[
                          styles.stateChipText,
                          taskStatusValue === st && styles.stateChipTextSelected,
                        ]}
                      >
                        {statusGlyph(st)} {statusLabel(st)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text allowFontScaling={false} style={styles.label}>Area:</Text>

                {/* A project owns its items' area, so offering a choice here
                    would be offering one that gets ignored. Shown, not asked. */}
                {derivedArea ? (
                  <Text allowFontScaling={false} style={styles.derivedArea}>
                    {derivedAreaName} — from project
                  </Text>
                ) : (
                <View style={styles.chipRow}>
                  <TouchableOpacity
                    style={[styles.stateChip, !areaValue && styles.stateChipSelected]}
                    onPress={() => setAreaValue(undefined)}
                  >
                    <Text allowFontScaling={false} style={[styles.stateChipText, !areaValue && styles.stateChipTextSelected]}>
                      None
                    </Text>
                  </TouchableOpacity>

                  {areas
                    .filter(a => !a.archived)
                    .map(a => (
                      <TouchableOpacity
                        key={a.id}
                        style={[styles.stateChip, areaValue === a.id && styles.stateChipSelected]}
                        onPress={() => setAreaValue(a.id)}
                      >
                        <Text allowFontScaling={false}
                          style={[
                            styles.stateChipText,
                            areaValue === a.id && styles.stateChipTextSelected,
                          ]}
                        >
                          {a.name}
                        </Text>
                      </TouchableOpacity>
                    ))}

                  {onCreateArea && !addingArea && (
                    <TouchableOpacity style={styles.stateChip} onPress={() => setAddingArea(true)}>
                      <Text allowFontScaling={false} style={styles.stateChipText}>+ New</Text>
                    </TouchableOpacity>
                  )}
                </View>
                )}

                {/* Created inline so filing a task never means leaving the
                    form to go and set an area up first. */}
                {addingArea && onCreateArea && !derivedArea && (
                  <View style={styles.timeEntryRow}>
                    <HandwritingTextInput
                      ref={newAreaInputRef}
                      style={[styles.textInput, styles.timeInput]}
                      value={newAreaName}
                      onChangeText={setNewAreaName}
                      placeholder="Area name"
                      placeholderTextColor="#707070"
                      autoCorrect={false}
                    />
                    <TouchableOpacity
                      style={styles.meridiemBtn}
                      onPress={() => {
                        const name = (newAreaInputRef.current?.getValue() ?? newAreaName).trim();
                        if (!name) {
                          setAddingArea(false);
                          return;
                        }
                        setAreaValue(onCreateArea(name));
                        setNewAreaName('');
                        setAddingArea(false);
                      }}
                    >
                      <Text allowFontScaling={false} style={styles.meridiemText}>Add</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <Text allowFontScaling={false} style={styles.label}>Project:</Text>
                <View style={styles.chipRow}>
                  <TouchableOpacity
                    style={[styles.stateChip, !projectValue && styles.stateChipSelected]}
                    onPress={() => setProjectValue(undefined)}
                  >
                    <Text allowFontScaling={false}
                      style={[styles.stateChipText, !projectValue && styles.stateChipTextSelected]}
                    >
                      None
                    </Text>
                  </TouchableOpacity>

                  {/* Finished and archived projects are not offered: filing new
                      work into something you have closed is almost never meant. */}
                  {projects
                    .filter(pr => pr.status === 'active')
                    .map(pr => (
                      <TouchableOpacity
                        key={pr.id}
                        style={[styles.stateChip, projectValue === pr.id && styles.stateChipSelected]}
                        onPress={() => setProjectValue(pr.id)}
                      >
                        <Text allowFontScaling={false}
                          style={[
                            styles.stateChipText,
                            projectValue === pr.id && styles.stateChipTextSelected,
                          ]}
                        >
                          {pr.name}
                        </Text>
                      </TouchableOpacity>
                    ))}

                  {onCreateProject && !addingProject && (
                    <TouchableOpacity style={styles.stateChip} onPress={() => setAddingProject(true)}>
                      <Text allowFontScaling={false} style={styles.stateChipText}>+ New</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {addingProject && onCreateProject && (
                  <View style={styles.timeEntryRow}>
                    <HandwritingTextInput
                      ref={newProjectInputRef}
                      style={[styles.textInput, styles.timeInput]}
                      value={newProjectName}
                      onChangeText={setNewProjectName}
                      placeholder="Project name"
                      placeholderTextColor="#707070"
                      autoCorrect={false}
                    />
                    <TouchableOpacity
                      style={styles.meridiemBtn}
                      onPress={() => {
                        const name = (newProjectInputRef.current?.getValue() ?? newProjectName).trim();
                        if (!name) {
                          setAddingProject(false);
                          return;
                        }
                        setProjectValue(onCreateProject(name));
                        setNewProjectName('');
                        setAddingProject(false);
                      }}
                    >
                      <Text allowFontScaling={false} style={styles.meridiemText}>Add</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <Text allowFontScaling={false} style={styles.label}>Priority:</Text>
                <View style={styles.chipRow}>
                  {TASK_PRIORITIES.map(p => (
                    <TouchableOpacity
                      key={p}
                      style={[styles.stateChip, taskPriorityValue === p && styles.stateChipSelected]}
                      onPress={() => setTaskPriorityValue(p)}
                    >
                      <Text allowFontScaling={false}
                        style={[
                          styles.stateChipText,
                          taskPriorityValue === p && styles.stateChipTextSelected,
                        ]}
                      >
                        {priorityLabel(p)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {itemKind === 'event' && (areas.length > 0 || Boolean(onCreateArea)) && (
              <>
                <Text allowFontScaling={false} style={styles.label}>Area:</Text>
                {derivedArea ? (
                  <Text allowFontScaling={false} style={styles.derivedArea}>
                    {derivedAreaName} — from project
                  </Text>
                ) : (
                  <>
                    <View style={styles.chipRow}>
                      <TouchableOpacity
                        style={[styles.stateChip, !areaValue && styles.stateChipSelected]}
                        onPress={() => setAreaValue(undefined)}
                      >
                        <Text
                          allowFontScaling={false}
                          style={[styles.stateChipText, !areaValue && styles.stateChipTextSelected]}
                        >
                          {eventTypes.find(eventType => eventType.id === typeValue)?.defaultAreaId
                            ? 'Type Default'
                            : 'None'}
                        </Text>
                      </TouchableOpacity>
                      {areas
                        .filter(area => !area.archived)
                        .map(area => (
                          <TouchableOpacity
                            key={area.id}
                            style={[styles.stateChip, areaValue === area.id && styles.stateChipSelected]}
                            onPress={() => setAreaValue(area.id)}
                          >
                            <Text
                              allowFontScaling={false}
                              style={[
                                styles.stateChipText,
                                areaValue === area.id && styles.stateChipTextSelected,
                              ]}
                            >
                              {area.icon ? `${area.icon} ` : ''}{area.name}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      {onCreateArea && !addingArea && (
                        <TouchableOpacity style={styles.stateChip} onPress={() => setAddingArea(true)}>
                          <Text allowFontScaling={false} style={styles.stateChipText}>+ New</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    {addingArea && onCreateArea && (
                      <View style={styles.timeEntryRow}>
                        <HandwritingTextInput
                          ref={newAreaInputRef}
                          style={[styles.textInput, styles.timeInput]}
                          value={newAreaName}
                          onChangeText={setNewAreaName}
                          placeholder="Area name"
                          placeholderTextColor="#707070"
                          autoCorrect={false}
                        />
                        <TouchableOpacity
                          style={styles.meridiemBtn}
                          onPress={() => {
                            const name = newAreaInputRef.current?.getValue() ?? newAreaName;
                            if (!name.trim()) return;
                            setAreaValue(onCreateArea(name.trim()));
                            setNewAreaName('');
                            setAddingArea(false);
                          }}
                        >
                          <Text allowFontScaling={false} style={styles.meridiemText}>Add</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    {!areaValue && eventTypes.find(eventType => eventType.id === typeValue)?.defaultAreaId && (
                      <Text allowFontScaling={false} style={styles.derivedArea}>
                        {areas.find(area => area.id === eventTypes.find(eventType => eventType.id === typeValue)?.defaultAreaId)?.name || 'Area'} — from Event Type
                      </Text>
                    )}
                  </>
                )}
              </>
            )}

            {/* Events can belong to a project too: that membership is what
                gathers their notes into the project's meeting ledger. */}
            {itemKind === 'event' && projects.length > 0 && (
              <>
                <Text allowFontScaling={false} style={styles.label}>Project:</Text>
                <View style={styles.chipRow}>
                  <TouchableOpacity
                    style={[styles.stateChip, !projectValue && styles.stateChipSelected]}
                    onPress={() => setProjectValue(undefined)}
                  >
                    <Text
                      allowFontScaling={false}
                      style={[styles.stateChipText, !projectValue && styles.stateChipTextSelected]}
                    >
                      None
                    </Text>
                  </TouchableOpacity>

                  {projects
                    .filter(pr => pr.status === 'active')
                    .map(pr => (
                      <TouchableOpacity
                        key={pr.id}
                        style={[styles.stateChip, projectValue === pr.id && styles.stateChipSelected]}
                        onPress={() => setProjectValue(pr.id)}
                      >
                        <Text
                          allowFontScaling={false}
                          style={[
                            styles.stateChipText,
                            projectValue === pr.id && styles.stateChipTextSelected,
                          ]}
                        >
                          {pr.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                </View>
              </>
            )}

            {itemKind === 'event' && eventTypes.length > 0 && (
              <>
                {/* Settles where this event's notes go and what they look like,
                    so creating one asks nothing. */}
                <Text allowFontScaling={false} style={styles.label}>Event Type:</Text>
                <View style={styles.chipRow}>
                  <TouchableOpacity
                    style={[styles.stateChip, !typeValue && styles.stateChipSelected]}
                    onPress={() => setTypeValue(undefined)}
                  >
                    <Text allowFontScaling={false} style={[styles.stateChipText, !typeValue && styles.stateChipTextSelected]}>
                      None
                    </Text>
                  </TouchableOpacity>

                  {eventTypes
                    .filter(t => !t.archived)
                    .map(t => (
                      <TouchableOpacity
                        key={t.id}
                        style={[styles.stateChip, typeValue === t.id && styles.stateChipSelected]}
                        onPress={() => setTypeValue(t.id)}
                      >
                        <Text allowFontScaling={false}
                          style={[
                            styles.stateChipText,
                            typeValue === t.id && styles.stateChipTextSelected,
                          ]}
                        >
                          {t.icon ? `${t.icon} ` : ''}
                          {t.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                </View>
              </>
            )}

            <Text allowFontScaling={false} style={styles.label}>Description / Details:</Text>
            <HandwritingTextInput
              ref={descriptionInputRef}
              style={[styles.textInput, styles.multilineInput]}
              value={description}
              onChangeText={setDescription}
              placeholder="Item details..."
              placeholderTextColor="#707070"
              multiline
              numberOfLines={3}
            />

          </ScrollView>

          {editingTask && (onTaskNoteAction || onLinkTaskNote) && (
            <View style={styles.noteActionRow}>
              {!taskNotePath && onLinkTaskNote && (
                <TouchableOpacity style={styles.taskNoteBtn} onPress={() => onLinkTaskNote(editingTask)}>
                  <Text allowFontScaling={false} style={styles.taskNoteBtnText}>Link Note…</Text>
                </TouchableOpacity>
              )}
              {onTaskNoteAction && (
                <TouchableOpacity style={styles.taskNoteBtn} onPress={() => onTaskNoteAction(editingTask, taskNotePath)}>
                  <Text allowFontScaling={false} style={styles.taskNoteBtnText}>
                    {taskNotePath ? 'Open Note' : 'Create Note'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          <View style={styles.footerRow}>
            <TouchableOpacity
              style={[styles.saveBtn, itemKind === 'task' ? styles.compactTaskSave : styles.footerGrow]}
              onPress={handleSave}
            >
              <Text allowFontScaling={false} style={styles.saveBtnText}>
                💾 Save {itemKind === 'event' ? 'Event' : 'Task'}
              </Text>
            </TouchableOpacity>

            {/* Editing only: there is nothing to delete from a create form. */}
            {editingTask && onDeleteTask && (
              <TouchableOpacity
                style={styles.deleteTaskBtn}
                onPress={() => {
                  onDeleteTask(editingTask.uid);
                  onClose();
                }}
              >
                {/* Labelled, not a bare icon: an unlabelled 🗑️ beside Save was
                    easy to miss entirely. */}
                <Text allowFontScaling={false} style={styles.deleteTaskBtnText}>🗑️ Delete</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

/** Nomad-class devices report ~998dp tall; a Manta reports ~1365. */
const SHORT_SCREEN = Dimensions.get('window').height < 1100;

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 8,
    padding: 12,
    width: SHORT_SCREEN ? '86%' : '72%',
    // A percentage of a shorter screen is less absolute room: 62% of the
    // Nomad's 998dp is 619, against 846 on a Manta. The smaller device needs
    // the larger share, not the same one.
    maxHeight: SHORT_SCREEN ? '90%' : '76%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    paddingBottom: 6,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000000',
  },
  closeBtn: {
    backgroundColor: '#000000',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
  },
  closeBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  dateLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#303030',
    marginBottom: 10,
  },
  checkRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  checkToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginRight: 8,
    backgroundColor: '#ffffff',
  },
  checkToggleBox: {
    fontSize: 18,
    color: '#000000',
    marginRight: 6,
  },
  checkToggleLabel: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#000000',
  },
  captureBox: {
    borderWidth: 1,
    borderColor: '#404040',
    borderRadius: 6,
    backgroundColor: '#f2f2f2',
    padding: 8,
    marginBottom: 10,
  },
  captureRead: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#404040',
  },
  captureInterp: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#000000',
    marginTop: 2,
  },
  captureWarn: {
    fontSize: 11,
    color: '#000000',
    marginTop: 4,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  whenBox: {
    borderWidth: 1,
    borderColor: '#606060',
    borderRadius: 6,
    padding: 8,
    marginTop: 4,
    marginBottom: 6,
    backgroundColor: '#f5f5f5',
  },
  whenHeading: { fontSize: 13, fontWeight: 'bold', color: '#000000', marginBottom: 5 },
  recurrenceBox: {
    borderWidth: 1,
    borderColor: '#707070',
    borderRadius: 6,
    padding: 7,
    marginBottom: 6,
    backgroundColor: '#f5f5f5',
  },
  countRow: { flexDirection: 'row', alignItems: 'center' },
  countValue: { fontSize: 13, fontWeight: 'bold', color: '#000000', marginRight: 8, marginBottom: 5 },
  dateNavBtn: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 18,
    backgroundColor: '#ffffff',
  },
  dateNavBtnText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000000',
  },
  dateDisplay: {
    flex: 1,
    alignItems: 'center',
  },
  dateHint: {
    fontSize: 10,
    color: '#606060',
  },
  dateJumpRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 12,
  },
  dateJumpBtn: {
    borderWidth: 1,
    borderColor: '#404040',
    borderRadius: 4,
    paddingVertical: 4,
    paddingHorizontal: 12,
    marginHorizontal: 4,
  },
  dateJumpBtnText: {
    fontSize: 12,
    color: '#101010',
  },
  kindToggleRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  kindBtn: {
    flex: 1,
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingVertical: 10,
    marginRight: 8,
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  kindBtnActive: {
    backgroundColor: '#000000',
  },
  kindBtnText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000000',
  },
  kindBtnTextActive: {
    color: '#ffffff',
  },
  // Room to scroll the last field clear of the on-screen keyboard; without it
  // there is nothing below to scroll into and the field stays covered.
  formContentInner: {
    paddingBottom: 220,
  },
  formContent: {
    marginBottom: 12,
  },
  derivedArea: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#000000',
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  label: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 2,
    marginTop: 4,
  },
  labelInline: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000000',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 6,
  },
  textInput: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    color: '#000000',
    fontSize: 14,
    marginBottom: 5,
  },
  multilineInput: {
    height: 60,
    textAlignVertical: 'top',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  stateChip: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginRight: 5,
    marginBottom: 5,
    backgroundColor: '#ffffff',
  },
  stateChipSelected: {
    backgroundColor: '#000000',
  },
  stateChipText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#000000',
  },
  stateChipTextSelected: {
    color: '#ffffff',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  footerGrow: {
    flex: 1,
  },
  noteActionRow: { flexDirection: 'row', marginBottom: 8 },
  compactTaskSave: { paddingHorizontal: 20, paddingVertical: 8, justifyContent: 'center' },
  taskNoteBtn: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginRight: 7,
    justifyContent: 'center',
  },
  taskNoteBtnText: { fontSize: 12, fontWeight: 'bold', color: '#000000' },
  deleteTaskBtn: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
    marginLeft: 8,
    backgroundColor: '#ffffff',
  },
  deleteTaskBtnText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#000000',
  },
  timeFieldRow: {
    flexDirection: 'row',
  },
  timeField: {
    flex: 1,
    marginRight: 8,
  },
  timeEntryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  timeInput: {
    flex: 1,
    marginRight: 4,
  },
  meridiemBtn: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  meridiemText: { fontSize: 13, fontWeight: 'bold', color: '#000000' },
  inputInvalid: {
    borderColor: '#909090',
    borderStyle: 'dashed',
  },
  durationHint: { fontSize: 12, color: '#505050', marginBottom: 4 },
  timeDisplayButton: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 7,
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  timeDisplayText: { fontSize: 18, fontWeight: 'bold', color: '#000000' },
  timeDisplayHint: { fontSize: 10, color: '#606060', marginTop: 1 },
  saveBtn: {
    backgroundColor: '#000000',
    borderRadius: 6,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 15,
  },
});
