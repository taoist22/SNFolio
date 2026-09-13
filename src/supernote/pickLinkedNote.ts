import { RattaFileSelector } from 'sn-plugin-lib';
import { firstPickedFilePath } from '../domain/fileSelection';
import { ensureFileReadPermission } from './pluginPermissions';

export async function pickLinkedNote(): Promise<string | undefined> {
  await new Promise<void>(resolve => setTimeout(resolve, 200));
  if (!(await ensureFileReadPermission())) throw new Error('File access was not allowed.');
  const result = await RattaFileSelector.selectFile({ selectType: 0, maxNum: 1,
    title: 'Select an existing note', rightButtonText: 'Link Note',
    needSelectFolder: '/storage/emulated/0/Note', suffixList: ['note'] });
  const path = firstPickedFilePath(result);
  if (path && !/\.note$/i.test(path)) throw new Error('Choose a Supernote .note file.');
  return path;
}
