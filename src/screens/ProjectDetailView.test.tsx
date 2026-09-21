import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
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
    onSetClassStart: jest.fn(), onSetLinkedFilesGrouping: jest.fn(), onCreateWeekFolders: jest.fn(), onSetClassWeekStart: jest.fn(), onMoveFile: jest.fn(async () => {}),
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
  press(tree, 'Project category');
  expect(textOf(tree)).toContain('Choices are saved as you tap them.');
  expect(textOf(tree)).toContain('Group Linked Files by');
  press(tree, 'Close');
  expect(textOf(tree)).not.toContain('Group Linked Files by');
  act(() => tree.unmount());
});

test('class options appear only for Class projects', () => {
  const { tree } = render({ ...classProject, category: 'work' });
  press(tree, 'Project category');
  expect(textOf(tree)).not.toContain('Class start date');
  act(() => tree.unmount());
});

test('Linked Files are grouped by class week when chosen, and listed flat otherwise', () => {
  const linkedNotes = [
    { label: 'Week 1 notes', path: '/Note/W1.note', date: new Date(2026, 8, 3, 10) },
    { label: 'Syllabus', path: '/Document/Syllabus.pdf' },
  ];
  const grouped = render({ ...classProject, classStartDate: new Date(2026, 8, 2), linkedFilesGrouping: 'week' }, { linkedNotes });
  // Weeks run from the class start day (Wednesday 2 September) unless another weekday is chosen.
  expect(textOf(grouped.tree)).toContain('Week 1 · Sep 2 – Sep 8');
  expect(textOf(grouped.tree)).toContain('No date');
  act(() => grouped.tree.unmount());

  const flat = render({ ...classProject, classStartDate: new Date(2026, 8, 2) }, { linkedNotes });
  expect(textOf(flat.tree)).not.toContain('Week 1 ·');
  expect(textOf(flat.tree)).toContain('Week 1 notes');
  act(() => flat.tree.unmount());

  const noStart = render({ ...classProject, linkedFilesGrouping: 'week' }, { linkedNotes });
  expect(textOf(noStart.tree)).toContain('Set a class start date');
  act(() => noStart.tree.unmount());
});

test('Create Week Folders appears once the class has a start and due date, naming the range', () => {
  const missing = render(classProject);
  press(missing.tree, 'Project category');
  expect(textOf(missing.tree)).toContain('Set the class start date and a due date');
  expect(textOf(missing.tree)).not.toContain('Create Week Folders');
  act(() => missing.tree.unmount());

  const ready = render({ ...classProject, classStartDate: new Date(2026, 8, 2), dueDate: new Date(2026, 11, 18) });
  press(ready.tree, 'Project category');
  expect(textOf(ready.tree)).toContain('Creates Week 01 – Week 16');
  press(ready.tree, 'Create Week Folders');
  expect(ready.props.onCreateWeekFolders).toHaveBeenCalledTimes(1);
  act(() => ready.tree.unmount());
});

test('weeks run from the class start day by default, or from a chosen weekday, and the range is shown', () => {
  // Wednesday 2 September 2026 to Friday 18 December 2026.
  const wednesdayStart = { ...classProject, classStartDate: new Date(2026, 8, 2), dueDate: new Date(2026, 11, 18) };
  const byStartDay = render(wednesdayStart);
  press(byStartDay.tree, 'Project category');
  expect(textOf(byStartDay.tree)).toContain('From class start day (Wed)');
  expect(textOf(byStartDay.tree)).toContain('Week 1: Wed, Sep 2 – Tue, Sep 8');
  expect(textOf(byStartDay.tree)).toContain('16 weeks, ending Week 16: Wed, Dec 16 – Tue, Dec 22');
  press(byStartDay.tree, 'Mon');
  expect(byStartDay.props.onSetClassWeekStart).toHaveBeenCalledWith(1);
  act(() => byStartDay.tree.unmount());

  const monday = render({ ...wednesdayStart, classWeekStartsOn: 1 });
  press(monday.tree, 'Project category');
  expect(textOf(monday.tree)).toContain('Week 1: Mon, Aug 31 – Sun, Sep 6');
  expect(textOf(monday.tree)).toContain('Creates Week 01 – Week 16');
  press(monday.tree, 'From class start day');
  expect(monday.props.onSetClassWeekStart).toHaveBeenCalledWith(undefined);
  act(() => monday.tree.unmount());
});

test('Move… on a linked file suggests the week of its linked item and moves it there', async () => {
  const linkedNotes = [{ label: 'Lecture.note', path: '/Note/SNFolio/Projects/IDS105/Lecture.note', date: new Date(2026, 8, 30, 10) }];
  const onListEntries = jest.fn(async () => [
    { name: 'Week 01', path: '/Note/SNFolio/Projects/IDS105/Week 01', isFolder: true },
    { name: 'Week 05', path: '/Note/SNFolio/Projects/IDS105/Week 05', isFolder: true },
  ]);
  const onMoveFile = jest.fn(async () => {});
  const { tree } = render({ ...classProject, classStartDate: new Date(2026, 8, 2), classWeekStartsOn: 3 }, { linkedNotes, onListEntries, onMoveFile });
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
  expect(onMoveFile).toHaveBeenCalledWith('/Note/SNFolio/Projects/IDS105/Lecture.note', '/Note/SNFolio/Projects/IDS105/Week 05');
  act(() => tree.unmount());
});
