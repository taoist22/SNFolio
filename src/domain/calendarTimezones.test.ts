import { parseIcsContent, parseIcsContentStrict, expandEventsForDate } from './icsParser';
import { generateOutboundIcsEvent } from './noteExporter';
import { CalendarStorage } from '../storage/calendarStorage';
import { pushSignature } from './pushState';
import { fetchCalendarFeed } from './feedService';
import { timezoneFields } from './calendarTimezones';

const wrap = (body: string) => `BEGIN:VCALENDAR\nVERSION:2.0\n${body}\nEND:VCALENDAR`;
const event = (id: string) => `BEGIN:VEVENT
UID:microsoft-series
SUMMARY:Office
DTSTART;TZID=${id}:20261018T100000
DTEND;TZID=${id}:20261018T110000
RRULE:FREQ=WEEKLY;COUNT=3
END:VEVENT`;
const definition = (id: string, offset = '+0100') => `BEGIN:VTIMEZONE
TZID:${id}
BEGIN:STANDARD
DTSTART:16011028T030000
TZOFFSETFROM:+0200
TZOFFSETTO:${offset}
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010325T020000
TZOFFSETFROM:${offset}
TZOFFSETTO:+0200
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
END:VTIMEZONE`;
const localDay = (iso: string) => {
  const date = new Date(iso);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

test.each(['W. Europe Standard Time', 'Private/Office'])('uses embedded 1601 timezone rules for %s across DST', id => {
  const events = parseIcsContentStrict(wrap(`${definition(id)}\n${event(id)}`));
  for (const instant of ['2026-10-18T08:00:00.000Z', '2026-10-25T09:00:00.000Z', '2026-11-01T09:00:00.000Z']) {
    expect(expandEventsForDate(events, localDay(instant))[0].start.toISOString()).toBe(instant);
  }
});

test.each(['W. Europe Standard Time', 'Europe/Berlin'])('resolves %s without VTIMEZONE offline', id => {
  const events = parseIcsContentStrict(wrap(event(id)));
  expect(events[0].start.toISOString()).toBe('2026-10-18T08:00:00.000Z');
  expect(expandEventsForDate(events, localDay('2026-10-25T09:00:00Z'))[0].start.toISOString()).toBe('2026-10-25T09:00:00.000Z');
});

test('embedded definitions with the same name never contaminate another calendar', () => {
  const a = parseIcsContentStrict(wrap(`${definition('Private/Office')}\n${event('Private/Office')}`));
  const b = parseIcsContentStrict(wrap(`${definition('Private/Office', '+0300')}\n${event('Private/Office')}`));
  const day = localDay('2026-11-01T09:00:00Z');
  expect(expandEventsForDate(a, day)[0].start.toISOString()).toBe('2026-11-01T09:00:00.000Z');
  expect(expandEventsForDate(b, day)[0].start.toISOString()).toBe('2026-11-01T07:00:00.000Z');
  expect(expandEventsForDate(a, day)[0].start.toISOString()).toBe('2026-11-01T09:00:00.000Z');
});

test('unknown named zones produce an actionable diagnostic, never floating dates', async () => {
  const text = wrap(event('Missing/Zone'));
  const diagnostics: string[] = [];
  expect(parseIcsContent(text, 'Office', diagnostics)).toEqual([]);
  expect(diagnostics.join(' ')).toContain('Missing/Zone');
  expect(() => parseIcsContentStrict(text)).toThrow('Calendar import needs attention');
  await expect(fetchCalendarFeed('https://example.test/calendar', 'Office', jest.fn().mockResolvedValue({
    ok: true, text: async () => text,
  }) as any)).rejects.toThrow('Missing/Zone');
});

test('timezone rules and single-occurrence exclusions survive storage and export', async () => {
  const id = 'W. Europe Standard Time';
  const [master] = parseIcsContentStrict(wrap(`${definition(id)}\n${event(id)}`));
  master.recurrenceExceptionInstants = ['2026-10-25T09:00:00.000Z'];
  master.caldavUrl = 'https://example.test/original.ics';
  master.etag = '"v2"';
  const store = new CalendarStorage();
  store.setCaldavEvents([master]);
  await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
  const reloaded = new CalendarStorage();
  await reloaded.load();
  const saved = reloaded.getCaldavEvents()[0];
  expect(saved.etag).toBe('"v2"');
  const outbound = generateOutboundIcsEvent(saved);
  expect(outbound).toContain('BEGIN:VTIMEZONE');
  const imported = parseIcsContentStrict(outbound);
  expect(expandEventsForDate(imported, localDay('2026-10-25T09:00:00Z'))).toEqual([]);
  expect(expandEventsForDate(imported, localDay('2026-11-01T09:00:00Z'))[0].start.toISOString()).toBe('2026-11-01T09:00:00.000Z');
  expect(pushSignature({...master, timezoneDefinitions: {}})).not.toBe(pushSignature(master));
});

test('known empty timezone shells use the database but unknown shells are rejected', () => {
  expect(parseIcsContentStrict(wrap(`BEGIN:VTIMEZONE\nTZID:Europe/Berlin\nEND:VTIMEZONE\n${event('Europe/Berlin')}`))[0].start.toISOString()).toBe('2026-10-18T08:00:00.000Z');
  expect(() => parseIcsContentStrict(wrap('BEGIN:VTIMEZONE\nTZID:Missing/Zone\nEND:VTIMEZONE'))).toThrow('no rules');
});

test('embedded rules override a recognized IANA name', () => {
  const [master] = parseIcsContentStrict(wrap(`${definition('Europe/Berlin', '+0300')}\n${event('Europe/Berlin')}`));
  expect(timezoneFields(new Date('2026-11-01T07:00:00Z'), 'Europe/Berlin', master.timezoneDefinitions).hour).toBe(10);
});
