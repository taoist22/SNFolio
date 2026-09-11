import {
  parseIcsContent,
  parseIcsDate,
  parseAttendee,
  unfoldIcsContent,
  unescapeIcsValue,
  expandEventsForDate,
} from './icsParser';
import { CalendarEvent } from './types';

/**
 * The device-local day that contains `instant`.
 *
 * Occurrence display is selected device-locally, so a test may only name a day
 * by an absolute instant. Naming it with literal calendar numbers silently
 * asserts that the host timezone puts the occurrence on that date, which is
 * false in any zone far enough from the event's own zone.
 */
function localDayOf(instant: string): Date {
  const at = new Date(instant);
  return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

/** Every occurrence instant visible across the device-local days spanning a range. */
function startsBetween(events: CalendarEvent[], fromInstant: string, toInstant: string): string[] {
  const found = new Set<string>();
  const end = new Date(toInstant).getTime();
  // Step by noon-to-noon so a DST shift can never skip a device-local day.
  for (let t = new Date(fromInstant).getTime(); t <= end; t += 24 * 60 * 60 * 1000) {
    for (const occurrence of expandEventsForDate(events, localDayOf(new Date(t).toISOString()))) {
      found.add(occurrence.start.toISOString());
    }
  }
  return [...found].sort();
}

describe('icsParser', () => {
  test('unfoldIcsContent unfolds lines with leading whitespace', () => {
    const raw = 'SUMMARY:Weekly Team Sync\r\nDESCRIPTION:This is a long description\r\n  that spans multiple lines';
    const unfolded = unfoldIcsContent(raw);
    expect(unfolded.length).toBe(2);
    expect(unfolded[1]).toBe('DESCRIPTION:This is a long description that spans multiple lines');
  });

  test('unescapeIcsValue unescapes special characters', () => {
    expect(unescapeIcsValue('Hello\\, World\\; Line 1\\nLine 2')).toBe('Hello, World; Line 1\nLine 2');
  });

  test('parseIcsDate handles UTC, local, and invalid date formats', () => {
    const utcRes = parseIcsDate('20260816T140000Z');
    expect(utcRes.allDay).toBe(false);
    expect(utcRes.date.toISOString()).toBe('2026-08-16T14:00:00.000Z');

    const localRes = parseIcsDate('20260816T140000');
    expect(localRes.allDay).toBe(false);
    expect(localRes.date.getFullYear()).toBe(2026);

    const dateOnlyRes = parseIcsDate('VALUE=DATE:20260816');
    expect(dateOnlyRes.allDay).toBe(true);
    expect(dateOnlyRes.date.getFullYear()).toBe(2026);

    const fallbackRes = parseIcsDate('invalid-date-string');
    expect(fallbackRes.date).toBeInstanceOf(Date);
  });

  test('parseAttendee parses name, email and status', () => {
    const line = 'ATTENDEE;CN="Sarah Connor";PARTSTAT=ACCEPTED:mailto:s.connor@acme.com';
    const att = parseAttendee(line);
    expect(att.name).toBe('Sarah Connor');
    expect(att.email).toBe('s.connor@acme.com');
    expect(att.status).toBe('ACCEPTED');

    const att2 = parseAttendee('ATTENDEE;PARTSTAT=DECLINED:plainemail@example.com');
    expect(att2.email).toBe('plainemail@example.com');
    expect(att2.status).toBe('DECLINED');
  });

  test('parseIcsContent parses standard VEVENT block and fallback defaults', () => {
    const icsData = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:evt-1001
SUMMARY:Project Architecture Review
DESCRIPTION:Reviewing the Supernote plugin architecture\\nand E-ink UX patterns.
LOCATION:Meeting Room A / Zoom
DTSTART:20260816T140000Z
DTEND:20260816T150000Z
ORGANIZER;CN="taoist22":mailto:ct@example.com
ATTENDEE;CN="Alice";PARTSTAT=ACCEPTED:mailto:alice@example.com
ATTENDEE;CN="Bob";PARTSTAT=TENTATIVE:mailto:bob@example.com
END:VEVENT
BEGIN:VEVENT
UID:evt-1002
DTSTART:20260816T160000Z
END:VEVENT
END:VCALENDAR`;

    const events = parseIcsContent(icsData, 'Work Calendar');
    expect(events.length).toBe(2);

    const evt1 = events[0];
    expect(evt1.uid).toBe('evt-1001');
    expect(evt1.summary).toBe('Project Architecture Review');
    expect(evt1.organizer?.name).toBe('taoist22');

    const evt2 = events[1];
    expect(evt2.summary).toBe('(No Title)');
  });

  test('expandEventsForDate expands daily and weekly recurring events', () => {
    const icsData = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:rec-2002
SUMMARY:Weekly Standup
DTSTART:20260802T090000Z
DTEND:20260802T093000Z
RRULE:FREQ=WEEKLY
END:VEVENT
BEGIN:VEVENT
UID:rec-2003
SUMMARY:Daily Checkin
DTSTART:20260815T080000Z
DTEND:20260815T081500Z
RRULE:FREQ=DAILY
END:VEVENT
END:VCALENDAR`;

    const events = parseIcsContent(icsData);
    const expanded = expandEventsForDate(events, localDayOf('2026-08-16T08:00:00.000Z'));

    expect(expanded.map(e => e.start.toISOString())).toEqual([
      '2026-08-16T08:00:00.000Z',
      '2026-08-16T09:00:00.000Z',
    ]);
    expect(expanded.map(e => e.summary)).toEqual(['Daily Checkin', 'Weekly Standup']);
  });

  test('keeps an every-other-week floating recurrence across a DST boundary', () => {
    const events = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:dst-biweekly
SUMMARY:Biweekly review
DTSTART:20260301T090000
DTEND:20260301T100000
RRULE:FREQ=WEEKLY;INTERVAL=2
END:VEVENT
END:VCALENDAR`);

    const expanded = expandEventsForDate(events, new Date(2026, 2, 15));
    expect(expanded).toHaveLength(1);
    expect(expanded[0].start.getHours()).toBe(9);
  });

  test('expands TZID recurrences in the event zone rather than the device zone', () => {
    const events = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:honolulu-weekly
SUMMARY:Honolulu review
DTSTART;TZID=Pacific/Honolulu:20261025T100000
DTEND;TZID=Pacific/Honolulu:20261025T110000
RRULE:FREQ=WEEKLY
END:VEVENT
END:VCALENDAR`);

    const expectedStart = new Date('2026-11-01T20:00:00.000Z');
    const expanded = expandEventsForDate(
      events,
      new Date(expectedStart.getFullYear(), expectedStart.getMonth(), expectedStart.getDate())
    );
    expect(expanded).toHaveLength(1);
    expect(expanded[0].start.toISOString()).toBe(expectedStart.toISOString());
  });

  test('expands UTC recurrences in UTC rather than the device zone', () => {
    const events = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:utc-weekly
SUMMARY:UTC review
DTSTART:20261025T200000Z
DTEND:20261025T210000Z
RRULE:FREQ=WEEKLY
END:VEVENT
END:VCALENDAR`);

    const expectedStart = new Date('2026-11-01T20:00:00.000Z');
    const expanded = expandEventsForDate(
      events,
      new Date(expectedStart.getFullYear(), expectedStart.getMonth(), expectedStart.getDate())
    );
    expect(expanded).toHaveLength(1);
    expect(expanded[0].start.toISOString()).toBe(expectedStart.toISOString());
  });

  test('a recurring occurrence and an identical single event share one display day', () => {
    // Both describe 10:00 Honolulu on 1 November 2026. Which device-local day an
    // event is shown on must not depend on whether it carries an RRULE, so both
    // are selected by instant against the same device-local window.
    const events = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:single-honolulu
SUMMARY:Single
DTSTART;TZID=Pacific/Honolulu:20261101T100000
DTEND;TZID=Pacific/Honolulu:20261101T110000
END:VEVENT
BEGIN:VEVENT
UID:series-honolulu
SUMMARY:Series
DTSTART;TZID=Pacific/Honolulu:20261025T100000
DTEND;TZID=Pacific/Honolulu:20261025T110000
RRULE:FREQ=WEEKLY
END:VEVENT
END:VCALENDAR`);

    const onDay = expandEventsForDate(events, localDayOf('2026-11-01T20:00:00.000Z'));

    expect(onDay.map(e => e.summary).sort()).toEqual(['Series', 'Single']);
    expect([...new Set(onDay.map(e => e.start.toISOString()))]).toEqual([
      '2026-11-01T20:00:00.000Z',
    ]);
  });

  test('rejects a recurring event with an unknown TZID instead of guessing local time', () => {
    const events = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:unknown-zone
SUMMARY:Unknown zone review
DTSTART;TZID=Not/A_Real_Zone:20260815T100000
DTEND;TZID=Not/A_Real_Zone:20260815T110000
RRULE:FREQ=DAILY
END:VEVENT
END:VCALENDAR`);

    expect(events).toHaveLength(0);
  });

  test('uses the first occurrence for an ambiguous zoned wall-clock time', () => {
    const parsed = parseIcsDate('DTSTART;TZID=America/New_York:20261101T013000');
    expect(parsed.date.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  test('uses the pre-gap offset for an explicit nonexistent zoned wall-clock time', () => {
    const parsed = parseIcsDate('DTSTART;TZID=America/New_York:20260308T023000');
    expect(parsed.date.toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });

  test('omits recurrence-generated gap times without consuming COUNT', () => {
    const events = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:spring-gap-daily
SUMMARY:Gap review
DTSTART;TZID=America/New_York:20260307T023000
DTEND;TZID=America/New_York:20260307T033000
RRULE:FREQ=DAILY;COUNT=3
END:VEVENT
END:VCALENDAR`);

    // 02:30 on 8 March does not exist in America/New_York, so that occurrence is
    // dropped without consuming COUNT: the series still yields three instants and
    // therefore runs one civil day further than a naive expansion would.
    expect(startsBetween(events, '2026-03-01T12:00:00.000Z', '2026-03-20T12:00:00.000Z')).toEqual([
      '2026-03-07T07:30:00.000Z',
      '2026-03-09T06:30:00.000Z',
      '2026-03-10T06:30:00.000Z',
    ]);
  });

  test.each([
    ['missing FREQ', 'INTERVAL=2'],
    ['duplicate FREQ', 'FREQ=DAILY;FREQ=WEEKLY'],
    ['COUNT plus UNTIL', 'FREQ=DAILY;COUNT=2;UNTIL=20260820T090000'],
    ['zero INTERVAL', 'FREQ=DAILY;INTERVAL=0'],
    ['unsupported BYSETPOS', 'FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1'],
    ['BYMONTHDAY with WEEKLY', 'FREQ=WEEKLY;BYMONTHDAY=1'],
    ['ordinal BYDAY with DAILY', 'FREQ=DAILY;BYDAY=1MO'],
  ])('marks %s as non-expandable', (_label, rrule) => {
    const events = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:invalid-rule
SUMMARY:Invalid recurrence
DTSTART:20260815T090000
DTEND:20260815T100000
RRULE:${rrule}
END:VEVENT
END:VCALENDAR`);

    expect(events).toHaveLength(1);
    expect(events[0].recurrenceError).toBeTruthy();
    expect(expandEventsForDate(events, new Date(2026, 7, 15))).toHaveLength(1);
    expect(expandEventsForDate(events, new Date(2026, 7, 16))).toHaveLength(0);
  });

  test('bounds a server-supplied RRULE token quoted into the stored warning', () => {
    // The warning is persisted on the event and rendered, so a hostile server
    // must not be able to turn one RRULE part into an unbounded record.
    const overlongToken = 'A'.repeat(5000);
    const events = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:overlong-rule
SUMMARY:Overlong recurrence
DTSTART:20260815T090000
DTEND:20260815T100000
RRULE:FREQ=WEEKLY;BYDAY=${overlongToken}
END:VEVENT
END:VCALENDAR`);

    const warning = events[0].recurrenceError as string;
    expect(warning).toMatch(/BYDAY token/i);
    expect(warning).not.toContain(overlongToken);
    expect(warning.length).toBeLessThan(120);
  });

  test.each([
    [
      'zoned DTSTART with local UNTIL',
      'DTSTART;TZID=America/New_York:20260815T090000',
      'DTEND;TZID=America/New_York:20260815T100000',
      'FREQ=DAILY;UNTIL=20260817T090000',
    ],
    [
      'floating DTSTART with UTC UNTIL',
      'DTSTART:20260815T090000',
      'DTEND:20260815T100000',
      'FREQ=DAILY;UNTIL=20260817T090000Z',
    ],
    [
      'DATE DTSTART with DATE-TIME UNTIL',
      'DTSTART;VALUE=DATE:20260815',
      'DTEND;VALUE=DATE:20260816',
      'FREQ=DAILY;UNTIL=20260817T000000Z',
    ],
  ])('rejects %s', (_label, start, end, rrule) => {
    const events = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:until-mismatch
SUMMARY:Until mismatch
${start}
${end}
RRULE:${rrule}
END:VEVENT
END:VCALENDAR`);

    expect(events[0].recurrenceError).toMatch(/UNTIL/i);
  });

  test('treats DTSTART as occurrence one even when BYDAY does not match it', () => {
    const events = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:start-counts
SUMMARY:Start counts
DTSTART:20260803T090000
DTEND:20260803T100000
RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=2
END:VEVENT
END:VCALENDAR`);

    expect(expandEventsForDate(events, new Date(2026, 7, 3))).toHaveLength(1);
    expect(expandEventsForDate(events, new Date(2026, 7, 5))).toHaveLength(1);
    expect(expandEventsForDate(events, new Date(2026, 7, 12))).toHaveLength(0);
  });

  test('accepts a UTC UNTIL for TZID DTSTART and includes the boundary', () => {
    const events = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:zoned-until
SUMMARY:Zoned until
DTSTART;TZID=America/New_York:20260815T090000
DTEND;TZID=America/New_York:20260815T100000
RRULE:FREQ=DAILY;UNTIL=20260817T130000Z
END:VEVENT
END:VCALENDAR`);

    expect(events[0].recurrenceError).toBeUndefined();
    // UNTIL is inclusive, so the 17 August instant is the final occurrence.
    expect(startsBetween(events, '2026-08-12T12:00:00.000Z', '2026-08-21T12:00:00.000Z')).toEqual([
      '2026-08-15T13:00:00.000Z',
      '2026-08-16T13:00:00.000Z',
      '2026-08-17T13:00:00.000Z',
    ]);
  });

  test('defaults a DATE event without DTEND to one full day', () => {
    const events = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:all-day-default
SUMMARY:All day
DTSTART;VALUE=DATE:20260815
END:VEVENT
END:VCALENDAR`);

    expect(events).toHaveLength(1);
    expect(events[0].allDay).toBe(true);
    expect(events[0].end.getTime() - events[0].start.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(expandEventsForDate(events, new Date(2026, 7, 15))).toHaveLength(1);
    expect(expandEventsForDate(events, new Date(2026, 7, 16))).toHaveLength(0);
  });

  test('shows every recurring overnight occurrence that overlaps the target day', () => {
    const events = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:overnight-daily
SUMMARY:Night shift
DTSTART:20260820T220000
DTEND:20260821T020000
RRULE:FREQ=DAILY;COUNT=3
END:VEVENT
END:VCALENDAR`);

    const aug21 = expandEventsForDate(events, new Date(2026, 7, 21));
    expect(aug21).toHaveLength(2);
    expect(aug21.map(event => event.start.getDate())).toEqual([20, 21]);
  });

  test('supports negative BYMONTHDAY and ordinal monthly BYDAY', () => {
    const lastDay = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:last-day
SUMMARY:Month close
DTSTART:20260131T090000
DTEND:20260131T100000
RRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3
END:VEVENT
END:VCALENDAR`);
    const lastMonday = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:last-monday
SUMMARY:Monday close
DTSTART:20260126T090000
DTEND:20260126T100000
RRULE:FREQ=MONTHLY;BYDAY=-1MO;COUNT=3
END:VEVENT
END:VCALENDAR`);

    expect(expandEventsForDate(lastDay, new Date(2026, 1, 28))).toHaveLength(1);
    expect(expandEventsForDate(lastDay, new Date(2026, 2, 31))).toHaveLength(1);
    expect(expandEventsForDate(lastMonday, new Date(2026, 1, 23))).toHaveLength(1);
    expect(expandEventsForDate(lastMonday, new Date(2026, 2, 30))).toHaveLength(1);
  });

  test('expands a simple monthly rule on the same calendar day', () => {
    const events = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:monthly-1
SUMMARY:Monthly review
DTSTART:20260821T090000
DTEND:20260821T100000
RRULE:FREQ=MONTHLY
END:VEVENT
END:VCALENDAR`);

    expect(expandEventsForDate(events, new Date(2026, 7, 21))).toHaveLength(1);
    expect(expandEventsForDate(events, new Date(2026, 8, 20))).toHaveLength(0);
    expect(expandEventsForDate(events, new Date(2026, 8, 21))).toHaveLength(1);
    expect(expandEventsForDate(events, new Date(2026, 9, 21))).toHaveLength(1);
  });

  test('expandEventsForDate respects exceptionDates for single occurrence deletion', () => {
    const icsData = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:rec-3001
SUMMARY:Daily Sync
DTSTART:20260815T080000Z
DTEND:20260815T081500Z
RRULE:FREQ=DAILY
END:VEVENT
END:VCALENDAR`;

    const events = parseIcsContent(icsData);
    // A DATE exclusion is keyed in the recurrence's own calendar (UTC here), not
    // the device's, so the suppressed instant is the same in every host zone.
    events[0].exceptionDates = ['2026-08-16'];

    const starts = startsBetween(events, '2026-08-13T12:00:00.000Z', '2026-08-20T12:00:00.000Z');
    expect(starts).toContain('2026-08-15T08:00:00.000Z');
    expect(starts).toContain('2026-08-17T08:00:00.000Z');
    expect(starts).not.toContain('2026-08-16T08:00:00.000Z');
  });

  test('stores DATE exclusions only as date keys', () => {
    const [event] = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:all-day-exdate
SUMMARY:Daily leave
DTSTART;VALUE=DATE:20260815
DTEND;VALUE=DATE:20260816
RRULE:FREQ=DAILY
EXDATE;VALUE=DATE:20260816
END:VEVENT
END:VCALENDAR`);

    expect(event.exceptionDates).toEqual(['2026-08-16']);
    expect(event.recurrenceExceptionInstants).toEqual([]);
  });

  test('honours INTERVAL, BYDAY, COUNT and UNTIL recurrence fields', () => {
    const everyOtherMonWed = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:class-1
SUMMARY:Class
DTSTART:20260803T090000
DTEND:20260803T100000
RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4
END:VEVENT
END:VCALENDAR`);

    expect(expandEventsForDate(everyOtherMonWed, new Date(2026, 7, 3))).toHaveLength(1);
    expect(expandEventsForDate(everyOtherMonWed, new Date(2026, 7, 5))).toHaveLength(1);
    expect(expandEventsForDate(everyOtherMonWed, new Date(2026, 7, 10))).toHaveLength(0);
    expect(expandEventsForDate(everyOtherMonWed, new Date(2026, 7, 17))).toHaveLength(1);
    expect(expandEventsForDate(everyOtherMonWed, new Date(2026, 7, 19))).toHaveLength(1);
    expect(expandEventsForDate(everyOtherMonWed, new Date(2026, 7, 31))).toHaveLength(0);

    const until = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:daily-until
SUMMARY:Short run
DTSTART:20260801T090000
DTEND:20260801T100000
RRULE:FREQ=DAILY;UNTIL=20260803T235959
END:VEVENT
END:VCALENDAR`);
    expect(expandEventsForDate(until, new Date(2026, 7, 3))).toHaveLength(1);
    expect(expandEventsForDate(until, new Date(2026, 7, 4))).toHaveLength(0);
  });

  test('folds EXDATE and RECURRENCE-ID replacements into a recurring series', () => {
    const events = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:sync-1
SUMMARY:Daily sync
DTSTART:20260801T090000
DTEND:20260801T100000
RRULE:FREQ=DAILY
EXDATE:20260802T090000
END:VEVENT
BEGIN:VEVENT
UID:sync-1
RECURRENCE-ID:20260803T090000
SUMMARY:Moved sync
DTSTART:20260803T130000
DTEND:20260803T140000
END:VEVENT
END:VCALENDAR`);

    expect(expandEventsForDate(events, new Date(2026, 7, 2))).toHaveLength(0);
    const aug3 = expandEventsForDate(events, new Date(2026, 7, 3));
    expect(aug3).toHaveLength(1);
    expect(aug3[0].summary).toBe('Moved sync');
    expect(aug3[0].start.getHours()).toBe(13);
  });

  test('matches TZID EXDATE by exact recurrence instant', () => {
    const events = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:zoned-exdate
SUMMARY:New York sync
DTSTART;TZID=America/New_York:20260801T090000
DTEND;TZID=America/New_York:20260801T100000
RRULE:FREQ=DAILY;COUNT=3
EXDATE;TZID=America/New_York:20260802T090000
END:VEVENT
END:VCALENDAR`);

    // The exclusion removes the 2 August instant from a three-occurrence series
    // without shifting the remaining instants.
    expect(startsBetween(events, '2026-07-29T12:00:00.000Z', '2026-08-07T12:00:00.000Z')).toEqual([
      '2026-08-01T13:00:00.000Z',
      '2026-08-03T13:00:00.000Z',
    ]);
  });

  test('folds a zoned RECURRENCE-ID into a moved replacement', () => {
    const events = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:zoned-move
SUMMARY:New York sync
DTSTART;TZID=America/New_York:20260801T090000
DTEND;TZID=America/New_York:20260801T100000
RRULE:FREQ=DAILY;COUNT=3
END:VEVENT
BEGIN:VEVENT
UID:zoned-move
RECURRENCE-ID;TZID=America/New_York:20260802T090000
SUMMARY:Moved sync
DTSTART;TZID=America/New_York:20260802T150000
DTEND;TZID=America/New_York:20260802T160000
END:VEVENT
END:VCALENDAR`);

    const expectedStart = new Date('2026-08-02T19:00:00.000Z');
    const replacementDay = new Date(
      expectedStart.getFullYear(),
      expectedStart.getMonth(),
      expectedStart.getDate()
    );
    const replacement = expandEventsForDate(events, replacementDay);
    const moved = replacement.find(event => event.summary === 'Moved sync');
    expect(moved).toBeDefined();
    expect(moved?.start.toISOString()).toBe(expectedStart.toISOString());
  });

  test('honours a cancelled RECURRENCE-ID without requiring DTSTART', () => {
    const events = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:cancel-one
SUMMARY:Daily sync
DTSTART:20260801T090000
DTEND:20260801T100000
RRULE:FREQ=DAILY;COUNT=3
END:VEVENT
BEGIN:VEVENT
UID:cancel-one
RECURRENCE-ID:20260802T090000
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR`);

    expect(expandEventsForDate(events, new Date(2026, 7, 1))).toHaveLength(1);
    expect(expandEventsForDate(events, new Date(2026, 7, 2))).toHaveLength(0);
    expect(expandEventsForDate(events, new Date(2026, 7, 3))).toHaveLength(1);
  });

  test('EXDATE does not hide an overlapping occurrence from the previous day', () => {
    const events = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:overnight-exdate
SUMMARY:Night shift
DTSTART:20260820T220000
DTEND:20260821T020000
RRULE:FREQ=DAILY;COUNT=3
EXDATE:20260821T220000
END:VEVENT
END:VCALENDAR`);

    const aug21 = expandEventsForDate(events, new Date(2026, 7, 21));
    expect(aug21).toHaveLength(1);
    expect(aug21[0].start.getDate()).toBe(20);
  });

  test('converts a TZID wall-clock time into the correct instant', () => {
    const parsed = parseIcsDate('DTSTART;TZID=America/New_York:20260820T100000');
    expect(parsed.date.toISOString()).toBe('2026-08-20T14:00:00.000Z');
  });

  test('drops malformed events instead of placing them at the current time', () => {
    const events = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:bad-date
SUMMARY:Broken
DTSTART:not-a-date
END:VEVENT
END:VCALENDAR`);
    expect(events).toHaveLength(0);
  });

  test('retains the hidden SNFolio task-mirror marker', () => {
    const events = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:task-1787558400000
SUMMARY:Buy milk
X-SNFOLIO-TASK-MIRROR:TRUE
DTSTART:20260824T090000
DTEND:20260824T093000
END:VEVENT
END:VCALENDAR`);

    expect(events).toHaveLength(1);
    expect(events[0].isTaskMirror).toBe(true);
    expect(events[0].summary).toBe('Buy milk');
  });

  test('shows overnight and multi-day events on each overlapping day', () => {
    const events = parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:trip
SUMMARY:Trip
DTSTART:20260820T220000
DTEND:20260822T080000
END:VEVENT
END:VCALENDAR`);
    expect(expandEventsForDate(events, new Date(2026, 7, 20))).toHaveLength(1);
    expect(expandEventsForDate(events, new Date(2026, 7, 21))).toHaveLength(1);
    expect(expandEventsForDate(events, new Date(2026, 7, 22))).toHaveLength(1);
    expect(expandEventsForDate(events, new Date(2026, 7, 23))).toHaveLength(0);
  });
});
