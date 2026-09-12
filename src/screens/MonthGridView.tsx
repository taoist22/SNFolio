import { formatDateTime } from '../domain/timeOfDay';
import { useTimeFormat } from './TimeFormatContext';
import React from 'react';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { allocateCellRows, generateMonthGrid, MonthGridCell } from '../domain/monthGrid';
import { CalendarEvent, CalendarTask, NoteKind } from '../domain/types';
import { tasksForCalendarDay } from '../domain/taskFilters';
import { dateKey } from '../domain/dailyNote';
import { noteIdentity } from '../domain/meetingSnapshot';
import { statusGlyph, taskRowLabel, taskStatus } from '../domain/taskModel';

interface MonthGridViewProps {
  currentDate: Date;
  selectedDate: Date;
  allEvents: CalendarEvent[];
  allTasks?: CalendarTask[];
  weekStartsOn?: number;
  /**
   * Local date keys (YYYY-MM-DD) that have a daily note on disk. Checked in
   * AgendaScreen, which owns the note logic; this view only draws the result.
   */
  dailyNoteDates?: Set<string>;
  /**
   * Note kind per event uid, from the stored mappings. Mappings written before
   * kinds were recorded map to undefined and show the neutral glyph.
   */
  noteKindByEvent?: Record<string, NoteKind | undefined>;
  onSelectDate: (date: Date) => void;
  onOpenActionSheet?: (date: Date) => void;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Most event rows a single day may claim, so tasks are never crowded out. */
const EVENT_CAP = 3;

/**
 * Vertical space a cell spends on anything that is not a snippet row: its own
 * padding, the day-number bar, and the reserved note-badge strip along the
 * bottom.
 */
const CELL_CHROME_HEIGHT = 43;

/**
 * Height of one snippet row: the 10dp font plus its 1dp bottom margin.
 *
 * Keep in step with eventSnippetText/taskSnippetText below — the row budget is
 * derived from it, so a font change without one here silently over- or
 * under-fills every cell.
 */
const SNIPPET_ROW_HEIGHT = 14;


/**
 * Which note glyphs a cell shows: D for the day's journal note, M and C for
 * meeting and class notes on that day's events, N for notes created before
 * kinds were recorded.
 *
 * One glyph per kind however many notes there are — three characters is
 * already a third of a Nomad cell's width.
 */
function cellNoteBadges(
  cell: MonthGridCell,
  dailyNoteDates?: Set<string>,
  noteKindByEvent?: Record<string, NoteKind | undefined>
): string[] {
  const badges: string[] = [];

  if (cell.isCurrentMonth && dailyNoteDates?.has(dateKey(cell.date))) {
    badges.push('D');
  }

  if (noteKindByEvent) {
    let meeting = false;
    let klass = false;
    let unknown = false;

    for (const evt of cell.events) {
      // Occurrences carry a per-instance uid; kinds are held on the series.
      const identity = noteIdentity(evt);
      if (!(identity in noteKindByEvent)) continue;
      const kind = noteKindByEvent[identity];
      if (kind === 'meeting') meeting = true;
      else if (kind === 'class') klass = true;
      else if (kind !== 'daily') unknown = true;
    }

    if (meeting) badges.push('M');
    if (klass) badges.push('C');
    if (unknown) badges.push('N');
  }

  return badges;
}

export function MonthGridView({
  currentDate,
  selectedDate,
  allEvents,
  allTasks = [],
  weekStartsOn = 0,
  dailyNoteDates,
  noteKindByEvent,
  onSelectDate,
  onOpenActionSheet,
}: MonthGridViewProps): React.JSX.Element {
  const timeFormat = useTimeFormat();
  const windowHeight = Dimensions.get('window').height;
  const dynamicCellHeight = Math.max(90, Math.min(140, Math.floor((windowHeight - 260) / 6)));

  // How many snippet rows this device's cell can actually hold. The Manta
  // lands at 6 and the Nomad at 5; hardcoding either was what made the grid
  // overflow on the other. Text scaling is pinned off throughout this view so
  // the arithmetic holds: the two devices report fontScale 0.85 and 1.0, which
  // silently rendered identical styles 18% apart.
  const rowBudget = Math.max(
    0,
    Math.floor((dynamicCellHeight - CELL_CHROME_HEIGHT) / SNIPPET_ROW_HEIGHT)
  );

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const grid = generateMonthGrid(year, month, allEvents, new Date(), weekStartsOn);
  const orderedDayNames = Array.from({ length: 7 }, (_, offset) =>
    DAY_NAMES[(weekStartsOn + offset) % 7]
  );

  const isSameDay = (d1: Date, d2: Date) =>
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();

  return (
    <View style={styles.container}>
      {/* Day Name Header Row */}
      <View style={styles.headerRow}>
        {orderedDayNames.map(dayName => (
          <View key={dayName} style={styles.headerCell}>
            <Text allowFontScaling={false} style={styles.headerCellText}>{dayName}</Text>
          </View>
        ))}
      </View>

      {/* Grid Weeks */}
      {grid.map((week, weekIdx) => (
        <View key={`week-${weekIdx}`} style={styles.weekRow}>
          {week.map((cell: MonthGridCell, dayIdx) => {
            const isSelected = isSameDay(cell.date, selectedDate);
            const dayTasks = tasksForCalendarDay(allTasks, cell.date);
            const rows = allocateCellRows(cell.events.length, dayTasks.length, rowBudget, EVENT_CAP);
            const badges = cellNoteBadges(cell, dailyNoteDates, noteKindByEvent);

            return (
              <TouchableOpacity
                key={`cell-${weekIdx}-${dayIdx}`}
                style={[
                  styles.dayCell,
                  { minHeight: dynamicCellHeight },
                  !cell.isCurrentMonth && styles.otherMonthCell,
                  cell.isToday && styles.todayCell,
                  isSelected && styles.selectedCell,
                  cell.isToday && isSelected && styles.todaySelectedCell,
                ]}
                onPress={() => onSelectDate(cell.date)}
                onLongPress={() => {
                  onSelectDate(cell.date);
                  if (onOpenActionSheet) onOpenActionSheet(cell.date);
                }}
              >
                <View style={styles.cellTopBar}>
                  <Text allowFontScaling={false}
                    style={[
                      styles.dayNumberText,
                      !cell.isCurrentMonth && styles.otherMonthText,
                      isSelected && styles.selectedText,
                    ]}
                  >
                    {cell.dayNumber}
                  </Text>

                  {cell.eventCount > 0 && (
                    <Text allowFontScaling={false} style={[styles.cellCountBadge, isSelected && styles.selectedCellCountBadge]}>
                      {cell.eventCount}
                    </Text>
                  )}
                </View>

                {/* Event Snippets Inside Cell */}
                <View style={styles.eventsSnippetContainer}>
                  {cell.events.slice(0, rows.events).map((evt, eIdx) => {
                    const timeStr = formatDateTime(evt.start, timeFormat);
                    return (
                      <Text allowFontScaling={false}
                        key={`${evt.uid}-${eIdx}`}
                        style={[styles.eventSnippetText, isSelected && styles.selectedEventSnippetText]}
                        numberOfLines={1}
                      >
                        • {timeStr} {evt.summary}
                      </Text>
                    );
                  })}
                  {rows.moreEventsLine && (
                    <Text
                      allowFontScaling={false}
                      style={[styles.moreEventsText, isSelected && styles.selectedMoreEventsText]}
                    >
                      +{rows.hiddenEvents} more...
                    </Text>
                  )}

                  {/* Tasks due that day, plus anything completed that day.
                      Capped separately from events so a busy task list can't
                      push the schedule out of the cell. */}
                  {(() => {
                    if (dayTasks.length === 0) return null;
                    return (
                      <>
                        {dayTasks.slice(0, rows.tasks).map(t => (
                          <Text allowFontScaling={false}
                            key={t.uid}
                            style={[
                              styles.taskSnippetText,
                              t.completed && styles.taskSnippetDone,
                              isSelected && styles.selectedEventSnippetText,
                            ]}
                            numberOfLines={1}
                          >
                            {`${statusGlyph(taskStatus(t))} ${taskRowLabel(t)}`}
                          </Text>
                        ))}
                        {rows.moreTasksLine && (
                          <Text
                            allowFontScaling={false}
                            style={[styles.moreEventsText, isSelected && styles.selectedMoreEventsText]}
                          >
                            +{rows.hiddenTasks} more task{rows.hiddenTasks === 1 ? '' : 's'}...
                          </Text>
                        )}
                      </>
                    );
                  })()}
                </View>

                {badges.length > 0 && (
                  <View style={styles.noteBadgeRow}>
                    {badges.map(glyph => (
                      <Text
                        key={glyph}
                        allowFontScaling={false}
                        style={[styles.noteBadge, isSelected && styles.noteBadgeSelected]}
                      >
                        {glyph}
                      </Text>
                    ))}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    padding: 4,
    backgroundColor: '#ffffff',
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    borderBottomWidth: 2,
    borderBottomColor: '#000000',
    paddingBottom: 4,
    marginBottom: 4,
  },
  headerCell: {
    flex: 1,
    alignItems: 'center',
  },
  headerCellText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000000',
  },
  weekRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  dayCell: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    padding: 4,
    // Room for the note badge, which is absolutely positioned bottom-right.
    paddingBottom: 16,
    justifyContent: 'flex-start',
    backgroundColor: '#ffffff',
  },
  otherMonthCell: {
    backgroundColor: '#f5f5f5',
    borderColor: '#c0c0c0',
  },
  todayCell: {
    borderWidth: 4,
    borderColor: '#000000',
    backgroundColor: '#f8f8f8',
  },
  todaySelectedCell: {},
  // Deliberately empty. Selecting a day navigates to the Day View, so marking
  // the cell told the user something they had just done and could already see;
  // the previous solid fill also made the cell's own contents unreadable. Only
  // today is distinguished, by its heavier border.
  selectedCell: {},
  cellTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  dayNumberText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000000',
  },
  otherMonthText: {
    color: '#909090',
  },
  selectedText: {
    color: '#000000',
  },
  cellCountBadge: {
    fontSize: 11,
    fontWeight: 'bold',
    backgroundColor: '#e0e0e0',
    color: '#000000',
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  selectedCellCountBadge: {
    backgroundColor: '#ffffff',
    color: '#000000',
  },
  eventsSnippetContainer: {
    marginTop: 2,
  },
  eventSnippetText: {
    fontSize: 10,
    color: '#000000',
    fontWeight: '500',
    marginBottom: 1,
  },
  taskSnippetText: {
    fontSize: 10,
    color: '#000000',
    marginBottom: 1,
  },
  taskSnippetDone: {
    textDecorationLine: 'line-through',
    color: '#606060',
  },
  selectedEventSnippetText: {
    color: '#000000',
  },
  moreEventsText: {
    fontSize: 9,
    fontStyle: 'italic',
    color: '#505050',
  },
  selectedMoreEventsText: {
    color: '#505050',
  },
  // A row along the bottom rather than a corner cluster: a Nomad cell is only
  // ~107dp wide, and three stacked glyphs in one corner crowded it.
  noteBadgeRow: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: 2,
    flexDirection: 'row',
  },
  noteBadge: {
    fontSize: 11,
    marginRight: 3,
    fontWeight: 'bold',
    color: '#000000',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 3,
    paddingHorizontal: 3,
    lineHeight: 13,
    // Required for borderRadius to clip the background on Text.
    overflow: 'hidden',
  },
  // Selected cells fill solid black, so the badge inverts to stay readable.
  noteBadgeSelected: {
    color: '#000000',
    backgroundColor: '#ffffff',
    borderColor: '#000000',
  },
});
