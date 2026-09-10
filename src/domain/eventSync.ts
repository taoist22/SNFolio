import type { CalendarStorage } from '../storage/calendarStorage';
import { recordSuccessfulPush } from './pushState';
import type { CalendarEvent } from './types';

type EventPushStorage = Pick<
  CalendarStorage,
  | 'addUserEvent'
  | 'getCaldavEvents'
  | 'getPushState'
  | 'getUserEvents'
  | 'setCaldavEvents'
  | 'setPushState'
>;

/** Persists the resource metadata and push state returned by a successful event PUT. */
export function persistSuccessfulEventPush(
  storage: EventPushStorage,
  target: string,
  event: CalendarEvent,
  resource: { caldavUrl?: string; etag?: string }
): CalendarEvent {
  const committed = recordSuccessfulPush(storage.getPushState(target), event, resource);

  if (storage.getUserEvents().some(item => item.uid === event.uid)) {
    storage.addUserEvent(committed.event);
  }
  if (storage.getCaldavEvents().some(item => item.uid === event.uid)) {
    storage.setCaldavEvents(
      storage.getCaldavEvents().map(item => item.uid === event.uid ? committed.event : item)
    );
  }
  storage.setPushState(committed.state);

  return committed.event;
}
