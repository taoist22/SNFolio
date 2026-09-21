import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { ParaView } from './ParaView';
import { CalendarEvent, CalendarTask, Project } from '../domain/types';

jest.mock('./HandwritingTextInput', () => ({ HandwritingTextInput: () => null }));

const textOf = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAllByType(Text).map(node => [node.props.children].flat(Infinity).join('')).join('|');

const day = (offset: number, hour = 12) => {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};
const task = (uid: string, due?: Date): CalendarTask => ({ uid, title: uid, completed: false, dueDate: due, createdAt: new Date(2026, 0, 1) });
const event = (uid: string, start: Date): CalendarEvent => ({ uid, summary: uid, start, end: new Date(start.getTime() + 3600000), allDay: false, attendees: [] });

function render(collapsedProjectIds: string[] = []) {
  const project: Project = { id: 'ids', name: 'IDS105', status: 'active', createdAt: new Date(2026, 0, 1) };
  const tasks = [task('Overdue essay', day(-3)), task('Due tomorrow', day(1)), task('Far away', day(40)), task('No date')];
  const events = [event('Lecture soon', day(2)), event('Lecture far', day(45))];
  const onSetCollapsedProjects = jest.fn();
  const handlers = new Proxy({}, { get: () => jest.fn(() => '') });
  const props: any = {
    ...(handlers as any),
    areas: [], projects: [project], resources: [], tasks, events,
    projectOf: () => 'ids', projectOfEvent: () => 'ids', areaOfEvent: () => undefined, areaOf: () => undefined,
    areaTaskCount: () => 0, folderFor: () => '/Note/IDS105', onListEntries: jest.fn(() => new Promise(() => {})),
    weekStartsOn: 1, collapsedProjectIds, onSetCollapsedProjects,
  };
  for (const key of ['isNomad', 'initialAreaId', 'onInitialAreaShown', 'onMoveFile']) delete props[key];
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<ParaView {...props} />); });
  return { tree, onSetCollapsedProjects };
}

test('a project card lists overdue work and the next two weeks, and counts the rest', () => {
  const { tree } = render();
  const text = textOf(tree);
  expect(text).toContain('Overdue essay');
  expect(text).toContain('⚠ Overdue');
  expect(text).toContain('Due tomorrow');
  expect(text).toContain('Lecture soon');
  expect(text).not.toContain('Far away');
  expect(text).not.toContain('Lecture far');
  expect(text).toContain('+ 2 later · 1 with no date ›');
  act(() => tree.unmount());
});

test('a collapsed card shows one summary line, and Collapse All / Expand All toggles every card', () => {
  const { tree, onSetCollapsedProjects } = render(['ids']);
  const text = textOf(tree);
  expect(text).not.toContain('OPEN & UPCOMING');
  expect(text).toContain('1 overdue · 1 due in the next two weeks · 1 event');
  expect(text).toContain('Expand All');
  act(() => tree.root.findAllByType(TouchableOpacity)
    .find(node => node.findAllByType(Text).some(t => [t.props.children].flat(Infinity).join('') === 'Expand All'))!.props.onPress());
  expect(onSetCollapsedProjects).toHaveBeenCalledWith([]);
  act(() => tree.unmount());

  const open = render();
  act(() => open.tree.root.findAllByType(TouchableOpacity)
    .find(node => node.props.accessibilityLabel === 'Collapse IDS105')!.props.onPress());
  expect(open.onSetCollapsedProjects).toHaveBeenCalledWith(['ids']);
  act(() => open.tree.unmount());
});
