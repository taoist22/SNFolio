import {
  CaldavPushState,
  emptyPushState,
  forgetPush,
  needsPush,
  prunePushState,
  knownServerUids,
  pushSignature,
  recordPullSnapshot,
  recordPush,
  selectRemovedUids,
  selectItemsToPush,
  stateForTarget,
} from './pushState';
import { CalendarEvent } from './types';

const COLLECTION = 'https://p01-caldav.icloud.com/123456789/calendars/work/';

function makeEvent(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    uid: 'evt-1',
    summary: 'Maikai Health',
    start: new Date('2026-08-18T20:20:00Z'),
    end: new Date('2026-08-18T21:20:00Z'),
    allDay: false,
    attendees: [],
    ...over,
  };
}

describe('CalDAV push state', () => {
  test('an item never pushed needs pushing', () => {
    expect(needsPush(makeEvent(), emptyPushState(COLLECTION))).toBe(true);
  });

  test('an unchanged item is not pushed again', () => {
    const event = makeEvent();
    const state = recordPush(emptyPushState(COLLECTION), event);

    expect(needsPush(event, state)).toBe(false);
    // A fresh object with identical content is still the same item.
    expect(needsPush(makeEvent(), state)).toBe(false);
  });

  test.each([
    ['summary', { summary: 'Maikai Health — rescheduled' }],
    ['start time', { start: new Date('2026-08-18T22:20:00Z') }],
    ['end time', { end: new Date('2026-08-18T23:00:00Z') }],
    ['all-day flag', { allDay: true }],
    ['location', { location: 'Suite 300' }],
    ['description', { description: 'Bring paperwork' }],
    ['completion', { completed: true }],
    ['alarm', { alarmMinutesBefore: 15 }],
    // Everything below reaches the server through generateOutboundIcs* and was
    // absent from the signature, so an edit touching only one of these fields
    // was silently treated as already synchronised.
    ['repeat rule', { rrule: 'FREQ=WEEKLY;BYDAY=MO' }],
    ['all-day exception date', { exceptionDates: ['2026-08-25'] }],
    ['timed exception instant', { recurrenceExceptionInstants: ['2026-08-25T20:20:00.000Z'] }],
    ['recurrence timezone', { recurrenceTimeZone: 'America/New_York' }],
    ['recurrence value type', { recurrenceValueType: 'zoned' as const }],
    ['organizer', { organizer: { name: 'Ada', email: 'ada@example.com' } }],
    ['attendee list', { attendees: [{ name: 'Ada', email: 'ada@example.com', status: 'ACCEPTED' as const }] }],
    ['attendee response', { attendees: [{ name: 'Ada', email: 'ada@example.com', status: 'DECLINED' as const }] }],
    ['task-mirror flag', { isTaskMirror: true }],
  ])('editing the %s marks the item dirty again', (_label, change) => {
    const state = recordPush(emptyPushState(COLLECTION), makeEvent());
    expect(needsPush(makeEvent(change as Partial<CalendarEvent>), state)).toBe(true);
  });

  test('a repeat-rule-only edit is still uploaded', () => {
    // The regression that motivated widening the signature: nothing the old
    // signature covered changes, so the edit looked already-pushed and the
    // series silently stayed on its previous rule on the server.
    const original = makeEvent({ rrule: 'FREQ=DAILY' });
    const state = recordPush(emptyPushState(COLLECTION), original);

    expect(needsPush(makeEvent({ rrule: 'FREQ=WEEKLY;BYDAY=MO,WE' }), state)).toBe(true);
  });

  test('deleting one occurrence of a series is uploaded', () => {
    const series = makeEvent({ rrule: 'FREQ=DAILY' });
    const state = recordPush(emptyPushState(COLLECTION), series);

    expect(needsPush(
      makeEvent({ rrule: 'FREQ=DAILY', recurrenceExceptionInstants: ['2026-08-19T20:20:00.000Z'] }),
      state
    )).toBe(true);
  });

  test('the signature ignores fields that never reach the server', () => {
    const base = makeEvent();
    // calendarName and colour are display concerns; changing them must not
    // trigger a pointless re-upload.
    const restyled = makeEvent({ calendarName: 'Work', calendarColor: '#000' });
    expect(pushSignature(restyled)).toBe(pushSignature(base));
  });

  test('a task and an event with identical text are distinct items', () => {
    const state = recordPush(emptyPushState(COLLECTION), makeEvent({ isTask: false }));
    // The flag decides VTODO vs VEVENT, so flipping it changes what is sent.
    expect(needsPush(makeEvent({ isTask: true }), state)).toBe(true);
  });

  test('selectItemsToPush returns only new and edited items', () => {
    const unchanged = makeEvent({ uid: 'a' });
    const edited = makeEvent({ uid: 'b' });
    const fresh = makeEvent({ uid: 'c' });

    let state = emptyPushState(COLLECTION);
    state = recordPush(state, unchanged);
    state = recordPush(state, edited);

    const selected = selectItemsToPush(
      [unchanged, makeEvent({ uid: 'b', summary: 'Moved' }), fresh],
      state
    );

    expect(selected.map(e => e.uid)).toEqual(['b', 'c']);
  });

  test('an item deleted on the phone is not resurrected by the next sync', () => {
    // The scenario this whole module exists for: the item is still in local
    // storage because it was deleted server-side, not on the device.
    const event = makeEvent();
    const state = recordPush(emptyPushState(COLLECTION), event);

    expect(selectItemsToPush([event], state)).toEqual([]);
  });

  test('recordPush does not mutate the state it was given', () => {
    const before = emptyPushState(COLLECTION);
    const after = recordPush(before, makeEvent());

    expect(before.records).toEqual({});
    expect(Object.keys(after.records)).toEqual(['evt-1']);
  });

  test('recordPush stores when the push happened', () => {
    const state = recordPush(emptyPushState(COLLECTION), makeEvent(), 1_760_000_000_000);
    expect(state.records['evt-1'].pushedAt).toBe(1_760_000_000_000);
  });

  test('switching to another collection invalidates every record', () => {
    const state = recordPush(emptyPushState(COLLECTION), makeEvent());
    const moved = stateForTarget(state, 'https://p01-caldav.icloud.com/123456789/calendars/home/');

    // Those items live on the old collection, so everything must upload again.
    expect(moved.records).toEqual({});
    expect(needsPush(makeEvent(), moved)).toBe(true);
  });

  test('the same collection keeps its records', () => {
    const state = recordPush(emptyPushState(COLLECTION), makeEvent());
    expect(stateForTarget(state, COLLECTION).records['evt-1']).toBeDefined();
  });

  test('stateForTarget tolerates a missing or corrupt state', () => {
    expect(stateForTarget(null, COLLECTION)).toEqual({ target: COLLECTION, records: {}, lastSeenUids: [] });
    expect(stateForTarget(undefined, COLLECTION).target).toBe(COLLECTION);
  });

  test('forgetPush makes a re-created item upload again', () => {
    let state = recordPush(emptyPushState(COLLECTION), makeEvent());
    state = forgetPush(state, 'evt-1');
    expect(needsPush(makeEvent(), state)).toBe(true);
  });

  test('prunePushState drops records for items no longer held locally', () => {
    let state = emptyPushState(COLLECTION);
    state = recordPush(state, makeEvent({ uid: 'keep' }));
    state = recordPush(state, makeEvent({ uid: 'gone' }));

    const pruned = prunePushState(state, ['keep']);
    expect(Object.keys(pruned.records)).toEqual(['keep']);
    expect(pruned.target).toBe(COLLECTION);
  });

  test('a state revived from storage still matches unchanged items', () => {
    // Dates survive JSON as strings, so the signature must not depend on
    // reading getTime() off a live Date at comparison time.
    const state = recordPush(emptyPushState(COLLECTION), makeEvent());
    const revived = JSON.parse(JSON.stringify(state));

    expect(needsPush(makeEvent(), stateForTarget(revived, COLLECTION))).toBe(false);
  });
});

