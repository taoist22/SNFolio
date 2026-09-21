import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { BulkFilePanel } from './BulkFilePanel';
import { Project } from '../domain/types';

jest.mock('./HandwritingTextInput', () => {
  const ReactMock = require('react');
  return {
    HandwritingTextInput: ReactMock.forwardRef((props: any, ref: any) => {
      ReactMock.useImperativeHandle(ref, () => ({ getValue: () => props.value, focus: () => {}, setValue: () => {} }));
      return null;
    }),
  };
});

const textOf = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAllByType(Text).map(node => [node.props.children].flat(Infinity).join('')).join('|');
const press = (tree: TestRenderer.ReactTestRenderer, label: string) => act(() => {
  const target = tree.root.findAllByType(TouchableOpacity)
    .find(node => node.findAllByType(Text).some(t => [t.props.children].flat(Infinity).join('').includes(label)));
  if (!target) throw new Error(`No button labelled ${label}`);
  target.props.onPress();
});

const projects: Project[] = [
  { id: 'ids', name: 'IDS105', status: 'active', createdAt: new Date(2026, 7, 1) },
  { id: 'old', name: 'Old', status: 'done', createdAt: new Date(2026, 7, 1) },
];
const items = [
  { identity: 'a', summary: 'Module One Begins', start: new Date(2026, 7, 31), location: 'IDS-105-18678-M01' },
  { identity: 'b', summary: 'Module One Begins', start: new Date(2026, 7, 31), location: 'FYE-101-11639-M01' },
  { identity: 'c', summary: 'Assignments Due – Module One', start: new Date(2026, 8, 6), location: 'IDS-105-18678-M01' },
];

function render(word = '') {
  const onFile = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<BulkFilePanel calendarName="All Courses" items={items} projects={projects} onFile={onFile} onClose={jest.fn()} />); });
  if (word) {
    const input = tree.root.findAll(node => typeof node.props.onChangeText === 'function')[0];
    act(() => input.props.onChangeText(word));
  }
  return { tree, onFile };
}

test('select matching ticks every item with the word in its title or location, ignoring hyphens', () => {
  const { tree, onFile } = render('IDS105');
  expect(textOf(tree)).toContain('3 unfiled items');
  expect(textOf(tree)).not.toContain('Old');
  press(tree, 'Select matching');
  expect(textOf(tree)).toContain('2 items matched');
  expect(textOf(tree)).toContain('2 selected');
  press(tree, 'IDS105');
  press(tree, 'File 2 under IDS105');
  expect(onFile).toHaveBeenCalledWith(['a', 'c'], 'ids');
  act(() => tree.unmount());
});

test('select all, clear, and single ticks; filing needs a Project and a selection', () => {
  const { tree, onFile } = render();
  press(tree, 'Select all');
  expect(textOf(tree)).toContain('3 selected');
  press(tree, 'Clear');
  expect(textOf(tree)).toContain('0 selected');
  press(tree, 'Assignments Due');
  expect(textOf(tree)).toContain('1 selected');
  press(tree, 'Choose a Project');
  expect(onFile).not.toHaveBeenCalled();
  press(tree, 'IDS105');
  press(tree, 'File 1 under IDS105');
  expect(onFile).toHaveBeenCalledWith(['c'], 'ids');
  act(() => tree.unmount());
});
