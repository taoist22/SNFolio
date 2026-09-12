import { CalendarEvent } from './types';
import { formatTimeOfDay, minutesFromDate, TimeFormat } from './timeOfDay';

/**
 * A deliberately compact preview of tomorrow's calendar. Tasks are omitted
 * because the Day View's Tasks & Deliverables section already shows their
 * names, dates, and project context with full editing controls.
 */
export function tomorrowScheduleSummary(events: CalendarEvent[], timeFormat: TimeFormat = '12h'): string {
  if (events.length === 0) return 'No events scheduled.';

  const first = events[0];
  const when = first.allDay ? 'All day' : formatTimeOfDay(minutesFromDate(first.start), timeFormat);
  const more = events.length > 1 ? ` (+${events.length - 1} more)` : '';
  return `${when} ${first.summary}${more}`;
}
