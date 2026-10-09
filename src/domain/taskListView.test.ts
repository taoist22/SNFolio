import {
  activeProjects,
  archivedProjects,
  areaProjectCounts,
  countGrouped,
  directTasksInArea,
  filterByArea,
  filterByProject,
  filterByScope,
  groupTasks,
  groupingLabel,
  moveActiveProject,
  projectOverdue,
  projectProgress,
  projectsInArea,
  scopeLabel,
  sortDeliverables,
  taskOverdue,
} from './taskListView';
import { withStatus } from './taskModel';
import { Area, CalendarTask, Project } from './types';

const NOW = new Date(2026, 7, 19, 10, 0);
const day = (offset: number) => new Date(2026, 7, 19 + offset);

function makeTask(uid: string, over: Partial<CalendarTask> = {}): CalendarTask {
  return {
    uid,
    title: uid,
    completed: false,
    createdAt: new Date(2026, 7, 1),
    ...over,
  };
}

describe('filterByScope', () => {
  const overdue = makeTask('overdue', { dueDate: day(-3) });
  const today = makeTask('today', { dueDate: day(0) });
  const soon = makeTask('soon', { dueDate: day(4) });
  const undated = makeTask('undated');
  const finished = withStatus(makeTask('finished', { dueDate: day(-1) }), 'done');
  const all = [overdue, today, soon, undated, finished];

  test('open excludes finished work', () => {
    expect(filterByScope(all, 'open', NOW).map(t => t.uid)).toEqual([
      'overdue',
      'today',
      'soon',
      'undated',
    ]);
  });

  test('open keeps undated tasks', () => {
    // They are the easiest to forget; a list that hides them is how a No Date
    // pile grows unnoticed.
    expect(filterByScope(all, 'open', NOW).map(t => t.uid)).toContain('undated');
  });

  test('today includes overdue work', () => {
    // Something you should have done yesterday is part of today's problem.
    expect(filterByScope(all, 'today', NOW).map(t => t.uid)).toEqual(['overdue', 'today']);
  });

  test('today excludes undated tasks', () => {
    expect(filterByScope(all, 'today', NOW).map(t => t.uid)).not.toContain('undated');
  });

  test('upcoming is strictly after today', () => {
    expect(filterByScope(all, 'upcoming', NOW).map(t => t.uid)).toEqual(['soon']);
  });

  test('done shows only finished work', () => {
    expect(filterByScope(all, 'done', NOW).map(t => t.uid)).toEqual(['finished']);
  });

  test('all returns everything untouched', () => {
    expect(filterByScope(all, 'all', NOW)).toHaveLength(5);
  });

  test('an empty list stays empty in every scope', () => {
    for (const scope of ['open', 'today', 'upcoming', 'done', 'all'] as const) {
      expect(filterByScope([], scope, NOW)).toEqual([]);
    }
  });
});

