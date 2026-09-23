/**
 * Comparisons that let a screen keep the state it already has.
 *
 * Both of these come from sweeps that run again whenever the day or month
 * changes and usually find exactly what they found last time. Handing back a
 * fresh object re-rendered the panel, the month grid and the day schedule for
 * no change at all — measured at several hundred milliseconds each on device.
 */

/** Whether two sweeps found the same linked notes. */
export function sameNotePaths(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
}

/** Whether two sets hold the same days. */
export function sameKeys(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every(key => b.has(key));
}
