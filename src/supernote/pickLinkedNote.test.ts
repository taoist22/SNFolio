import { RattaFileSelector } from 'sn-plugin-lib';
import { pickLinkedNote } from './pickLinkedNote';
import { ensureFileReadPermission } from './pluginPermissions';

jest.mock('sn-plugin-lib', () => ({ RattaFileSelector: { selectFile: jest.fn() } }));
jest.mock('./pluginPermissions', () => ({ ensureFileReadPermission: jest.fn(async () => true) }));

beforeEach(() => { jest.clearAllMocks(); });

test.each(['/storage/emulated/0/Document/Reference.pdf', '/storage/emulated/0/Note/Existing.note', '/storage/emulated/0/Document/Upper.PDF'])(
  'accepts a supported linked file: %s', async path => {
    (RattaFileSelector.selectFile as jest.Mock).mockResolvedValueOnce([{ path }]);
    expect(await pickLinkedNote()).toBe(path);
    expect(RattaFileSelector.selectFile).toHaveBeenCalledWith(expect.objectContaining({
      selectType: 0, suffixList: ['note', 'pdf'], needSelectFolder: '/storage/emulated/0',
    }));
  }
);

test('rejects unsupported files returned by the picker', async () => {
  (RattaFileSelector.selectFile as jest.Mock).mockResolvedValueOnce(['/storage/emulated/0/Book.epub']);
  await expect(pickLinkedNote()).rejects.toThrow('note file or a PDF');
});

test('cancellation keeps the current link', async () => {
  (RattaFileSelector.selectFile as jest.Mock).mockResolvedValueOnce([]);
  expect(await pickLinkedNote()).toBeUndefined();
});

test('permission denial prevents file selection', async () => {
  (ensureFileReadPermission as jest.Mock).mockResolvedValueOnce(false);
  await expect(pickLinkedNote()).rejects.toThrow('not allowed');
  expect(RattaFileSelector.selectFile).not.toHaveBeenCalled();
});
