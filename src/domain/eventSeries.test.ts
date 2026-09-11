import AsyncStorage from '@react-native-async-storage/async-storage';
import { CalendarStorage } from '../storage/calendarStorage';
import { parseIcsContent } from './icsParser';
import { belongsToSeries, findStoredSeries } from './eventSeries';

const pastSeries = () => parseIcsContent(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:past-series
DTSTART:20240101T100000Z
DTEND:20240101T110000Z
SUMMARY:Past series
RRULE:FREQ=DAILY;COUNT=2
END:VEVENT
BEGIN:VEVENT
UID:past-series
RECURRENCE-ID:20240102T100000Z
DTSTART:20240102T120000Z
DTEND:20240102T130000Z
SUMMARY:Moved occurrence
END:VEVENT
END:VCALENDAR`);

test('past exceptions remain deletable when the master is absent from the cache', () => {
  const [, exception] = pastSeries();
  expect(findStoredSeries([exception], 'past-series')).toBe(exception);
  expect(findStoredSeries([], 'past-series')).toBeUndefined();
});

test('resolves the saved master resource ahead of an occurrence', () => {
  const [master, exception] = pastSeries();
  master.caldavUrl = 'https://calendar.example/events/server-resource.ics';
  master.etag = 'current';
  expect(findStoredSeries([exception, master], 'past-series')).toBe(master);
});

test('deleting a past series clears persisted exceptions without deleting similar UIDs', async () => {
  await AsyncStorage.clear();
  const store = new CalendarStorage();
  const events = pastSeries();
  const unrelated = { ...events[0], uid: 'past-series-other', recurringSeriesId: undefined };
  for (const event of [...events, unrelated]) store.addUserEvent(event);
  store.setCaldavEvents([...events, unrelated]);

  store.removeUserEvent('past-series');
  store.setCaldavEvents(store.getCaldavEvents().filter(event => !belongsToSeries(event, 'past-series')));
  await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
  const reloaded = new CalendarStorage();
  await reloaded.load();
  expect(reloaded.getUserEvents().map(event => event.uid)).toEqual(['past-series-other']);
  expect(reloaded.getCaldavEvents().map(event => event.uid)).toEqual(['past-series-other']);
});
