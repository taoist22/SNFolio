import { generateOutboundIcsEvent, generateOutboundIcsTodo } from './noteExporter';
import { CalendarEvent } from './types';

describe('noteExporter', () => {
  const sampleEvent: CalendarEvent = {
    uid: 'evt-exp-1',
    summary: 'Physics 301 Midterm Sync',
    description: '1. Review Mechanics\n2. Lab reports',
    location: 'Science Hall 101',
    start: new Date('2026-08-25T10:00:00Z'),
    end: new Date('2026-08-25T11:30:00Z'),
    allDay: false,
    organizer: { name: 'Prof. Davis', email: 'davis@univ.edu' },
    attendees: [{ name: 'Alex Smith', email: 'alex@univ.edu', status: 'ACCEPTED' }],
    actionItems: ['Review Mechanics', 'Submit Lab report'],
  };


  test('generateOutboundIcsEvent formats valid RFC 5545 VEVENT string', () => {
    const ics = generateOutboundIcsEvent(sampleEvent);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('SUMMARY:Physics 301 Midterm Sync');
    expect(ics).toContain('LOCATION:Science Hall 101');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
  });

  test('marks a task-mirror event without exposing the marker in its title', () => {
    const ics = generateOutboundIcsEvent({
      ...sampleEvent,
      uid: 'task-1787558400000',
      summary: 'Buy milk',
      isTaskMirror: true,
    });

    expect(ics).toContain('\r\nSUMMARY:Buy milk\r\n');
    expect(ics).toContain('\r\nX-SNFOLIO-TASK-MIRROR:TRUE\r\n');
  });

  test('generateOutboundIcsEvent emits DTSTAMP, which iCloud requires', () => {
    const ics = generateOutboundIcsEvent(sampleEvent);
    expect(ics).toMatch(/\r\nDTSTAMP:\d{8}T\d{6}Z\r\n/);
  });

  test('generateOutboundIcsEvent emits a display alarm when requested', () => {
    const ics = generateOutboundIcsEvent({ ...sampleEvent, alarmMinutesBefore: 15 });
    expect(ics).toContain('BEGIN:VALARM\r\n');
    expect(ics).toContain('TRIGGER:-PT15M\r\n');
    expect(ics).toContain('ACTION:DISPLAY\r\n');
    expect(ics).toContain('DESCRIPTION:Physics 301 Midterm Sync\r\nEND:VALARM');
  });

  test('a zero-minute alarm fires at event start', () => {
    const ics = generateOutboundIcsEvent({ ...sampleEvent, alarmMinutesBefore: 0 });
    expect(ics).toContain('TRIGGER:PT0M\r\n');
  });

  test('generateOutboundIcsEvent terminates every content line with CRLF', () => {
    const ics = generateOutboundIcsEvent(sampleEvent);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
  });

  test('generateOutboundIcsEvent escapes TEXT separators per RFC 5545', () => {
    const ics = generateOutboundIcsEvent({
      ...sampleEvent,
      summary: 'Standup, Tuesday; week 3',
      location: 'Bldg C\\Room 2, Level 1',
      description: 'Line one\nLine two, with comma',
    });

    expect(ics).toContain('SUMMARY:Standup\\, Tuesday\\; week 3');
    expect(ics).toContain('LOCATION:Bldg C\\\\Room 2\\, Level 1');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two\\, with comma');
  });

  test('generateOutboundIcsEvent folds content lines at 75 octets', () => {
    const ics = generateOutboundIcsEvent({
      ...sampleEvent,
      description: 'x'.repeat(400),
    });

    const octets = (s: string) =>
      [...s].reduce((n, ch) => {
        const cp = ch.codePointAt(0) as number;
        return n + (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);
      }, 0);
    const lines = ics.split('\r\n').filter(Boolean);

    expect(lines.every(l => octets(l) <= 75)).toBe(true);
    expect(lines.some(l => l.startsWith(' '))).toBe(true);
    // Unfolding must restore the original value.
    expect(ics.replace(/\r\n /g, '')).toContain(`DESCRIPTION:${'x'.repeat(400)}`);
  });



  test('generateOutboundIcsTodo emits a VTODO with DUE, not a VEVENT', () => {
    const ics = generateOutboundIcsTodo({
      ...sampleEvent,
      uid: 'task-1',
      summary: '[TASK] Submit lab report',
      isTask: true,
      allDay: false,
    });

    expect(ics).toContain('BEGIN:VTODO');
    expect(ics).toContain('END:VTODO');
    expect(ics).not.toContain('VEVENT');
    expect(ics).toMatch(/\r\nDUE:\d{8}T\d{6}Z\r\n/);
    // VTODO has no DTEND — a task has a deadline, not a duration.
    expect(ics).not.toContain('DTEND');
    expect(ics).toMatch(/\r\nDTSTAMP:\d{8}T\d{6}Z\r\n/);
  });

  test('generateOutboundIcsTodo strips the legacy [TASK] display prefix', () => {
    const ics = generateOutboundIcsTodo({ ...sampleEvent, summary: '[TASK] Buy milk', isTask: true });
    expect(ics).toContain('SUMMARY:Buy milk');
    expect(ics).not.toContain('[TASK]');
  });

  test('generateOutboundIcsTodo reflects completion state', () => {
    const open = generateOutboundIcsTodo({ ...sampleEvent, isTask: true });
    expect(open).toContain('STATUS:NEEDS-ACTION');
    expect(open).toContain('PERCENT-COMPLETE:0');
    expect(open).not.toContain('COMPLETED:');

    const done = generateOutboundIcsTodo({ ...sampleEvent, isTask: true, completed: true });
    expect(done).toContain('STATUS:COMPLETED');
    expect(done).toContain('PERCENT-COMPLETE:100');
    expect(done).toMatch(/\r\nCOMPLETED:\d{8}T\d{6}Z\r\n/);
  });

  test('generateOutboundIcsTodo uses a DATE-valued DUE for all-day tasks', () => {
    const ics = generateOutboundIcsTodo({
      ...sampleEvent,
      isTask: true,
      allDay: true,
      start: new Date(2026, 7, 25),
    });
    expect(ics).toContain('DUE;VALUE=DATE:20260825');
  });

  test('generateOutboundIcsTodo keeps undated tasks undated and maps priority', () => {
    const ics = generateOutboundIcsTodo({
      ...sampleEvent,
      isTask: true,
      undatedTask: true,
      priority: 4,
    });
    expect(ics).not.toMatch(/\r\nDUE[;:]/);
    expect(ics).toContain('PRIORITY:1');
  });

  test('generateOutboundIcsEvent uses the DATE value type for all-day events', () => {
    const ics = generateOutboundIcsEvent({
      ...sampleEvent,
      allDay: true,
      start: new Date(2026, 7, 25),
      end: new Date(2026, 7, 26),
    });

    expect(ics).toContain('DTSTART;VALUE=DATE:20260825');
    expect(ics).toContain('DTEND;VALUE=DATE:20260826');
    expect(ics).not.toContain('DTSTART:2026');
  });

  test('editing an imported recurring event preserves recurrence and participants', () => {
    const ics = generateOutboundIcsEvent({
      ...sampleEvent,
      rrule: 'FREQ=WEEKLY;BYDAY=MO,WE',
      recurrenceValueType: 'utc',
      recurrenceTimeZone: 'UTC',
      recurrenceExceptionInstants: ['2026-08-26T10:00:00.000Z'],
      organizer: { name: 'Ada', email: 'ada@example.com' },
      attendees: [{ name: 'Grace', email: 'grace@example.com', status: 'ACCEPTED' }],
    });
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE');
    expect(ics).toContain('EXDATE:20260826T100000Z');
    expect(ics).toContain('ORGANIZER;CN=Ada:mailto:ada@example.com');
    expect(ics).toContain('ATTENDEE;CN=Grace;PARTSTAT=ACCEPTED:mailto:grace@example.com');
  });

  test('round-trips a TZID recurrence without converting it to fixed UTC wall time', () => {
    const ics = generateOutboundIcsEvent({
      ...sampleEvent,
      start: new Date('2026-10-30T13:00:00.000Z'),
      end: new Date('2026-10-30T14:00:00.000Z'),
      rrule: 'FREQ=DAILY;COUNT=4',
      timeZone: 'America/New_York',
      recurrenceTimeZone: 'America/New_York',
      recurrenceValueType: 'zoned',
      recurrenceExceptionInstants: ['2026-11-01T14:00:00.000Z'],
    });

    expect(ics).toContain('DTSTART;TZID=America/New_York:20261030T090000');
    expect(ics).toContain('DTEND;TZID=America/New_York:20261030T100000');
    expect(ics).toContain('EXDATE;TZID=America/New_York:20261101T090000');
    expect(ics).not.toContain('DTSTART:20261030T130000Z');
  });

  test('exports a new metadata-free recurrence as floating device-local time', () => {
    const start = new Date(2026, 2, 7, 9, 0, 0);
    const end = new Date(2026, 2, 7, 10, 0, 0);
    const ics = generateOutboundIcsEvent({
      ...sampleEvent,
      start,
      end,
      rrule: 'FREQ=WEEKLY;COUNT=3',
      recurrenceValueType: undefined,
      recurrenceTimeZone: undefined,
      timeZone: undefined,
    });

    expect(ics).toContain('DTSTART:20260307T090000');
    expect(ics).toContain('DTEND:20260307T100000');
    expect(ics).not.toMatch(/DTSTART:\d{8}T\d{6}Z/);
  });

  test('preserves exact imported DATE-TIME recurrence exceptions', () => {
    const ics = generateOutboundIcsEvent({
      ...sampleEvent,
      rrule: 'FREQ=DAILY',
      recurrenceValueType: 'utc',
      recurrenceTimeZone: 'UTC',
      recurrenceExceptionInstants: ['2026-08-26T14:30:00.000Z'],
    });

    expect(ics).toContain('EXDATE:20260826T143000Z');
  });

  test('does not guess an instant from a legacy date-only exception on a timed event', () => {
    const ics = generateOutboundIcsEvent({
      ...sampleEvent,
      rrule: 'FREQ=DAILY',
      exceptionDates: ['2026-08-26'],
      recurrenceTimeZone: 'Pacific/Honolulu',
      recurrenceValueType: 'zoned',
    });

    expect(ics).not.toContain('EXDATE:');
  });
});
