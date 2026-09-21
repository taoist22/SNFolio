import { CalendarEvent, CalendarTask } from './types';
import { isDone } from './taskModel';

export function projectOverviewItems(
  projectId: string,
  tasks: CalendarTask[],
  events: CalendarEvent[],
  projectOfTask: (uid: string) => string | undefined,
  projectOfEvent: (event: CalendarEvent) => string | undefined
) {
  const projectTasks = tasks.filter(task => projectOfTask(task.uid) === projectId);
  const openTasks = projectTasks
    .filter(task => !isDone(task))
    .sort((a, b) =>
      (a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY) -
      (b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY)
    );
  const completedTasks = projectTasks
    .filter(isDone)
    .sort((a, b) =>
      (b.completedAt?.getTime() ?? b.dueDate?.getTime() ?? 0) -
      (a.completedAt?.getTime() ?? a.dueDate?.getTime() ?? 0)
    );
  const upcomingEvents = events
    .filter(event => projectOfEvent(event) === projectId)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  return { openTasks, completedTasks, upcomingEvents };
}

export interface ProjectOverviewWindow {
  /** Open tasks due before today, oldest first: always shown so nothing slips. */
  overdue: CalendarTask[];
  /** Open tasks due from today to the end of next week. */
  dueSoon: CalendarTask[];
  /** Events from now to the end of next week. */
  eventsSoon: CalendarEvent[];
  /** Open tasks and events after next week, not listed on the card. */
  laterCount: number;
  /** Open tasks without a due date, not listed on the card. */
  undatedCount: number;
}

/**
 * What a project card lists: overdue work, then this week and next week by
 * the calendar's week start, so every card uses the same two weeks. The rest
 * is counted and lives in the project itself.
 */
export function projectOverviewWindow(
  openTasks: CalendarTask[],
  events: CalendarEvent[],
  now: Date,
  weekStartsOn: number,
): ProjectOverviewWindow {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - ((today.getDay() - weekStartsOn + 7) % 7));
  const windowEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 14);
  const dated = openTasks.filter(task => task.dueDate);
  const overdue = dated.filter(task => (task.dueDate as Date).getTime() < today.getTime());
  const dueSoon = dated.filter(task => {
    const due = (task.dueDate as Date).getTime();
    return due >= today.getTime() && due < windowEnd.getTime();
  });
  const upcoming = events.filter(event => event.end.getTime() >= now.getTime() || event.start.getTime() >= today.getTime());
  const eventsSoon = upcoming.filter(event => event.start.getTime() < windowEnd.getTime());
  const laterTasks = dated.filter(task => (task.dueDate as Date).getTime() >= windowEnd.getTime()).length;
  return {
    overdue,
    dueSoon,
    eventsSoon,
    laterCount: laterTasks + (upcoming.length - eventsSoon.length),
    undatedCount: openTasks.length - dated.length,
  };
}

/** One line for a collapsed card, e.g. "1 overdue · 2 due in the next two weeks · 3 events". */
export function projectWindowSummary(window: ProjectOverviewWindow): string {
  const parts = [
    window.overdue.length ? `${window.overdue.length} overdue` : '',
    window.dueSoon.length ? `${window.dueSoon.length} due in the next two weeks` : '',
    window.eventsSoon.length ? `${window.eventsSoon.length} event${window.eventsSoon.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nothing in the next two weeks';
}
