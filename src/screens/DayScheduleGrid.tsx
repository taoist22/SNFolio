import { useTimeFormat } from './TimeFormatContext';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CalendarEvent } from '../domain/types';
import { DEFAULT_DAY_GRID, gridHeight, gridHours, hourLabel, placeEvents } from '../domain/dayGrid';

interface DayScheduleGridProps {
  events: CalendarEvent[];
  startHour: number;
  endHour: number;
  /** Note path per event uid, so a row can offer Open rather than Create. */
  notePaths: Record<string, string>;
  onEditEvent: (event: CalendarEvent) => void;
  onNoteAction: (event: CalendarEvent, existingPath?: string) => void;
  onDeleteEvent: (event: CalendarEvent) => void;
  /** Type label for an event, e.g. "🎓 Class". Empty when untyped. */
  typeLabel: (event: CalendarEvent) => string;
}

/**
 * The day as a grid of hours rather than a list of rows.
 *
 * A list said what was on but not when: an hour with nothing in it looked the
 * same as no gap at all. Positioned against hour lines, the shape of the day
 * is legible — where the free afternoon is, which two things collide.
 *
 * Positioning lives in domain/dayGrid so the clamping and overlap columns are
 * tested off device.
 */
export function DayScheduleGrid({
  events,
  startHour,
  endHour,
  notePaths,
  onEditEvent,
  onNoteAction,
  onDeleteEvent,
  typeLabel,
}: DayScheduleGridProps): React.JSX.Element {
  const timeFormat = useTimeFormat();
  // The grid grows with the hours chosen; the Day View already scrolls, so a
  // longer day makes a taller page rather than a squashed one.
  const options = { ...DEFAULT_DAY_GRID, startHour, endHour };
  const allDay = events.filter(e => e.allDay);
  const placed = placeEvents(events, options);
  const hours = gridHours(options);
  const height = gridHeight(options);

  return (
    <View>
      {/* Pinned above: an all-day item has no position on an hour grid. */}
      {allDay.map(evt => (
        <TouchableOpacity key={`allday-${evt.uid}`} style={styles.allDayRow} onPress={() => onEditEvent(evt)}>
          <Text allowFontScaling={false} style={styles.allDayTag}>
            ALL DAY
          </Text>
          <Text allowFontScaling={false} style={styles.allDayTitle} numberOfLines={1}>
            {evt.summary}
          </Text>
        </TouchableOpacity>
      ))}

      <View style={[styles.grid, { height }]}>
        {hours.map((hour, idx) => (
          <View
            key={hour}
            style={[styles.hourRow, { top: idx * options.hourHeight }]}
            pointerEvents="none"
          >
            <Text allowFontScaling={false} style={styles.hourLabel}>
              {hourLabel(hour, timeFormat)}
            </Text>
            <View style={styles.hourLine} />
          </View>
        ))}

        {/* Blocks sit in their own layer inset past the hour labels. Sharing
            the grid's box meant a percentage width resolved against the full
            width, so a full-width block overhung the right edge by the gutter. */}
        <View style={styles.blockLayer} pointerEvents="box-none">
        {placed.map(({ event, top, height: blockHeight, column, columns }) => {
          const existingPath = notePaths[event.uid];
          // Columns share the track width; a single event takes all of it.
          const widthPercent = 100 / columns;

          return (
            <View
              key={event.uid}
              style={[
                styles.block,
                {
                  top,
                  height: blockHeight,
                  left: `${column * widthPercent}%`,
                  width: `${widthPercent}%`,
                },
              ]}
            >
              <TouchableOpacity style={styles.blockBody} onPress={() => onEditEvent(event)}>
                <Text allowFontScaling={false} style={styles.blockTitle} numberOfLines={1}>
                  {event.summary}
                </Text>
                {/* Each line only appears if it fits. Rendering all three in a
                    short block overflowed the box, and with the box clipped
                    the lines collided — which read as text behind the icon. */}
                {blockHeight >= META_MIN_HEIGHT && (
                  <Text allowFontScaling={false} style={styles.blockMeta} numberOfLines={1}>
                    {[typeLabel(event), event.location].filter(Boolean).join(' · ')}
                  </Text>
                )}
              </TouchableOpacity>

              {blockHeight >= ACTIONS_MIN_HEIGHT && (
              <View style={styles.blockActions}>
                {/* The action takes the room it needs and the delete stays a
                    fixed sliver, rather than the two splitting evenly and
                    truncating the only label that carries meaning. */}
                <TouchableOpacity
                  style={styles.blockActionBtn}
                  onPress={() => onNoteAction(event, existingPath)}
                >
                  <Text allowFontScaling={false} style={styles.blockAction} numberOfLines={1}>
                    {existingPath ? '📂 Open Note' : '📝 Create Note'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.blockDeleteBtn} onPress={() => onDeleteEvent(event)}>
                  <Text allowFontScaling={false} style={styles.blockDelete}>
                    ✕
                  </Text>
                </TouchableOpacity>
              </View>
              )}
            </View>
          );
        })}
        </View>
      </View>
    </View>
  );
}

const GUTTER = 62;

/**
 * Heights at which each line earns its place.
 *
 * A one-hour block cannot hold a title, a meta line and an action row at
 * these sizes; drawing all three overflowed a clipped box and the lines
 * collided.
 */
const ACTIONS_MIN_HEIGHT = 46;
const META_MIN_HEIGHT = 66;

const styles = StyleSheet.create({
  allDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginBottom: 5,
    backgroundColor: '#f2f2f2',
  },
  allDayTag: { fontSize: 10, fontWeight: 'bold', color: '#303030', marginRight: 8 },
  allDayTitle: { flex: 1, fontSize: 13, fontWeight: 'bold', color: '#000000' },
  grid: { position: 'relative' },
  hourRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  hourLabel: {
    width: GUTTER,
    fontSize: 12,
    color: '#303030',
    textAlign: 'right',
    paddingRight: 8,
  },
  // Dotted rather than solid: the lines are a reference, and solid rules at
  // every hour compete with the event blocks for attention.
  hourLine: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: '#b0b0b0',
    borderStyle: 'dotted',
  },
  blockLayer: {
    position: 'absolute',
    left: GUTTER,
    right: 4,
    top: 0,
    bottom: 0,
  },
  block: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 5,
    backgroundColor: '#ffffff',
    paddingHorizontal: 6,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  blockBody: { flex: 1 },
  blockTitle: { fontSize: 13, fontWeight: 'bold', color: '#000000' },
  blockMeta: { fontSize: 11, color: '#404040' },
  blockActions: { flexDirection: 'row', alignItems: 'center' },
  blockActionBtn: { flex: 1 },
  blockAction: { fontSize: 11, fontWeight: 'bold', color: '#000000' },
  blockDeleteBtn: { paddingLeft: 8 },
  blockDelete: { fontSize: 12, color: '#606060' },
});
