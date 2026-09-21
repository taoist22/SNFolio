import { autoFileProject, autoFileWords } from './autoFile';
import { Project } from './types';

const project = (id: string, autoFileMatch?: string, status: Project['status'] = 'active'): Project =>
  ({ id, name: id, status, createdAt: new Date(2026, 0, 1), autoFileMatch });

test('auto-file words are comma-separated and trimmed, with blanks dropped', () => {
  expect(autoFileWords(' IDS105, Acme ,, ')).toEqual(['IDS105', 'Acme']);
  expect(autoFileWords(undefined)).toEqual([]);
});

test('an item is filed under the first active project whose words appear in its title, ignoring case', () => {
  const projects = [project('done', 'ids105', 'done'), project('ids', 'IDS105'), project('acme', 'Acme, Globex')];
  expect(autoFileProject('Essay 1 [ids105-01]', projects)?.id).toBe('ids');
  expect(autoFileProject('Globex quarterly review', projects)?.id).toBe('acme');
  expect(autoFileProject('Dentist', projects)).toBeUndefined();
});
