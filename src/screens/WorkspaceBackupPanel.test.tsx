import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { TouchableOpacity, Text, Modal } from 'react-native';
import { calendarStorage } from '../storage/calendarStorage';
import { WorkspaceBackupPanel } from './WorkspaceBackupPanel';
import { selectWorkspaceBackup, restoreWorkspaceBackup, createWorkspaceBackup } from '../supernote/workspaceBackupService';

jest.mock('../supernote/workspaceBackupService', () => ({
  selectWorkspaceBackup: jest.fn(),
  missingBackupNotes: jest.fn(async () => []),
  createWorkspaceBackup: jest.fn(async () => '/Export/backup.snfolio.json'),
  restoreWorkspaceBackup: jest.fn(async () => '/Export/safety.snfolio.json'),
}));
const selected = { createdAt: '2026-09-01T00:00:00Z', imports: {}, data: {
  tasks: [], userEvents: [], caldavEvents: [], areas: [], projects: [], resources: [], pendingTaskDeletes: [],
} };
function button(tree: TestRenderer.ReactTestRenderer, label: string) {
  return tree.root.findAllByType(TouchableOpacity).find(node =>
    node.findAllByType(Text).some(text => text.props.children === label))!;
}

test('selecting a backup only previews; replacement requires the explicit confirmation', async () => {
  (selectWorkspaceBackup as jest.Mock).mockResolvedValueOnce(selected);
  const restored = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<WorkspaceBackupPanel disabled={false} onRestored={restored} />); });
  await act(async () => { button(tree, 'Choose Backup to Restore…').props.onPress(); });
  expect(restoreWorkspaceBackup).not.toHaveBeenCalled();
  await act(async () => { button(tree, 'Create Safety Backup and Replace Workspace').props.onPress(); });
  expect(restoreWorkspaceBackup).toHaveBeenCalledTimes(1);
  expect(restored).toHaveBeenCalledWith(expect.stringContaining('Sync is paused'));
  act(() => tree.unmount());
});

test('ongoing workspace activity disables backup and restore entry points', () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<WorkspaceBackupPanel disabled onRestored={() => {}} />); });
  expect(button(tree, 'Create Backup').props.disabled).toBe(true);
  expect(button(tree, 'Choose Backup to Restore…').props.disabled).toBe(true);
  act(() => tree.unmount());
});


test('pending file permission uses no native modal and denial returns usable controls', async () => {
  const loaded = jest.spyOn(calendarStorage, 'isLoaded').mockReturnValue(true);
  let deny!: (error: Error) => void;
  (createWorkspaceBackup as jest.Mock).mockImplementationOnce(() => new Promise((_resolve, reject) => { deny = reject; }));
  let tree!: TestRenderer.ReactTestRenderer;
  const close = jest.fn();
  act(() => { tree = TestRenderer.create(<WorkspaceBackupPanel disabled={false} onRestored={() => {}} onClose={close} />); });
  await act(async () => { button(tree, 'Create Backup').props.onPress(); });
  expect(tree.root.findAllByType(Modal)).toHaveLength(0);
  expect(button(tree, 'Create Backup').props.disabled).toBe(true);
  expect(button(tree, 'Close').props.disabled).toBe(true);
  await act(async () => { deny(new Error('File access was not allowed.')); });
  expect(tree.root.findAllByType(Text).some(node => node.props.children === 'File access was not allowed.')).toBe(true);
  expect(button(tree, 'Create Backup').props.disabled).toBe(false);
  act(() => button(tree, 'Close').props.onPress());
  expect(close).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
  loaded.mockRestore();
});

test('the native picker can remain pending without a backup modal above it', async () => {
  let finish!: (value: null) => void;
  (selectWorkspaceBackup as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<WorkspaceBackupPanel disabled={false} onRestored={() => {}} />); });
  await act(async () => { button(tree, 'Choose Backup to Restore…').props.onPress(); });
  expect(tree.root.findAllByType(Modal)).toHaveLength(0);
  expect(button(tree, 'Choose Backup to Restore…').props.disabled).toBe(true);
  await act(async () => { finish(null); });
  expect(button(tree, 'Close').props.disabled).toBe(false);
  act(() => tree.unmount());
});
