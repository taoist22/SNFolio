import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { CalendarEvent } from '../domain/types';
import { EventDetailsModal } from './EventDetailsModal';

test('shows a recurrence warning when a rule is preserved but not expanded', () => {
  const event: CalendarEvent = {
    uid: 'invalid-rule',
    summary: 'Imported meeting',
    start: new Date(2026, 7, 15, 9),
    end: new Date(2026, 7, 15, 10),
    allDay: false,
    attendees: [],
    rrule: 'FREQ=WEEKLY;BYMONTHDAY=1',
    recurrenceError: 'BYMONTHDAY is supported only for MONTHLY rules',
  };
  let renderer: TestRenderer.ReactTestRenderer;

  act(() => {
    renderer = TestRenderer.create(
      <EventDetailsModal
        event={event}
        readOnly
        onClose={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onCopy={jest.fn()}
        onHide={jest.fn()}
        onNoteAction={jest.fn()}
      />
    );
  });

  const text = renderer!.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat(Infinity)
    .join(' ');
  expect(text).toContain('Recurrence not expanded');
  expect(text).toContain(event.recurrenceError);
});

test('bounds recurrence warnings derived from imported calendar data', () => {
  const recurrenceError = `Invalid RRULE token ${'X'.repeat(2_000)}`;
  const event: CalendarEvent = {
    uid: 'oversized-rule',
    summary: 'Imported meeting',
    start: new Date(2026, 7, 15, 9),
    end: new Date(2026, 7, 15, 10),
    allDay: false,
    attendees: [],
    recurrenceError,
  };
  let renderer: TestRenderer.ReactTestRenderer;

  act(() => {
    renderer = TestRenderer.create(
      <EventDetailsModal
        event={event}
        readOnly
        onClose={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onCopy={jest.fn()}
        onHide={jest.fn()}
        onNoteAction={jest.fn()}
      />
    );
  });

  const text = renderer!.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat(Infinity)
    .join(' ');
  expect(text).toContain('Recurrence not expanded');
  expect(text).toContain('...');
  expect(text).not.toContain(recurrenceError);
  expect(text.length).toBeLessThan(600);
});

test.each([
  ['/Document/Syllabus.pdf', '📄 Open PDF'],
  ['/Document/Syllabus.PDF', '📄 Open PDF'],
  ['/Note/Lecture.note', '📂 Open Note'],
])('a linked %s is opened with the matching label', (notePath, label) => {
  const event: CalendarEvent = {
    uid: 'linked', summary: 'Lecture', start: new Date(2026, 8, 20, 9), end: new Date(2026, 8, 20, 10),
    allDay: false, attendees: [],
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <EventDetailsModal event={event} readOnly={false} notePath={notePath} onClose={jest.fn()} onEdit={jest.fn()}
        onDelete={jest.fn()} onCopy={jest.fn()} onHide={jest.fn()} onNoteAction={jest.fn()} />
    );
  });
  const text = renderer.root.findAllByType(Text).map(node => [node.props.children].flat(Infinity).join('')).join('|');
  expect(text).toContain(label);
  act(() => renderer.unmount());
});
