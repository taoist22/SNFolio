import { compareTasks, isDone, taskStatus } from './taskModel';
import { Area, CalendarTask, Project, TaskStatus } from './types';

/**
 * Filtering and grouping for the task list.
 *
 * Kept out of the screen so the rules are testable, and expressed as discrete
 * choices rather than free text: this display ghosts on frequent redraws, so
 * the list is driven by tapping a chip rather than filtering as you type.
 */

export type TaskScope = 'open' | 'today' | 'upcoming' | 'done' | 'all';
export type TaskGrouping = 'none' | 'status' | 'priority' | 'due' | 'area' | 'project';

export const TASK_SCOPES: TaskScope[] = ['open', 'today', 'upcoming', 'done', 'all'];

const SCOPE_LABELS: Record<TaskScope, string> = {
  open: 'Open',
  today: 'Today',
  upcoming: 'Upcoming',
  done: 'Done',
  all: 'All',
};

export function scopeLabel(scope: TaskScope): string {
  return SCOPE_LABELS[scope];
}

export const TASK_GROUPINGS: TaskGrouping[] = ['none', 'status', 'priority', 'due', 'area', 'project'];

const GROUPING_LABELS: Record<TaskGrouping, string> = {
  none: 'Flat',
  status: 'Status',
  priority: 'Priority',
  due: 'Due',
  area: 'Area',
  project: 'Project',
};

