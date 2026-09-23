import {
  repeatChoiceFromRrule,
  repeatSettingsFromRrule,
  rruleForRepeat,
} from './recurrence';
import { eventsOnDay, expandEventsByDay } from './icsParser';
import { CalendarEvent } from './types';

const START = new Date(2026, 7, 21, 9, 30); // Friday

describe('recurrence form helpers', () => {
  test('recognises and parses a bounded multi-day weekly rule', () => {
    const parsed = repeatSettingsFromRrule(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=12',
      START
    );
    expect(parsed).toMatchObject({
      choice: 'weekly', interval: 2, weekDays: ['MO', 'WE'], endMode: 'count', count: 12,
    });
    expect(repeatChoiceFromRrule(undefined)).toBe('none');
  });

  test('defaults weekly recurrence to the selected start weekday', () => {
    const settings = repeatSettingsFromRrule(undefined, START);
    settings.choice = 'weekly';
    expect(rruleForRepeat(settings, START)).toBe('FREQ=WEEKLY;BYDAY=FR');
  });

  test('builds interval, selected weekdays and a count', () => {
    expect(rruleForRepeat({
      choice: 'weekly', interval: 2, weekDays: ['MO', 'WE'], endMode: 'count', count: 12,
    }, START)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=12');
  });

  test('builds an inclusive date UNTIL for all-day recurrence', () => {
    expect(rruleForRepeat({
      choice: 'daily', interval: 1, weekDays: [], endMode: 'until',
      until: new Date(2026, 8, 5), count: 10,
    }, START, true)).toBe('FREQ=DAILY;UNTIL=20260905');
  });

  test('none explicitly removes recurrence', () => {
    expect(rruleForRepeat({
      choice: 'none', interval: 1, weekDays: [], endMode: 'never', count: 10,
    }, START)).toBeUndefined();
  });
});

describe('COUNT rules reach the same occurrences however far ahead the window is', () => {
  const event = (rrule: string, start: Date, allDay = false): CalendarEvent => ({
    uid: 'series', summary: 'Series', start, end: new Date(start.getTime() + 3600000),
    allDay, attendees: [], rrule,
  });
  /** Every occurrence, taken from a window that begins at DTSTART so nothing can be skipped. */
  const fromTheStart = (item: CalendarEvent) =>
    expandEventsByDay([item], item.start, new Date(item.start.getFullYear() + 12, 0, 1));

  const cases: Array<[string, CalendarEvent]> = [
    ['weekly', event('FREQ=WEEKLY;COUNT=52', new Date(2026, 0, 5, 9))],
    ['weekly, every other week', event('FREQ=WEEKLY;INTERVAL=2;COUNT=26', new Date(2026, 0, 5, 9))],
    ['weekly on set days', event('FREQ=WEEKLY;BYDAY=MO,WE;COUNT=40', new Date(2026, 0, 5, 9))],
    ['monthly on the 15th', event('FREQ=MONTHLY;COUNT=24', new Date(2026, 0, 15, 9))],
    ['monthly on the 31st', event('FREQ=MONTHLY;COUNT=24', new Date(2026, 0, 31, 9))],
    ['monthly by month day', event('FREQ=MONTHLY;BYMONTHDAY=29;COUNT=24', new Date(2026, 0, 29, 9))],
    ['yearly', event('FREQ=YEARLY;COUNT=6', new Date(2026, 5, 10, 9))],
    ['yearly on 29 February', event('FREQ=YEARLY;COUNT=6', new Date(2024, 1, 29, 9))],
    ['daily', event('FREQ=DAILY;COUNT=120', new Date(2026, 0, 5, 9))],
    ['all-day weekly', event('FREQ=WEEKLY;COUNT=52', new Date(2026, 0, 5), true)],
  ];

  test.each(cases)('%s', (_label, item) => {
    const everything = fromTheStart(item);
    // Windows at the start, in the middle and past the end of the series.
    for (const [year, month] of [[2026, 0], [2026, 6], [2027, 0], [2029, 3]] as Array<[number, number]>) {
      const first = new Date(year, month, 1);
      const last = new Date(year, month + 1, 0);
      const direct = expandEventsByDay([item], first, last);
      for (let day = 1; day <= last.getDate(); day++) {
        const date = new Date(year, month, day);
        expect(eventsOnDay(direct, date).map(instance => instance.start.toISOString()))
          .toEqual(eventsOnDay(everything, date).map(instance => instance.start.toISOString()));
      }
    }
  });
});
