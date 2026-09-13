import { rememberNote, captureCurrentNote } from './recentNotes';
import { calendarStorage } from '../storage/calendarStorage';
import { PluginCommAPI } from 'sn-plugin-lib';
jest.mock('sn-plugin-lib', () => ({ PluginCommAPI: { getCurrentFilePath: jest.fn() } }));

test('recent notes are deduplicated, newest first, and bounded to twelve', () => {
  calendarStorage.updateSettings({ recentNotePaths: [] });
  for (let i = 0; i < 15; i++) rememberNote(`/Note/${i}.note`);
  rememberNote('/Note/5.note');
  rememberNote('/Document/ignored.pdf');
  const paths = calendarStorage.getSettings().recentNotePaths!;
  expect(paths).toHaveLength(12);
  expect(paths[0]).toBe('/Note/5.note');
  expect(paths.filter(path => path === '/Note/5.note')).toHaveLength(1);
  expect(paths).not.toContain('/Note/0.note');
});
test('captures the actual current note without failing navigation on unavailable metadata', async () => {
  (PluginCommAPI.getCurrentFilePath as jest.Mock).mockResolvedValueOnce({ result: '/Note/Current.note' });
  await captureCurrentNote();
  expect(calendarStorage.getSettings().recentNotePaths?.[0]).toBe('/Note/Current.note');
  (PluginCommAPI.getCurrentFilePath as jest.Mock).mockRejectedValueOnce(new Error('unavailable'));
  await expect(captureCurrentNote()).resolves.toBeUndefined();
});
