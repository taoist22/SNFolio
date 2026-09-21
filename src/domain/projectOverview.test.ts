import { CalendarEvent, CalendarTask } from './types';
import { projectOverviewItems, projectOverviewWindow, projectWindowSummary } from './projectOverview';

const task = (uid: string, completed: boolean, due: string, completedAt?: string): CalendarTask => ({
  uid,
  title: uid,
  completed,
  dueDate: new Date(due),
  completedAt: completedAt ? new Date(completedAt) : undefined,
  createdAt: new Date('2026-08-01T12:00:00Z'),
});

const event = (uid: string, start: string): CalendarEvent => ({
  uid,
  summary: uid,
  start: new Date(start),
  end: new Date(new Date(start).getTime() + 3600000),
  allDay: false,
  attendees: [],
});

test('project overview separates and orders open tasks, completed tasks, and events', () => {
  const result = projectOverviewItems(
    'project-a',
    [
      task('open-later', false, '2026-08-29T12:00:00Z'),
      task('done-old', true, '2026-08-20T12:00:00Z', '2026-08-22T12:00:00Z'),
      task('open-sooner', false, '2026-08-27T12:00:00Z'),
      task('done-new', true, '2026-08-21T12:00:00Z', '2026-08-25T12:00:00Z'),
      task('other', false, '2026-08-26T12:00:00Z'),
    ],
    [event('event-later', '2026-08-30T12:00:00Z'), event('event-sooner', '2026-08-28T12:00:00Z')],
    uid => uid === 'other' ? 'project-b' : 'project-a',
    () => 'project-a'
  );

  expect(result.openTasks.map(item => item.uid)).toEqual(['open-sooner', 'open-later']);
  expect(result.completedTasks.map(item => item.uid)).toEqual(['done-new', 'done-old']);
  expect(result.upcomingEvents.map(item => item.uid)).toEqual(['event-sooner', 'event-later']);
});

describe('project card window', () => {
  // Wednesday 30 September 2026; Monday weeks, so the window is 28 Sep – 11 Oct.
  const now = new Date(2026, 8, 30, 12);
  const open = (uid: string, due?: Date): CalendarTask => ({ uid, title: uid, completed: false, dueDate: due, createdAt: new Date(2026, 7, 1) });
  const at = (uid: string, start: Date): CalendarEvent => ({ uid, summary: uid, start, end: new Date(start.getTime() + 3600000), allDay: false, attendees: [] });

  test('lists overdue work, then this and next calendar week; counts the rest', () => {
    const tasks = [
      open('overdue', new Date(2026, 8, 18)),
      open('today', new Date(2026, 8, 30, 23)),
      open('next-week', new Date(2026, 9, 11, 9)),
      open('later', new Date(2026, 9, 12, 9)),
      open('undated'),
    ];
    const events = [at('this-week', new Date(2026, 9, 1, 10)), at('next-week', new Date(2026, 9, 8, 10)), at('later', new Date(2026, 9, 20, 10))];
    const window = projectOverviewWindow(tasks, events, now, 1);
    expect(window.overdue.map(t => t.uid)).toEqual(['overdue']);
    expect(window.dueSoon.map(t => t.uid)).toEqual(['today', 'next-week']);
    expect(window.eventsSoon.map(e => e.uid)).toEqual(['this-week', 'next-week']);
    expect(window.laterCount).toBe(2);
    expect(window.undatedCount).toBe(1);
    expect(projectWindowSummary(window)).toBe('1 overdue · 2 due in the next two weeks · 2 events');
  });

  test('the window follows the calendar week start, and an empty window says so', () => {
    // Sunday weeks: 27 Sep – 10 Oct, so Sunday 11 October is later.
    const window = projectOverviewWindow([open('sun', new Date(2026, 9, 11, 9))], [], now, 0);
    expect(window.dueSoon).toHaveLength(0);
    expect(window.laterCount).toBe(1);
    expect(projectWindowSummary(window)).toBe('Nothing in the next two weeks');
  });
});
