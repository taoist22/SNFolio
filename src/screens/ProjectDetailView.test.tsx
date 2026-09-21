import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { ProjectDetailView } from './ProjectDetailView';
import { Project } from '../domain/types';

const textOf = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAllByType(Text).map(node => [node.props.children].flat(Infinity).join('')).join('|');
const press = (tree: TestRenderer.ReactTestRenderer, label: string) => {
  const target = tree.root.findAllByType(TouchableOpacity)
    .find(node => node.findAllByType(Text).some(text => [text.props.children].flat(Infinity).join('').includes(label)));
  if (!target) throw new Error(`No button labelled ${label}`);
  act(() => target.props.onPress());
};

function render(project: Project, overrides: Partial<React.ComponentProps<typeof ProjectDetailView>> = {}) {
  const props: React.ComponentProps<typeof ProjectDetailView> = {
    project, areas: [], tasks: [], projectOf: () => undefined, linkedNotes: [], weekStartsOn: 0,
    onSetClassStart: jest.fn(), onCreateWeekFolders: jest.fn(), onSetRecurringNotes: jest.fn(), onSetAutoFileMatch: jest.fn(), upcomingEvents: [], onOpenEvent: jest.fn(), onSetClassWeekStart: jest.fn(), onMoveFile: jest.fn(async () => {}),
    onBack: jest.fn(), onSetDue: jest.fn(), onAssignArea: jest.fn(), onCreateArea: jest.fn(),
    onUpdateClassification: jest.fn(), onRename: jest.fn(), onToggleStatus: jest.fn(), onArchive: jest.fn(),
    onConvertToArea: jest.fn(), onDelete: jest.fn(), folder: '/Note/SNFolio/Projects/IDS105',
    // Never resolves: the folder read is not under test and must not update state after unmount.
    onListEntries: jest.fn(() => new Promise<never>(() => {})), onNewNote: jest.fn(async () => {}), onChooseFolder: jest.fn(async () => {}),
    onOpenFile: jest.fn(), onOpenNote: jest.fn(), onAddTask: jest.fn(), onToggleTask: jest.fn(), onEditTask: jest.fn(),
    ...overrides,
  };
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<ProjectDetailView {...props} />); });
  return { tree, props };
}

const classProject: Project = {
  id: 'ids105', name: 'IDS105', status: 'active', createdAt: new Date(2026, 7, 30), category: 'class',
};

test('status actions are in Project Actions, not beside the due date', () => {
  const { tree } = render(classProject);
  expect(textOf(tree)).not.toContain('Mark Complete');
  expect(textOf(tree)).not.toContain('Finish');
  press(tree, 'Project Actions');
  for (const label of ['Mark Complete', 'Archive', 'Move to Areas', 'Delete']) expect(textOf(tree)).toContain(label);
  act(() => tree.unmount());
});

test('Mark Complete explains what happens and acts only after confirmation', () => {
  const { tree, props } = render(classProject);
  press(tree, 'Project Actions');
  press(tree, '☑ Mark Complete');
  expect(props.onToggleStatus).not.toHaveBeenCalled();
  const text = textOf(tree);
  expect(text).toContain('Mark "IDS105" complete?');
  expect(text).toContain('Archive → Projects, labeled Finished');
  expect(text).toContain('Nothing is moved or deleted');
  expect(text).toContain('open it in Archive and tap Reopen');
  press(tree, 'Cancel');
  expect(props.onToggleStatus).not.toHaveBeenCalled();
  press(tree, '☑ Mark Complete');
  const confirm = tree.root.findAllByType(TouchableOpacity)
    .filter(node => node.findAllByType(Text).some(t => [t.props.children].flat(Infinity).join('') === 'Mark Complete'));
  act(() => confirm[confirm.length - 1].props.onPress());
  expect(props.onToggleStatus).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});

test('a completed project offers Reopen directly', () => {
  const { tree, props } = render({ ...classProject, status: 'done' });
  press(tree, 'Project Actions');
  expect(textOf(tree)).not.toContain('Mark Complete');
  press(tree, 'Reopen');
  expect(props.onToggleStatus).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});

test('the category panel says how to close it and has a Close button', () => {
  const { tree } = render(classProject);
  expect(textOf(tree)).toContain('▾ Change');
  press(tree, 'Project settings');
  expect(textOf(tree)).toContain('Choices are saved as you tap them.');
  expect(textOf(tree)).toContain('Default calendar designation');
  press(tree, 'Close');
  expect(textOf(tree)).not.toContain('Default calendar designation');
  act(() => tree.unmount());
});

