import { notePageCount } from './notePageCount';

test('reads the actual SDK result and supports legacy data', () => {
  expect(notePageCount({ success: true, result: 7 })).toBe(7);
  expect(notePageCount({ success: true, data: 3 })).toBe(3);
  expect(notePageCount({ success: true, result: 7, data: 3 })).toBe(7);
});
test('does not accept failed or invalid page counts', () => {
  for (const response of [null, { success: false, result: 7 }, { success: true, result: 0 }, { success: true, result: '7' }, { success: true, result: 1.5 }]) {
    expect(notePageCount(response)).toBeUndefined();
  }
});
