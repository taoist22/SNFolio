import { Project } from './types';

/** The words in a project's auto-file field: comma-separated, trimmed, blanks dropped. */
export function autoFileWords(text: string | undefined): string[] {
  return (text || '').split(',').map(word => word.trim()).filter(Boolean);
}

/**
 * The active project whose auto-file words appear in an item's title
 * (ignoring case). The first project in list order wins a tie.
 */
export function autoFileProject(title: string, projects: Project[]): Project | undefined {
  const haystack = title.toLocaleLowerCase();
  return projects.find(project =>
    project.status === 'active' &&
    autoFileWords(project.autoFileMatch).some(word => haystack.includes(word.toLocaleLowerCase())));
}
