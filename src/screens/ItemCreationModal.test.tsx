import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { ItemCreationModal } from './ItemCreationModal';
import { pickLinkedNote } from '../supernote/pickLinkedNote';
jest.mock('../supernote/pickLinkedNote', () => ({ pickLinkedNote: jest.fn() }));

function button(tree: TestRenderer.ReactTestRenderer, label: string) {
  return tree.root.findAllByType(TouchableOpacity).reverse().find(node => node.findAllByType(Text).some(text => [text.props.children].flat().join('') === label))!;
}
test.each(['task', 'event'] as const)('new %s holds a selected note until Save', async type => {
  (pickLinkedNote as jest.Mock).mockResolvedValue('/Note/Existing.note');
  const createTask = jest.fn(), createEvent = jest.fn(), close = jest.fn();
  let tree: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<ItemCreationModal visible type={type} targetDate={new Date(2026, 8, 12)} initialTitle="Linked item" availableFeeds={[]} onClose={close} onCreateTask={createTask} onCreateEvent={createEvent} />); });
  await act(async () => { await button(tree!, 'Link Note…').props.onPress(); });
  expect(createTask).not.toHaveBeenCalled(); expect(createEvent).not.toHaveBeenCalled();
  const save = tree!.root.findAllByType(TouchableOpacity).reverse().find(node => node.findAllByType(Text).some(text => [text.props.children].flat().join('').includes('💾 Save')));
  expect(save).toBeDefined();
  act(() => save!.props.onPress());
  if (type === 'task') expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ linkedNotePath: '/Note/Existing.note' }));
  else expect(createEvent.mock.calls[0][5]).toBe('/Note/Existing.note');
  act(() => tree!.unmount());
});

test('canceling a new item discards the pending note link', async () => {
  (pickLinkedNote as jest.Mock).mockResolvedValue('/Note/Existing.note');
  const createTask = jest.fn(), createEvent = jest.fn(), close = jest.fn();
  const date = new Date(2026, 8, 12);
  const render = (visible: boolean) => <ItemCreationModal visible={visible} type="task" targetDate={date} initialTitle="Draft" availableFeeds={[]} onClose={close} onCreateTask={createTask} onCreateEvent={createEvent} />;
  let tree: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(render(true)); });
  await act(async () => { await button(tree!, 'Link Note…').props.onPress(); });
  act(() => tree!.update(render(false)));
  act(() => tree!.update(render(true)));
  expect(button(tree!, 'Link Note…')).toBeDefined();
  expect(createTask).not.toHaveBeenCalled();
  expect(createEvent).not.toHaveBeenCalled();
  act(() => tree!.unmount());
});
