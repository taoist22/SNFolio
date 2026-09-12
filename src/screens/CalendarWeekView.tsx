import { formatDateTime } from '../domain/timeOfDay';
import { useTimeFormat } from './TimeFormatContext';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CalendarEvent, CalendarTask } from '../domain/types';
import { expandEventsForDate } from '../domain/icsParser';
import { tasksForCalendarDay } from '../domain/taskFilters';
import { isDone, statusGlyph, taskStatus } from '../domain/taskModel';
import { dailyFocusTasks, startOfPlannerWeek, weeklyTaskSummary } from '../domain/plannerReview';

interface CalendarWeekViewProps {
  selectedDate: Date;
  weekStartsOn: number;
  dayCount: 5 | 7;
  events: CalendarEvent[];
  tasks: CalendarTask[];
  onOpenDay: (date: Date) => void;
  onOpenEvent: (event: CalendarEvent) => void;
  onToggleTask: (task: CalendarTask) => void;
  onEditTask: (task: CalendarTask) => void;
  taskContextLabel?: (uid: string) => string;
  weeklyNoteExists?: boolean;
  onOpenWeeklyNote?: () => void;
}

const ITEM_LIMIT = 4;
const DASHBOARD_LIMIT = 3;

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function CalendarWeekView({
  selectedDate,
  weekStartsOn,
  dayCount,
  events,
  tasks,
  onOpenDay,
  onOpenEvent,
  onToggleTask,
  onEditTask,
  taskContextLabel,
  weeklyNoteExists = false,
  onOpenWeeklyNote,
}: CalendarWeekViewProps): React.JSX.Element {
  const timeFormat = useTimeFormat();
  const start = startOfPlannerWeek(selectedDate, weekStartsOn);
  const days = Array.from({ length: dayCount }, (_, offset) => {
    const day = new Date(start);
    day.setDate(day.getDate() + offset);
    return day;
  });
  const today = new Date();
  const endExclusive = new Date(start);
  endExclusive.setDate(endExclusive.getDate() + dayCount);
  const weekTasks = tasks.filter(task => {
    const stamp = task.completed ? task.completedAt ?? task.dueDate : task.dueDate;
    return Boolean(stamp && stamp.getTime() >= start.getTime() && stamp.getTime() < endExclusive.getTime());
  });
  const openWeekTasks = weekTasks.filter(task => !isDone(task));
  const completedWeekTasks = weekTasks.filter(isDone);
  const focusTasks = dailyFocusTasks(
    tasks.filter(task => !task.dueDate || task.dueDate.getTime() < endExclusive.getTime()),
    new Date(endExclusive.getTime() - 1),
    DASHBOARD_LIMIT
  );
  const undatedTasks = tasks.filter(task => !isDone(task) && !task.dueDate).slice(0, DASHBOARD_LIMIT);
  const summary = weeklyTaskSummary(tasks, selectedDate, today, weekStartsOn);
  const progressTotal = openWeekTasks.length + completedWeekTasks.length;
  const progressPercent = progressTotal === 0 ? 0 : Math.round((completedWeekTasks.length / progressTotal) * 100);

  const taskLabel = (task: CalendarTask): string => {
    const context = taskContextLabel?.(task.uid)?.trim();
    return context ? `${context} · ${task.title}` : task.title;
  };

  const renderDashboardTasks = (items: CalendarTask[], emptyLabel: string) => {
    if (items.length === 0) {
      return <Text allowFontScaling={false} style={styles.dashboardEmpty}>{emptyLabel}</Text>;
    }
    return items.slice(0, DASHBOARD_LIMIT).map(task => (
      <View key={task.uid} style={styles.dashboardTaskRow}>
        <TouchableOpacity onPress={() => onToggleTask(task)}>
          <Text allowFontScaling={false} style={styles.dashboardCheck}>{statusGlyph(taskStatus(task))}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dashboardTaskBody} onPress={() => onEditTask(task)}>
          <Text allowFontScaling={false} style={styles.dashboardTaskText} numberOfLines={1}>{taskLabel(task)}</Text>
        </TouchableOpacity>
      </View>
    ));
  };

  return (
    <View style={styles.root}>
      <View style={styles.columns}>
        {days.map((day, dayIndex) => {
          const dayEvents = expandEventsForDate(events, day);
          const dayTasks = tasksForCalendarDay(tasks, day);
          const shownEvents = dayEvents.slice(0, Math.min(4, ITEM_LIMIT));
          const remainingSlots = Math.max(0, ITEM_LIMIT - shownEvents.length);
          const shownTasks = dayTasks.slice(0, remainingSlots);
          const hidden = dayEvents.length + dayTasks.length - shownEvents.length - shownTasks.length;
          const selected = sameDay(day, selectedDate);
          const isToday = sameDay(day, today);
          return (
            <View key={day.toISOString()} style={[styles.dayColumn, isToday && styles.todayColumn, dayIndex > 0 && styles.dayColumnDivider]}>
              <TouchableOpacity style={[styles.dayHeader, selected && styles.dayHeaderSelected]} onPress={() => onOpenDay(day)}>
                <Text allowFontScaling={false} style={[styles.weekday, selected && styles.selectedText]}>
                  {day.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}
                </Text>
                <Text allowFontScaling={false} style={[styles.dayNumber, selected && styles.selectedText]}>
                  {isToday ? `(${day.getDate()})` : day.getDate()}
                </Text>
              </TouchableOpacity>

              <View style={styles.dayItems}>
                {shownEvents.length > 0 ? <Text allowFontScaling={false} style={styles.itemGroupLabel}>EVENTS</Text> : null}
                {shownEvents.map(event => (
                  <TouchableOpacity key={`${event.uid}-${event.start.toISOString()}`} style={styles.itemRow} onPress={() => onOpenEvent(event)}>
                    <Text allowFontScaling={false} style={styles.eventText} numberOfLines={2}>
                      ○ {event.allDay ? 'All day' : formatDateTime(event.start, timeFormat)}{' '}{event.summary}
                    </Text>
                  </TouchableOpacity>
                ))}
                {shownTasks.length > 0 ? <Text allowFontScaling={false} style={styles.itemGroupLabel}>TASKS</Text> : null}
                {shownTasks.map(task => (
                  <View key={task.uid} style={styles.itemRow}>
                    <TouchableOpacity onPress={() => onToggleTask(task)}>
                      <Text allowFontScaling={false} style={styles.taskGlyph}>{statusGlyph(taskStatus(task))}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.taskBody} onPress={() => onEditTask(task)}>
                      <Text allowFontScaling={false} style={styles.taskText} numberOfLines={2}>{taskLabel(task)}</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                {hidden > 0 ? (
                  <TouchableOpacity onPress={() => onOpenDay(day)}>
                    <Text allowFontScaling={false} style={styles.moreText}>+{hidden} more ›</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.dashboard}>
        <View style={styles.dashboardRow}>
          <View style={styles.dashboardPanel}>
            <Text allowFontScaling={false} style={styles.dashboardTitle}>WEEKLY FOCUS</Text>
            {renderDashboardTasks(focusTasks, 'No priority work waiting.')}
          </View>
          <View style={[styles.dashboardPanel, styles.dashboardPanelRight]}>
            <Text allowFontScaling={false} style={styles.dashboardTitle}>DUE THIS WEEK</Text>
            {renderDashboardTasks(openWeekTasks, 'Nothing else due this week.')}
            {openWeekTasks.length > DASHBOARD_LIMIT ? (
              <Text allowFontScaling={false} style={styles.dashboardMore}>+{openWeekTasks.length - DASHBOARD_LIMIT} more</Text>
            ) : null}
          </View>
        </View>

        <View style={[styles.dashboardRow, styles.dashboardSecondRow]}>
          <View style={styles.dashboardPanel}>
            <Text allowFontScaling={false} style={styles.dashboardTitle}>UNSCHEDULED</Text>
            {renderDashboardTasks(undatedTasks, 'No unscheduled tasks.')}
            {tasks.filter(task => !isDone(task) && !task.dueDate).length > DASHBOARD_LIMIT ? (
              <Text allowFontScaling={false} style={styles.dashboardMore}>
                +{tasks.filter(task => !isDone(task) && !task.dueDate).length - DASHBOARD_LIMIT} more
              </Text>
            ) : null}
          </View>
          <View style={[styles.dashboardPanel, styles.dashboardPanelRight]}>
            <Text allowFontScaling={false} style={styles.dashboardTitle}>WEEKLY PROGRESS</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
            </View>
            <Text allowFontScaling={false} style={styles.progressText}>
              {completedWeekTasks.length} completed · {openWeekTasks.length} remaining
              {summary.overdue.length > 0 ? ` · ${summary.overdue.length} overdue` : ''}
            </Text>
            {onOpenWeeklyNote ? (
              <TouchableOpacity style={styles.weeklyNoteButton} onPress={onOpenWeeklyNote}>
                <Text allowFontScaling={false} style={styles.weeklyNoteButtonText}>
                  {weeklyNoteExists ? 'Open Weekly Review Note' : 'Create Weekly Review Note'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>
      <Text allowFontScaling={false} style={styles.hint}>Tap a date for its Day Planner. Tap an item to open it.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, borderWidth: 1, borderColor: '#000000' },
  columns: { height: '43%', minHeight: 285, flexDirection: 'row', borderBottomWidth: 2, borderBottomColor: '#000000' },
  dayColumn: { flex: 1, minWidth: 0 },
  todayColumn: { backgroundColor: '#e6e6e6' },
  dayColumnDivider: { borderLeftWidth: 1, borderLeftColor: '#000000' },
  dayHeader: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: '#000000', backgroundColor: '#f0f0f0' },
  dayHeaderSelected: { backgroundColor: '#000000' },
  weekday: { fontSize: 12, fontWeight: 'bold', color: '#000000' },
  dayNumber: { fontSize: 17, fontWeight: 'bold', color: '#000000', marginTop: 2 },
  selectedText: { color: '#ffffff' },
  dayItems: { paddingHorizontal: 5, paddingVertical: 4 },
  itemGroupLabel: { fontSize: 9, fontWeight: 'bold', color: '#505050', letterSpacing: 0.5, marginTop: 4, marginBottom: 2 },
  itemRow: { flexDirection: 'row', minHeight: 38, alignItems: 'flex-start', borderBottomWidth: 1, borderBottomColor: '#c8c8c8', paddingVertical: 5 },
  eventText: { flex: 1, fontSize: 12, color: '#000000' },
  taskGlyph: { fontSize: 15, color: '#000000', marginRight: 4 },
  taskBody: { flex: 1 },
  taskText: { fontSize: 12, color: '#000000' },
  moreText: { fontSize: 11, fontWeight: 'bold', color: '#000000', paddingVertical: 7 },
  dashboard: { flex: 1, padding: 10, backgroundColor: '#f4f4f4' },
  dashboardRow: { flex: 1, flexDirection: 'row' },
  dashboardSecondRow: { marginTop: 10 },
  dashboardPanel: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: '#000000', backgroundColor: '#ffffff', padding: 10 },
  dashboardPanelRight: { marginLeft: 10 },
  dashboardTitle: { fontSize: 13, fontWeight: 'bold', color: '#000000', letterSpacing: 0.5, paddingBottom: 6, borderBottomWidth: 2, borderBottomColor: '#000000', marginBottom: 3 },
  dashboardTaskRow: { minHeight: 32, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#d0d0d0' },
  dashboardCheck: { fontSize: 15, color: '#000000', marginRight: 6 },
  dashboardTaskBody: { flex: 1, paddingVertical: 5 },
  dashboardTaskText: { fontSize: 13, color: '#000000' },
  dashboardEmpty: { fontSize: 12, color: '#606060', paddingVertical: 8 },
  dashboardMore: { fontSize: 11, fontWeight: 'bold', color: '#303030', paddingTop: 5 },
  progressTrack: { height: 16, borderWidth: 1, borderColor: '#000000', backgroundColor: '#ffffff', marginTop: 7 },
  progressFill: { height: '100%', backgroundColor: '#000000' },
  progressText: { fontSize: 12, color: '#000000', marginTop: 7 },
  weeklyNoteButton: { minHeight: 38, borderWidth: 1, borderColor: '#000000', alignItems: 'center', justifyContent: 'center', marginTop: 9, backgroundColor: '#eeeeee' },
  weeklyNoteButtonText: { fontSize: 13, fontWeight: 'bold', color: '#000000' },
  hint: { fontSize: 12, color: '#303030', paddingHorizontal: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#000000' },
});
