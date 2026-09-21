import { CalendarEvent, CalendarFeed, Project } from './types';

/** The words in a project's auto-file field: comma-separated, trimmed, blanks dropped. */
export function autoFileWords(text: string | undefined): string[] {
  return (text || '').split(',').map(word => word.trim()).filter(Boolean);
}

/**
 * Lower case without spaces or punctuation, so "IDS105" matches
 * "IDS-105-18678" and "ids 105".
 */
export function matchKey(text: string): string {
  return text.toLocaleLowerCase().replace(/[\s\-_.,:;/\\|()[\]{}'"`’‘“”–—#&+*]+/g, '');
}

type FilingFields = Pick<CalendarEvent, 'summary' | 'location' | 'categories'>;

/**
 * The active project whose auto-file words appear in an item's title,
 * location or categories. Each learning system puts the course in a
 * different one of these (Canvas the title, Brightspace the location, Moodle
 * the categories). The description is not searched: long descriptions often
 * mention other courses or clients. The first project in list order wins.
 */
export function autoFileProject(item: FilingFields, projects: Project[]): Project | undefined {
  const haystack = matchKey([item.summary, item.location, ...(item.categories || [])].filter(Boolean).join(' '));
  if (!haystack) return undefined;
  return projects.find(project =>
    project.status === 'active' &&
    autoFileWords(project.autoFileMatch).some(word => {
      const key = matchKey(word);
      return Boolean(key) && haystack.includes(key);
    }));
}

/** The active project a whole calendar is filed under, if it has one. */
export function feedProject(
  item: Pick<CalendarEvent, 'sourceFeedId'>,
  feeds: CalendarFeed[],
  projects: Project[],
): Project | undefined {
  const projectId = item.sourceFeedId ? feeds.find(feed => feed.id === item.sourceFeedId)?.projectId : undefined;
  return projectId ? projects.find(project => project.id === projectId && project.status === 'active') : undefined;
}
