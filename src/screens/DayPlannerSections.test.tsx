import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ScrollView, Text, TouchableOpacity } from 'react-native';
import { DayPlannerSections, PlannerSection } from './DayPlannerSections';
import { calendarStorage } from '../storage/calendarStorage';

const render = (enabled: boolean) => (
  <DayPlannerSections enabled={enabled}>
    <PlannerSection id="schedule" title="Schedule" summary="2 events"><Text>Schedule content</Text></PlannerSection>
    <PlannerSection id="focus" title="Focus" summary="1 priority"><Text>Focus content</Text></PlannerSection>
  </DayPlannerSections>
);
const content = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAllByType(Text).map(node => [node.props.children].flat().join(''));

test('non-Nomad layout retains expanded content without section controls', () => {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(render(false)); });
  expect(content(tree!)).toEqual(['Schedule content', 'Focus content']);
  expect(tree!.root.findAllByType(TouchableOpacity)).toHaveLength(0);
  act(() => tree!.unmount());
});

test('Nomad starts collapsed, remembers expanded sections, and shortcuts reveal content', () => {
  calendarStorage.updateSettings({ nomadPlannerSections: {} });
  let tree: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(render(true)); });
  expect(content(tree!)).not.toContain('Schedule content');
  expect(content(tree!)).toContain('2 events');
  const header = tree!.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityState?.expanded === false);
  act(() => header!.props.onPress());
  expect(content(tree!)).toContain('Schedule content');
  expect(calendarStorage.getSettings().nomadPlannerSections?.schedule).toBe(true);
  act(() => tree!.unmount());
  act(() => { tree = TestRenderer.create(render(true)); });
  expect(content(tree!)).toContain('Schedule content');
  const shortcut = tree!.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'Go to Focus');
  act(() => shortcut!.props.onPress());
  expect(content(tree!)).toContain('Focus content');
  expect(content(tree!)).toContain('Schedule content');
  act(() => tree!.unmount());
});

test('Weekly Review keeps its header outside scrolling and saves expansion separately from Day Planner', () => {
  calendarStorage.updateSettings({ nomadPlannerSections: { projects: true }, nomadWeeklySections: {} });
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <DayPlannerSections enabled weekly header={<Text>Weekly totals</Text>}>
        <PlannerSection id="projects" title="Projects" summary="2 projects"><Text>Weekly projects</Text></PlannerSection>
      </DayPlannerSections>
    );
  });
  expect(content(tree!)).toContain('Weekly totals');
  const scrollingText = tree!.root.findByType(ScrollView).findAllByType(Text).map(node => node.props.children);
  expect(scrollingText).not.toContain('Weekly totals');
  expect(content(tree!)).not.toContain('Weekly projects');
  const shortcut = tree!.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === 'Go to Projects');
  act(() => shortcut!.props.onPress());
  expect(content(tree!)).toContain('Weekly projects');
  expect(calendarStorage.getSettings().nomadWeeklySections?.projects).toBe(true);
  expect(calendarStorage.getSettings().nomadPlannerSections).toEqual({ projects: true });
  act(() => tree!.unmount());
});
