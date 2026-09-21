import { CalendarEvent, CalendarTask, Project } from './types';
import { classWeekCount, classWeekNumber, classWeekStartDay, LinkedFileEntry } from './linkedFileWeeks';
import { isDone } from './taskModel';

export interface WeekRange {
  start: Date;
  endExclusive: Date;
}

export function startOfPlannerWeek(value: Date, weekStartsOn: number = 1): Date {
  const result = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const daysSinceStart = (result.getDay() - weekStartsOn + 7) % 7;
  result.setDate(result.getDate() - daysSinceStart);
  return result;
}

export function plannerWeekRange(value: Date, weekStartsOn: number = 1): WeekRange {
  const start = startOfPlannerWeek(value, weekStartsOn);
  const endExclusive = new Date(start);
  endExclusive.setDate(endExclusive.getDate() + 7);
  return { start, endExclusive };
}

function inRange(value: Date | undefined, range: WeekRange): boolean {
  if (!value) return false;
  return value.getTime() >= range.start.getTime() && value.getTime() < range.endExclusive.getTime();
}

export function weeklyTaskSummary(tasks: CalendarTask[], selectedDate: Date, now = new Date(), weekStartsOn: number = 1) {
  const range = plannerWeekRange(selectedDate, weekStartsOn);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const completed = tasks.filter(task => isDone(task) && inRange(task.completedAt ?? task.dueDate, range));
  const due = tasks.filter(task => !isDone(task) && inRange(task.dueDate, range));
  const overdue = tasks.filter(task =>
    !isDone(task) && Boolean(task.dueDate && task.dueDate.getTime() < today.getTime())
  );
  return { range, completed, due, overdue };
}

/** Highest-priority work first, then overdue/today, then the nearest future due date. */
export function dailyFocusTasks(tasks: CalendarTask[], selectedDate: Date, limit = 3): CalendarTask[] {
  const selected = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()).getTime();
  return tasks
    .filter(task => !isDone(task))
    .sort((a, b) => {
      const aDue = a.dueDate?.getTime();
      const bDue = b.dueDate?.getTime();
      const aDueDay = a.dueDate
        ? new Date(a.dueDate.getFullYear(), a.dueDate.getMonth(), a.dueDate.getDate()).getTime()
        : undefined;
      const bDueDay = b.dueDate
        ? new Date(b.dueDate.getFullYear(), b.dueDate.getMonth(), b.dueDate.getDate()).getTime()
        : undefined;
      const aRelevance = aDueDay !== undefined && aDueDay <= selected ? 0 : aDueDay === undefined ? 1 : 2;
      const bRelevance = bDueDay !== undefined && bDueDay <= selected ? 0 : bDueDay === undefined ? 1 : 2;
      if (aRelevance !== bRelevance) return aRelevance - bRelevance;
      const aPriority = a.priority ?? 1;
      const bPriority = b.priority ?? 1;
      if (aPriority !== bPriority) return bPriority - aPriority;
      const aOrder = aDue ?? Number.POSITIVE_INFINITY;
      const bOrder = bDue ?? Number.POSITIVE_INFINITY;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.createdAt.getTime() - b.createdAt.getTime();
    })
    .slice(0, limit);
}

export function projectsNeedingAttention(
  projects: Project[],
  tasks: CalendarTask[],
  projectOf: (uid: string) => string | undefined,
  selectedDate: Date,
  limit = 4
): Project[] {
  const horizon = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + 7);
  return projects
    .filter(project => project.status === 'active')
    .filter(project => {
      const open = tasks.filter(task => projectOf(task.uid) === project.id && !isDone(task));
      return open.length === 0 ||
        Boolean(project.dueDate && project.dueDate.getTime() <= horizon.getTime()) ||
        open.some(task => task.dueDate && task.dueDate.getTime() <= horizon.getTime());
    })
    .sort((a, b) => {
      const aDue = a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
      const bDue = b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
      return aDue - bDue || a.createdAt.getTime() - b.createdAt.getTime();
    })
    .slice(0, limit);
}

export interface ProjectWeek {
  project: Project;
  /** Open tasks due this week, soonest first. */
  due: CalendarTask[];
  /** Events this week, in order. */
  events: CalendarEvent[];
  /** Notes and PDFs linked to this week's tasks and events. */
  notes: LinkedFileEntry[];
  /** The project's own week number, when it has a start and due date and this week is inside them. */
  week?: number;
}

/**
 * This week, one project at a time: what is due, what is scheduled, and what
 * has been written. Projects with nothing this week are left out.
 */
export function projectsThisWeek(
  projects: Project[],
  tasks: CalendarTask[],
  events: CalendarEvent[],
  projectOf: (uid: string) => string | undefined,
  projectOfEvent: (event: CalendarEvent) => string | undefined,
  notesFor: (project: Project) => LinkedFileEntry[],
  selectedDate: Date,
  weekStartsOn: number = 1,
): ProjectWeek[] {
  const range = plannerWeekRange(selectedDate, weekStartsOn);
  return projects
    .filter(project => project.status === 'active')
    .map(project => {
      const due = tasks
        .filter(task => projectOf(task.uid) === project.id && !isDone(task) && inRange(task.dueDate, range))
        .sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0));
      const weekEvents = events
        .filter(event => projectOfEvent(event) === project.id && inRange(event.start, range))
        .sort((a, b) => a.start.getTime() - b.start.getTime());
      const seen = new Set<string>();
      const notes = notesFor(project).filter(note => {
        if (!inRange(note.date, range) || seen.has(note.path)) return false;
        seen.add(note.path);
        return true;
      });
      let week: number | undefined;
      if (project.classStartDate && project.dueDate) {
        const start = classWeekStartDay(project.classStartDate, project.classWeekStartsOn);
        const n = classWeekNumber(selectedDate, project.classStartDate, start);
        if (n >= 1 && n <= classWeekCount(project.classStartDate, project.dueDate, start)) week = n;
      }
      return { project, due, events: weekEvents, notes, week };
    })
    .filter(entry => entry.due.length > 0 || entry.events.length > 0 || entry.notes.length > 0);
}