describe('groupTasks', () => {
  test('flat grouping returns one unlabelled group', () => {
    const groups = groupTasks([makeTask('a'), makeTask('b')], 'none', NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].tasks).toHaveLength(2);
  });

  test('flat grouping of nothing produces no groups at all', () => {
    expect(groupTasks([], 'none', NOW)).toEqual([]);
  });

  test('status grouping leads with In Progress', () => {
    // What you are part-way through matters more than what you have not begun.
    const tasks = [
      makeTask('a'),
      withStatus(makeTask('b'), 'in-progress'),
      withStatus(makeTask('c'), 'done'),
    ];
    expect(groupTasks(tasks, 'status', NOW).map(g => g.label)).toEqual([
      'In Progress',
      'To Do',
      'Done',
    ]);
  });

  test('empty groups are omitted rather than shown as bare headings', () => {
    const groups = groupTasks([makeTask('a')], 'status', NOW);
    expect(groups.map(g => g.label)).toEqual(['To Do']);
  });

  test('priority groups run high to low, with unset last', () => {
    const tasks = [
      makeTask('none'),
      makeTask('high', { priority: 4 }),
      makeTask('low', { priority: 2 }),
      makeTask('med', { priority: 3 }),
    ];
    expect(groupTasks(tasks, 'priority', NOW).map(g => g.label)).toEqual([
      'High',
      'Medium',
      'Low',
      'No Priority',
    ]);
  });

  test('priority 1 and unset share the same group', () => {
    const tasks = [makeTask('a', { priority: 1 }), makeTask('b')];
    const groups = groupTasks(tasks, 'priority', NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].tasks).toHaveLength(2);
  });

  test('due grouping runs overdue, today, this week, later, no date', () => {
    const tasks = [
      makeTask('later', { dueDate: day(30) }),
      makeTask('none'),
      makeTask('today', { dueDate: day(0) }),
      makeTask('overdue', { dueDate: day(-2) }),
      makeTask('week', { dueDate: day(3) }),
    ];
    expect(groupTasks(tasks, 'due', NOW).map(g => g.label)).toEqual([
      'Overdue',
      'Today',
      'This Week',
      'Later',
      'No Date',
    ]);
  });

  test('exactly seven days out is still This Week', () => {
    const groups = groupTasks([makeTask('edge', { dueDate: day(7) })], 'due', NOW);
    expect(groups[0].label).toBe('This Week');
  });

  test('eight days out is Later', () => {
    const groups = groupTasks([makeTask('edge', { dueDate: day(8) })], 'due', NOW);
    expect(groups[0].label).toBe('Later');
  });

  test('grouping sorts within a group by priority', () => {
    const tasks = [
      makeTask('low', { dueDate: day(0), priority: 2 }),
      makeTask('high', { dueDate: day(0), priority: 4 }),
    ];
    const groups = groupTasks(tasks, 'due', NOW);
    expect(groups[0].tasks.map(t => t.uid)).toEqual(['high', 'low']);
  });

  test('grouping never loses or duplicates a task', () => {
    const tasks = [
      makeTask('a', { dueDate: day(-1) }),
      makeTask('b', { dueDate: day(0), priority: 4 }),
      makeTask('c'),
      withStatus(makeTask('d'), 'done'),
    ];
    for (const grouping of ['none', 'status', 'priority', 'due'] as const) {
      const groups = groupTasks(tasks, grouping, NOW);
      expect(countGrouped(groups)).toBe(4);
      const uids = groups.flatMap(g => g.tasks.map(t => t.uid));
      expect(new Set(uids).size).toBe(4);
    }
  });

  test('grouping does not mutate the input array', () => {
    const tasks = [makeTask('b', { priority: 2 }), makeTask('a', { priority: 4 })];
    groupTasks(tasks, 'priority', NOW);
    expect(tasks.map(t => t.uid)).toEqual(['b', 'a']);
  });
});

describe('labels', () => {
  test('scopes read as plain words', () => {
    expect(scopeLabel('open')).toBe('Open');
    expect(scopeLabel('upcoming')).toBe('Upcoming');
  });

  test('groupings read as plain words', () => {
    expect(groupingLabel('none')).toBe('Flat');
    expect(groupingLabel('due')).toBe('Due');
  });
});

