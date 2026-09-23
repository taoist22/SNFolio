import { CalendarEvent, CalendarSettings } from './types';

function feedFingerprint(event: CalendarEvent): string {
  return [
    event.summary.trim().toLocaleLowerCase(),
    event.start.getTime(),
    event.end.getTime(),
    event.allDay ? '1' : '0',
    (event.location || '').trim().toLocaleLowerCase(),
  ].join('|');
}

/**
 * The same job as feedFingerprint, for comparing one batch against itself.
 *
 * toLocaleLowerCase is noticeably slower on the device, and this value is
 * never stored: it only has to be consistent within a single call. The stored
 * hide identity above keeps the locale-aware form so that ids saved by earlier
 * versions still match.
 */
function sessionFingerprint(event: CalendarEvent): string {
  return `${event.summary.trim().toLowerCase()}|${event.start.getTime()}|${event.end.getTime()}|${event.allDay ? '1' : '0'}|${(event.location || '').trim().toLowerCase()}`;
}

/** Stable across duplicate subscribed calendars and recurring occurrences. */
export function feedEventHideIdentity(event: CalendarEvent): string {
  return event.recurringSeriesId
    ? `series:${event.recurringSeriesId}`
    : `event:${feedFingerprint(event)}`;
}

/**
 * Collapses items that appear more than once by UID, keeping the first.
 *
 * An item created in the plugin is held locally AND pushed to CalDAV, then
 * comes back down through the subscribed webcal feed on the next refresh —
 * same UID, two copies. Locally-created items are loaded before feeds are
 * fetched, so keeping the first occurrence keeps the local copy, which is the
 * one carrying isTask and any edits made on the device.
 *
 * Safe against recurrence: parseIcsContent emits one entry per VEVENT with an
 * rrule field, and expandEventsForDate runs after filtering, so distinct
 * occurrences do not exist yet at this point.
 */
export function dedupeEvents(events: CalendarEvent[]): CalendarEvent[] {
  const seen = new Set<string>();
  const seenFeedFingerprints = new Set<string>();
  const result: CalendarEvent[] = [];

  for (const event of events) {
    const key = event.uid;
    if (!key) {
      result.push(event);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);

    // Shared/invited events can appear in two subscribed Google calendars
    // with different UIDs. Collapse only byte-for-byte-equivalent feed views;
    // local and CalDAV events are never merged by a heuristic.
    if (event.sourceKind === 'feed') {
      const fingerprint = sessionFingerprint(event);
      if (seenFeedFingerprints.has(fingerprint)) continue;
      seenFeedFingerprints.add(fingerprint);
    }
    result.push(event);
  }

  return result;
}

/**
 * Filters calendar events based on user preferences (all-day events, solo events)
 */
export function filterEvents(events: CalendarEvent[], settings: CalendarSettings): CalendarEvent[] {
  const hidden = new Set(settings.hiddenFeedEventIds || []);
  return dedupeEvents(events).filter(event => {
    if (event.isTaskMirror) {
      return false;
    }
    if (event.sourceKind === 'feed' && hidden.has(feedEventHideIdentity(event))) {
      return false;
    }
    if (settings.hideAllDayEvents && event.allDay) {
      return false;
    }
    if (settings.hideSoloEvents && event.attendees.length === 0) {
      return false;
    }
    return true;
  });
}
