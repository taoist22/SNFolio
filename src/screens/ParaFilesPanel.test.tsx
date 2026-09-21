import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { ParaFilesPanel } from './ParaFilesPanel';
import { useWorkspaceActivity } from './useWorkspaceActivity';

jest.mock('./HandwritingTextInput', () => ({ HandwritingTextInput: () => null }));
const props = { itemKey: 'project:a', folder: '/A', onOpenFile: jest.fn(),
  onNewNote: jest.fn(), onChooseFolder: jest.fn() };
const entry = (name: string) => ({ name, path: `/A/${name}`, isFolder: false });
const texts = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAllByType(Text).map(node => node.props.children);
function refresh(tree: TestRenderer.ReactTestRenderer) {
  tree.root.findAllByType(TouchableOpacity).find(node =>
    node.findAllByType(Text).some(text => text.props.children === '↻ Refresh'))!.props.onPress();
}

test('activity tracking rerenders do not cause repeated folder reads', async () => {
  const read = jest.fn(async (_folder: string) => [entry('Plan.note')]);
  function Host() {
    const { track } = useWorkspaceActivity();
    return <ParaFilesPanel {...props} onListEntries={track(folder => read(folder))} />;
  }
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<Host />); });
  expect(read).toHaveBeenCalledTimes(1);
  expect(texts(tree)).toContain('Plan.note');
  expect(texts(tree)).not.toContain('Reading folder…');
  await act(async () => { refresh(tree); });
  expect(read).toHaveBeenCalledTimes(2);
  act(() => tree.unmount());
});

test('callback replacement does not reload, but explicit refresh uses the latest callback', async () => {
  const first = jest.fn(async () => [entry('First.note')]);
  const latest = jest.fn(async () => [entry('Latest.note')]);
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<ParaFilesPanel {...props} onListEntries={first} />); });
  await act(async () => { tree.update(<ParaFilesPanel {...props} onListEntries={latest} />); });
  expect(latest).not.toHaveBeenCalled();
  await act(async () => { refresh(tree); });
  expect(latest).toHaveBeenCalledTimes(1);
  expect(texts(tree)).toContain('Latest.note');
  act(() => tree.unmount());
});

test('switching projects discards results from a slower previous read', async () => {
  let finish!: (entries: ReturnType<typeof entry>[]) => void;
  const read = jest.fn((folder: string) => folder === '/A'
    ? new Promise<ReturnType<typeof entry>[]>(resolve => { finish = resolve; })
    : Promise.resolve([entry('New project.note')]));
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<ParaFilesPanel {...props} onListEntries={read} />); });
  const finishOld = finish;
  await act(async () => { tree.update(<ParaFilesPanel {...props} itemKey="project:b" folder="/B" onListEntries={read} />); });
  await act(async () => { finishOld([entry('Old project.note')]); });
  expect(texts(tree)).toContain('New project.note');
  expect(texts(tree)).not.toContain('Old project.note');
  expect(texts(tree)).not.toContain('Reading folder…');
  act(() => tree.unmount());
});

const folderEntry = (name: string) => ({ name, path: `/A/${name}`, isFolder: true });
const press = (tree: TestRenderer.ReactTestRenderer, label: string) => {
  const target = tree.root.findAllByType(TouchableOpacity).find(node =>
    node.findAllByType(Text).some(text => [text.props.children].flat(Infinity).join('').includes(label)));
  if (!target) throw new Error(`No button labelled ${label}`);
  return target.props.onPress();
};
const allText = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAllByType(Text).map(node => [node.props.children].flat(Infinity).join('')).join('|');
const weekRead = (folder: string) => Promise.resolve(folder === '/A'
  ? [entry('Syllabus.pdf'), folderEntry('Week 01'), folderEntry('Week 05')]
  : [{ name: `${folder.split('/').pop()} notes.note`, path: `${folder}/notes.note`, isFolder: false }]);

test('subfolders are collapsible sections; this week starts open and gets the top + New Note', async () => {
  const read = jest.fn(weekRead);
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<ParaFilesPanel {...props} onListEntries={read} currentSubfolder="/A/Week 05" />); });
  await act(async () => {});
  const text = allText(tree);
  expect(text).toContain('Syllabus.pdf');
  expect(text).toContain('▸ 📁 Week 01');
  expect(text).toContain('▾ 📁 Week 05  (1)  · this week');
  expect(text).toContain('Week 05 notes.note');
  expect(text).not.toContain('Week 01 notes.note');
  expect(text).toContain('+ New Note in Week 05');
  expect(read).not.toHaveBeenCalledWith('/A/Week 01');

  await act(async () => { press(tree, 'Week 01'); });
  expect(read).toHaveBeenCalledWith('/A/Week 01');
  expect(allText(tree)).toContain('Week 01 notes.note');
  await act(async () => { press(tree, 'Week 01'); });
  expect(allText(tree)).not.toContain('Week 01 notes.note');
  act(() => tree.unmount());
});

test('without a current subfolder every section starts closed and + New Note targets the item folder', async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<ParaFilesPanel {...props} onListEntries={jest.fn(weekRead)} />); });
  await act(async () => {});
  const text = allText(tree);
  expect(text).toContain('▸ 📁 Week 05');
  expect(text).not.toContain('this week');
  expect(text).toContain('|+ New Note|');
  act(() => tree.unmount());
});

test('Move… offers the item folder and its subfolders, and moves the file there', async () => {
  const move = jest.fn(async () => {});
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<ParaFilesPanel {...props} onListEntries={jest.fn(weekRead)} onMoveFile={move} />); });
  await act(async () => {});
  await act(async () => { press(tree, 'Move…'); });
  const text = allText(tree);
  expect(text).toContain('Move Syllabus.pdf to:');
  expect(text).toContain('📁 Week 01');
  expect(text).not.toContain('📁 Project folder');
  await act(async () => { await press(tree, '📁 Week 05'); });
  expect(move).toHaveBeenCalledWith('/A/Syllabus.pdf', '/A/Week 05');
  expect(allText(tree)).not.toContain('Move Syllabus.pdf to:');
  act(() => tree.unmount());
});

test('a refused move is explained beside the file and nothing closes', async () => {
  const move = jest.fn(async () => { throw new Error('Week 05 already has a file named Syllabus.pdf. Nothing was moved.'); });
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<ParaFilesPanel {...props} onListEntries={jest.fn(weekRead)} onMoveFile={move} />); });
  await act(async () => {});
  await act(async () => { press(tree, 'Move…'); });
  await act(async () => { await press(tree, '📁 Week 05'); });
  expect(allText(tree)).toContain('already has a file named Syllabus.pdf');
  expect(allText(tree)).toContain('Move Syllabus.pdf to:');
  act(() => tree.unmount());
});