describe('areas', () => {
  const membership: Record<string, string> = { a: 'area-work', b: 'area-eng', c: 'area-work' };
  const names: Record<string, string> = { 'area-work': 'Work', 'area-eng': 'ENG 102' };
  const lookup = {
    areaOf: (uid: string) => membership[uid],
    nameOf: (id: string) => names[id],
  };

  const tasks = [makeTask('a'), makeTask('b'), makeTask('c'), makeTask('d')];

  test('filtering narrows to one area', () => {
    expect(filterByArea(tasks, 'area-work', lookup).map(t => t.uid)).toEqual(['a', 'c']);
  });

  test('no area selected leaves the list untouched', () => {
    expect(filterByArea(tasks, null, lookup)).toHaveLength(4);
  });

  test('grouping names each area and puts unfiled last', () => {
    // Unfiled is a residue, not a peer of the areas you named.
    const groups = groupTasks(tasks, 'area', NOW, lookup);
    expect(groups.map(g => g.label)).toEqual(['ENG 102', 'Work', 'Unfiled']);
  });

  test('grouping by area loses nobody', () => {
    const groups = groupTasks(tasks, 'area', NOW, lookup);
    expect(countGrouped(groups)).toBe(4);
  });

  test('an area with no tasks produces no heading', () => {
    const groups = groupTasks([makeTask('b')], 'area', NOW, lookup);
    expect(groups.map(g => g.label)).toEqual(['ENG 102']);
  });

  test('grouping by area without a lookup files everything as Unfiled', () => {
    // Rather than throwing: membership lives outside the task, so a caller
    // that has not loaded it yet should still render something sane.
    const groups = groupTasks(tasks, 'area', NOW);
    expect(groups.map(g => g.label)).toEqual(['Unfiled']);
    expect(countGrouped(groups)).toBe(4);
  });

  test('an area whose name is missing still groups', () => {
    const partial = { areaOf: (uid: string) => membership[uid], nameOf: () => '' };
    const groups = groupTasks([makeTask('a')], 'area', NOW, partial);
    expect(groups).toHaveLength(1);
  });

  test('an Area shows only tasks filed directly in it', () => {
    const projectMembership: Record<string, string> = { c: 'project-in-work' };
    expect(
      directTasksInArea(
        tasks,
        'area-work',
        uid => membership[uid],
        uid => projectMembership[uid]
      ).map(task => task.uid)
    ).toEqual(['a']);
  });
});

describe('projects', () => {
  const assigned: Record<string, string> = { a: 'p-paper', b: 'p-paper', c: 'p-solar' };
  const names: Record<string, string> = { 'p-paper': 'Term Paper', 'p-solar': 'Solar Monitor' };
  const projects = {
    projectOf: (uid: string) => assigned[uid],
    nameOf: (id: string) => names[id],
  };

  const tasks = [
    withStatus(makeTask('a'), 'done'),
    makeTask('b'),
    makeTask('c'),
    makeTask('d'),
  ];

  test('filtering narrows to one project', () => {
    expect(filterByProject(tasks, 'p-paper', projects).map(t => t.uid)).toEqual(['a', 'b']);
  });

  test('no project selected leaves the list untouched', () => {
    expect(filterByProject(tasks, null, projects)).toHaveLength(4);
  });

  test('grouping names each project and puts unassigned last', () => {
    const groups = groupTasks(tasks, 'project', NOW, undefined, projects);
    expect(groups.map(g => g.label)).toEqual(['Solar Monitor', 'Term Paper', 'No Project']);
  });

  test('grouping by project loses nobody', () => {
    expect(countGrouped(groupTasks(tasks, 'project', NOW, undefined, projects))).toBe(4);
  });

  test('progress counts done against total', () => {
    // The reason a Project is not an Area: it can be finished.
    expect(projectProgress(tasks, 'p-paper', projects)).toEqual({
      done: 1,
      total: 2,
      percent: 50,
    });
  });

  test('an empty project reads as 0%, not 100%', () => {
    // Nothing done is not everything done.
    expect(projectProgress(tasks, 'p-empty', projects)).toEqual({ done: 0, total: 0, percent: 0 });
  });

  test('a fully finished project reads as 100%', () => {
    const finished = [withStatus(makeTask('c'), 'done')];
    expect(projectProgress(finished, 'p-solar', projects).percent).toBe(100);
  });

  test('in-progress work does not count as done', () => {
    const partial = [withStatus(makeTask('a'), 'in-progress'), makeTask('b')];
    expect(projectProgress(partial, 'p-paper', projects).done).toBe(0);
  });

  test('grouping by project without a lookup files everything as No Project', () => {
    const groups = groupTasks(tasks, 'project', NOW);
    expect(groups.map(g => g.label)).toEqual(['No Project']);
    expect(countGrouped(groups)).toBe(4);
  });
});

