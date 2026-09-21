import { classWeekCount, classWeekNumber, currentWeekFolderName, isInsideFolder, linkCaption, pathKey, projectHasWeeks, startOfWeek, visibleWeekNumbers, weekFolderForDate, weekFolderName, weekFolderNumber } from './linkedFileWeeks';

// Wednesday 2 September 2026; weeks start on Sunday (0) unless stated.
const classStart = new Date(2026, 8, 2);
const day = (month: number, date: number) => new Date(2026, month, date, 10);

test('Week 1 is the week containing the class start, whatever weekday it starts on', () => {
  expect(startOfWeek(classStart, 0)).toEqual(new Date(2026, 7, 30));
  expect(startOfWeek(classStart, 1)).toEqual(new Date(2026, 7, 31));
  expect(classWeekNumber(day(7, 30), classStart, 0)).toBe(1);
  expect(classWeekNumber(day(8, 5), classStart, 0)).toBe(1);
  expect(classWeekNumber(day(8, 6), classStart, 0)).toBe(2);
  expect(classWeekNumber(day(7, 29), classStart, 0)).toBe(0);
  // Monday weeks: Sunday 6 September still belongs to Week 1.
  expect(classWeekNumber(day(8, 6), classStart, 1)).toBe(1);
});

test('weeks keep counting across a daylight-saving change and through holiday weeks', () => {
  // US clocks change on 1 November 2026; a 16-week class still numbers by calendar week.
  expect(classWeekNumber(day(10, 2), classStart, 0)).toBe(10);
  expect(classWeekNumber(day(11, 16), classStart, 0)).toBe(16);
});

test('week folders are zero-padded and span the class start to its due date', () => {
  expect(weekFolderName(1)).toBe('Week 01');
  expect(weekFolderName(12)).toBe('Week 12');
  // 2 Sep – 18 Dec 2026, Sunday weeks: 16 calendar weeks; 8- and 12-week classes follow.
  expect(classWeekCount(classStart, day(11, 18), 0)).toBe(16);
  expect(classWeekCount(classStart, day(9, 23), 0)).toBe(8);
  expect(classWeekCount(classStart, day(10, 20), 0)).toBe(12);
  expect(classWeekCount(classStart, classStart, 0)).toBe(1);
});

test('the current week folder exists only while the class is running', () => {
  const end = day(11, 18);
  expect(currentWeekFolderName(day(8, 30), classStart, end, 0)).toBe('Week 05');
  expect(currentWeekFolderName(day(7, 20), classStart, end, 0)).toBeUndefined();
  expect(currentWeekFolderName(day(11, 28), classStart, end, 0)).toBeUndefined();
});

test('three week folders are listed outside All weeks: last, this and next week', () => {
  // Sunday weeks from 2 September: 1 October is in Week 5 of 16.
  expect(visibleWeekNumbers(day(9, 1), classStart, 16, 0)).toEqual([4, 5, 6]);
  expect(visibleWeekNumbers(day(8, 3), classStart, 16, 0)).toEqual([1, 2]);
  expect(visibleWeekNumbers(day(7, 1), classStart, 16, 0)).toEqual([1, 2]);
  expect(visibleWeekNumbers(new Date(2027, 1, 1), classStart, 16, 0)).toEqual([15, 16]);
  expect(visibleWeekNumbers(day(8, 3), classStart, 1, 0)).toEqual([1]);
});

test('week folder names are recognised; other folders are not', () => {
  expect(weekFolderNumber('Week 05')).toBe(5);
  expect(weekFolderNumber('Week 12')).toBe(12);
  expect(weekFolderNumber('Handouts')).toBeUndefined();
  expect(weekFolderNumber('Week 5 notes')).toBeUndefined();
});

test('paths match whether written with /sdcard or /storage/emulated/0', () => {
  expect(pathKey('/storage/emulated/0/Note/A.note')).toBe('/Note/A.note');
  expect(pathKey('/sdcard/Note/A.note')).toBe('/Note/A.note');
  expect(isInsideFolder('/storage/emulated/0/Note/P/Week 01/A.note', '/sdcard/Note/P')).toBe(true);
  expect(isInsideFolder('/Note/Project2/A.note', '/Note/P')).toBe(false);
  expect(isInsideFolder('/Note/P', '/Note/P')).toBe(false);
});

test('a linked file names the first item it is linked from and counts the rest', () => {
  const entries = [
    { label: 'L.note', path: '/Note/L.note', source: 'Lecture (Sep 23)' },
    { label: 'L.note', path: '/sdcard/Note/L.note', source: 'Task: Read chapter 4' },
    { label: 'L.note', path: '/Note/L.note', source: 'Lecture (Sep 23)' },
  ];
  expect(linkCaption(entries, '/Note/L.note')).toBe('Lecture (Sep 23) +1 more');
  expect(linkCaption(entries.slice(0, 1), '/Note/L.note')).toBe('Lecture (Sep 23)');
  expect(linkCaption(entries, '/Note/Other.note')).toBeUndefined();
});

test('a dated item belongs in its week folder only inside the project\'s weeks', () => {
  const project = { classStartDate: new Date(2026, 8, 2), dueDate: new Date(2026, 11, 18) };
  expect(weekFolderForDate(project, '/Note/P/', day(8, 30))).toBe('/Note/P/Week 05');
  expect(weekFolderForDate(project, '/Note/P', day(7, 20))).toBeUndefined();
  expect(weekFolderForDate(project, '/Note/P', new Date(2027, 0, 10))).toBeUndefined();
  expect(weekFolderForDate(project, '/Note/P', undefined)).toBeUndefined();
  expect(weekFolderForDate({ classStartDate: new Date(2026, 8, 2) }, '/Note/P', day(8, 30))).toBeUndefined();
  expect(projectHasWeeks(project)).toBe(true);
  expect(projectHasWeeks({ dueDate: new Date() })).toBe(false);
});
