import { CalendarEvent } from './types';

export function belongsToSeries(event: CalendarEvent, seriesId: string): boolean {
  return event.uid === seriesId || event.recurringSeriesId === seriesId;
}

/** Resolve persisted data even when a past series has only an exception cached. */
export function findStoredSeries(events: CalendarEvent[], seriesId: string): CalendarEvent | undefined {
  return events.find(event => event.uid === seriesId) ||
    events.find(event => event.recurringSeriesId === seriesId);
}