test('start date, weeks and week folders are available to every project category, not only Class', () => {
  const { tree, props } = render({ ...classProject, category: 'work', classStartDate: new Date(2026, 8, 7), dueDate: new Date(2026, 10, 27) });
  press(tree, 'Project settings');
  const text = textOf(tree);
  expect(text).toContain('Start date');
  expect(text).toContain('From start day (Mon)');
  expect(text).toContain('Creates Week 01 – Week 12');
  expect(text).not.toContain('Class start date');
  press(tree, 'Create Week Folders');
  expect(props.onCreateWeekFolders).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});

test('recurring-event notes: one notebook by default, or one note per session', () => {
  const { tree, props } = render(classProject);
  press(tree, 'Project settings');
  expect(textOf(tree)).toContain('● One notebook for the series');
  expect(textOf(tree)).toContain('○ One note per session');
  press(tree, 'One note per session');
  expect(props.onSetRecurringNotes).toHaveBeenCalledWith('session');
  act(() => tree.unmount());

  const session = render({ ...classProject, recurringNotes: 'session' });
  press(session.tree, 'Project settings');
  expect(textOf(session.tree)).toContain('● One note per session');
  expect(textOf(session.tree)).toContain('Each session gets its own dated note');
  act(() => session.tree.unmount());
});

test('auto-file words are saved from the settings panel and shown once set', () => {
  const { tree, props } = render({ ...classProject, autoFileMatch: 'IDS105' });
  press(tree, 'Project settings');
  expect(textOf(tree)).toContain('Filing items containing: IDS105');
  press(tree, 'Save');
  expect(props.onSetAutoFileMatch).toHaveBeenCalledWith('IDS105');
  act(() => tree.unmount());
});

test('Upcoming lists the project\'s next events and opens one when tapped', () => {
  const event = (uid: string, day: number) => ({
    uid, summary: `Lecture ${day}`, start: new Date(2026, 8, day, 10), end: new Date(2026, 8, day, 11), allDay: false, attendees: [],
  });
  const upcomingEvents = [1, 2, 3, 4, 5, 6, 7].map(day => event(`e${day}`, day));
  const { tree, props } = render(classProject, { upcomingEvents });
  const text = textOf(tree);
  expect(text).toContain('📅 Upcoming (7)');
  expect(text).toContain('Lecture 5');
  expect(text).not.toContain('Lecture 6');
  expect(text).toContain('+2 more in the calendar');
  press(tree, 'Lecture 3');
  expect(props.onOpenEvent).toHaveBeenCalledWith(upcomingEvents[2]);
  act(() => tree.unmount());
});

test('there is no separate Linked Files section; files linked from outside the project folder are listed under Linked from elsewhere', () => {
  const linkedNotes = [
    { label: 'Lecture.note', path: '/Note/SNFolio/Projects/IDS105/Week 01/Lecture.note', source: 'Lecture (Sep 3)' },
    { label: 'Syllabus.pdf', path: '/Document/Syllabus.pdf', source: 'Task: Read the syllabus' },
    { label: 'Syllabus.pdf', path: '/sdcard/Document/Syllabus.pdf', source: 'Orientation (Sep 2)' },
  ];
  const { tree } = render({ ...classProject, classStartDate: new Date(2026, 8, 2) }, { linkedNotes });
  let text = textOf(tree);
  expect(text).not.toContain('Linked Files');
  expect(text).not.toContain('Group Linked Files by');
  expect(text).toContain('▸ 🔗 Linked from elsewhere (1)');
  expect(text).not.toContain('Syllabus.pdf');
  press(tree, 'Linked from elsewhere');
  text = textOf(tree);
  expect(text).toContain('📄 Syllabus.pdf  🔗');
  expect(text).toContain('↳ Task: Read the syllabus +1 more');
  expect(text).not.toContain('📄 Lecture.note');
  act(() => tree.unmount());

  const inside = render(classProject, { linkedNotes: linkedNotes.slice(0, 1) });
  expect(textOf(inside.tree)).not.toContain('Linked from elsewhere');
  act(() => inside.tree.unmount());
});

const layout = (tree: TestRenderer.ReactTestRenderer, width: number) => {
  act(() => tree.root.findByType(View).props.onLayout({ nativeEvent: { layout: { width, height: 1800, x: 0, y: 0 } } }));
};

