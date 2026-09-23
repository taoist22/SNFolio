import { eventsOnDay, expandEventsByDay, expandEventsForDate } from './icsParser';
import { generateMonthGrid, monthGridFor } from './monthGrid';
import { CalendarEvent } from './types';

/**
 * Guards the cost of drawing a calendar on a busy account.
 *
 * A user reported SNFolio becoming unusable after syncing iCloud and guessed
 * there were too many events. Measuring showed recurrence was the driver:
 * 10,000 one-off events cost ~19 ms per month view, but 500 weekly series
 * cost ~355 ms and 10,000 cost ~5 s, because every day drawn asked every
 * recurring event whether it occurred, walking each rule from its start date.
 *
 * Timings vary by machine, so the assertions here count work rather than
 * milliseconds: recurring events must not cost dramatically more than plain
 * ones, and a month must not re-walk a rule per cell.
 */
const series = (count: number, recurring: boolean): CalendarEvent[] => {
  const events: CalendarEvent[] = [];
  const base = new Date(2026, 8, 1, 8);
  for (let index = 0; index < count; index++) {
    const start = new Date(base.getTime() + (index % 20) * 86400000 + (index % 9) * 3600000);
    events.push({
      uid: `e${index}`, summary: `Event ${index}`, start, end: new Date(start.getTime() + 3600000),
      allDay: false, attendees: [],
      ...(recurring ? { rrule: 'FREQ=WEEKLY;COUNT=52' } : {}),
    });
  }
  return events;
};

test('a month of a busy recurring calendar walks each rule about once, not once per cell', () => {
  // Counting work rather than milliseconds: wall-clock timing is unreliable
  // when the suite runs in parallel, and the defect was extra walks.
  let walks = 0;
  const events = series(200, true).map(event => {
    Object.defineProperty(event, 'recurrenceExceptionInstants', { get: () => { walks++; return undefined; } });
    return event;
  });
  generateMonthGrid(2026, 9, events, new Date(2026, 9, 15), 1);
  // A 42-cell grid walks each rule across the range once: about one candidate
  // per day in range. Cell-by-cell expansion cost tens of times more.
  expect(walks).toBeLessThan(events.length * 60);
});

test('drawing a month walks each rule fewer times than asking cell by cell', () => {
  let walks = 0;
  const weekly = (): CalendarEvent => {
    const event: CalendarEvent = {
      uid: 'weekly', summary: 'Weekly', start: new Date(2026, 0, 5, 9), end: new Date(2026, 0, 5, 10),
      allDay: false, attendees: [], rrule: 'FREQ=WEEKLY;COUNT=520',
    };
    Object.defineProperty(event, 'recurrenceExceptionInstants', { get: () => { walks++; return undefined; } });
    return event;
  };
  generateMonthGrid(2026, 9, [weekly()], new Date(2026, 9, 15), 1);
  const onePass = walks;
  walks = 0;
  const event = weekly();
  for (let cell = 0; cell < 42; cell++) expandEventsForDate([event], new Date(2026, 8, 28 + cell));
  expect(onePass).toBeGreaterThan(0);
  // Per-cell expansion now has a month cache of its own, so the gap is no
  // longer 42:1 — but one pass still walks each rule fewer times.
  expect(onePass).toBeLessThan(walks);
});

test('the same occurrences appear whichever way a day is expanded', () => {
  const events = series(200, true);
  const byDay = expandEventsByDay(events, new Date(2026, 9, 1), new Date(2026, 9, 31));
  for (const day of [1, 9, 17, 25, 31]) {
    const date = new Date(2026, 9, day);
    expect(eventsOnDay(byDay, date).map(event => `${event.uid}@${event.start.toISOString()}`))
      .toEqual(expandEventsForDate(events, date).map(event => `${event.uid}@${event.start.toISOString()}`));
  }
});

test('a month already built for the same events is not built again', () => {
  let walks = 0;
  const events = series(100, true).map(event => {
    Object.defineProperty(event, 'recurrenceExceptionInstants', { get: () => { walks++; return undefined; } });
    return event;
  });
  const today = new Date(2026, 9, 15);
  const first = monthGridFor(2026, 9, events, today, 1);
  const afterFirst = walks;
  const other = monthGridFor(2026, 10, events, today, 1);
  const again = monthGridFor(2026, 9, events, today, 1);

  expect(again).toBe(first);
  expect(other).not.toBe(first);
  // Paging back costs nothing; only the new month did any work.
  expect(walks).toBeGreaterThan(afterFirst);
  const afterPagingBack = walks;
  monthGridFor(2026, 9, events, today, 1);
  expect(walks).toBe(afterPagingBack);

  // A different array of events — any sync or edit — is built fresh.
  const edited = [...events];
  expect(monthGridFor(2026, 9, edited, today, 1)).not.toBe(first);
});

test('the same day is marked today, so a grid built yesterday is not reused', () => {
  const events = series(5, false);
  const yesterday = monthGridFor(2026, 9, events, new Date(2026, 9, 14), 1);
  const today = monthGridFor(2026, 9, events, new Date(2026, 9, 15), 1);
  expect(today).not.toBe(yesterday);
  expect(today.flat().find(cell => cell.isToday)?.date.getDate()).toBe(15);
});

describe('state that has not changed', () => {
  // The screen re-rendered — the month grid and day schedule with it — because
  // a sweep handed back a fresh object holding exactly what the last one did.
  const { sameNotePaths, sameKeys } = jest.requireActual('../screens/stateEquality');

  test('note paths are the same when they hold the same links', () => {
    expect(sameNotePaths({}, {})).toBe(true);
    expect(sameNotePaths({ a: '/N/A.note' }, { a: '/N/A.note' })).toBe(true);
    expect(sameNotePaths({ a: '/N/A.note' }, { a: '/N/B.note' })).toBe(false);
    expect(sameNotePaths({ a: '/N/A.note' }, {})).toBe(false);
    expect(sameNotePaths({}, { a: '/N/A.note' })).toBe(false);
    expect(sameNotePaths({ a: '/N/A.note', b: '/N/B.note' }, { b: '/N/B.note', a: '/N/A.note' })).toBe(true);
  });

  test('day sets are the same when they hold the same days', () => {
    expect(sameKeys(new Set(), new Set())).toBe(true);
    expect(sameKeys(new Set(['2026-9-1']), new Set(['2026-9-1']))).toBe(true);
    expect(sameKeys(new Set(['2026-9-1']), new Set(['2026-9-2']))).toBe(false);
    expect(sameKeys(new Set(['2026-9-1']), new Set(['2026-9-1', '2026-9-2']))).toBe(false);
  });
});
