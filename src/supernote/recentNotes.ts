import { PluginCommAPI } from 'sn-plugin-lib';
import { calendarStorage } from '../storage/calendarStorage';

/** File types the floating icon's Recent Files picker can return the user to. */
const RECENT_FILE_EXTENSIONS = ['.note', '.pdf', '.epub'];

export function isRecentFileType(path: string): boolean {
  const lower = path.toLowerCase();
  return RECENT_FILE_EXTENSIONS.some(extension => lower.endsWith(extension));
}

export function rememberNote(path: string): void {
  // The launcher starts before AgendaScreen hydrates storage. A settings write
  // here would persist every still-empty in-memory collection over saved data.
  if (!calendarStorage.isLoaded()) return;
  if (!path || !isRecentFileType(path)) return;
  const previous = calendarStorage.getSettings().recentNotePaths || [];
  calendarStorage.updateSettings({ recentNotePaths: [path, ...previous.filter(item => item !== path)].slice(0, 12) });
}
export async function captureCurrentNote(): Promise<void> {
  if (!calendarStorage.isLoaded()) return;
  try {
    const response = await PluginCommAPI.getCurrentFilePath();
    const path = (response as { result?: unknown } | null)?.result;
    if (typeof path === 'string') rememberNote(path);
  } catch (_) { /* Recent history must not prevent navigation. */ }
}