export function groupingLabel(grouping: TaskGrouping): string {
  return GROUPING_LABELS[grouping];
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Narrows the list to a scope.
 *
 * "Open" deliberately includes undated tasks: they are the ones most easily
 * forgotten, and a list that hides them is how a No Date pile grows unnoticed.
 */
export function filterByScope(
  tasks: CalendarTask[],
  scope: TaskScope,
  now: Date = new Date()
): CalendarTask[] {
  const today = startOfDay(now).getTime();

  return tasks.filter(task => {
    const done = isDone(task);
    const due = task.dueDate ? startOfDay(task.dueDate).getTime() : null;

    switch (scope) {
      case 'open':
        return !done;
      case 'today':
        // Overdue work is part of today's problem, so it belongs here too.
        return !done && due !== null && due <= today;
      case 'upcoming':
        return !done && due !== null && due > today;
      case 'done':
        return done;
      default:
        return true;
    }
  });
}

export interface TaskGroup {
  key: string;
  label: string;
  tasks: CalendarTask[];
}

const STATUS_ORDER: TaskStatus[] = ['in-progress', 'todo', 'done'];
const STATUS_GROUP_LABELS: Record<TaskStatus, string> = {
  'in-progress': 'In Progress',
  todo: 'To Do',
  done: 'Done',
};

function dueBucket(task: CalendarTask, now: Date): { key: string; label: string; rank: number } {
  if (!task.dueDate) return { key: 'none', label: 'No Date', rank: 4 };

  const today = startOfDay(now).getTime();
  const due = startOfDay(task.dueDate).getTime();
  const week = today + 7 * 24 * 60 * 60 * 1000;

  if (due < today) return { key: 'overdue', label: 'Overdue', rank: 0 };
  if (due === today) return { key: 'today', label: 'Today', rank: 1 };
  if (due <= week) return { key: 'week', label: 'This Week', rank: 2 };
  return { key: 'later', label: 'Later', rank: 3 };
}

export interface AreaLookup {
  /** Area id for a task, by its uid. Absent means unfiled. */
  areaOf: (uid: string) => string | undefined;
  nameOf: (areaId: string) => string;
}

/** Narrows to one area. Membership lives outside the task, keyed by uid. */
export function filterByArea(
  tasks: CalendarTask[],
  areaId: string | null,
  lookup: AreaLookup
): CalendarTask[] {
  if (!areaId) return tasks;
  return tasks.filter(t => lookup.areaOf(t.uid) === areaId);
}

/**
 * Tasks filed directly in an Area rather than inside one of its Projects.
 * Project tasks are rendered with their Project, otherwise the Area view
 * would show the same task twice.
 */
export function directTasksInArea(
  tasks: CalendarTask[],
  areaId: string,
  areaOf: (uid: string) => string | undefined,
  projectOf: (uid: string) => string | undefined
): CalendarTask[] {
  return [...tasks]
    .filter(task => areaOf(task.uid) === areaId && !projectOf(task.uid))
    .sort(compareTasks);
}

/**
 * Groups a filtered list for display.
 *
 * Empty groups are omitted rather than shown as headers with nothing beneath —
 * on a small screen a run of empty headings buries the rows that do exist.
 */
export function groupTasks(
  tasks: CalendarTask[],
  grouping: TaskGrouping,
  now: Date = new Date(),
  lookup?: AreaLookup,
  projects?: ProjectLookup
): TaskGroup[] {
  const sorted = [...tasks].sort(compareTasks);

  if (grouping === 'none') {
    return sorted.length ? [{ key: 'all', label: '', tasks: sorted }] : [];
  }

  if (grouping === 'status') {
    return STATUS_ORDER.map(status => ({
      key: status,
      label: STATUS_GROUP_LABELS[status],
      tasks: sorted.filter(t => taskStatus(t) === status),
    })).filter(g => g.tasks.length > 0);
  }

  if (grouping === 'priority') {
    const buckets: Array<{ key: string; label: string; match: (t: CalendarTask) => boolean }> = [
      { key: '4', label: 'High', match: t => t.priority === 4 },
      { key: '3', label: 'Medium', match: t => t.priority === 3 },
      { key: '2', label: 'Low', match: t => t.priority === 2 },
      { key: '1', label: 'No Priority', match: t => !t.priority || t.priority === 1 },
    ];
    return buckets
      .map(b => ({ key: b.key, label: b.label, tasks: sorted.filter(b.match) }))
      .filter(g => g.tasks.length > 0);
  }

  if (grouping === 'area') {
    // Unfiled last: it is a residue, not a peer of the areas you named.
    const byArea = new Map<string, TaskGroup>();
    for (const task of sorted) {
      const areaId = lookup?.areaOf(task.uid);
      const key = areaId || '__unfiled';
      const label = areaId ? lookup?.nameOf(areaId) || 'Area' : 'Unfiled';
      const existing = byArea.get(key);
      if (existing) existing.tasks.push(task);
      else byArea.set(key, { key, label, tasks: [task] });
    }
    return [...byArea.values()].sort((a, b) => {
      if (a.key === '__unfiled') return 1;
      if (b.key === '__unfiled') return -1;
      return a.label.localeCompare(b.label);
    });
  }

  if (grouping === 'project') {
    const byProject = new Map<string, TaskGroup>();
    for (const task of sorted) {
      const projectId = projects?.projectOf(task.uid);
      const key = projectId || '__none';
      const label = projectId ? projects?.nameOf(projectId) || 'Project' : 'No Project';
      const existing = byProject.get(key);
      if (existing) existing.tasks.push(task);
      else byProject.set(key, { key, label, tasks: [task] });
    }
    return [...byProject.values()].sort((a, b) => {
      if (a.key === '__none') return 1;
      if (b.key === '__none') return -1;
      return a.label.localeCompare(b.label);
    });
  }

  const byBucket = new Map<string, TaskGroup & { rank: number }>();
  for (const task of sorted) {
    const bucket = dueBucket(task, now);
    const existing = byBucket.get(bucket.key);
    if (existing) existing.tasks.push(task);
    else byBucket.set(bucket.key, { ...bucket, tasks: [task] });
  }

  return [...byBucket.values()]
    .sort((a, b) => a.rank - b.rank)
    .map(({ key, label, tasks: groupTasksList }) => ({ key, label, tasks: groupTasksList }));
}

/** Total across groups, for the list header. */
export function countGrouped(groups: TaskGroup[]): number {
  return groups.reduce((n, g) => n + g.tasks.length, 0);
}

export interface ProjectLookup {
  /** Project id for a task, by its uid. Absent means unassigned. */
  projectOf: (uid: string) => string | undefined;
  nameOf: (projectId: string) => string;
}

/** Narrows to one project. Membership lives outside the task, keyed by uid. */
export function filterByProject(
  tasks: CalendarTask[],
  projectId: string | null,
  lookup: ProjectLookup
): CalendarTask[] {
  if (!projectId) return tasks;
  return tasks.filter(t => lookup.projectOf(t.uid) === projectId);
}

export interface ProjectProgress {
  done: number;
  total: number;
  /** 0–100, rounded. A project with no tasks reads as 0, not 100. */
  percent: number;
}

/**
 * How far along a project is.
 *
 * This is the whole reason a Project is not an Area: it can be finished, and
 * finishing is worth showing. An empty project reads as 0% rather than 100% —
 * nothing done is not everything done.
 */
export function projectProgress(
  tasks: CalendarTask[],
  projectId: string,
  lookup: ProjectLookup
): ProjectProgress {
  const mine = tasks.filter(t => lookup.projectOf(t.uid) === projectId);
  const done = mine.filter(isDone).length;
  return {
    done,
    total: mine.length,
    percent: mine.length === 0 ? 0 : Math.round((done / mine.length) * 100),
  };
}

/**
 * Projects belonging to an area.
 *
 * This is what separates a Project from an Area rather than duplicating it:
 * areas contain projects, projects finish. Narrowing the project choices to
 * the area you are working in is the visible consequence.
 */
export function projectsInArea(projects: Project[], areaId: string | null): Project[] {
  if (!areaId) return projects;
  return projects.filter(p => p.areaId === areaId);
}

/** Active projects only — a short list is the entire point of the split. */
export function activeProjects(projects: Project[]): Project[] {
  return projects
    .map((project, index) => ({ project, index }))
    .filter(entry => entry.project.status === 'active')
    .sort((a, b) => (a.project.sortOrder ?? a.index) - (b.project.sortOrder ?? b.index))
    .map(entry => entry.project);
}

/** Moves one active Project by one position in the single global Project order. */
export function moveActiveProject(
  projects: Project[],
  projectId: string,
  direction: 'up' | 'down'
): Project[] {
  const ordered = activeProjects(projects);
  const index = ordered.findIndex(project => project.id === projectId);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= ordered.length) return projects;

  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  const sortOrderById = new Map(ordered.map((project, sortOrder) => [project.id, sortOrder]));
  return projects.map(project => {
    const sortOrder = sortOrderById.get(project.id);
    return sortOrder === undefined ? project : { ...project, sortOrder };
  });
}

