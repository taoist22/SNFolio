import { rememberNote, captureCurrentNote } from './recentNotes';
import { calendarStorage } from '../storage/calendarStorage';
import { PluginCommAPI } from 'sn-plugin-lib';
jest.mock('sn-plugin-lib', () => ({ PluginCommAPI: { getCurrentFilePath: jest.fn() } }));

beforeEach(async () => { await calendarStorage.load(); });

test('recent files are deduplicated, newest first, and bounded to twelve', () => {
  calendarStorage.updateSettings({ recentNotePaths: [] });
  for (let i = 0; i < 15; i++) rememberNote(`/Note/${i}.note`);
  rememberNote('/Note/5.note');
  const paths = calendarStorage.getSettings().recentNotePaths!;
  expect(paths).toHaveLength(12);
  expect(paths[0]).toBe('/Note/5.note');
  expect(paths.filter(path => path === '/Note/5.note')).toHaveLength(1);
  expect(paths).not.toContain('/Note/0.note');
});
test('recent files include PDF and EPUB documents but not other file types', () => {
  calendarStorage.updateSettings({ recentNotePaths: [] });
  rememberNote('/Document/Paper.PDF');
  rememberNote('/Document/Book.epub');
  rememberNote('/Document/Sheet.xlsx');
  rememberNote('/Note/Plan.note');
  expect(calendarStorage.getSettings().recentNotePaths).toEqual(['/Note/Plan.note', '/Document/Book.epub', '/Document/Paper.PDF']);
});
test('captures the actual current file without failing navigation on unavailable metadata', async () => {
  (PluginCommAPI.getCurrentFilePath as jest.Mock).mockResolvedValueOnce({ result: '/Note/Current.note' });
  await captureCurrentNote();
  expect(calendarStorage.getSettings().recentNotePaths?.[0]).toBe('/Note/Current.note');
  (PluginCommAPI.getCurrentFilePath as jest.Mock).mockRejectedValueOnce(new Error('unavailable'));
  await expect(captureCurrentNote()).resolves.toBeUndefined();
});

test('startup history capture cannot write defaults before storage hydration', async () => {
  const loaded = jest.spyOn(calendarStorage, 'isLoaded').mockReturnValue(false);
  const update = jest.spyOn(calendarStorage, 'updateSettings');
  (PluginCommAPI.getCurrentFilePath as jest.Mock).mockClear();
  rememberNote('/Note/Startup.note');
  await captureCurrentNote();
  expect(update).not.toHaveBeenCalled();
  expect(PluginCommAPI.getCurrentFilePath).not.toHaveBeenCalled();
  loaded.mockRestore(); update.mockRestore();
});
