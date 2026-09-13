/** Current SDK returns result; data supports older host responses. */
export function notePageCount(response: unknown): number | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const value = response as { success?: boolean; result?: unknown; data?: unknown };
  if (value.success !== true) return undefined;
  const count = value.result !== undefined ? value.result : value.data;
  return typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : undefined;
}
