import {
  eventMatchesTaskRule,
  taskFromEvent,
  taskifiedEventIdentities,
  tasksForEvent,
} from './eventTasks';
import { CalendarEvent, CalendarTask, Project } from './types';

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  uid: 'evt-1',
  summary: 'Assignments Due — Module Six',
  start: new Date('2026-10-11T00:00:00Z'),
  end: new Date('2026-10-11T23:59:00Z'),
  allDay: true,
  attendees: [],
  sourceKind: 'feed',
  ...over,
});

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: 'IDS105',
  status: 'active',
  createdAt: new Date(),
  ...over,
});

describe('taskFromEvent', () => {
  test('the deadline becomes the due date', () => {
    const task = taskFromEvent(event(), 'task-1', new Date('2026-10-08T00:00:00Z'));
    expect(task.dueDate?.toISOString()).toBe('2026-10-11T00:00:00.000Z');
    expect(task.title).toBe('Assignments Due — Module Six');
    expect(task.completed).toBe(false);
    expect(task.status).toBe('todo');
  });

  test('an all-day event makes an undated-time task, not one due at midnight', () => {
    expect(taskFromEvent(event(), 't', new Date()).allDay).toBe(true);
  });

  test('a timed event keeps its clock time', () => {
    const task = taskFromEvent(event({ allDay: false }), 't', new Date());
    expect(task.allDay).toBe(false);
  });

  test('an empty title still produces something nameable', () => {
    expect(taskFromEvent(event({ summary: '   ' }), 't', new Date()).title).toBe('Untitled');
  });

  test("the event's description carries over as notes", () => {
    expect(taskFromEvent(event({ description: ' read ch.4 ' }), 't', new Date()).notes).toBe('read ch.4');
  });
});

describe('eventMatchesTaskRule', () => {
  test('matches a word from the project rule, ignoring punctuation and case', () => {
    expect(eventMatchesTaskRule(event(), project({ taskifyMatch: 'due' }))).toBe(true);
  });

  test('matches any of several words', () => {
    expect(eventMatchesTaskRule(
      event({ summary: 'Initial Discussion Post' }),
      project({ taskifyMatch: 'Due, Discussion Post' }),
    )).toBe(true);
  });

  test('does not match an unrelated event', () => {
    expect(eventMatchesTaskRule(
      event({ summary: 'Module Seven Begins' }),
      project({ taskifyMatch: 'Due' }),
    )).toBe(false);
  });

  test('a project with no rule never matches', () => {
    expect(eventMatchesTaskRule(event(), project())).toBe(false);
    expect(eventMatchesTaskRule(event(), project({ taskifyMatch: '  ,  ' }))).toBe(false);
  });

  test('a finished project stops converting its events', () => {
    expect(eventMatchesTaskRule(event(), project({ taskifyMatch: 'Due', status: 'done' }))).toBe(false);
  });

  test('an event with no project is left alone', () => {
    expect(eventMatchesTaskRule(event(), undefined)).toBe(false);
  });

  test('only the title is searched, not the location', () => {
    // "Due" in a room name would otherwise convert everything in that room.
    expect(eventMatchesTaskRule(
      event({ summary: 'Lecture', location: 'Dueñas Hall' }),
      project({ taskifyMatch: 'Due' }),
    )).toBe(false);
  });
});

describe('taskifiedEventIdentities', () => {
  test('hides an event whose standing-in task still exists', () => {
    const hidden = taskifiedEventIdentities({ 'evt-1': { taskifiedAs: 'task-1' } }, new Set(['task-1']));
    expect(hidden.has('evt-1')).toBe(true);
  });

  test('a deleted task releases its event', () => {
    // Otherwise the event stays invisible with nothing standing in for it.
    const hidden = taskifiedEventIdentities({ 'evt-1': { taskifiedAs: 'task-1' } }, new Set());
    expect(hidden.has('evt-1')).toBe(false);
  });

  test('ignores membership entries that are about something else', () => {
    expect(taskifiedEventIdentities({ 'evt-2': {} }, new Set(['task-1'])).size).toBe(0);
  });
});

describe('tasksForEvent', () => {
  const task = (uid: string): CalendarTask =>
    ({ uid, title: uid, completed: false, createdAt: new Date() } as CalendarTask);

  test('returns only the tasks attached to that event', () => {
    const tasks = [task('a'), task('b'), task('c')];
    const membership = {
      a: { forEventIdentity: 'evt-1' },
      b: { forEventIdentity: 'evt-2' },
      c: { forEventIdentity: 'evt-1' },
    };
    expect(tasksForEvent('evt-1', tasks, membership).map(t => t.uid)).toEqual(['a', 'c']);
  });

  test('an event with none returns nothing', () => {
    expect(tasksForEvent('evt-9', [task('a')], { a: { forEventIdentity: 'evt-1' } })).toEqual([]);
  });
});
