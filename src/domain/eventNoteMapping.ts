import { CalendarEvent, MeetingNoteMapping } from './types';

/**
 * The note linked to one event occurrence.
 *
 * With series notebooks, a session falls back to its series' notebook. With
 * one note per session, only that session's own note counts: the series
 * notebook (stored under the session it was first made from) is not reused.
 */
export function eventNoteMapping(
  getMapping: (key: string) => MeetingNoteMapping | undefined,
  event: Pick<CalendarEvent, 'uid' | 'recurringSeriesId'>,
  perSession: boolean,
): MeetingNoteMapping | undefined {
  const own = getMapping(event.uid);
  if (!event.recurringSeriesId) return own;
  if (perSession) return own?.perSession ? own : undefined;
  return own || getMapping(event.recurringSeriesId);
}

/** The key a new note link is stored under: the session with per-session notes, else the series. */
export function eventNoteKey(event: Pick<CalendarEvent, 'uid' | 'recurringSeriesId'>, perSession: boolean): string {
  return perSession && event.recurringSeriesId ? event.uid : event.recurringSeriesId || event.uid;
}
