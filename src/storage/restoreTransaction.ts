import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules } from 'react-native';
import { RESTORE_JOURNAL_KEY, storageKey, validateWorkspaceData, WORKSPACE_FIELDS, WorkspaceData } from './workspaceBackup';

/** A durable redo journal: startup finishes an interrupted restore before exposing data. */
export async function recoverWorkspaceRestore(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(RESTORE_JOURNAL_KEY);
  if (raw === null) return false;
  const data = JSON.parse(raw);
  validateWorkspaceData(data);
  if (data.settings.restoreSyncPaused !== true || data.settings.caldavEnabled || data.settings.taskCaldavEnabled ||
      data.settings.feeds.some((feed: any) => feed.enabled)) throw new Error('Invalid restore recovery journal.');
  if (!NativeModules.CalendarFile?.setSecret) throw new Error('Encrypted storage is unavailable. Restore cannot finish.');
  // Never combine a restored workspace with the previous workspace's credentials.
  await NativeModules.CalendarFile.setSecret('calendar-connections', '{}');
  await AsyncStorage.multiSet(WORKSPACE_FIELDS.map(field => [storageKey(field), JSON.stringify(data[field])]));
  await AsyncStorage.removeItem(RESTORE_JOURNAL_KEY);
  return true;
}

export async function commitWorkspaceRestore(data: WorkspaceData): Promise<void> {
  validateWorkspaceData(data);
  await AsyncStorage.setItem(RESTORE_JOURNAL_KEY, JSON.stringify(data));
  await recoverWorkspaceRestore();
}
