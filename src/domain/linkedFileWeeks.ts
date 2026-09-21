/** A file linked to one of a project's events or tasks, with that item's date. */
export interface LinkedFileEntry {
  label: string;
  path: string;
  /** The event's start or the task's due date; absent for undated tasks. */
  date?: Date;
  /** What the file is linked to, as shown under it: "Task: Read chapter 4" or "Lecture (Sep 23)". */
  source?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight at the start of the week containing `date`, weeks beginning on `weekStartsOn` (0 = Sunday). */
export function startOfWeek(date: Date, weekStartsOn: number): Date {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (day.getDay() - weekStartsOn + 7) % 7;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - offset);
}

/** The weekday a class's weeks begin: the chosen one, or the class start date's own weekday. */
export function classWeekStartDay(classStart: Date, chosen?: number): number {
  return chosen ?? classStart.getDay();
}

/** First and last day of a class week. */
export function classWeekRange(week: number, classStart: Date, weekStartsOn: number): { start: Date; end: Date } {
  const first = startOfWeek(classStart, weekStartsOn);
  const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() + (week - 1) * 7);
  return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6) };
}

/**
 * Calendar week of a class: Week 1 is the week containing the start date, and
 * weeks keep counting through holidays. Zero or less means before Week 1.
 */
export function classWeekNumber(date: Date, classStart: Date, weekStartsOn: number): number {
  const first = startOfWeek(classStart, weekStartsOn);
  const current = startOfWeek(date, weekStartsOn);
  // Rounded: a daylight-saving change makes one week an hour short or long.
  return Math.round((current.getTime() - first.getTime()) / (7 * DAY_MS)) + 1;
}

/** Zero-padded so a file manager sorts Week 02 before Week 10. */
export const weekFolderName = (week: number): string => `Week ${String(week).padStart(2, '0')}`;

/** Number of calendar weeks from the class start through its end date (the Project's due date). */
export function classWeekCount(classStart: Date, classEnd: Date, weekStartsOn: number): number {
  return Math.max(1, classWeekNumber(classEnd, classStart, weekStartsOn));
}

/** This week's folder name while the class is running, or undefined before it starts or after it ends. */
export function currentWeekFolderName(today: Date, classStart: Date, classEnd: Date, weekStartsOn: number): string | undefined {
  const week = classWeekNumber(today, classStart, weekStartsOn);
  return week >= 1 && week <= classWeekCount(classStart, classEnd, weekStartsOn) ? weekFolderName(week) : undefined;
}

/** Comparable form of a device path: /sdcard and /storage/emulated/0 are the same place. */
export function pathKey(path: string): string {
  return path.replace(/^\/(sdcard|storage\/emulated\/0)(?=\/)/, '').replace(/\/+$/, '');
}

/** True when `path` is inside `folder` or one of its subfolders. */
export function isInsideFolder(path: string, folder: string): boolean {
  return pathKey(path).startsWith(`${pathKey(folder)}/`);
}

/** What a linked file belongs to: the first item it is linked from, and how many more. */
export function linkCaption(entries: LinkedFileEntry[], path: string): string | undefined {
  const key = pathKey(path);
  const sources = [...new Set(entries.filter(entry => pathKey(entry.path) === key).map(entry => entry.source || 'Linked item'))];
  if (!sources.length) return undefined;
  return sources.length > 1 ? `${sources[0]} +${sources.length - 1} more` : sources[0];
}

/** The week number in a "Week 05" folder name, or undefined for any other folder. */
export function weekFolderNumber(name: string): number | undefined {
  const match = /^Week (\d+)$/.exec(name.trim());
  return match ? Number(match[1]) : undefined;
}

/**
 * Week folders listed without opening All weeks: last week, this week and
 * next week. Before the class, Weeks 1–2; after it, the final two.
 */
export function visibleWeekNumbers(today: Date, classStart: Date, weekCount: number, weekStartsOn: number): number[] {
  const week = classWeekNumber(today, classStart, weekStartsOn);
  if (week < 1) return [1, 2].filter(n => n <= weekCount);
  if (week > weekCount) return [weekCount - 1, weekCount].filter(n => n >= 1);
  return [week - 1, week, week + 1].filter(n => n >= 1 && n <= weekCount);
}

/** True once a project has both dates that define its weeks. */
export function projectHasWeeks(project: { classStartDate?: Date; dueDate?: Date }): boolean {
  return Boolean(project.classStartDate && project.dueDate);
}

/** The week folder a dated item belongs in, or undefined outside the project's weeks. */
export function weekFolderForDate(
  project: { classStartDate?: Date; dueDate?: Date; classWeekStartsOn?: number },
  projectFolder: string,
  date: Date | undefined,
): string | undefined {
  if (!date || !project.classStartDate || !project.dueDate) return undefined;
  const weekStart = classWeekStartDay(project.classStartDate, project.classWeekStartsOn);
  const week = classWeekNumber(date, project.classStartDate, weekStart);
  if (week < 1 || week > classWeekCount(project.classStartDate, project.dueDate, weekStart)) return undefined;
  return `${projectFolder.replace(/\/+$/, '')}/${weekFolderName(week)}`;
}
