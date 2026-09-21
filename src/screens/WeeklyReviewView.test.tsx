import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { WeeklyReviewView } from './WeeklyReviewView';
import { Project } from '../domain/types';

const textOf = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAllByType(Text).map(node => [node.props.children].flat(Infinity).join('')).join('|');

test('This Week by Project lists each project\'s due tasks, events and notes, and opens them', () => {
  const project: Project = { id: 'ids', name: 'IDS105', status: 'active', createdAt: new Date(2026, 7, 1) };
  const essay = { uid: 'essay', title: 'Essay 1', completed: false, createdAt: new Date(2026, 7, 1), dueDate: new Date(2026, 8, 30, 12) };
  const lecture = { uid: 'lec_1', summary: 'Research Methods', start: new Date(2026, 8, 29, 10), end: new Date(2026, 8, 29, 11), allDay: false, attendees: [] };
  const onOpenProject = jest.fn();
  const onOpenFile = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<WeeklyReviewView
      selectedDate={new Date(2026, 8, 30)} weekStartsOn={1} tasks={[essay]} projects={[project]}
      projectOf={() => 'ids'} journalDates={[]} weeklyNoteExists={true}
      projectWeeks={[{ project, due: [essay], events: [lecture], notes: [{ label: 'Lecture 5.note', path: '/N/Lecture 5.note' }], week: 5 }]}
      onOpenFile={onOpenFile} onOpenWeeklyNote={jest.fn()} onEditTask={jest.fn()} onOpenProject={onOpenProject} onOpenJournal={jest.fn()} />);
  });
  const text = textOf(tree);
  expect(text).toContain('THIS WEEK BY PROJECT');
  expect(text).toContain('🚀 IDS105 · Week 5');
  expect(text).toContain('Essay 1');
  expect(text).toContain('Research Methods');
  expect(text).toContain('Lecture 5.note');
  const pressText = (label: string) => act(() => tree.root.findAllByType(TouchableOpacity)
    .find(node => node.findAllByType(Text).some(t => [t.props.children].flat(Infinity).join('').includes(label)))!.props.onPress());
  pressText('Lecture 5.note');
  expect(onOpenFile).toHaveBeenCalledWith('/N/Lecture 5.note');
  pressText('🚀 IDS105');
  expect(onOpenProject).toHaveBeenCalledWith(project);
  act(() => tree.unmount());
});
