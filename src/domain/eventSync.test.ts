import { CalendarStorage } from '../storage/calendarStorage';
import { caldavService } from './caldavService';
import { persistSuccessfulEventPush } from './eventSync';
import { needsPush } from './pushState';
import { CalendarEvent } from './types';

describe('event CalDAV synchronization', () => {
  const originalFetch = (globalThis as any).fetch;

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  test('retains occurrence PUT metadata for a later series delete', async () => {
    (globalThis as any).fetch = jest.fn()
      .mockResolvedValueOnce({
        status: 204,
        text: async () => '',
        headers: { get: (name: string) => name.toLowerCase() === 'etag' ? '"v2"' : null },
      } as any)
      .mockResolvedValueOnce({ status: 204, text: async () => '' } as any);
    const collection = 'https://caldav.example.test/cal/';
    const resource = `${collection}recurring.ics`;
    const updated: CalendarEvent = {
      uid: 'recurring',
      summary: 'Recurring event',
      start: new Date('2026-09-08T13:00:00Z'),
      end: new Date('2026-09-08T14:00:00Z'),
      allDay: false,
      attendees: [],
      rrule: 'FREQ=DAILY;COUNT=3',
      recurrenceExceptionInstants: ['2026-09-09T13:00:00.000Z'],
      caldavUrl: resource,
      etag: '"v1"',
    };
    const storage = new CalendarStorage();
    storage.setCaldavEvents([updated]);

    const pushed = await caldavService.pushIcloudEvent(updated, {
      appleId: 'user', appPassword: 'pass', calendarUrl: collection,
    });
    expect(pushed.success).toBe(true);

    persistSuccessfulEventPush(storage, collection, updated, pushed);
    const persisted = storage.getCaldavEvents()[0];
    expect(persisted.etag).toBe('"v2"');
    expect(persisted.caldavUrl).toBe(resource);
    expect(needsPush(persisted, storage.getPushState(collection))).toBe(false);

    await caldavService.deleteIcloudEvent(persisted.uid, {
      appleId: 'user', appPassword: 'pass', calendarUrl: collection,
    }, false, { url: persisted.caldavUrl, etag: persisted.etag });

    expect((globalThis as any).fetch).toHaveBeenNthCalledWith(2, resource, expect.objectContaining({
      method: 'DELETE',
      headers: expect.objectContaining({ 'If-Match': '"v2"' }),
    }));
  });
});
