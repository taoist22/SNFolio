import { autoFileProject, autoFileWords, feedProject, matchKey } from './autoFile';
import { CalendarFeed, Project } from './types';

const project = (id: string, autoFileMatch?: string, status: Project['status'] = 'active'): Project =>
  ({ id, name: id, status, createdAt: new Date(2026, 0, 1), autoFileMatch });
const item = (summary: string, location?: string, categories?: string[]) => ({ summary, location, categories });

test('auto-file words are comma-separated and trimmed, with blanks dropped', () => {
  expect(autoFileWords(' IDS105, Acme ,, ')).toEqual(['IDS105', 'Acme']);
  expect(autoFileWords(undefined)).toEqual([]);
});

test('matching ignores case, spaces and punctuation, so IDS105 matches IDS-105-18678', () => {
  expect(matchKey('IDS-105-18678-M01 Awareness & Online Learning')).toBe('ids10518678m01awarenessonlinelearning');
  const projects = [project('ids', 'IDS105')];
  expect(autoFileProject(item('Module Four Begins', 'IDS-105-18678-M01 Awareness & Online Learning 2026 C-5 (Aug - Oct)'), projects)?.id).toBe('ids');
  expect(autoFileProject(item('Essay 1 [ids 105]'), projects)?.id).toBe('ids');
});

test('the course is found in the title (Canvas), location (Brightspace) or categories (Moodle), but not the description', () => {
  const projects = [project('done', 'IDS105', 'done'), project('ids', 'IDS105'), project('fye', 'FYE101'), project('acme', 'Acme, Globex')];
  expect(autoFileProject(item('Essay 1 [IDS-105]'), projects)?.id).toBe('ids');
  expect(autoFileProject(item('Module One Begins', 'FYE-101-11639-M01 First Year Experience'), projects)?.id).toBe('fye');
  expect(autoFileProject(item('Quiz 2', undefined, ['Lecture', 'IDS105']), projects)?.id).toBe('ids');
  expect(autoFileProject(item('Globex quarterly review'), projects)?.id).toBe('acme');
  expect(autoFileProject({ ...item('Module One Begins', 'Southern New Hampshire University'), description: 'IDS105' } as any, projects)).toBeUndefined();
});

test('a calendar filed under a project files its items there, if that project is active', () => {
  const projects = [project('ids'), project('old', undefined, 'done')];
  const feeds: CalendarFeed[] = [
    { id: 'course', name: 'IDS105 calendar', enabled: true, projectId: 'ids' },
    { id: 'finished', name: 'Old course', enabled: true, projectId: 'old' },
    { id: 'plain', name: 'Personal', enabled: true },
  ];
  expect(feedProject({ sourceFeedId: 'course' }, feeds, projects)?.id).toBe('ids');
  expect(feedProject({ sourceFeedId: 'finished' }, feeds, projects)).toBeUndefined();
  expect(feedProject({ sourceFeedId: 'plain' }, feeds, projects)).toBeUndefined();
  expect(feedProject({}, feeds, projects)).toBeUndefined();
});
