import { CalendarEvent } from './types';

/**
 * Tracks what has already been pushed to CalDAV, so a sync uploads only what
 * is new or changed.
 *
 * Before this, every sync re-PUT every user item. That was slow, but the real
 * problem was resurrection: deleting an event on the phone left it untouched
 * in local storage, so the next sync pushed it straight back up and it
 * reappeared. Skipping unchanged items means an item you never edited on the
 * Supernote is never re-uploaded, and a phone-side delete stays deleted.
 *
 * CalendarEvent carries no modification timestamp, so "changed" is decided by
 * hashing the fields that actually reach the server rather than by comparing
 * dates.
 */
export interface PushRecord {
  signature: string;
  pushedAt: number;
}

export interface CaldavPushState {
  /**
   * Collection the records belong to. Pointing the plugin at a different
   * calendar or account invalidates every record: those items exist on the
   * old server, not the new one.
   */
  target: string;
  records: Record<string, PushRecord>;
  /**
   * UIDs the last successful read returned. Combined with the push records
   * these are the items known to exist on the server, which is what makes a
   * later absence meaningful rather than merely unproven.
   */
  lastSeenUids: string[];
}

export function emptyPushState(target = ''): CaldavPushState {
  return { target, records: {}, lastSeenUids: [] };
}

/**
 * Content hash of everything generateOutboundIcs* actually writes. DTSTAMP is
 * excluded — it is regenerated on every push and would make every item look
 * permanently dirty.
 */
export function pushSignature(item: CalendarEvent): string {
  return JSON.stringify([
    item.summary || '',
    item.start instanceof Date ? item.start.getTime() : '',
    item.end instanceof Date ? item.end.getTime() : '',
    item.allDay ? '1' : '0',
    item.location || '',
    item.description || '',
    item.isTask ? '1' : '0',
    item.completed ? '1' : '0',
    item.undatedTask ? '1' : '0',
    item.priority || '',
    Number.isFinite(item.alarmMinutesBefore) ? item.alarmMinutesBefore : '',
    // Recurrence, exceptions, participants, and task-mirror state are all
    // serialized by generateOutboundIcs*, so a change to any of them changes
    // the bytes the server must receive. While they were missing, editing only
    // a repeat rule, an attendee, or a deleted occurrence produced a signature
    // identical to the last successful push, and the edit was never uploaded.
    item.rrule || '',
    (item.exceptionDates || []).join(','),
    (item.recurrenceExceptionInstants || []).join(','),
    item.recurrenceTimeZone || '',
    item.timeZone || '',
    item.recurrenceValueType || '',
    item.organizer?.name || '',
    item.organizer?.email || '',
    (item.attendees || []).map(a => [a.name || '', a.email || '', a.status || '']),
    item.isTaskMirror ? '1' : '0',
  ]);
}

/** Reads the state for a collection, discarding it if it belongs to another. */
export function stateForTarget(
  state: CaldavPushState | null | undefined,
  target: string
): CaldavPushState {
  if (!state || state.target !== target) return emptyPushState(target);
  return {
    target,
    records: { ...state.records },
    lastSeenUids: [...(state.lastSeenUids || [])],
  };
}

export function needsPush(item: CalendarEvent, state: CaldavPushState): boolean {
  const record = state.records[item.uid];
  if (!record) return true;
  return record.signature !== pushSignature(item);
}

/** The subset of items a sync should actually upload. */
export function selectItemsToPush(
  items: CalendarEvent[],
  state: CaldavPushState
): CalendarEvent[] {
  return items.filter(item => needsPush(item, state));
}

/** Records a successful push. Returns a new state; the input is not mutated. */
export function recordPush(
  state: CaldavPushState,
  item: CalendarEvent,
  at: number = Date.now()
): CaldavPushState {
  return {
    target: state.target,
    lastSeenUids: state.lastSeenUids,
    records: {
      ...state.records,
      [item.uid]: { signature: pushSignature(item), pushedAt: at },
    },
  };
}

/** Applies resource metadata returned by a successful PUT and records it as pushed. */
export function recordSuccessfulPush(
  state: CaldavPushState,
  item: CalendarEvent,
  resource: { caldavUrl?: string; etag?: string },
  at: number = Date.now()
): { event: CalendarEvent; state: CaldavPushState } {
  const event = {
    ...item,
    caldavUrl: resource.caldavUrl || item.caldavUrl,
    etag: resource.etag || item.etag,
  };
  return { event, state: recordPush(state, event, at) };
}

/** Forgets a single item, so a later re-create pushes again. */
export function forgetPush(state: CaldavPushState, uid: string): CaldavPushState {
  const records = { ...state.records };
  delete records[uid];
  return {
    target: state.target,
    records,
    lastSeenUids: (state.lastSeenUids || []).filter(u => u !== uid),
  };
}

/**
 * Drops records for items that no longer exist locally, so the state does not
 * grow without bound as items come and go.
 */
export function prunePushState(state: CaldavPushState, liveUids: string[]): CaldavPushState {
  const live = new Set(liveUids);
  const records: Record<string, PushRecord> = {};
  for (const [uid, record] of Object.entries(state.records)) {
    if (live.has(uid)) records[uid] = record;
  }
  return { target: state.target, records, lastSeenUids: state.lastSeenUids };
}

/** Records what a successful read found on the server. */
export function recordPullSnapshot(state: CaldavPushState, serverUids: string[]): CaldavPushState {
  return {
    target: state.target,
    records: state.records,
    lastSeenUids: [...new Set(serverUids)],
  };
}

/**
 * Items the server is known to hold: everything successfully pushed, plus
 * everything the previous read returned.
 */
export function knownServerUids(state: CaldavPushState): Set<string> {
  return new Set([...Object.keys(state.records), ...(state.lastSeenUids || [])]);
}

export interface ReconcileInput {
  /** Everything currently held locally, from any source. */
  local: CalendarEvent[];
  /** UIDs this read returned. */
  serverUids: string[];
  state: CaldavPushState;
  windowStart: Date;
  windowEnd: Date;
}

/**
 * Decides which local items were deleted on the server.
 *
 * A read only proves absence for items that were supposed to be in the
 * response, so three conditions must all hold before anything is removed:
 *
 *  1. The item starts inside the requested window. The server never sends
 *     anything outside it, so absence there means nothing at all.
 *  2. The item is known to be server-backed — pushed from here, or seen by an
 *     earlier read. A purely local event was never on the server, and neither
 *     was an event that arrived from a subscribed feed.
 *  3. This read did not return it.
 *
 * The caller must only run this after a successful read; a network failure
 * returns no UIDs and would otherwise look like a mass deletion. Pointing the
 * plugin at another collection is safe for a different reason: the state is
 * scoped to its target, so a changed URL yields no known UIDs and nothing is
 * eligible for removal.
 */
export function selectRemovedUids({
  local,
  serverUids,
  state,
  windowStart,
  windowEnd,
}: ReconcileInput): string[] {
  const stillOnServer = new Set(serverUids);
  const known = knownServerUids(state);
  const removed: string[] = [];

  for (const item of local) {
    if (!item.uid || removed.includes(item.uid)) continue;
    if (!known.has(item.uid)) continue;
    if (stillOnServer.has(item.uid)) continue;

    const start = item.start instanceof Date ? item.start.getTime() : NaN;
    if (Number.isNaN(start)) continue;
    if (start < windowStart.getTime() || start > windowEnd.getTime()) continue;

    removed.push(item.uid);
  }

  return removed;
}
