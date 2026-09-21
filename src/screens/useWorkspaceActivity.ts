import { useRef, useState } from 'react';

/** A restore must wait for operations which could still write to the old workspace. */
export function useWorkspaceActivity() {
  const count = useRef(0);
  const [busy, setBusy] = useState(false);
  const track = <Args extends unknown[], Result,>(operation: (...args: Args) => Promise<Result>) =>
    async (...args: Args): Promise<Result> => {
      count.current += 1;
      setBusy(true);
      try { return await operation(...args); }
      finally {
        count.current -= 1;
        setBusy(count.current > 0);
      }
    };
  return { busy, track };
}
