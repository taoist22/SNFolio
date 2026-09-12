import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { TimePickerModal } from './TimePickerModal';
import { TimeFormatContext } from './TimeFormatContext';
import { TimeFormat } from '../domain/timeOfDay';

test('24-hour selection preserves minutes and switching formats preserves the selected time', () => {
  const onSelect = jest.fn();
  const render = (format: TimeFormat) => (
    <TimeFormatContext.Provider value={format}>
      <TimePickerModal visible title="Start time" value={13 * 60 + 15} onSelect={onSelect} onClose={jest.fn()} />
    </TimeFormatContext.Provider>
  );
  let tree: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(render('24h')); });
  const press = (label: string) => {
    const button = tree!.root.findAllByType(TouchableOpacity).reverse().find(node =>
      node.findAllByType(Text).some(text => [text.props.children].flat(Infinity).join('') === label));
    expect(button).toBeDefined();
    act(() => button!.props.onPress());
  };
  press('00');
  press('Use 00:15');
  expect(onSelect).toHaveBeenLastCalledWith(15);
  press('12');
  press('Use 12:15');
  expect(onSelect).toHaveBeenLastCalledWith(735);
  press('23');
  act(() => tree!.update(render('12h')));
  press('Use 11:15 PM');
  expect(onSelect).toHaveBeenLastCalledWith(1395);
  act(() => tree!.unmount());
});
