import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useWorkspaceActivity } from './useWorkspaceActivity';

test('backup remains blocked until every overlapping operation settles, including failures', async () => {
  let activity: ReturnType<typeof useWorkspaceActivity>;
  function Host() { activity = useWorkspaceActivity(); return null; }
  let tree: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(<Host />); });
  let finish!: () => void;
  let fail!: (error: Error) => void;
  const first = new Promise<void>(resolve => { finish = resolve; });
  const second = new Promise<void>((_resolve, reject) => { fail = reject; });
  let pendingOne!: Promise<void>;
  let pendingTwo!: Promise<void>;
  act(() => {
    pendingOne = activity!.track(() => first)();
    pendingTwo = activity!.track(() => second)();
  });
  expect(activity!.busy).toBe(true);
  await act(async () => { finish(); await pendingOne; });
  expect(activity!.busy).toBe(true);
  await act(async () => {
    fail(new Error('Connection lost'));
    await expect(pendingTwo).rejects.toThrow('Connection lost');
  });
  expect(activity!.busy).toBe(false);
  act(() => tree!.unmount());
});