test('on a wide screen files and deliverables sit in two columns; on a narrow one deliverables come first', () => {
  const { tree } = render(classProject);
  layout(tree, 1400);
  expect(tree.root.findAllByType(ScrollView)).toHaveLength(2);
  const [left, right] = tree.root.findAllByType(ScrollView);
  const inside = (node: TestRenderer.ReactTestInstance) => node.findAllByType(Text).map(t => [t.props.children].flat(Infinity).join('')).join('|');
  expect(inside(left)).toContain('📁 Project Files');
  expect(inside(left)).not.toContain('Actionable Deliverables');
  expect(inside(right)).toContain('Actionable Deliverables');
  expect(inside(right)).toContain('Project Actions');
  layout(tree, 800);
  expect(tree.root.findAllByType(ScrollView)).toHaveLength(1);
  const text = textOf(tree);
  expect(text.indexOf('Actionable Deliverables')).toBeLessThan(text.indexOf('📁 Project Files'));
  act(() => tree.unmount());
});

test('Create Week Folders appears once the class has a start and due date, naming the range', () => {
  const missing = render(classProject);
  press(missing.tree, 'Project settings');
  expect(textOf(missing.tree)).toContain('Set a start date and a due date');
  expect(textOf(missing.tree)).not.toContain('Create Week Folders');
  act(() => missing.tree.unmount());

  const ready = render({ ...classProject, classStartDate: new Date(2026, 8, 2), dueDate: new Date(2026, 11, 18) });
  press(ready.tree, 'Project settings');
  expect(textOf(ready.tree)).toContain('Creates Week 01 – Week 16');
  press(ready.tree, 'Create Week Folders');
  expect(ready.props.onCreateWeekFolders).toHaveBeenCalledTimes(1);
  act(() => ready.tree.unmount());
});

test('weeks run from the class start day by default, or from a chosen weekday, and the range is shown', () => {
  // Wednesday 2 September 2026 to Friday 18 December 2026.
  const wednesdayStart = { ...classProject, classStartDate: new Date(2026, 8, 2), dueDate: new Date(2026, 11, 18) };
  const byStartDay = render(wednesdayStart);
  press(byStartDay.tree, 'Project settings');
  expect(textOf(byStartDay.tree)).toContain('From start day (Wed)');
  expect(textOf(byStartDay.tree)).toContain('Week 1: Wed, Sep 2 – Tue, Sep 8');
  expect(textOf(byStartDay.tree)).toContain('16 weeks, ending Week 16: Wed, Dec 16 – Tue, Dec 22');
  press(byStartDay.tree, 'Mon');
  expect(byStartDay.props.onSetClassWeekStart).toHaveBeenCalledWith(1);
  act(() => byStartDay.tree.unmount());

  const monday = render({ ...wednesdayStart, classWeekStartsOn: 1 });
  press(monday.tree, 'Project settings');
  expect(textOf(monday.tree)).toContain('Week 1: Mon, Aug 31 – Sun, Sep 6');
  expect(textOf(monday.tree)).toContain('Creates Week 01 – Week 16');
  press(monday.tree, 'From start day');
  expect(monday.props.onSetClassWeekStart).toHaveBeenCalledWith(undefined);
  act(() => monday.tree.unmount());
});

test('Move… on a file linked from elsewhere suggests the week of its linked item and moves it there', async () => {
  const linkedNotes = [{ label: 'Lecture.note', path: '/Note/Lecture.note', date: new Date(2026, 8, 30, 10) }];
  const onListEntries = jest.fn(async () => [
    { name: 'Week 01', path: '/Note/SNFolio/Projects/IDS105/Week 01', isFolder: true },
    { name: 'Week 05', path: '/Note/SNFolio/Projects/IDS105/Week 05', isFolder: true },
  ]);
  const onMoveFile = jest.fn(async () => {});
  const { tree } = render({ ...classProject, classStartDate: new Date(2026, 8, 2), classWeekStartsOn: 3 }, { linkedNotes, onListEntries, onMoveFile });
  press(tree, 'Linked from elsewhere');
  const moveButton = tree.root.findAllByType(TouchableOpacity)
    .filter(node => node.findAllByType(Text).some(text => [text.props.children].flat(Infinity).join('') === 'Move…'));
  await act(async () => { await moveButton[moveButton.length - 1].props.onPress(); });
  const text = textOf(tree);
  // Wednesday weeks from 2 September: 30 September is in Week 5.
  expect(text).toContain('📁 Week 05 (suggested)');
  // Project Files above also lists the week folders; the Move list is the last place Week 01 appears.
  expect(text.indexOf('Week 05 (suggested)')).toBeLessThan(text.lastIndexOf('📁 Week 01'));
  const target = tree.root.findAllByType(TouchableOpacity)
    .find(node => node.findAllByType(Text).some(t => [t.props.children].flat(Infinity).join('').includes('Week 05 (suggested)')))!;
  await act(async () => { await target.props.onPress(); });
  expect(onMoveFile).toHaveBeenCalledWith('/Note/Lecture.note', '/Note/SNFolio/Projects/IDS105/Week 05');
  act(() => tree.unmount());
});
