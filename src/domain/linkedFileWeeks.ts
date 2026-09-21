/** A file linked to one of a project's events or tasks, with that item's date. */
export interface LinkedFileEntry {
  label: string;
  path: string;
  /** The event's start or the task's due date; absent for undated tasks. */
  date?: Date;
}

export interface LinkedFileGroup {
  key: string;
  title: string;
  files: Array<{ label: string; path: string }>;
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

const shortDate = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function addUnique(group: LinkedFileGroup, entry: LinkedFileEntry) {
  if (!group.files.some(file => file.path === entry.path)) group.files.push({ label: entry.label, path: entry.path });
}

/**
 * Groups linked files by class week. A file linked from items in several weeks
 * appears under each of them; weeks with no files are not listed. Order:
 * Before Week 1, the weeks in order, then No date.
 */
export function groupLinkedFilesByWeek(
  entries: LinkedFileEntry[],
  classStart: Date,
  weekStartsOn: number,
): LinkedFileGroup[] {
  const before: LinkedFileGroup = { key: 'before', title: 'Before Week 1', files: [] };
  const undated: LinkedFileGroup = { key: 'none', title: 'No date', files: [] };
  const weeks = new Map<number, LinkedFileGroup>();

  for (const entry of entries) {
    if (!entry.date) {
      addUnique(undated, entry);
      continue;
    }
    const week = classWeekNumber(entry.date, classStart, weekStartsOn);
    if (week < 1) {
      addUnique(before, entry);
      continue;
    }
    let group = weeks.get(week);
    if (!group) {
      const { start, end } = classWeekRange(week, classStart, weekStartsOn);
      group = { key: `week-${week}`, title: `Week ${week} · ${shortDate(start)} – ${shortDate(end)}`, files: [] };
      weeks.set(week, group);
    }
    addUnique(group, entry);
  }

  return [
    ...(before.files.length ? [before] : []),
    ...[...weeks.entries()].sort((a, b) => a[0] - b[0]).map(([, group]) => group),
    ...(undated.files.length ? [undated] : []),
  ];
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
