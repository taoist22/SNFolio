import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { FileBrowserModal } from './FileBrowserModal';
import { listParaFolderEntries, listStorageRoots } from '../supernote/exportService';
jest.mock('../supernote/exportService', () => ({ listParaFolderEntries: jest.fn(), listStorageRoots: jest.fn() }));

const flush = () => act(async () => { await new Promise<void>(resolve => setImmediate(() => resolve())); });
function row(tree: TestRenderer.ReactTestRenderer, label: string) {
  return tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => [text.props.children].flat().join('').includes(label)))!;
}
function hasText(tree: TestRenderer.ReactTestRenderer, label: string) {
  return tree.root.findAllByType(Text).some(text => [text.props.children].flat().join('').includes(label));
}

beforeEach(() => {
  (listStorageRoots as jest.Mock).mockResolvedValue(['/storage/emulated/0']);
  (listParaFolderEntries as jest.Mock).mockImplementation(async (folder: string) => folder === '/storage/emulated/0'
    ? [{ name: 'Document', path: '/storage/emulated/0/Document', isFolder: true }, { name: 'Plan.note', path: '/storage/emulated/0/Plan.note', isFolder: false }]
    : [{ name: 'Paper.pdf', path: `${folder}/Paper.pdf`, isFolder: false }]);
});

test('folders navigate inside the panel and files are handed to the opener', async () => {
  const open = jest.fn(async () => {});
  let tree: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<FileBrowserModal visible initialPath="/storage/emulated/0" onCancel={jest.fn()} onOpenFile={open} />); });
  await flush();
  act(() => row(tree!, 'Document').props.onPress());
  await flush();
  expect(listParaFolderEntries).toHaveBeenLastCalledWith('/storage/emulated/0/Document');
  expect(open).not.toHaveBeenCalled();
  act(() => row(tree!, 'Paper.pdf').props.onPress());
  await flush();
  expect(open).toHaveBeenCalledWith('/storage/emulated/0/Document/Paper.pdf');
  act(() => row(tree!, 'Up').props.onPress());
  await flush();
  expect(listParaFolderEntries).toHaveBeenLastCalledWith('/storage/emulated/0');
  act(() => tree!.unmount());
});

test('a failed open is reported in the browser, which stays usable', async () => {
  const open = jest.fn(async () => { throw new Error('Could not open file: unsupported'); });
  let tree: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<FileBrowserModal visible initialPath="/storage/emulated/0" onCancel={jest.fn()} onOpenFile={open} />); });
  await flush();
  act(() => row(tree!, 'Plan.note').props.onPress());
  await flush();
  expect(hasText(tree!, 'Could not open file: unsupported')).toBe(true);
  expect(row(tree!, 'Plan.note').props.disabled).toBe(false);
  act(() => tree!.unmount());
});