describe('areas contain projects', () => {
  const project = (id: string, name: string, over: Partial<Project> = {}): Project => ({
    id,
    name,
    status: 'active',
    createdAt: new Date(2026, 0, 1),
    ...over,
  });

  const projects = [
    project('p-paper', 'Term Paper', { areaId: 'a-eng' }),
    project('p-exam', 'Final Exam', { areaId: 'a-eng' }),
    project('p-solar', 'Solar Monitor', { areaId: 'a-farm' }),
    project('p-loose', 'Unfiled Thing'),
  ];

  test('projects narrow to the area you are working in', () => {
    // The visible consequence of areas containing projects, rather than the
    // two being parallel lists.
    expect(projectsInArea(projects, 'a-eng').map(p => p.name)).toEqual([
      'Term Paper',
      'Final Exam',
    ]);
  });

  test('no area selected shows every project', () => {
    expect(projectsInArea(projects, null)).toHaveLength(4);
  });

  test('an area with no projects yields nothing rather than an empty heading', () => {
    expect(projectsInArea(projects, 'a-none')).toEqual([]);
  });

  test('active filters out finished and archived work', () => {
    const mixed = [
      project('p1', 'Live'),
      project('p2', 'Finished', { status: 'done' }),
      project('p3', 'Filed away', { status: 'archived' }),
    ];
    expect(activeProjects(mixed).map(p => p.name)).toEqual(['Live']);
  });

  test('a project in second position can move into first position', () => {
    const moved = moveActiveProject(projects, 'p-exam', 'up');
    expect(activeProjects(moved).map(p => p.id)).toEqual([
      'p-exam',
      'p-paper',
      'p-solar',
      'p-loose',
    ]);
  });

  test('moving past the first position is a no-op', () => {
    expect(moveActiveProject(projects, 'p-paper', 'up')).toBe(projects);
  });
});

describe('project due dates', () => {
  const NOW_DAY = new Date(2026, 7, 19, 10, 0);
  const project = (over: Partial<Project> = {}): Project => ({
    id: 'p',
    name: 'Term Paper',
    status: 'active',
    createdAt: new Date(2026, 0, 1),
    ...over,
  });

  test('a past due date on live work is overdue', () => {
    expect(projectOverdue(project({ dueDate: new Date(2026, 7, 18) }), NOW_DAY)).toBe(true);
  });

  test('due today is not overdue', () => {
    expect(projectOverdue(project({ dueDate: new Date(2026, 7, 19) }), NOW_DAY)).toBe(false);
  });

  test('a finished project is never overdue, however late', () => {
    // Nagging about something already done is noise.
    const done = project({ dueDate: new Date(2026, 1, 1), status: 'done' });
    expect(projectOverdue(done, NOW_DAY)).toBe(false);
  });

  test('no due date is never overdue', () => {
    expect(projectOverdue(project(), NOW_DAY)).toBe(false);
  });
});

describe('the PARA browser', () => {
  const area = (id: string, name: string): Area => ({ id, name, createdAt: new Date(2026, 0, 1) });
  const project = (id: string, name: string, over: Partial<Project> = {}): Project => ({
    id,
    name,
    status: 'active',
    createdAt: new Date(2026, 0, 1),
    ...over,
  });

  const areas = [area('work', 'Work'), area('acad', 'Academic'), area('fin', 'Finance')];
  const projects = [
    project('p1', 'Website Redesign', { areaId: 'work' }),
    project('p2', 'Client Launch', { areaId: 'work' }),
    project('p3', 'Term Paper', { areaId: 'acad' }),
    project('p4', 'Old Thing', { areaId: 'work', status: 'done' }),
  ];

  test('area counts are of projects, not tasks', () => {
    // The left pane answers "how much is in flight", not "how much to do".
    const counts = areaProjectCounts(areas, projects);
    expect(counts.map(c => [c.area.name, c.count])).toEqual([
      ['Work', 2],
      ['Academic', 1],
      ['Finance', 0],
    ]);
  });

  test('finished projects are excluded from the counts', () => {
    // 'Old Thing' is done, so Work reads 2 rather than 3.
    expect(areaProjectCounts(areas, projects).find(c => c.area.id === 'work')?.count).toBe(2);
  });

  test('an area with nothing in it still appears, showing zero', () => {
    // Vanishing when empty would make an area look deleted.
    expect(areaProjectCounts(areas, projects).some(c => c.area.name === 'Finance')).toBe(true);
  });

  test('the archive holds everything not active', () => {
    const mixed = [...projects, project('p5', 'Filed', { status: 'archived' })];
    expect(archivedProjects(mixed).map(p => p.name)).toEqual(['Old Thing', 'Filed']);
  });

  test('nothing finished means an empty archive', () => {
    expect(archivedProjects([project('p1', 'Live')])).toEqual([]);
  });
});

