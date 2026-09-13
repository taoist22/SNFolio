import { PluginCommAPI } from 'sn-plugin-lib';
import { calendarStorage } from '../storage/calendarStorage';

export function rememberNote(path: string): void {
  if (!path || !path.toLowerCase().endsWith('.note')) return;
  const previous = calendarStorage.getSettings().recentNotePaths || [];
  calendarStorage.updateSettings({ recentNotePaths: [path, ...previous.filter(item => item !== path)].slice(0, 12) });
}
export async function captureCurrentNote(): Promise<void> {
  try {
    const response = await PluginCommAPI.getCurrentFilePath();
    const path = (response as { result?: unknown } | null)?.result;
    if (typeof path === 'string') rememberNote(path);
  } catch (_) { /* Recent history must not prevent navigation. */ }
}
