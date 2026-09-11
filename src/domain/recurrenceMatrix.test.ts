import { parseIcsContent, expandEventsForDate } from './icsParser';
import { CalendarEvent } from './types';

/**
 * Recurrence regression matrix.
 *
 * Every case names occurrences by absolute instant, never by literal calendar
 * numbers and never through `Date.getHours()`. A test that spells the expected
 * day out in digits silently asserts that the host timezone agrees with the
 * event's own zone, which is false in any zone far enough away — that is
 * exactly how the original TZID defect stayed green for so long.
 *
 * The matrix crosses DTSTART form, frequency, interval, end rule, DST
 * behaviour, exceptions, event shape, zone relationship, and query boundary.
 */

/** The device-local day that contains `instant`. */
function localDayOf(instant: string | Date): Date {
  const at = new Date(instant);
  return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The device-local days that a UTC instant range covers, padded by a day at
 * each end.
 *
 * A range named in UTC does not name the same set of device-local days
 * everywhere: at UTC+14 an instant of 12:00Z is already the following local
 * day, and at UTC-11 it is still the previous one. Without the padding a scan
 * silently omits the local day holding the first or last occurrence, which
 * looks exactly like a missing occurrence. Every case below therefore leaves
 * at least a day of slack around the instants it asserts.
 *
 * Steps noon-to-noon so a DST shift can never skip or double-count a day.
 */
function localDaysCovering(fromInstant: string, toInstant: string): Date[] {
  const days: Date[] = [];
  const end = new Date(toInstant).getTime() + DAY_MS;
  for (let t = new Date(fromInstant).getTime() - DAY_MS; t <= end; t += DAY_MS) {
    days.push(localDayOf(new Date(t)));
  }
  return days;
}

/** Occurrence instants visible across the device-local days spanning a range. */
function startsBetween(events: CalendarEvent[], fromInstant: string, toInstant: string): string[] {
  const found = new Set<string>();
  for (const day of localDaysCovering(fromInstant, toInstant)) {
    for (const occurrence of expandEventsForDate(events, day)) {
      found.add(occurrence.start.toISOString());
    }
  }
  return [...found].sort();
}

/** The device-local calendar days on which any occurrence is displayed. */
function displayDaysBetween(events: CalendarEvent[], fromInstant: string, toInstant: string): string[] {
  const found = new Set<string>();
  for (const day of localDaysCovering(fromInstant, toInstant)) {
    if (expandEventsForDate(events, day).length > 0) {
      found.add(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`);
    }
  }
  return [...found].sort();
}

function ics(body: string): string {
  return `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\n${body}\nEND:VEVENT\nEND:VCALENDAR`;
}

function parseOne(body: string): CalendarEvent {
  const events = parseIcsContent(ics(body));
  expect(events).toHaveLength(1);
  return events[0];
}

const NY_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:America/New_York',
  'END:VTIMEZONE',
].join('\n');

describe('recurrence matrix: DTSTART form', () => {
  test('floating DTSTART recurs on the device-local wall clock', () => {
    const events = parseIcsContent(ics(
      'UID:m-float\nSUMMARY:Floating\nDTSTART:20260810T093000\nDTEND:20260810T103000\nRRULE:FREQ=DAILY;COUNT=3'
    ));
    expect(events[0].recurrenceError).toBeUndefined();
    expect(events[0].recurrenceValueType).toBe('floating');

    const starts = startsBetween(events, '2026-08-10T12:00:00Z', '2026-08-16T12:00:00Z')
      .map(instant => new Date(instant));
    expect(starts).toHaveLength(3);
    // Every occurrence keeps the same device-local wall clock.
    for (const start of starts) {
      expect(start.getHours()).toBe(9);
      expect(start.getMinutes()).toBe(30);
    }
    // On three consecutive device-local days.
    expect(starts[1].getTime() - starts[0].getTime()).toBeGreaterThanOrEqual(23 * 3600000);
    expect(starts[1].getTime() - starts[0].getTime()).toBeLessThanOrEqual(25 * 3600000);
  });

  test('explicit Z DTSTART recurs in UTC regardless of the device zone', () => {
    const events = parseIcsContent(ics(
      'UID:m-utc\nSUMMARY:UTC\nDTSTART:20260810T093000Z\nDTEND:20260810T103000Z\nRRULE:FREQ=DAILY;COUNT=3'
    ));
    expect(events[0].recurrenceValueType).toBe('utc');
    expect(startsBetween(events, '2026-08-09T12:00:00Z', '2026-08-16T12:00:00Z')).toEqual([
      '2026-08-10T09:30:00.000Z',
      '2026-08-11T09:30:00.000Z',
      '2026-08-12T09:30:00.000Z',
    ]);
  });

  test('valid TZID DTSTART recurs in the source zone, not the device zone', () => {
    const events = parseIcsContent(ics(
      `${NY_VTIMEZONE}\nUID:m-tzid\nSUMMARY:Zoned\nDTSTART;TZID=America/New_York:20260810T093000\nDTEND;TZID=America/New_York:20260810T103000\nRRULE:FREQ=DAILY;COUNT=3`
    ));
    expect(events[0].recurrenceValueType).toBe('zoned');
    expect(events[0].recurrenceTimeZone ?? events[0].timeZone).toBe('America/New_York');
    // 09:30 New York in August is UTC-4.
    expect(startsBetween(events, '2026-08-09T12:00:00Z', '2026-08-16T12:00:00Z')).toEqual([
      '2026-08-10T13:30:00.000Z',
      '2026-08-11T13:30:00.000Z',
      '2026-08-12T13:30:00.000Z',
    ]);
  });

  test('an unavailable TZID fails closed rather than silently becoming device-local', () => {
    // The strongest available failure mode: an item whose own zone cannot be
    // resolved is dropped entirely rather than being re-homed to the device
    // zone, which would place it at a plausible but wrong time.
    const events = parseIcsContent(ics(
      'UID:m-badtz\nSUMMARY:Bad zone\nDTSTART;TZID=Mars/Olympus:20260810T093000\nDTEND;TZID=Mars/Olympus:20260810T103000\nRRULE:FREQ=DAILY;COUNT=5'
    ));
    expect(events).toHaveLength(0);
  });
});

describe('recurrence matrix: frequency and interval', () => {
  test('daily at interval 1 and 5', () => {
    const daily = parseIcsContent(ics(
      'UID:m-d1\nSUMMARY:D1\nDTSTART:20260801T090000Z\nDTEND:20260801T100000Z\nRRULE:FREQ=DAILY;COUNT=3'
    ));
    expect(startsBetween(daily, '2026-07-31T12:00:00Z', '2026-08-10T12:00:00Z')).toEqual([
      '2026-08-01T09:00:00.000Z',
      '2026-08-02T09:00:00.000Z',
      '2026-08-03T09:00:00.000Z',
    ]);

    const everyFifth = parseIcsContent(ics(
      'UID:m-d5\nSUMMARY:D5\nDTSTART:20260801T090000Z\nDTEND:20260801T100000Z\nRRULE:FREQ=DAILY;INTERVAL=5;COUNT=4'
    ));
    expect(startsBetween(everyFifth, '2026-07-31T12:00:00Z', '2026-08-25T12:00:00Z')).toEqual([
      '2026-08-01T09:00:00.000Z',
      '2026-08-06T09:00:00.000Z',
      '2026-08-11T09:00:00.000Z',
      '2026-08-16T09:00:00.000Z',
    ]);
  });

  test('weekly defaults to the DTSTART weekday when BYDAY is absent', () => {
    // 2026-08-05 is a Wednesday.
    const events = parseIcsContent(ics(
      'UID:m-w0\nSUMMARY:W0\nDTSTART:20260805T090000Z\nDTEND:20260805T100000Z\nRRULE:FREQ=WEEKLY;COUNT=3'
    ));
    expect(startsBetween(events, '2026-08-04T12:00:00Z', '2026-08-26T12:00:00Z')).toEqual([
      '2026-08-05T09:00:00.000Z',
      '2026-08-12T09:00:00.000Z',
      '2026-08-19T09:00:00.000Z',
    ]);
  });

  test('weekly with multi-value BYDAY at interval 1', () => {
    const events = parseIcsContent(ics(
      'UID:m-w1\nSUMMARY:W1\nDTSTART:20260805T090000Z\nDTEND:20260805T100000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5'
    ));
    expect(startsBetween(events, '2026-08-03T12:00:00Z', '2026-08-24T12:00:00Z')).toEqual([
      '2026-08-05T09:00:00.000Z', // We (DTSTART)
      '2026-08-10T09:00:00.000Z', // Mo
      '2026-08-12T09:00:00.000Z', // We
      '2026-08-17T09:00:00.000Z', // Mo
      '2026-08-19T09:00:00.000Z', // We
    ]);
  });

  test('weekly BYDAY at interval 2 skips whole weeks from the DTSTART week', () => {
    // RFC 5545 counts weekly intervals in whole weeks starting at WKST
    // (default Monday), not in 7-day blocks measured from DTSTART. DTSTART is
    // Wednesday 2026-08-05, whose week is Mon 2026-08-03 .. Sun 2026-08-09.
    // The next active week is Mon 2026-08-17, so the Monday occurrence falls
    // two days BEFORE the Wednesday, not five days after it.
    const events = parseIcsContent(ics(
      'UID:m-w2\nSUMMARY:W2\nDTSTART:20260805T090000Z\nDTEND:20260805T100000Z\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE'
    ));
    expect(startsBetween(events, '2026-08-03T12:00:00Z', '2026-09-06T12:00:00Z')).toEqual([
      '2026-08-05T09:00:00.000Z', // We, DTSTART week
      '2026-08-17T09:00:00.000Z', // Mo, +2 weeks
      '2026-08-19T09:00:00.000Z', // We
      '2026-08-31T09:00:00.000Z', // Mo, +4 weeks
      '2026-09-02T09:00:00.000Z', // We
    ]);
  });

  test('WKST moves the interval week boundary', () => {
    // Same rule as above but with WKST=SU the week containing DTSTART is
    // Sun 2026-08-02 .. Sat 2026-08-08, which does not change this series'
    // Monday placement; the Monday of an active week is still 2026-08-17.
    const sundayStart = parseIcsContent(ics(
      'UID:m-wkst\nSUMMARY:WKST\nDTSTART:20260805T090000Z\nDTEND:20260805T100000Z\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;WKST=SU'
    ));
    expect(sundayStart[0].recurrenceError).toBeUndefined();
    expect(startsBetween(sundayStart, '2026-08-03T12:00:00Z', '2026-08-22T12:00:00Z')).toEqual([
      '2026-08-05T09:00:00.000Z',
      '2026-08-17T09:00:00.000Z',
      '2026-08-19T09:00:00.000Z',
    ]);

    // With a Sunday DTSTART the two week definitions genuinely disagree:
    // 2026-08-09 is a Sunday. Under WKST=SU it opens its own week, so the
    // Monday one day later is in the same active week. Under the default
    // WKST=MO that Sunday closes the previous week, so the next Monday opens
    // a skipped week and the first Monday occurrence is a week later.
    const sundayDtstart = 'DTSTART:20260809T090000Z\nDTEND:20260809T100000Z';
    const wkstSunday = parseIcsContent(ics(
      `UID:m-wkst-su\nSUMMARY:SU\n${sundayDtstart}\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;WKST=SU`
    ));
    expect(startsBetween(wkstSunday, '2026-08-08T12:00:00Z', '2026-08-26T12:00:00Z')).toEqual([
      '2026-08-09T09:00:00.000Z', // Su, DTSTART
      '2026-08-10T09:00:00.000Z', // Mo, same WKST=SU week
      '2026-08-23T09:00:00.000Z', // Su, +2 weeks
      '2026-08-24T09:00:00.000Z', // Mo
    ]);

    const wkstMonday = parseIcsContent(ics(
      `UID:m-wkst-mo\nSUMMARY:MO\n${sundayDtstart}\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;WKST=MO`
    ));
    expect(startsBetween(wkstMonday, '2026-08-08T12:00:00Z', '2026-08-26T12:00:00Z')).toEqual([
      '2026-08-09T09:00:00.000Z', // Su, DTSTART closes the week Mon 08-03..Sun 08-09
      '2026-08-17T09:00:00.000Z', // Mo, first day of the next active week
      '2026-08-23T09:00:00.000Z', // Su, same active week Mon 08-17..Sun 08-23
    ]);
  });

  test('monthly on a calendar day, at interval 1 and 3', () => {
    const monthly = parseIcsContent(ics(
      'UID:m-m1\nSUMMARY:M1\nDTSTART:20260115T090000Z\nDTEND:20260115T100000Z\nRRULE:FREQ=MONTHLY;COUNT=3'
    ));
    expect(startsBetween(monthly, '2026-01-14T12:00:00Z', '2026-04-16T12:00:00Z')).toEqual([
      '2026-01-15T09:00:00.000Z',
      '2026-02-15T09:00:00.000Z',
      '2026-03-15T09:00:00.000Z',
    ]);

    const quarterly = parseIcsContent(ics(
      'UID:m-m3\nSUMMARY:M3\nDTSTART:20260115T090000Z\nDTEND:20260115T100000Z\nRRULE:FREQ=MONTHLY;INTERVAL=3;COUNT=3'
    ));
    expect(startsBetween(quarterly, '2026-01-14T12:00:00Z', '2026-07-16T12:00:00Z')).toEqual([
      '2026-01-15T09:00:00.000Z',
      '2026-04-15T09:00:00.000Z',
      '2026-07-15T09:00:00.000Z',
    ]);
  });

  test('monthly skips months that lack the calendar day without consuming COUNT', () => {
    // RFC 5545: a month with no 31st simply produces no occurrence, and the
    // absent occurrence does not count towards COUNT.
    const events = parseIcsContent(ics(
      'UID:m-m31\nSUMMARY:M31\nDTSTART:20260131T090000Z\nDTEND:20260131T100000Z\nRRULE:FREQ=MONTHLY;COUNT=3'
    ));
    expect(startsBetween(events, '2026-01-30T12:00:00Z', '2026-06-02T12:00:00Z')).toEqual([
      '2026-01-31T09:00:00.000Z',
      '2026-03-31T09:00:00.000Z',
      '2026-05-31T09:00:00.000Z',
    ]);
  });

  test('monthly negative BYMONTHDAY and ordinal BYDAY', () => {
    const lastDay = parseIcsContent(ics(
      'UID:m-neg\nSUMMARY:Last\nDTSTART:20260131T090000Z\nDTEND:20260131T100000Z\nRRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3'
    ));
    expect(startsBetween(lastDay, '2026-01-30T12:00:00Z', '2026-04-02T12:00:00Z')).toEqual([
      '2026-01-31T09:00:00.000Z',
      '2026-02-28T09:00:00.000Z',
      '2026-03-31T09:00:00.000Z',
    ]);

    // Second Tuesday of each month. 2026-08-11 is the second Tuesday.
    const ordinal = parseIcsContent(ics(
      'UID:m-ord\nSUMMARY:Ordinal\nDTSTART:20260811T090000Z\nDTEND:20260811T100000Z\nRRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=3'
    ));
    expect(startsBetween(ordinal, '2026-08-10T12:00:00Z', '2026-10-15T12:00:00Z')).toEqual([
      '2026-08-11T09:00:00.000Z',
      '2026-09-08T09:00:00.000Z',
      '2026-10-13T09:00:00.000Z',
    ]);
  });

  test('yearly at interval 1 and 2, and on a leap day', () => {
    const yearly = parseIcsContent(ics(
      'UID:m-y1\nSUMMARY:Y1\nDTSTART:20260315T120000Z\nDTEND:20260315T130000Z\nRRULE:FREQ=YEARLY;COUNT=3'
    ));
    expect(startsBetween(yearly, '2027-03-14T12:00:00Z', '2027-03-16T12:00:00Z')).toEqual([
      '2027-03-15T12:00:00.000Z',
    ]);
    expect(startsBetween(yearly, '2029-03-14T12:00:00Z', '2029-03-16T12:00:00Z')).toEqual([]);

    const everyOther = parseIcsContent(ics(
      'UID:m-y2\nSUMMARY:Y2\nDTSTART:20260315T120000Z\nDTEND:20260315T130000Z\nRRULE:FREQ=YEARLY;INTERVAL=2'
    ));
    expect(startsBetween(everyOther, '2027-03-14T12:00:00Z', '2027-03-16T12:00:00Z')).toEqual([]);
    expect(startsBetween(everyOther, '2028-03-14T12:00:00Z', '2028-03-16T12:00:00Z')).toEqual([
      '2028-03-15T12:00:00.000Z',
    ]);

    // A 29 February series recurs only in leap years, per RFC 5545.
    const leapDay = parseIcsContent(ics(
      'UID:m-leap\nSUMMARY:Leap\nDTSTART:20240229T120000Z\nDTEND:20240229T130000Z\nRRULE:FREQ=YEARLY'
    ));
    expect(startsBetween(leapDay, '2025-02-27T12:00:00Z', '2025-03-02T12:00:00Z')).toEqual([]);
    expect(startsBetween(leapDay, '2028-02-27T12:00:00Z', '2028-03-02T12:00:00Z')).toEqual([
      '2028-02-29T12:00:00.000Z',
    ]);
  });
});

describe('recurrence matrix: end rules', () => {
  test('an unbounded rule keeps producing occurrences far from DTSTART', () => {
    const events = parseIcsContent(ics(
      'UID:m-noend\nSUMMARY:Forever\nDTSTART:20260315T120000Z\nDTEND:20260315T130000Z\nRRULE:FREQ=YEARLY'
    ));
    // Well beyond any fixed day-stepping budget measured from DTSTART.
    expect(startsBetween(events, '2096-03-14T12:00:00Z', '2096-03-16T12:00:00Z')).toEqual([
      '2096-03-15T12:00:00.000Z',
    ]);
  });

  test('COUNT includes the DTSTART occurrence', () => {
    const events = parseIcsContent(ics(
      'UID:m-count\nSUMMARY:Count\nDTSTART:20260810T090000Z\nDTEND:20260810T100000Z\nRRULE:FREQ=DAILY;COUNT=2'
    ));
    expect(startsBetween(events, '2026-08-09T12:00:00Z', '2026-08-16T12:00:00Z')).toEqual([
      '2026-08-10T09:00:00.000Z',
      '2026-08-11T09:00:00.000Z',
    ]);
  });

  test('COUNT stops after its last occurrence even when filters have no later match', () => {
    const events = parseIcsContent(ics(
      `${NY_VTIMEZONE}\nUID:m-count-stop\nSUMMARY:Stop\nDTSTART;TZID=America/New_York:20260810T090000\nDTEND;TZID=America/New_York:20260810T100000\nRRULE:FREQ=DAILY;INTERVAL=7;BYDAY=TU;COUNT=1`
    ));
    const formatSpy = jest.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts');
    expect(expandEventsForDate(events, localDayOf('2096-08-10T13:00:00Z'))).toEqual([]);
    expect(formatSpy.mock.calls.length).toBeLessThan(20);
    formatSpy.mockRestore();
  });

  test('a large COUNT series remains queryable beyond the old fixed scan limit', () => {
    const events = parseIcsContent(ics(
      'UID:m-count-far\nSUMMARY:Long count\nDTSTART:19700101T090000Z\nDTEND:19700101T100000Z\nRRULE:FREQ=DAILY;COUNT=30000'
    ));
    const starts = startsBetween(events, '2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z')
      .filter(instant => instant >= '2026-01-01T00:00:00.000Z' && instant < '2026-01-03T00:00:00.000Z');
    expect(starts).toEqual([
      '2026-01-01T09:00:00.000Z',
      '2026-01-02T09:00:00.000Z',
    ]);
  });

  test('a sparse monthly COUNT series remains queryable beyond 20,000 days', () => {
    const events = parseIcsContent(ics(
      'UID:m-count-sparse\nSUMMARY:Leap count\nDTSTART:20240229T090000Z\nDTEND:20240229T100000Z\nRRULE:FREQ=MONTHLY;INTERVAL=12;COUNT=20'
    ));
    expect(events[0].recurrenceError).toBeUndefined();
    expect(startsBetween(events, '2096-02-28T00:00:00Z', '2096-03-02T00:00:00Z')).toContain(
      '2096-02-29T09:00:00.000Z'
    );
    expect(events[0].recurrenceError).toBeUndefined();
  });

  test('a COUNT rule beyond the safe horizon fails closed during parsing', () => {
    const event = parseOne(
      'UID:m-count-too-far\nSUMMARY:Too far\nDTSTART:20240229T090000Z\nDTEND:20240229T100000Z\nRRULE:FREQ=MONTHLY;INTERVAL=12;COUNT=100'
    );
    expect(event.recurrenceError).toMatch(/horizon/i);
  });

  test('a floating UNTIL bounds a floating series inclusively', () => {
    const events = parseIcsContent(ics(
      'UID:m-untilf\nSUMMARY:UntilF\nDTSTART:20260810T090000\nDTEND:20260810T100000\nRRULE:FREQ=DAILY;UNTIL=20260812T090000'
    ));
    expect(events[0].recurrenceError).toBeUndefined();
    expect(startsBetween(events, '2026-08-09T12:00:00Z', '2026-08-16T12:00:00Z')).toHaveLength(3);
  });

  test('a UTC UNTIL bounds a zoned series inclusively', () => {
    const events = parseIcsContent(ics(
      `${NY_VTIMEZONE}\nUID:m-untilz\nSUMMARY:UntilZ\nDTSTART;TZID=America/New_York:20260810T090000\nDTEND;TZID=America/New_York:20260810T100000\nRRULE:FREQ=DAILY;UNTIL=20260812T130000Z`
    ));
    expect(events[0].recurrenceError).toBeUndefined();
    expect(startsBetween(events, '2026-08-09T12:00:00Z', '2026-08-16T12:00:00Z')).toEqual([
      '2026-08-10T13:00:00.000Z',
      '2026-08-11T13:00:00.000Z',
      '2026-08-12T13:00:00.000Z',
    ]);
  });

  test('UNTIL whose form disagrees with DTSTART is rejected rather than guessed', () => {
    const event = parseOne(
      'UID:m-untilbad\nSUMMARY:UntilBad\nDTSTART:20260810T090000\nDTEND:20260810T100000\nRRULE:FREQ=DAILY;UNTIL=20260812T090000Z'
    );
    expect(event.recurrenceError).toMatch(/UNTIL/i);
  });

  test('COUNT and UNTIL together are rejected', () => {
    const event = parseOne(
      'UID:m-both\nSUMMARY:Both\nDTSTART:20260810T090000Z\nDTEND:20260810T100000Z\nRRULE:FREQ=DAILY;COUNT=2;UNTIL=20260812T090000Z'
    );
    expect(event.recurrenceError).toMatch(/COUNT|UNTIL/i);
  });
});

describe('recurrence matrix: DST', () => {
  test('a zoned series keeps its source wall clock across the source zone DST change', () => {
    // New York leaves DST on 2026-11-01. 09:00 local is 13:00Z before and
    // 14:00Z after, so the instant must shift while the wall clock holds.
    const events = parseIcsContent(ics(
      `${NY_VTIMEZONE}\nUID:m-dst-src\nSUMMARY:SrcDST\nDTSTART;TZID=America/New_York:20261030T090000\nDTEND;TZID=America/New_York:20261030T100000\nRRULE:FREQ=DAILY;COUNT=4`
    ));
    expect(startsBetween(events, '2026-10-29T12:00:00Z', '2026-11-05T12:00:00Z')).toEqual([
      '2026-10-30T13:00:00.000Z',
      '2026-10-31T13:00:00.000Z',
      '2026-11-01T14:00:00.000Z',
      '2026-11-02T14:00:00.000Z',
    ]);
  });

  test('a floating series keeps its wall clock across the device zone DST change', () => {
    const events = parseIcsContent(ics(
      'UID:m-dst-dev\nSUMMARY:DevDST\nDTSTART:20260307T090000\nDTEND:20260307T100000\nRRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3'
    ));
    const starts = startsBetween(events, '2026-03-06T12:00:00Z', '2026-04-10T12:00:00Z')
      .map(instant => new Date(instant));
    expect(starts).toHaveLength(3);
    for (const start of starts) expect(start.getHours()).toBe(9);
  });

  test('a spring-forward gap time is skipped without consuming COUNT', () => {
    // 02:30 does not exist in New York on 2026-03-08.
    const events = parseIcsContent(ics(
      `${NY_VTIMEZONE}\nUID:m-gap\nSUMMARY:Gap\nDTSTART;TZID=America/New_York:20260307T023000\nDTEND;TZID=America/New_York:20260307T033000\nRRULE:FREQ=DAILY;COUNT=3`
    ));
    const starts = startsBetween(events, '2026-03-06T12:00:00Z', '2026-03-12T12:00:00Z');
    // COUNT=3 must still deliver three real occurrences.
    expect(starts).toHaveLength(3);
    expect(starts[0]).toBe('2026-03-07T07:30:00.000Z');
    expect(starts[starts.length - 1]).toBe('2026-03-10T06:30:00.000Z');
  });

  test('a fall-back ambiguous time resolves to the first occurrence', () => {
    // 01:30 happens twice in New York on 2026-11-01: 05:30Z then 06:30Z.
    const events = parseIcsContent(ics(
      `${NY_VTIMEZONE}\nUID:m-fold\nSUMMARY:Fold\nDTSTART;TZID=America/New_York:20261101T013000\nDTEND;TZID=America/New_York:20261101T023000\nRRULE:FREQ=DAILY;COUNT=1`
    ));
    expect(startsBetween(events, '2026-10-31T12:00:00Z', '2026-11-03T12:00:00Z')).toEqual([
      '2026-11-01T05:30:00.000Z',
    ]);
  });

  test('an all-day recurrence keeps a calendar-day duration across spring-forward', () => {
    const events = parseIcsContent(ics(
      'UID:m-date-dst\nSUMMARY:Date DST\nDTSTART;VALUE=DATE:20260308\nDTEND;VALUE=DATE:20260309\nRRULE:FREQ=DAILY;COUNT=1'
    ));
    expect(displayDaysBetween(events, '2026-03-07T12:00:00Z', '2026-03-12T12:00:00Z')).toEqual([
      '2026-03-08',
    ]);
  });
});

describe('recurrence matrix: exceptions', () => {
  test('a DATE EXDATE removes an all-day occurrence', () => {
    const events = parseIcsContent(ics(
      'UID:m-exd\nSUMMARY:ExD\nDTSTART;VALUE=DATE:20260810\nDTEND;VALUE=DATE:20260811\nRRULE:FREQ=DAILY;COUNT=3\nEXDATE;VALUE=DATE:20260811'
    ));
    expect(displayDaysBetween(events, '2026-08-10T12:00:00Z', '2026-08-15T12:00:00Z')).toEqual([
      '2026-08-10',
      '2026-08-12',
    ]);
  });

  test('a zoned EXDATE removes exactly the named instant', () => {
    const events = parseIcsContent(ics(
      `${NY_VTIMEZONE}\nUID:m-exz\nSUMMARY:ExZ\nDTSTART;TZID=America/New_York:20260810T090000\nDTEND;TZID=America/New_York:20260810T100000\nRRULE:FREQ=DAILY;COUNT=3\nEXDATE;TZID=America/New_York:20260811T090000`
    ));
    expect(startsBetween(events, '2026-08-09T12:00:00Z', '2026-08-15T12:00:00Z')).toEqual([
      '2026-08-10T13:00:00.000Z',
      '2026-08-12T13:00:00.000Z',
    ]);
  });

  test('a moved RECURRENCE-ID replaces the original occurrence', () => {
    const events = parseIcsContent([
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:m-rid',
      'SUMMARY:Series',
      'DTSTART:20260810T090000Z',
      'DTEND:20260810T100000Z',
      'RRULE:FREQ=DAILY;COUNT=3',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:m-rid',
      'SUMMARY:Moved',
      'RECURRENCE-ID:20260811T090000Z',
      'DTSTART:20260811T140000Z',
      'DTEND:20260811T150000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n'));

    const starts = startsBetween(events, '2026-08-09T12:00:00Z', '2026-08-15T12:00:00Z');
    expect(starts).toContain('2026-08-10T09:00:00.000Z');
    expect(starts).toContain('2026-08-11T14:00:00.000Z');
    expect(starts).not.toContain('2026-08-11T09:00:00.000Z');
    expect(starts).toContain('2026-08-12T09:00:00.000Z');
  });
});

describe('recurrence matrix: event shape', () => {
  test('an all-day recurring event shows on exactly its own days', () => {
    const events = parseIcsContent(ics(
      'UID:m-allday\nSUMMARY:AllDay\nDTSTART;VALUE=DATE:20260810\nDTEND;VALUE=DATE:20260811\nRRULE:FREQ=DAILY;COUNT=2'
    ));
    expect(events[0].allDay).toBe(true);
    expect(displayDaysBetween(events, '2026-08-09T12:00:00Z', '2026-08-14T12:00:00Z')).toEqual([
      '2026-08-10',
      '2026-08-11',
    ]);
  });

  test('an overnight recurring event shows on both days it overlaps', () => {
    const events = parseIcsContent(ics(
      'UID:m-night\nSUMMARY:Night\nDTSTART:20260810T220000\nDTEND:20260811T060000\nRRULE:FREQ=DAILY;COUNT=2'
    ));
    expect(displayDaysBetween(events, '2026-08-09T12:00:00Z', '2026-08-14T12:00:00Z')).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
    ]);
  });

  test('a multi-day recurring event shows on every day it spans', () => {
    const events = parseIcsContent(ics(
      'UID:m-multi\nSUMMARY:Multi\nDTSTART:20260810T090000\nDTEND:20260813T170000\nRRULE:FREQ=MONTHLY;COUNT=1'
    ));
    expect(displayDaysBetween(events, '2026-08-09T12:00:00Z', '2026-08-16T12:00:00Z')).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
    ]);
  });

  test('a zero-duration occurrence is visible, including at local midnight', () => {
    // A zero-length event is a point in time, not an empty interval. Selecting
    // it with a strict "end after day start" test hides it on exactly the day
    // it belongs to when it starts at midnight.
    const midday = parseIcsContent(ics(
      'UID:m-zero\nSUMMARY:Zero\nDTSTART:20260810T090000\nDTEND:20260810T090000\nRRULE:FREQ=DAILY;COUNT=2'
    ));
    expect(displayDaysBetween(midday, '2026-08-09T12:00:00Z', '2026-08-14T12:00:00Z')).toEqual([
      '2026-08-10',
      '2026-08-11',
    ]);

    const atMidnight = parseIcsContent(ics(
      'UID:m-zero-mid\nSUMMARY:ZeroMid\nDTSTART:20260810T000000\nDTEND:20260810T000000\nRRULE:FREQ=DAILY;COUNT=2'
    ));
    expect(displayDaysBetween(atMidnight, '2026-08-09T12:00:00Z', '2026-08-14T12:00:00Z')).toEqual([
      '2026-08-10',
      '2026-08-11',
    ]);

    const single = parseIcsContent(ics(
      'UID:m-zero-one\nSUMMARY:ZeroOne\nDTSTART:20260810T000000\nDTEND:20260810T000000'
    ));
    expect(displayDaysBetween(single, '2026-08-09T12:00:00Z', '2026-08-12T12:00:00Z')).toEqual([
      '2026-08-10',
    ]);
  });

  test('a malformed DTSTART is dropped rather than placed at the current time', () => {
    const events = parseIcsContent(ics(
      'UID:m-bad\nSUMMARY:Bad\nDTSTART:not-a-date\nDTEND:also-not-a-date\nRRULE:FREQ=DAILY;COUNT=3'
    ));
    expect(events).toHaveLength(0);
  });

  test('a syntactically valid negative duration is rejected', () => {
    const events = parseIcsContent(ics(
      'UID:m-negative\nSUMMARY:Negative\nDTSTART:20260810T100000Z\nDTEND:20260810T090000Z\nRRULE:FREQ=DAILY;COUNT=3'
    ));
    expect(events).toHaveLength(0);
  });
});

describe('recurrence matrix: query boundary', () => {
  test('an occurrence at local midnight belongs to the day it opens', () => {
    const events = parseIcsContent(ics(
      'UID:m-mid\nSUMMARY:Midnight\nDTSTART:20260810T000000\nDTEND:20260810T010000\nRRULE:FREQ=DAILY;COUNT=2'
    ));
    expect(displayDaysBetween(events, '2026-08-09T12:00:00Z', '2026-08-14T12:00:00Z')).toEqual([
      '2026-08-10',
      '2026-08-11',
    ]);
  });

  test('an occurrence just before local midnight does not leak into the next day', () => {
    const events = parseIcsContent(ics(
      'UID:m-late\nSUMMARY:Late\nDTSTART:20260810T233000\nDTEND:20260810T234500\nRRULE:FREQ=DAILY;COUNT=2'
    ));
    expect(displayDaysBetween(events, '2026-08-09T12:00:00Z', '2026-08-14T12:00:00Z')).toEqual([
      '2026-08-10',
      '2026-08-11',
    ]);
  });

  test('a UTC-midnight occurrence is displayed on the device-local day that contains it', () => {
    const events = parseIcsContent(ics(
      'UID:m-utcmid\nSUMMARY:UtcMidnight\nDTSTART:20260810T000000Z\nDTEND:20260810T010000Z\nRRULE:FREQ=DAILY;COUNT=2'
    ));
    const occurrences = startsBetween(events, '2026-08-08T12:00:00Z', '2026-08-14T12:00:00Z');
    expect(occurrences).toEqual([
      '2026-08-10T00:00:00.000Z',
      '2026-08-11T00:00:00.000Z',
    ]);
    // Each is shown on the device-local day containing that instant, whatever
    // the host zone calls it.
    for (const instant of occurrences) {
      const day = localDayOf(instant);
      expect(expandEventsForDate(events, day).map(e => e.start.toISOString())).toContain(instant);
    }
  });

  test('a recurring occurrence and an identical single event share one display day', () => {
    const shared = `${NY_VTIMEZONE}\nDTSTART;TZID=America/New_York:20260810T230000\nDTEND;TZID=America/New_York:20260810T233000`;
    const single = parseIcsContent(ics(`UID:m-cmp-1\nSUMMARY:Single\n${shared}`));
    const series = parseIcsContent(ics(`UID:m-cmp-2\nSUMMARY:Series\n${shared}\nRRULE:FREQ=DAILY;COUNT=1`));
    expect(displayDaysBetween(series, '2026-08-09T12:00:00Z', '2026-08-13T12:00:00Z'))
      .toEqual(displayDaysBetween(single, '2026-08-09T12:00:00Z', '2026-08-13T12:00:00Z'));
  });
});

describe('recurrence matrix: unsupported constructs fail closed', () => {
  test.each([
    ['FREQ=HOURLY', 'FREQ=HOURLY'],
    ['unsupported part', 'FREQ=WEEKLY;BYSETPOS=1'],
    ['yearly ordinal BYDAY', 'FREQ=YEARLY;BYDAY=1MO'],
    ['BYMONTHDAY outside MONTHLY', 'FREQ=WEEKLY;BYMONTHDAY=15'],
    ['zero interval', 'FREQ=DAILY;INTERVAL=0'],
    ['duplicate part', 'FREQ=DAILY;FREQ=WEEKLY'],
    ['malformed part', 'FREQ=DAILY;INTERVAL'],
    ['invalid BYDAY token', 'FREQ=WEEKLY;BYDAY=XX'],
    ['impossible monthly ordinal', 'FREQ=MONTHLY;BYDAY=53MO'],
    ['sparse fifth weekday interval', 'FREQ=MONTHLY;INTERVAL=12;BYDAY=5MO;COUNT=20'],
    ['invalid WKST', 'FREQ=WEEKLY;INTERVAL=2;WKST=XX'],
  ])('%s is rejected and never silently expanded', (_label, rule) => {
    const event = parseOne(
      `UID:m-unsup\nSUMMARY:Unsupported\nDTSTART:20260810T090000Z\nDTEND:20260810T100000Z\nRRULE:${rule}`
    );
    expect(event.recurrenceError).toBeTruthy();
    // Only the supplied DTSTART is shown; no invented schedule.
    expect(startsBetween([event], '2026-08-09T12:00:00Z', '2026-08-20T12:00:00Z')).toEqual([
      '2026-08-10T09:00:00.000Z',
    ]);
  });
});