describe('sortDeliverables', () => {
  const task = (uid: string, over: Partial<CalendarTask> = {}): CalendarTask =>
    ({ uid, title: uid, completed: false, createdAt: new Date('2026-01-01'), ...over } as CalendarTask);

  test('actionable work sorts by due date, soonest first', () => {
    const sorted = sortDeliverables([
      task('late', { dueDate: new Date('2026-10-20') }),
      task('soon', { dueDate: new Date('2026-10-09') }),
      task('mid', { dueDate: new Date('2026-10-14') }),
    ], false);
    expect(sorted.map(t => t.uid)).toEqual(['soon', 'mid', 'late']);
  });

  test('undated work goes last rather than sorting as the epoch', () => {
    const sorted = sortDeliverables([
      task('none'),
      task('dated', { dueDate: new Date('2026-10-20') }),
    ], false);
    expect(sorted.map(t => t.uid)).toEqual(['dated', 'none']);
  });

  test('completed work sorts by completion, most recent first', () => {
    const sorted = sortDeliverables([
      task('older', { completed: true, completedAt: new Date('2026-09-01') }),
      task('newer', { completed: true, completedAt: new Date('2026-10-01') }),
    ], true);
    expect(sorted.map(t => t.uid)).toEqual(['newer', 'older']);
  });

  test('completed work with no completion time goes last', () => {
    const sorted = sortDeliverables([
      task('unknown', { completed: true }),
      task('known', { completed: true, completedAt: new Date('2026-09-01') }),
    ], true);
    expect(sorted.map(t => t.uid)).toEqual(['known', 'unknown']);
  });

  test('does not mutate the list it was given', () => {
    const input = [task('b', { dueDate: new Date('2026-10-20') }), task('a', { dueDate: new Date('2026-10-01') })];
    sortDeliverables(input, false);
    expect(input.map(t => t.uid)).toEqual(['b', 'a']);
  });
});

describe('taskOverdue', () => {
  const now = new Date('2026-10-08T12:00:00');

  test('an all-day task is late only once its day is over', () => {
    // Due today, not yet overdue at noon.
    expect(taskOverdue({ uid: 'a', title: 'a', completed: false, createdAt: now,
      dueDate: new Date('2026-10-08T00:00:00'), allDay: true } as CalendarTask, now)).toBe(false);
    expect(taskOverdue({ uid: 'a', title: 'a', completed: false, createdAt: now,
      dueDate: new Date('2026-10-07T00:00:00'), allDay: true } as CalendarTask, now)).toBe(true);
  });

  test('a timed task is late once its time has passed', () => {
    expect(taskOverdue({ uid: 'a', title: 'a', completed: false, createdAt: now,
      dueDate: new Date('2026-10-08T09:00:00'), allDay: false } as CalendarTask, now)).toBe(true);
  });

  test('finished work is never overdue', () => {
    expect(taskOverdue({ uid: 'a', title: 'a', completed: true, createdAt: now,
      dueDate: new Date('2026-01-01'), allDay: true } as CalendarTask, now)).toBe(false);
  });

  test('undated work is never overdue', () => {
    expect(taskOverdue({ uid: 'a', title: 'a', completed: false, createdAt: now } as CalendarTask, now)).toBe(false);
  });
});
