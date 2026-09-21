import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { ItemCreationModal } from './ItemCreationModal';
import { pickLinkedNote } from '../supernote/pickLinkedNote';
jest.mock('../supernote/pickLinkedNote', () => ({ pickLinkedNote: jest.fn() }));

function button(tree: TestRenderer.ReactTestRenderer, label: string) {
  return tree.root.findAllByType(TouchableOpacity).reverse().find(node => node.findAllByType(Text).some(text => [text.props.children].flat().join('') === label))!;
}
test.each([
  ['task', '/Note/Existing.note'], ['event', '/Note/Existing.note'],
  ['task', '/Document/Reference.pdf'], ['event', '/Document/Reference.pdf'],
] as const)('new %s holds selected file %s until Save', async (type, path) => {
  (pickLinkedNote as jest.Mock).mockResolvedValue(path);
  const createTask = jest.fn(), createEvent = jest.fn(), close = jest.fn();
  let tree: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<ItemCreationModal visible type={type} targetDate={new Date(2026, 8, 12)} initialTitle="Linked item" availableFeeds={[]} onClose={close} onCreateTask={createTask} onCreateEvent={createEvent} />); });
  await act(async () => { await button(tree!, 'Link Note / PDF…').props.onPress(); });
  expect(createTask).not.toHaveBeenCalled(); expect(createEvent).not.toHaveBeenCalled();
  const save = tree!.root.findAllByType(TouchableOpacity).reverse().find(node => node.findAllByType(Text).some(text => [text.props.children].flat().join('').includes('💾 Save')));
  expect(save).toBeDefined();
  act(() => save!.props.onPress());
  if (type === 'task') expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ linkedNotePath: path }));
  else expect(createEvent.mock.calls[0][5]).toBe(path);
  act(() => tree!.unmount());
});

test.each(['task', 'event'] as const)('saving a new %s records it before the form closes', type => {
  // onClose can dismiss the form (and the panel), so the item must already be stored by then.
  const order: string[] = [];
  const createTask = jest.fn(() => order.push('create')), createEvent = jest.fn(() => order.push('create')), close = jest.fn(() => order.push('close'));
  let tree: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<ItemCreationModal visible type={type} targetDate={new Date(2026, 8, 12)} initialTitle="Quick item" availableFeeds={[]} onClose={close} onCreateTask={createTask} onCreateEvent={createEvent} />); });
  const save = tree!.root.findAllByType(TouchableOpacity).reverse().find(node => node.findAllByType(Text).some(text => [text.props.children].flat().join('').includes('💾 Save')));
  act(() => save!.props.onPress());
  expect(order).toEqual(['create', 'close']);
  act(() => tree!.unmount());
});

test('canceling a new item discards the pending note link', async () => {
  (pickLinkedNote as jest.Mock).mockResolvedValue('/Note/Existing.note');
  const createTask = jest.fn(), createEvent = jest.fn(), close = jest.fn();
  const date = new Date(2026, 8, 12);
  const render = (visible: boolean) => <ItemCreationModal visible={visible} type="task" targetDate={date} initialTitle="Draft" availableFeeds={[]} onClose={close} onCreateTask={createTask} onCreateEvent={createEvent} />;
  let tree: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(render(true)); });
  await act(async () => { await button(tree!, 'Link Note / PDF…').props.onPress(); });
  act(() => tree!.update(render(false)));
  act(() => tree!.update(render(true)));
  expect(button(tree!, 'Link Note / PDF…')).toBeDefined();
  expect(createTask).not.toHaveBeenCalled();
  expect(createEvent).not.toHaveBeenCalled();
  act(() => tree!.unmount());
});

test.each(['none', 'class', 'meeting'] as const)('event saves explicit %s calendar designation', async designation => {
  const create = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<ItemCreationModal visible type="event" targetDate={new Date(2026, 8, 20)} initialTitle="Designated event" availableFeeds={[]} onClose={() => {}} onCreateTask={() => {}} onCreateEvent={create} />); });
  const label = designation === 'none' ? 'None' : designation === 'class' ? 'Class (C)' : 'Meeting (M)';
  act(() => button(tree, label).props.onPress());
  const save = tree.root.findAllByType(TouchableOpacity).reverse().find(node => node.findAllByType(Text).some(text => [text.props.children].flat().join('').includes('💾 Save')))!;
  act(() => save.props.onPress());
  expect(create.mock.calls[0][6]).toBe(designation);
  act(() => tree.unmount());
});
