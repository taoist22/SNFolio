import { TimeFormat } from './timeOfDay';
import { CalendarEvent } from './types';
import { minutesFromDate } from './timeOfDay';

/**
 * Positions timed events against an hour grid.
 *
 * The schedule was a list of rows, which said what was on but not when — an
 * hour with nothing in it looked the same as no gap at all. A grid shows the
 * shape of a day: where the free afternoon is, which two things collide.
 *
 * Layout is computed here rather than in the view so the awkward parts — the
 * clamping and the overlap columns — can be tested without a device.
 */

export interface DayGridOptions {
  /** First and last hour drawn, 0–23. */
  startHour: number;
  endHour: number;
  hourHeight: number;
  /** Shortest an event may render, so a 15-minute item stays readable. */
  minHeight: number;
}

export const DEFAULT_DAY_GRID: DayGridOptions = {
  startHour: 8,
  endHour: 20,
  // An hour has to hold a title and an action row at readable sizes; at 44 a
  // one-hour event could not, and its contents collided.
  hourHeight: 58,
  minHeight: 34,
};

export interface PlacedEvent {
  event: CalendarEvent;
  top: number;
  height: number;
  /** Which of `columns` this event occupies, for side-by-side overlaps. */
  column: number;
  columns: number;
}

/** Hour lines to draw, top to bottom. */
export function gridHours(options: DayGridOptions = DEFAULT_DAY_GRID): number[] {
  const hours: number[] = [];
  for (let h = options.startHour; h <= options.endHour; h++) hours.push(h);
  return hours;
}

/**
 * Total height, including a trailing hour past the last label.
 *
 * Without it the final label sits exactly on the bottom edge and renders below
 * it, and an event ending at the last hour has nowhere to draw — both were
 * visible as the last slot spilling out of the panel.
 */
export function gridHeight(options: DayGridOptions = DEFAULT_DAY_GRID): number {
  return (options.endHour - options.startHour + 1) * options.hourHeight;
}

/**
 * Groups events that overlap in time, so each cluster can be split into
 * columns independently. Two events that merely share a cluster with a third
 * still get their own columns; a day with no overlaps stays full width.
 */
function clusterOverlapping(events: CalendarEvent[]): CalendarEvent[][] {
  const sorted = [...events].sort((a, b) => a.start.getTime() - b.start.getTime());
  const clusters: CalendarEvent[][] = [];
  let current: CalendarEvent[] = [];
  let clusterEnd = -Infinity;

  for (const event of sorted) {
    const start = event.start.getTime();
    if (current.length > 0 && start < clusterEnd) {
      current.push(event);
      clusterEnd = Math.max(clusterEnd, event.end.getTime());
    } else {
      if (current.length > 0) clusters.push(current);
      current = [event];
      clusterEnd = event.end.getTime();
    }
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

/**
 * Assigns each event in a cluster to the first column free at its start time.
 *
 * Greedy by start time, which is what a paper planner does: the earlier thing
 * keeps the left-hand track and later arrivals move right.
 */
function assignColumns(cluster: CalendarEvent[]): Array<{ event: CalendarEvent; column: number }> {
  const columnEnds: number[] = [];
  return cluster.map(event => {
    const start = event.start.getTime();
    let column = columnEnds.findIndex(end => end <= start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(event.end.getTime());
    } else {
      columnEnds[column] = event.end.getTime();
    }
    return { event, column };
  });
}

/**
 * Places timed events on the grid.
 *
 * All-day events are excluded — they have no position in a day, and the view
 * pins them above the grid instead. Events outside the drawn hours are clamped
 * into it rather than dropped: an 06:00 start on an 08:00 grid still needs to
 * be visible, or the day silently lies about what is on.
 */
export function placeEvents(
  events: CalendarEvent[],
  options: DayGridOptions = DEFAULT_DAY_GRID
): PlacedEvent[] {
  const timed = events.filter(e => !e.allDay);
  const gridStart = options.startHour * 60;
  const gridEnd = options.endHour * 60;
  const placed: PlacedEvent[] = [];

  for (const cluster of clusterOverlapping(timed)) {
    const assigned = assignColumns(cluster);
    const columns = Math.max(...assigned.map(a => a.column)) + 1;

    for (const { event, column } of assigned) {
      const startMin = Math.max(gridStart, Math.min(minutesFromDate(event.start), gridEnd));
      const rawEnd = minutesFromDate(event.end);
      // An end at or before the start — bad data, or an event crossing
      // midnight — still gets a visible block rather than a zero-height sliver.
      const endMin = Math.max(startMin, Math.min(rawEnd > startMin ? rawEnd : startMin + 30, gridEnd));

      const top = ((startMin - gridStart) / 60) * options.hourHeight;
      const height = Math.max(options.minHeight, ((endMin - startMin) / 60) * options.hourHeight);

      placed.push({ event, top, height, column, columns });
    }
  }

  return placed;
}

/** Label for an hour line: "8 AM", "12 PM". */
export function hourLabel(hour: number, format: TimeFormat = '12h'): string {
  if (format === '24h') return `${String(hour % 24).padStart(2, '0')}:00`;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve} ${suffix}`;
}
