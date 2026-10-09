import { autoFileWords, matchKey } from './autoFile';
import { CalendarEvent, CalendarTask, Project } from './types';

/**
 * Turning a calendar event into something you can tick off.
 *
 * Deadlines arrive as events — "Assignments Due — Module Six" — because that is
 * all a subscribed calendar can express. They are read-only: a feed has no write
 * endpoint, and even a CalDAV event belongs to the account rather than to
 * SNFolio. So an event is never converted in the sense of being changed. A task
 * is created to stand in for it, and the event is hidden locally.
 *
 * That keeps the operation reversible and costs nothing upstream: clearing the
 * link brings the event straight back, because it was never touched.
 */

/** A task built from an event. The caller supplies the uid it will be stored under. */
export function taskFromEvent(event: CalendarEvent, uid: string, now: Date): CalendarTask {
  return {
    uid,
    title: event.summary.trim() || 'Untitled',
    // The deadline is the point of the event, so it becomes the due date. An
    // all-day event keeps allDay, so it lands in the day's undated section
    // rather than claiming a clock time it never had.
    dueDate: new Date(event.start),
    allDay: event.allDay !== false,
    completed: false,
    status: 'todo',
    createdAt: now,
    notes: event.description?.trim() || undefined,
  };
}

/**
 * Whether a project's rule says this event should become a task.
 *
 * Deliberately the same matching as auto-filing — the same words, the same
 * punctuation-insensitive compare — so a project's two rules read alike and a
 * user who understands one understands the other. The title alone is searched:
 * location and categories carry the course identity, not what kind of thing it
 * is, and matching "Due" against a location would fire on everything.
 */
export function eventMatchesTaskRule(event: CalendarEvent, project: Project | undefined): boolean {
  if (!project || project.status !== 'active') return false;
  const words = autoFileWords(project.taskifyMatch);
  if (!words.length) return false;
  const haystack = matchKey(event.summary || '');
  if (!haystack) return false;
  return words.some(word => {
    const key = matchKey(word);
    return Boolean(key) && haystack.includes(key);
  });
}

/**
 * The identities of events that a task now stands in for, so the calendar can
 * stop drawing them.
 *
 * Built from membership rather than from the events themselves: an event is
 * rebuilt from ICS on every sync, so nothing about it survives on the object.
 */
export function taskifiedEventIdentities(
  membership: Record<string, { taskifiedAs?: string }>,
  liveTaskUids: Set<string>
): Set<string> {
  const hidden = new Set<string>();
  for (const [identity, entry] of Object.entries(membership)) {
    // A task that has since been deleted must not keep its event hidden, or
    // the event would be invisible with nothing standing in for it.
    if (entry?.taskifiedAs && liveTaskUids.has(entry.taskifiedAs)) hidden.add(identity);
  }
  return hidden;
}

/** The tasks attached to one event, in due order. */
export function tasksForEvent(
  eventIdentity: string,
  tasks: CalendarTask[],
  membership: Record<string, { forEventIdentity?: string }>
): CalendarTask[] {
  return tasks.filter(task => membership[task.uid]?.forEventIdentity === eventIdentity);
}
