import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { LinkedFileMarker, LinkedFilePathsContext, EventDesignationsContext } from './LinkedFileMarker';
import { MonthGridView } from './MonthGridView';

const labels = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAllByType(Text)
  .map(node => node.props.accessibilityLabel).filter(Boolean);

test('markers update when a note is linked, changed to PDF, and unlinked', () => {
  const render = (path?: string) => <LinkedFilePathsContext.Provider value={{ task: path }}>
    <Text><LinkedFileMarker item={{ uid: 'task' }} />Task title</Text>
  </LinkedFilePathsContext.Provider>;
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(render()); });
  expect(labels(tree)).toEqual([]);
  act(() => tree.update(render('/Note/Work.note')));
  expect(labels(tree)).toEqual(['Linked note']);
  act(() => tree.update(render('/Document/Guide.PDF')));
  expect(labels(tree)).toEqual(['Linked PDF']);
  act(() => tree.update(render('')));
  expect(labels(tree)).toEqual([]);
  act(() => tree.unmount());
});

test('recurring event occurrences show the marker for their linked series', () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<LinkedFilePathsContext.Provider value={{ series: '/Note/Meetings.note' }}>
    <Text><LinkedFileMarker item={{ uid: 'occurrence', recurringSeriesId: 'series' }} /></Text>
  </LinkedFilePathsContext.Provider>); });
  expect(labels(tree)).toEqual(['Linked note']);
  act(() => tree.unmount());
});

test('month snippets show linked markers on individual tasks and events', () => {
  const day = new Date(2026, 8, 20, 10);
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<LinkedFilePathsContext.Provider value={{ task: '/Note/Task.note', event: '/Document/Agenda.pdf' }}>
    <MonthGridView currentDate={day} selectedDate={day} onSelectDate={() => {}}
      allTasks={[{ uid: 'task', title: 'Task', completed: false, dueDate: day, createdAt: day }]}
      allEvents={[{ uid: 'event', summary: 'Meeting', start: day, end: new Date(2026, 8, 20, 11), allDay: false, attendees: [] }]} />
  </LinkedFilePathsContext.Provider>); });
  expect(labels(tree)).toContain('Linked note');
  expect(labels(tree)).toContain('Linked PDF');
  act(() => tree.unmount());
});


test('event designation and attachment markers are independent', () => {
  const render = (path: string | undefined, kind: 'none' | 'class' | 'meeting') =>
    <EventDesignationsContext.Provider value={{ event: kind }}>
      <LinkedFilePathsContext.Provider value={{ event: path }}>
        <Text><LinkedFileMarker item={{ uid: 'event' }} /></Text>
      </LinkedFilePathsContext.Provider>
    </EventDesignationsContext.Provider>;
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(render('/Document/Agenda.pdf', 'class')); });
  expect(labels(tree)).toEqual(['Class', 'Linked PDF']);
  act(() => tree.update(render(undefined, 'class')));
  expect(labels(tree)).toEqual(['Class']);
  act(() => tree.update(render('/Note/Meeting.note', 'meeting')));
  expect(labels(tree)).toEqual(['Meeting', 'Linked note']);
  act(() => tree.update(render('/Note/Meeting.note', 'none')));
  expect(labels(tree)).toEqual(['Linked note']);
  act(() => tree.unmount());
});

test('a month cell shows C for a class task and its row shows the C marker', () => {
  const day = new Date(2026, 8, 20, 10);
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<EventDesignationsContext.Provider value={{ homework: 'class' }}>
    <MonthGridView currentDate={day} selectedDate={day} onSelectDate={() => {}}
      allTasks={[{ uid: 'homework', title: 'Homework', completed: false, dueDate: day, createdAt: day }]}
      allEvents={[]} />
  </EventDesignationsContext.Provider>); });
  expect(labels(tree)).toContain('Class');
  expect(tree.root.findAllByType(Text).some(node => node.props.children === 'C')).toBe(true);
  act(() => tree.unmount());
});
