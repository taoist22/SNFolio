import { projectEventDesignation, resolveEventDesignation, resolveTaskDesignation } from './eventDesignation';
import { Project } from './types';

const project: Project = { id: 'p', name: 'Project', status: 'active', createdAt: new Date() };
test('only explicit Class projects automatically designate their events', () => {
  expect(projectEventDesignation({ ...project, name: 'Physics Class' })).toBe('none');
  expect(projectEventDesignation({ ...project, category: 'class' })).toBe('class');
  expect(projectEventDesignation({ ...project, category: 'work' })).toBe('none');
  expect(projectEventDesignation({ ...project, category: 'work', defaultEventDesignation: 'meeting' })).toBe('meeting');
});
test('explicit per-event choices override the project, including None and standalone meetings', () => {
  const projects: Project[] = [{ ...project, category: 'class' }];
  expect(resolveEventDesignation({ projectId: 'p' }, projects)).toBe('class');
  expect(resolveEventDesignation({ projectId: 'p', eventDesignation: 'none' }, projects)).toBe('none');
  expect(resolveEventDesignation({ projectId: 'p', eventDesignation: 'meeting' }, projects)).toBe('meeting');
  expect(resolveEventDesignation({ eventDesignation: 'meeting' }, [])).toBe('meeting');
  expect(resolveEventDesignation({ projectId: 'missing' }, projects)).toBe('none');
});
test('inherited designations follow a changed project default but explicit choices stay fixed', () => {
  const projects: Project[] = [{ ...project, category: 'class', defaultEventDesignation: 'none' }];
  expect(resolveEventDesignation({ projectId: 'p' }, projects)).toBe('none');
  expect(resolveEventDesignation({ projectId: 'p', eventDesignation: 'class' }, projects)).toBe('class');
});

test('tasks inherit C from a Class project and never get M', () => {
  const projects: Project[] = [
    { ...project, id: 'class', category: 'class' },
    { ...project, id: 'class-off', category: 'class', defaultEventDesignation: 'none' },
    { ...project, id: 'work', category: 'work', defaultEventDesignation: 'meeting' },
    { ...project, id: 'general-class', defaultEventDesignation: 'class' },
  ];
  expect(resolveTaskDesignation({ projectId: 'class' }, projects)).toBe('class');
  expect(resolveTaskDesignation({ projectId: 'general-class' }, projects)).toBe('class');
  expect(resolveTaskDesignation({ projectId: 'class-off' }, projects)).toBe('none');
  expect(resolveTaskDesignation({ projectId: 'work' }, projects)).toBe('none');
  expect(resolveTaskDesignation({}, projects)).toBe('none');
  expect(resolveTaskDesignation({ projectId: 'missing' }, projects)).toBe('none');
});
