import { CalendarTask, Project } from './types';
import { dailyFocusTasks, plannerWeekRange, projectsNeedingAttention, projectsThisWeek, weeklyTaskSummary } from './plannerReview';

function task(uid: string, due: string | undefined, priority: 1 | 2 | 3 | 4 = 1, completedAt?: string): CalendarTask {
  return {
    uid,
    title: uid,
    dueDate: due ? new Date(`${due}T12:00:00`) : undefined,
    createdAt: new Date('2026-08-01T12:00:00'),
    completed: Boolean(completedAt),
    completedAt: completedAt ? new Date(`${completedAt}T12:00:00`) : undefined,
    priority,
  };
}

function project(id: string, due?: string): Project {
  return {
    id,
    name: id,
    status: 'active',
    dueDate: due ? new Date(`${due}T12:00:00`) : undefined,
    createdAt: new Date('2026-08-01T12:00:00'),
  };
}

describe('planner review helpers', () => {
  test('uses Monday through Sunday for a planner week', () => {
    const range = plannerWeekRange(new Date('2026-08-26T12:00:00'));
    expect(range.start.toDateString()).toBe(new Date('2026-08-24T00:00:00').toDateString());
    expect(range.endExclusive.toDateString()).toBe(new Date('2026-08-31T00:00:00').toDateString());
  });

  test('supports a configured Sunday week start', () => {
    const range = plannerWeekRange(new Date('2026-08-26T12:00:00'), 0);
    expect(range.start.toDateString()).toBe(new Date('2026-08-23T00:00:00').toDateString());
  });

  test('summarizes completed, due, and overdue work independently', () => {
    const summary = weeklyTaskSummary([
      task('done', '2026-08-25', 1, '2026-08-25'),
      task('due', '2026-08-29'),
      task('late', '2026-08-20'),
    ], new Date('2026-08-26T12:00:00'), new Date('2026-08-26T12:00:00'));
    expect(summary.completed.map(item => item.uid)).toEqual(['done']);
    expect(summary.due.map(item => item.uid)).toEqual(['due']);
    expect(summary.overdue.map(item => item.uid)).toEqual(['late']);
  });

  test('focus favors high-priority work before ordinary work', () => {
    const result = dailyFocusTasks([
      task('ordinary', '2026-08-26'),
      task('important', '2026-08-26', 4),
    ], new Date('2026-08-26T12:00:00'));
    expect(result.map(item => item.uid)).toEqual(['important', 'ordinary']);
  });

  test('flags active projects with no next action or a near deadline', () => {
    const projects = [project('empty'), project('near', '2026-08-28'), project('later', '2026-10-01')];
    const tasks = [task('near-task', '2026-08-28'), task('later-task', '2026-10-01')];
    const result = projectsNeedingAttention(
      projects,
      tasks,
      uid => uid.startsWith('near') ? 'near' : uid.startsWith('later') ? 'later' : undefined,
      new Date('2026-08-26T12:00:00')
    );
    expect(result.map(item => item.id)).toEqual(['near', 'empty']);
  });
});

test('this week by project: due tasks, events and linked notes for the week; quiet projects are left out', () => {
  const projects: Project[] = [
    { id: 'ids', name: 'IDS105', status: 'active', createdAt: new Date('2026-08-01T12:00:00'),
      classStartDate: new Date('2026-09-02T12:00:00'), dueDate: new Date('2026-12-18T12:00:00') },
    { id: 'acme', name: 'Acme', status: 'active', createdAt: new Date('2026-08-01T12:00:00') },
    { id: 'quiet', name: 'Quiet', status: 'active', createdAt: new Date('2026-08-01T12:00:00') },
  ];
  const tasks = [task('essay', '2026-09-30'), task('later', '2026-10-20'), task('memo', '2026-10-01')];
  const owner: Record<string, string> = { essay: 'ids', later: 'ids', memo: 'acme' };
  const lecture = { uid: 'lec_1', summary: 'Lecture', start: new Date('2026-09-29T10:00:00'), end: new Date('2026-09-29T11:00:00'), allDay: false, attendees: [] };
  const notes = { ids: [
    { label: 'Lecture.note', path: '/N/Lecture.note', date: new Date('2026-09-29T10:00:00') },
    { label: 'Old.note', path: '/N/Old.note', date: new Date('2026-09-08T10:00:00') },
  ] } as Record<string, any[]>;
  const weeks = projectsThisWeek(projects, tasks, [lecture], uid => owner[uid], () => 'ids',
    project => notes[project.id] || [], new Date('2026-09-30T12:00:00'), 1);
  expect(weeks.map(week => week.project.id)).toEqual(['ids', 'acme']);
  const ids = weeks[0];
  expect(ids.due.map(item => item.uid)).toEqual(['essay']);
  expect(ids.events).toHaveLength(1);
  expect(ids.notes.map(note => note.label)).toEqual(['Lecture.note']);
  // Weeks run from the start day (Wednesday 2 September): 30 September is in Week 5.
  expect(ids.week).toBe(5);
  expect(weeks[1].week).toBeUndefined();
});
