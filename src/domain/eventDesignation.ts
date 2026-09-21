import { ItemMembership, Project } from './types';

export type ProjectCategory = 'general' | 'class' | 'work';
export type EventDesignation = 'none' | 'class' | 'meeting';

export function projectEventDesignation(project?: Project): EventDesignation {
  return project?.defaultEventDesignation ?? (project?.category === 'class' ? 'class' : 'none');
}

/** Explicit None suppresses the project default; omission follows it dynamically. */
export function resolveEventDesignation(membership: ItemMembership, projects: Project[]): EventDesignation {
  return membership.eventDesignation ?? projectEventDesignation(projects.find(project => project.id === membership.projectId));
}

/**
 * Tasks carry C only, inherited from a project whose events default to Class.
 * They never get M: a task is not a meeting, and M should always mean one.
 */
export function resolveTaskDesignation(membership: ItemMembership, projects: Project[]): EventDesignation {
  const project = projects.find(item => item.id === membership.projectId);
  return projectEventDesignation(project) === 'class' ? 'class' : 'none';
}

export const designationLabel = (kind: EventDesignation): string =>
  kind === 'class' ? 'Class (C)' : kind === 'meeting' ? 'Meeting (M)' : 'None';
