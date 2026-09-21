import { classWeekCount, classWeekNumber, currentWeekFolderName, groupLinkedFilesByWeek, startOfWeek, weekFolderName } from './linkedFileWeeks';

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

test('files are grouped by week in order, with Before Week 1 first and No date last', () => {
  const groups = groupLinkedFilesByWeek([
    { label: 'Week 3 reading', path: '/Note/W3.note', date: day(8, 15) },
    { label: 'Undated', path: '/Note/Todo.note' },
    { label: 'Syllabus', path: '/Document/Syllabus.pdf', date: day(7, 25) },
    { label: 'Week 1 notes', path: '/Note/W1.note', date: day(8, 3) },
  ], classStart, 0);
  expect(groups.map(group => group.title)).toEqual([
    'Before Week 1',
    'Week 1 · Aug 30 – Sep 5',
    'Week 3 · Sep 13 – Sep 19',
    'No date',
  ]);
});

test('a shared note appears under every week it is linked from, once per week', () => {
  const shared = { label: 'Course notebook', path: '/Note/Course.note' };
  const groups = groupLinkedFilesByWeek([
    { ...shared, date: day(8, 3) },
    { ...shared, date: day(8, 4) },
    { ...shared, date: day(8, 10) },
  ], classStart, 0);
  expect(groups.map(group => [group.title, group.files.length])).toEqual([
    ['Week 1 · Aug 30 – Sep 5', 1],
    ['Week 2 · Sep 6 – Sep 12', 1],
  ]);
});

test('weeks without files, such as a holiday week, are not listed', () => {
  const groups = groupLinkedFilesByWeek([
    { label: 'Before break', path: '/Note/A.note', date: day(9, 20) },
    { label: 'After break', path: '/Note/B.note', date: day(10, 3) },
  ], classStart, 0);
  expect(groups.map(group => group.key)).toEqual(['week-8', 'week-10']);
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
