import {
  CaldavService,
  buildCalendarQuery,
  buildTodoQuery,
  extractCalendarData,
  isTaskItem,
  splitMultistatusResponses,
  toCalDavStamp,
} from './caldavService';
import { ICLOUD_CALENDAR_QUERY_RESPONSE } from './__fixtures__/icloudCalendarQuery';

describe('CalDAV read path (calendar-query REPORT)', () => {
  const originalFetch = (globalThis as any).fetch;
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  const creds = { appleId: 'user@example.com', appPassword: 'app-specific-pw' };
  const COLLECTION = 'https://p01-caldav.icloud.com/123456789/calendars/calendar-example-001/';

  describe('extractCalendarData', () => {
    test('unwraps the CDATA payload iCloud actually sends', () => {
      const [first] = splitMultistatusResponses(ICLOUD_CALENDAR_QUERY_RESPONSE);
      const ics = extractCalendarData(first) as string;

      expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
      expect(ics).toContain('SUMMARY:Maikai Health');
      // The CDATA markers themselves must not survive into the payload.
      expect(ics).not.toContain('CDATA');
      expect(ics).not.toContain(']]>');
    });

    test('decodes the entity-escaped form other servers use instead of CDATA', () => {
      const block = `<response><calendar-data>BEGIN:VCALENDAR&#13;
SUMMARY:Tea &amp; Biscuits&#13;
END:VCALENDAR</calendar-data></response>`.replace(/&#13;\n/g, '\n');

      expect(extractCalendarData(block)).toContain('SUMMARY:Tea & Biscuits');
    });

    test('returns null when a response block carries no calendar-data', () => {
      const notFound =
        '<response><href>/gone.ics</href><status>HTTP/1.1 404 Not Found</status></response>';
      expect(extractCalendarData(notFound)).toBeNull();
    });
  });

  describe('query construction', () => {
    test('toCalDavStamp emits the UTC basic form the filter requires', () => {
      expect(toCalDavStamp(new Date(Date.UTC(2026, 7, 17, 0, 0, 0)))).toBe('20260817T000000Z');
      expect(toCalDavStamp(new Date(Date.UTC(2026, 0, 5, 9, 8, 7)))).toBe('20260105T090807Z');
    });

    test('buildCalendarQuery filters VEVENTs to the requested window', () => {
      const xml = buildCalendarQuery(
        new Date(Date.UTC(2026, 7, 17)),
        new Date(Date.UTC(2026, 7, 24))
      );

      expect(xml).toContain('<C:calendar-query');
      expect(xml).toContain('name="VCALENDAR"');
      expect(xml).toContain('name="VEVENT"');
      expect(xml).toContain('start="20260817T000000Z"');
      expect(xml).toContain('end="20260824T000000Z"');
      expect(xml).toContain('<C:calendar-data />');
    });

    test('buildTodoQuery includes undated VTODO resources', () => {
      const xml = buildTodoQuery();
      expect(xml).toContain('name="VTODO"');
      expect(xml).not.toContain('time-range');
    });
  });

  describe('fetchEventsInRange', () => {
    function mockResponse(status: number, body: string) {
      const fn = jest.fn().mockResolvedValue({ status, text: async () => body } as any);
      (globalThis as any).fetch = fn;
      return fn;
    }

    test('issues a REPORT at Depth 1 with the calendar-query body', async () => {
      const fn = mockResponse(207, ICLOUD_CALENDAR_QUERY_RESPONSE);
      const svc = new CaldavService();

      await svc.fetchEventsInRange(
        COLLECTION,
        creds,
        new Date(Date.UTC(2026, 7, 17)),
        new Date(Date.UTC(2026, 7, 24))
      );

      const [url, init] = fn.mock.calls[0];
      expect(url).toBe(COLLECTION);
      expect(init.method).toBe('REPORT');
      expect(init.headers.Depth).toBe('1');
      expect(init.headers.Authorization).toMatch(/^Basic /);
      expect(init.body).toContain('time-range');
    });

    test('returns both items from the captured iCloud response', async () => {
      mockResponse(207, ICLOUD_CALENDAR_QUERY_RESPONSE);
      const { events, error } = await new CaldavService().fetchEventsInRange(
        COLLECTION,
        creds,
        new Date(Date.UTC(2026, 7, 17)),
        new Date(Date.UTC(2026, 7, 24)),
        'iCloud'
      );

      expect(error).toBeUndefined();
      expect(events.map(e => e.summary)).toEqual(['Maikai Health', '[TASK] Call advisor']);
      expect(events[0].uid).toBe('66666666-7777-4888-8999-AAAAAAAAAAAA');
      expect(events[0].calendarName).toBe('iCloud');
    });

    test('does not mistake VTIMEZONE sub-components for events', () => {
      // The Honolulu VTIMEZONE contains six STANDARD/DAYLIGHT blocks, each with
      // its own DTSTART. Only the two real items may come back.
      return mockResponse(207, ICLOUD_CALENDAR_QUERY_RESPONSE) &&
        new CaldavService()
          .fetchEventsInRange(COLLECTION, creds, new Date(0), new Date(1))
          .then(({ events }) => {
            expect(events).toHaveLength(2);
          });
    });

    test('reads a TZID time as the instant it names, not as device-local', async () => {
      mockResponse(207, ICLOUD_CALENDAR_QUERY_RESPONSE);
      const { events } = await new CaldavService().fetchEventsInRange(
        COLLECTION,
        creds,
        new Date(0),
        new Date(1)
      );

      // DTSTART;TZID=Pacific/Honolulu:20260818T102000 is 10:20 in Honolulu,
      // which is 20:20 UTC. It was previously taken at face value, so the
      // wall-clock time was only correct on a device set to the event's own
      // zone. Asserting the instant keeps this true in every host timezone.
      expect(events[0].start.toISOString()).toBe('2026-08-18T20:20:00.000Z');
      expect(events[0].allDay).toBe(false);
    });

    test('recognises an item the plugin previously pushed as a task', async () => {
      mockResponse(207, ICLOUD_CALENDAR_QUERY_RESPONSE);
      const { events } = await new CaldavService().fetchEventsInRange(
        COLLECTION,
        creds,
        new Date(0),
        new Date(1)
      );

      // Tasks pushed as events carry the legacy prefix, so reading them back
      // must not turn a task into an appointment.
      expect(isTaskItem(events[1])).toBe(true);
    });

    test('reports an authentication failure rather than returning nothing silently', async () => {
      mockResponse(401, '');
      const { events, error } = await new CaldavService().fetchEventsInRange(
        COLLECTION,
        creds,
        new Date(0),
        new Date(1)
      );

      expect(events).toEqual([]);
      expect(error).toMatch(/Authentication failed/i);
    });

    test('reports an unexpected status with the server body', async () => {
      mockResponse(500, 'Internal Server Error');
      const { error } = await new CaldavService().fetchEventsInRange(
        COLLECTION,
        creds,
        new Date(0),
        new Date(1)
      );

      expect(error).toContain('HTTP 500');
    });

    test('does not call the network without credentials', async () => {
      const fn = jest.fn();
      (globalThis as any).fetch = fn;

      const { error } = await new CaldavService().fetchEventsInRange(
        COLLECTION,
        { appleId: '', appPassword: '' },
        new Date(0),
        new Date(1)
      );

      expect(fn).not.toHaveBeenCalled();
      expect(error).toMatch(/credentials/i);
    });

    test('surfaces a network failure as an error instead of throwing', async () => {
      (globalThis as any).fetch = jest.fn().mockRejectedValue(new Error('Network request failed'));

      const { events, error } = await new CaldavService().fetchEventsInRange(
        COLLECTION,
        creds,
        new Date(0),
        new Date(1)
      );

      expect(events).toEqual([]);
      expect(error).toContain('Network request failed');
    });
  });

  describe('fetchTasks', () => {
    test('reads dated and undated VTODO resources with server metadata', async () => {
      const body = `<?xml version="1.0"?><multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
<response><href>/tasks/one.ics</href><propstat><prop><getetag>"v1"</getetag><C:calendar-data><![CDATA[BEGIN:VCALENDAR
BEGIN:VTODO
UID:task-one
SUMMARY:Buy milk
STATUS:NEEDS-ACTION
PRIORITY:1
END:VTODO
END:VCALENDAR]]></C:calendar-data></prop></propstat></response>
</multistatus>`;
      (globalThis as any).fetch = jest.fn().mockResolvedValue({ status: 207, text: async () => body });

      const { tasks, error } = await new CaldavService().fetchTasks(COLLECTION, creds);

      expect(error).toBeUndefined();
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        uid: 'task-one',
        isTask: true,
        undatedTask: true,
        priority: 4,
        etag: '"v1"',
      });
      expect(tasks[0].caldavUrl).toContain('/tasks/one.ics');
    });
  });
});