/** True when a project's due date has passed and it is not finished. */
export function projectOverdue(project: Project, now: Date = new Date()): boolean {
  if (!project.dueDate || project.status !== 'active') return false;
  const due = new Date(
    project.dueDate.getFullYear(),
    project.dueDate.getMonth(),
    project.dueDate.getDate()
  );
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return due.getTime() < today.getTime();
}

/**
 * Counts shown beside each area in the browser's left pane.
 *
 * Counts *projects*, not tasks: the left pane answers "what am I responsible
 * for and how much is in flight", and a task count there would compete with
 * the per-project progress on the right.
 */
export function areaProjectCounts(
  areas: Area[],
  projects: Project[]
): Array<{ area: Area; count: number }> {
  const live = activeProjects(projects);
  return areas.map(area => ({
    area,
    count: live.filter(p => p.areaId === area.id).length,
  }));
}

/** Projects that are finished or filed away — PARA's Archive. */
export function archivedProjects(projects: Project[]): Project[] {
  return projects.filter(p => p.status !== 'active');
}

/**
 * Deliverables in the order a project needs them.
 *
 * Actionable work sorts by when it is due, soonest first, with undated tasks
 * last — they are the ones with no claim on a particular day. Completed work
 * sorts by when it was finished, most recent first, because the useful question
 * about finished work is what you did lately.
 *
 * The order matters more than it looks: the project card shows only the first
 * few, so an arbitrary order means the card can show something due next month
 * while hiding the one due tomorrow.
 */
export function sortDeliverables(tasks: CalendarTask[], done: boolean): CalendarTask[] {
  const at = (task: CalendarTask): number | undefined => {
    const value = done ? task.completedAt : task.dueDate;
    const time = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(time) ? time : undefined;
  };

  return [...tasks].sort((left, right) => {
    const a = at(left);
    const b = at(right);
    if (a === undefined && b === undefined) return 0;
    // Undated last either way, rather than sorting as the epoch.
    if (a === undefined) return 1;
    if (b === undefined) return -1;
    return done ? b - a : a - b;
  });
}

/** True when an incomplete task's due date has passed. */
export function taskOverdue(task: CalendarTask, now: Date): boolean {
  if (!task.dueDate || isDone(task)) return false;
  const due = new Date(task.dueDate);
  // An all-day task is late once its day is over, not at midnight that morning.
  if (task.allDay !== false) due.setHours(23, 59, 59, 999);
  return due.getTime() < now.getTime();
}