describe('CalDAV deletion reconciliation', () => {
  const WINDOW_START = new Date('2026-08-01T00:00:00Z');
  const WINDOW_END = new Date('2027-08-01T00:00:00Z');

  function inWindow(uid: string): CalendarEvent {
    return makeEvent({ uid, start: new Date('2026-09-01T10:00:00Z'), end: new Date('2026-09-01T11:00:00Z') });
  }

  function reconcile(local: CalendarEvent[], serverUids: string[], state: CaldavPushState) {
    return selectRemovedUids({
      local,
      serverUids,
      state,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
  }

  test('removes an event created here and deleted on the phone', () => {
    const event = inWindow('mine');
    const state = recordPush(emptyPushState(COLLECTION), event);

    expect(reconcile([event], [], state)).toEqual(['mine']);
  });

  test('removes an event created on the phone, pulled here, then deleted there', () => {
    const event = inWindow('theirs');
    const state = recordPullSnapshot(emptyPushState(COLLECTION), ['theirs']);

    expect(reconcile([event], [], state)).toEqual(['theirs']);
  });

  test('keeps an event the server still holds', () => {
    const event = inWindow('alive');
    const state = recordPullSnapshot(emptyPushState(COLLECTION), ['alive']);

    expect(reconcile([event], ['alive'], state)).toEqual([]);
  });

  test('never removes a purely local event that was never synced', () => {
    // No push record and never seen by a read, so the server's silence about
    // it proves nothing.
    const local = inWindow('never-synced');
    expect(reconcile([local], [], emptyPushState(COLLECTION))).toEqual([]);
  });

  test('never removes an event that came from a subscribed feed', () => {
    const fromFeed = makeEvent({
      uid: 'feed-evt',
      calendarName: 'US Holidays',
      start: new Date('2026-09-04T00:00:00Z'),
      end: new Date('2026-09-05T00:00:00Z'),
    });
    const state = recordPush(emptyPushState(COLLECTION), inWindow('mine'));

    // Only 'mine' is server-backed; the feed event is a different source.
    expect(reconcile([fromFeed, inWindow('mine')], [], state)).toEqual(['mine']);
  });

  test('never removes an event outside the requested window', () => {
    // The server was never asked about it, so it is absent by construction.
    const old = makeEvent({ uid: 'ancient', start: new Date('2020-01-01T10:00:00Z') });
    const state = recordPullSnapshot(emptyPushState(COLLECTION), ['ancient']);

    expect(reconcile([old], [], state)).toEqual([]);
  });

  test('a changed collection makes nothing eligible for removal', () => {
    const event = inWindow('mine');
    const other = stateForTarget(
      recordPush(recordPullSnapshot(emptyPushState(COLLECTION), ['mine']), event),
      'https://p01-caldav.icloud.com/123456789/calendars/home/'
    );

    // Scoping is the safety net: an unfamiliar collection knows nothing, so
    // an empty response cannot wipe the calendar.
    expect(reconcile([event], [], other)).toEqual([]);
  });

  test('reports each uid once even when duplicated locally', () => {
    // The same event can be held twice — once from a feed, once from CalDAV —
    // before dedupe collapses them.
    const event = inWindow('dupe');
    const state = recordPullSnapshot(emptyPushState(COLLECTION), ['dupe']);

    expect(reconcile([event, { ...event }], [], state)).toEqual(['dupe']);
  });

  test('an empty server response deletes only what it accounts for', () => {
    const mine = inWindow('mine');
    const stranger = inWindow('stranger');
    const state = recordPush(emptyPushState(COLLECTION), mine);

    expect(reconcile([mine, stranger], [], state)).toEqual(['mine']);
  });

  test('recordPullSnapshot replaces the previous snapshot rather than accumulating', () => {
    let state = recordPullSnapshot(emptyPushState(COLLECTION), ['a', 'b']);
    state = recordPullSnapshot(state, ['b']);

    expect(state.lastSeenUids).toEqual(['b']);
  });

  test('recordPullSnapshot keeps push records intact', () => {
    const event = inWindow('mine');
    const state = recordPullSnapshot(recordPush(emptyPushState(COLLECTION), event), ['other']);

    expect(needsPush(event, state)).toBe(false);
    expect(knownServerUids(state)).toEqual(new Set(['mine', 'other']));
  });

  test('a snapshot survives a round trip through storage', () => {
    const event = inWindow('theirs');
    const state = recordPullSnapshot(emptyPushState(COLLECTION), ['theirs']);
    const revived = stateForTarget(JSON.parse(JSON.stringify(state)), COLLECTION);

    expect(reconcile([event], [], revived)).toEqual(['theirs']);
  });

  test('a state written before snapshots existed is handled', () => {
    // Older stored blobs have no lastSeenUids field at all.
    const legacy = { target: COLLECTION, records: {} } as any;
    const state = stateForTarget(legacy, COLLECTION);

    expect(state.lastSeenUids).toEqual([]);
    expect(knownServerUids(state)).toEqual(new Set());
  });
});
