import { parseIcsContent, expandEventsForDate } from './icsParser';
import { generateOutboundIcsEvent } from './noteExporter';
import { rruleForRepeat } from './recurrence';
import { CalendarEvent } from './types';

const wrap = (body: string) => `BEGIN:VCALENDAR\n${body}\nEND:VCALENDAR`;
const vevent = (body: string) => `BEGIN:VEVENT\n${body}\nEND:VEVENT`;

test('editor-created timed repeat with an end date survives export and reimport', () => {
  const start = new Date(2026, 8, 5, 9);
  const event: CalendarEvent = {
    uid: 'editor-until',
    summary: 'Editor until',
    start,
    end: new Date(2026, 8, 5, 10),
    allDay: false,
    attendees: [],
    rrule: rruleForRepeat({
      choice: 'daily',
      interval: 1,
      weekDays: [],
      endMode: 'until',
      until: new Date(2026, 8, 8),
      count: 10,
    }, start, false),
  };
  const imported = parseIcsContent(generateOutboundIcsEvent(event));
  expect(imported[0].recurrenceError).toBeUndefined();
  expect(expandEventsForDate(imported, new Date(2026, 8, 6))).toHaveLength(1);
  expect(expandEventsForDate(imported, new Date(2026, 8, 8))).toHaveLength(1);
  expect(expandEventsForDate(imported, new Date(2026, 8, 9))).toHaveLength(0);
});

test('legacy timed exclusion survives export and reimport', () => {
  const event: CalendarEvent = {
    uid: 'legacy',
    summary: 'Legacy',
    start: new Date(2026, 8, 5, 9),
    end: new Date(2026, 8, 5, 10),
    allDay: false,
    attendees: [],
    rrule: 'FREQ=DAILY;COUNT=3',
    exceptionDates: ['2026-09-06'],
  };
  expect(expandEventsForDate([event], new Date(2026, 8, 6))).toHaveLength(0);
  const imported = parseIcsContent(generateOutboundIcsEvent(event));
  expect(expandEventsForDate(imported, new Date(2026, 8, 6))).toHaveLength(0);
});

test('all-day cancelled recurrence survives master export and reimport', () => {
  const events = parseIcsContent(wrap([
    vevent('UID:all-day\nDTSTART;VALUE=DATE:20260905\nDTEND;VALUE=DATE:20260906\nRRULE:FREQ=DAILY;COUNT=3'),
    vevent('UID:all-day\nRECURRENCE-ID;VALUE=DATE:20260906\nDTSTART;VALUE=DATE:20260906\nDTEND;VALUE=DATE:20260907\nSTATUS:CANCELLED'),
  ].join('\n')));
  expect(expandEventsForDate(events, new Date(2026, 8, 6))).toHaveLength(0);
  const imported = parseIcsContent(generateOutboundIcsEvent(events[0]));
  expect(expandEventsForDate(imported, new Date(2026, 8, 6))).toHaveLength(0);
});

test('all-day cancellation without DTSTART remains a date exclusion', () => {
  const events = parseIcsContent(wrap([
    vevent('UID:all-day-bare-cancel\nDTSTART;VALUE=DATE:20260905\nDTEND;VALUE=DATE:20260906\nRRULE:FREQ=DAILY;COUNT=3'),
    vevent('UID:all-day-bare-cancel\nRECURRENCE-ID;VALUE=DATE:20260906\nSTATUS:CANCELLED'),
  ].join('\n')));
  const imported = parseIcsContent(generateOutboundIcsEvent(events[0]));
  expect(expandEventsForDate(imported, new Date(2026, 8, 6))).toHaveLength(0);
});

test('all-day moved recurrence preserves the original-date exclusion on export', () => {
  const events = parseIcsContent(wrap([
    vevent('UID:all-day-moved\nDTSTART;VALUE=DATE:20260905\nDTEND;VALUE=DATE:20260906\nRRULE:FREQ=DAILY;COUNT=3'),
    vevent('UID:all-day-moved\nRECURRENCE-ID;VALUE=DATE:20260906\nDTSTART;VALUE=DATE:20260908\nDTEND;VALUE=DATE:20260909'),
  ].join('\n')));
  const master = events.find(event => event.rrule);
  const replacement = events.find(event => event.recurringSeriesId === 'all-day-moved' && !event.rrule);
  expect(master).toBeDefined();
  expect(replacement?.start).toEqual(new Date(2026, 8, 8));

  const importedMaster = parseIcsContent(generateOutboundIcsEvent(master as CalendarEvent));
  expect(expandEventsForDate(importedMaster, new Date(2026, 8, 6))).toHaveLength(0);
});

test.each([
  {
    name: 'DATE override on a timed master',
    master: 'DTSTART:20260905T090000\nDTEND:20260905T100000',
    override: 'RECURRENCE-ID;VALUE=DATE:20260906\nDTSTART;VALUE=DATE:20260908\nDTEND;VALUE=DATE:20260909',
  },
  {
    name: 'DATE-TIME override on an all-day master',
    master: 'DTSTART;VALUE=DATE:20260905\nDTEND;VALUE=DATE:20260906',
    override: 'RECURRENCE-ID:20260906T090000\nDTSTART:20260908T090000\nDTEND:20260908T100000',
  },
])('fails closed for $name', ({ master, override }) => {
  const events = parseIcsContent(wrap([
    vevent(`UID:mismatched-domain\n${master}\nRRULE:FREQ=DAILY;COUNT=3`),
    vevent(`UID:mismatched-domain\n${override}`),
  ].join('\n')));

  expect(events).toHaveLength(1);
  expect(events[0].recurrenceError).toMatch(/RECURRENCE-ID.*DTSTART/);
  expect(events[0].exceptionDates).toBeUndefined();
  expect(events[0].recurrenceExceptionInstants).toBeUndefined();
});
