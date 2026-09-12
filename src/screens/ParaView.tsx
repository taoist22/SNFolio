import { formatDateTime } from '../domain/timeOfDay';
import { useTimeFormat } from './TimeFormatContext';
import React from 'react';
import { Dimensions, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Area, CalendarEvent, CalendarTask, Project, Resource } from '../domain/types';
import { isDone, statusGlyph, taskStatus } from '../domain/taskModel';
import { ICON_CHOICES } from '../domain/noteTemplates';
import { ParaFilesPanel } from './ParaFilesPanel';
import { ParaFolderEntry } from '../supernote/exportService';
import { HandwritingTextInput, HandwritingTextInputHandle } from './HandwritingTextInput';
import {
  activeProjects,
  archivedProjects,
  areaProjectCounts,
  directTasksInArea,
  projectOverdue,
  projectProgress,
  ProjectLookup,
} from '../domain/taskListView';
import { projectOverviewItems } from '../domain/projectOverview';

interface ParaViewProps {
  /** Opens a just-converted Project at its new location instead of Projects. */
  initialAreaId?: string | null;
  onInitialAreaShown?: () => void;
  areas: Area[];
  projects: Project[];
  resources: Resource[];
  tasks: CalendarTask[];
  events: CalendarEvent[];
  projectOf: (uid: string) => string | undefined;
  projectOfEvent: (event: CalendarEvent) => string | undefined;
  areaOfEvent: (event: CalendarEvent) => string | undefined;
  areaOf: (uid: string) => string | undefined;
  onNewProject: (name: string, areaId?: string) => unknown;
  onNewArea: (name: string) => unknown;
  onNewResource: (name: string) => unknown;
  /** Editing an area happens on the area, not in a sheet about all of them. */
  onRenameArea: (areaId: string, name: string, icon?: string) => void;
  onDeleteArea: (areaId: string) => void;
  onArchiveArea: (area: Area, archiveProjects: boolean) => void;
  onRestoreArea: (area: Area) => void;
  /** Tasks filed under an area, so deleting one can say what it detaches. */
  areaTaskCount: (areaId: string) => number;
  onOpenProject: (project: Project) => void;
  onSetProjectDue: (project: Project) => void;
  onArchiveProject: (project: Project) => void;
  onRestoreProject: (project: Project) => void;
  onBrowseFiles: (kind: 'project' | 'area' | 'resource', item: Project | Area | Resource) => void;
  folderFor: (kind: 'project' | 'area' | 'resource', item: Project | Area | Resource) => string;
  onListEntries: (kind: 'project' | 'area' | 'resource', item: Project | Area | Resource, folder: string) => Promise<ParaFolderEntry[]>;
  onOpenFile: (path: string) => void;
  onNewNote: (kind: 'project' | 'area' | 'resource', item: Project | Area | Resource, name: string, folder: string) => Promise<void>;
  onChooseFolder: (kind: 'project' | 'area' | 'resource', item: Project | Area | Resource, folder: string) => Promise<void>;
  onUpdateResource: (resource: Resource) => void;
  onArchiveResource: (resource: Resource) => void;
  onRestoreResource: (resource: Resource) => void;
  onToggleTask: (task: CalendarTask) => void;
  onEditTask: (task: CalendarTask) => void;
  onEditEvent: (event: CalendarEvent) => void;
  onAddTaskToProject: (project: Project) => void;
  onMoveProject: (project: Project, direction: 'up' | 'down') => void;
}

/**
 * Areas and Projects as a place you browse, not a filter row.
 *
 * A peer of Month and Day View rather than a modal — it sat in the view
 * switcher but opened an overlay, which is what made it feel bolted on.
 *
 * Grouping tasks *by* project showed tasks. This shows projects as things:
 * how far along, when due, what is in them.
 */
export function ParaView({
  initialAreaId,
  onInitialAreaShown,
  areas,
  projects,
  resources,
  tasks,
  events,
  projectOf,
  projectOfEvent,
  areaOfEvent,
  areaOf,
  onNewProject,
  onNewArea,
  onNewResource,
  onRenameArea,
  onDeleteArea,
  onArchiveArea,
  onRestoreArea,
  areaTaskCount,
  onOpenProject,
  onSetProjectDue,
  onArchiveProject,
  onRestoreProject,
  onBrowseFiles,
  folderFor,
  onListEntries,
  onOpenFile,
  onNewNote,
  onChooseFolder,
  onUpdateResource,
  onArchiveResource,
  onRestoreResource,
  onToggleTask,
  onEditTask,
  onEditEvent,
  onAddTaskToProject,
  onMoveProject,
}: ParaViewProps): React.JSX.Element {
  const timeFormat = useTimeFormat();
  const lookup: ProjectLookup = {
    projectOf,
    nameOf: (id: string) => projects.find(p => p.id === id)?.name || 'Project',
  };

  const activeAreas = areas.filter(area => !area.archived);
  const counts = areaProjectCounts(activeAreas, projects);
  type ParaSection = 'projects' | 'areas' | 'resources' | 'archive';
  const [section, setSection] = React.useState<ParaSection>(initialAreaId ? 'areas' : 'projects');
  const [selectedItemId, setSelectedItemId] = React.useState<string | null>(initialAreaId || null);
  React.useEffect(() => {
    if (initialAreaId) {
      onInitialAreaShown?.();
    }
    // This is a one-time handoff. Clearing the parent prop must not move the
    // user away from the Area that was just revealed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [expanded, setExpanded] = React.useState<Record<ParaSection, boolean>>({
    projects: true,
    areas: true,
    resources: true,
    archive: false,
  });
  const [reorderProjects, setReorderProjects] = React.useState<boolean>(false);

  const selectedAreaId = section === 'areas' ? selectedItemId : null;
  const selectedProjectId = section === 'projects' ? selectedItemId : null;
  const selectedResourceId = section === 'resources' ? selectedItemId : null;
  React.useEffect(() => {
    if (section === 'projects' && selectedItemId) {
      const selected = projects.find(project => project.id === selectedItemId);
      if (selected && selected.status !== 'active') setSelectedItemId(null);
    }
    if (section === 'areas' && selectedItemId) {
      const selected = areas.find(area => area.id === selectedItemId);
      if (selected?.archived) setSelectedItemId(null);
    }
  }, [areas, projects, section, selectedItemId]);
  const shown = activeProjects(projects).filter(
    project =>
      (!selectedAreaId || project.areaId === selectedAreaId) &&
      (!selectedProjectId || project.id === selectedProjectId)
  );
  const useProjectColumns = Dimensions.get('window').width >= 1000;
  const selectedArea = activeAreas.find(a => a.id === selectedAreaId);
  const selectedAreaTasks = selectedArea
    ? directTasksInArea(tasks, selectedArea.id, areaOf, projectOf)
    : [];
  const selectedAreaEvents = selectedArea
    ? events.filter(event =>
        areaOfEvent(event) === selectedArea.id && !projectOfEvent(event)
      )
    : [];
  const selectedProject = projects.find(project => project.id === selectedProjectId);
  const [editingAreaId, setEditingAreaId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState<string>('');
  const editAreaInputRef = React.useRef<HandwritingTextInputHandle>(null);
  const [iconOpen, setIconOpen] = React.useState<boolean>(false);
  const [confirmingAreaId, setConfirmingAreaId] = React.useState<string | null>(null);
  const [confirmingArchiveAreaId, setConfirmingArchiveAreaId] = React.useState<string | null>(null);

  const closeAreaEditor = () => {
    setEditingAreaId(null);
    setIconOpen(false);
    setConfirmingAreaId(null);
    setConfirmingArchiveAreaId(null);
  };
  const [adding, setAdding] = React.useState<'project' | 'area' | 'resource' | null>(null);
  const [newName, setNewName] = React.useState<string>('');
  const [addingBusy, setAddingBusy] = React.useState<boolean>(false);
  const newItemInputRef = React.useRef<HandwritingTextInputHandle>(null);
  const [editingResourceId, setEditingResourceId] = React.useState<string | null>(null);
  const [resourceName, setResourceName] = React.useState<string>('');
  const [resourceDescription, setResourceDescription] = React.useState<string>('');
  const resourceNameInputRef = React.useRef<HandwritingTextInputHandle>(null);
  const resourceDescriptionInputRef = React.useRef<HandwritingTextInputHandle>(null);
  const [resourceIcon, setResourceIcon] = React.useState<string>('');

  const showProjects = section === 'projects';
  const showAreas = section === 'areas';
  const showResources = section === 'resources';
  const showArchive = section === 'archive';
  const selectedResource = resources.find(resource => resource.id === selectedResourceId);

  const selectSection = (next: ParaSection) => {
    setSection(next);
    setSelectedItemId(null);
  };
  const toggleSection = (next: ParaSection) => {
    setExpanded(current => ({ ...current, [next]: !current[next] }));
    selectSection(next);
  };

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <Text allowFontScaling={false} style={styles.topTitle}>
          📁 PARA Workspace
        </Text>
        <View style={styles.topActions}>
          {/* "+ New" used to open the manage sheet, which is not what it says.
              It creates now, and managing has a door of its own. */}
          <TouchableOpacity style={styles.topBtn} onPress={() => setAdding('project')}>
            <Text allowFontScaling={false} style={styles.topBtnText}>
              + New Project
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.topBtn} onPress={() => setAdding('area')}>
            <Text allowFontScaling={false} style={styles.topBtnText}>
              + Area
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.topBtn} onPress={() => setAdding('resource')}>
            <Text allowFontScaling={false} style={styles.topBtnText}>+ Resource</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.topBtn, reorderProjects && styles.topBtnActive]}
            onPress={() => {
              setSection('projects');
              setSelectedItemId(null);
              setReorderProjects(value => !value);
            }}
          >
            <Text allowFontScaling={false} style={styles.topBtnText}>{reorderProjects ? 'Done Reordering' : 'Reorder Projects'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Named inline rather than in a sheet, as creating from a task form
          already does. */}
      {adding && (
        <View style={styles.addRow}>
          <HandwritingTextInput
            ref={newItemInputRef}
            style={styles.addInput}
            value={newName}
            onChangeText={setNewName}
            placeholder={
              adding === 'area'
                ? 'New area name'
                : adding === 'resource'
                ? 'New resource name'
                : // Says where it will land, because a project quietly filed
                  // under nothing is the thing that goes missing.
                  selectedArea
                  ? `New project in ${selectedArea.name}`
                  : 'New project name'
            }
            placeholderTextColor="#707070"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={styles.topBtn}
            disabled={addingBusy}
            onPress={() => void (async () => {
              const name = (newItemInputRef.current?.getValue() ?? newName).trim();
              if (name) {
                setAddingBusy(true);
                try {
                  if (adding === 'project') await onNewProject(name, selectedArea?.id);
                  else if (adding === 'area') await onNewArea(name);
                  else await onNewResource(name);
                } finally {
                  setAddingBusy(false);
                }
              }
              setNewName('');
              setAdding(null);
            })()}
          >
            <Text allowFontScaling={false} style={styles.topBtnText}>
              {addingBusy ? 'Creating…' : 'Add'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.topBtn}
            onPress={() => {
              setNewName('');
              setAdding(null);
            }}
          >
            <Text allowFontScaling={false} style={styles.topBtnText}>
              Cancel
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.columns}>
        <View style={styles.leftPane}>
          <Text allowFontScaling={false} style={styles.paneHeading}>PARA</Text>
          <ScrollView style={styles.paneScroll} keyboardShouldPersistTaps="always">
            <TouchableOpacity
              style={[styles.areaRow, showProjects && !selectedItemId && styles.areaRowActive]}
              onPress={() => toggleSection('projects')}
            >
              <Text allowFontScaling={false} style={[styles.areaText, showProjects && !selectedItemId && styles.areaTextActive]}>
                {expanded.projects ? '▾' : '▸'} 🚀 Projects ({activeProjects(projects).length})
              </Text>
            </TouchableOpacity>
            {expanded.projects && activeProjects(projects).map(project => (
              <TouchableOpacity
                key={project.id}
                style={[styles.treeRow, showProjects && selectedProjectId === project.id && styles.treeRowActive]}
                onPress={() => {
                  setSection('projects');
                  setSelectedItemId(project.id);
                }}
              >
                <Text
                  allowFontScaling={false}
                  style={[styles.treeRowText, showProjects && selectedProjectId === project.id && styles.areaTextActive]}
                  numberOfLines={1}
                >
                  └ {project.name}
                </Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={[styles.areaRow, showAreas && !selectedItemId && styles.areaRowActive]}
              onPress={() => toggleSection('areas')}
            >
              <Text allowFontScaling={false} style={[styles.areaText, showAreas && !selectedItemId && styles.areaTextActive]}>
                {expanded.areas ? '▾' : '▸'} 🌐 Areas ({activeAreas.length})
              </Text>
            </TouchableOpacity>
            {expanded.areas && counts.map(({ area, count }) => {
              const active = showAreas && selectedAreaId === area.id;
              return (
                <TouchableOpacity
                  key={area.id}
                  style={[styles.treeRow, active && styles.treeRowActive]}
                  onPress={() => {
                    setSection('areas');
                    setSelectedItemId(area.id);
                    closeAreaEditor();
                  }}
                >
                  <Text allowFontScaling={false} style={[styles.treeRowText, active && styles.areaTextActive]} numberOfLines={1}>
                    └ {area.icon ? `${area.icon} ` : ''}{area.name} ({count})
                  </Text>
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity
              style={[styles.areaRow, showResources && !selectedItemId && styles.areaRowActive]}
              onPress={() => toggleSection('resources')}
            >
              <Text allowFontScaling={false} style={[styles.areaText, showResources && !selectedItemId && styles.areaTextActive]}>
                {expanded.resources ? '▾' : '▸'} 📚 Resources ({resources.filter(item => !item.archived).length})
              </Text>
            </TouchableOpacity>
            {expanded.resources && resources.filter(item => !item.archived).map(resource => {
              const active = showResources && selectedResourceId === resource.id;
              return (
                <TouchableOpacity
                  key={resource.id}
                  style={[styles.treeRow, active && styles.treeRowActive]}
                  onPress={() => {
                    setSection('resources');
                    setSelectedItemId(resource.id);
                  }}
                >
                  <Text allowFontScaling={false} style={[styles.treeRowText, active && styles.areaTextActive]} numberOfLines={1}>
                    └ {resource.icon ? `${resource.icon} ` : ''}{resource.name}
                  </Text>
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity
              style={[styles.areaRow, showArchive && !selectedItemId && styles.areaRowActive]}
              onPress={() => toggleSection('archive')}
            >
              <Text allowFontScaling={false} style={[styles.areaText, showArchive && !selectedItemId && styles.areaTextActive]}>
                {expanded.archive ? '▾' : '▸'} 📦 Archive
              </Text>
            </TouchableOpacity>
            {expanded.archive && (['projects', 'areas', 'resources'] as const).map(kind => {
              const count = kind === 'projects'
                ? archivedProjects(projects).length
                : kind === 'areas'
                ? areas.filter(area => area.archived).length
                : resources.filter(resource => resource.archived).length;
              const active = showArchive && selectedItemId === kind;
              const label = kind.charAt(0).toUpperCase() + kind.slice(1);
              return (
                <TouchableOpacity
                  key={kind}
                  style={[styles.treeRow, active && styles.treeRowActive]}
                  onPress={() => {
                    setSection('archive');
                    setSelectedItemId(kind);
                  }}
                >
                  <Text allowFontScaling={false} style={[styles.treeRowText, active && styles.areaTextActive]}>
                    └ {label} ({count})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.rightPane}>
          <Text allowFontScaling={false} style={styles.paneHeading}>
            {showArchive
              ? selectedItemId
                ? `📦 Archive · ${selectedItemId.charAt(0).toUpperCase() + selectedItemId.slice(1)}`
                : '📦 Archive'
              : showResources
              ? selectedResource ? `📚 ${selectedResource.name}` : '📚 Resources'
              : showAreas
              ? selectedArea ? `🌐 ${selectedArea.name}` : '🌐 Areas'
              : selectedProject ? `🚀 ${selectedProject.name}` : '🚀 Projects'}
          </Text>

          <ScrollView style={styles.paneScroll} keyboardShouldPersistTaps="always">
            {showAreas && !selectedArea && activeAreas.length === 0 && (
              <Text allowFontScaling={false} style={styles.empty}>
                No active Areas. Areas are ongoing parts of life or work that do not have a finish line.
              </Text>
            )}

            {showAreas && !selectedArea && counts.map(({ area, count }) => (
              <TouchableOpacity
                key={area.id}
                style={styles.projectCard}
                onPress={() => setSelectedItemId(area.id)}
              >
                <View style={styles.projectHead}>
                  <Text allowFontScaling={false} style={styles.projectName}>
                    {area.icon ? `${area.icon} ` : ''}{area.name}
                  </Text>
                  <Text allowFontScaling={false} style={styles.projectMeta}>
                    {count} active project{count === 1 ? '' : 's'}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}

            {showAreas && selectedArea && (
              <View style={styles.projectCard}>
                {editingAreaId === selectedArea.id ? (
                  <>
                    <View style={styles.areaEditRow}>
                      <TouchableOpacity style={styles.iconBtn} onPress={() => setIconOpen(open => !open)}>
                        <Text allowFontScaling={false} style={styles.iconBtnText}>{selectedArea.icon || '+'}</Text>
                      </TouchableOpacity>
                      <HandwritingTextInput
                        ref={editAreaInputRef}
                        style={styles.areaInput}
                        value={editName}
                        onChangeText={setEditName}
                        autoCorrect={false}
                      />
                    </View>
                    {iconOpen && (
                      <View style={styles.iconStrip}>
                        {ICON_CHOICES.map(icon => (
                          <TouchableOpacity
                            key={icon}
                            style={styles.iconChoice}
                            onPress={() => {
                              const name = editAreaInputRef.current?.getValue() ?? editName;
                              onRenameArea(selectedArea.id, name.trim() || selectedArea.name, icon);
                              setIconOpen(false);
                            }}
                          >
                            <Text allowFontScaling={false} style={styles.iconChoiceText}>{icon}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                    <View style={styles.areaEditRow}>
                      <TouchableOpacity
                        style={styles.rowBtn}
                        onPress={() => {
                          const next = (editAreaInputRef.current?.getValue() ?? editName).trim();
                          if (next) onRenameArea(selectedArea.id, next, selectedArea.icon);
                          closeAreaEditor();
                        }}
                      >
                        <Text allowFontScaling={false} style={styles.rowBtnText}>Save</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.rowBtn} onPress={() => {
                        setEditingAreaId(null);
                        setConfirmingAreaId(selectedArea.id);
                      }}>
                        <Text allowFontScaling={false} style={styles.rowBtnText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : confirmingAreaId === selectedArea.id ? (
                  <>
                    <Text allowFontScaling={false} style={styles.areaConfirmText}>
                      Delete “{selectedArea.name}”? Its {areaTaskCount(selectedArea.id)} task(s) and projects will be kept but unfiled.
                    </Text>
                    <View style={styles.areaEditRow}>
                      <TouchableOpacity style={styles.rowBtn} onPress={() => {
                        onDeleteArea(selectedArea.id);
                        setSelectedItemId(null);
                        closeAreaEditor();
                      }}>
                        <Text allowFontScaling={false} style={styles.rowBtnText}>Delete Area</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.rowBtn} onPress={() => setConfirmingAreaId(null)}>
                        <Text allowFontScaling={false} style={styles.rowBtnText}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : confirmingArchiveAreaId === selectedArea.id ? (
                  <>
                    <Text allowFontScaling={false} style={styles.areaConfirmText}>
                      What should happen to the active Projects in “{selectedArea.name}”?
                    </Text>
                    <View style={styles.areaEditRow}>
                      <TouchableOpacity style={styles.rowBtn} onPress={() => {
                        onArchiveArea(selectedArea, false);
                        closeAreaEditor();
                      }}>
                        <Text allowFontScaling={false} style={styles.rowBtnText}>Keep Projects Active</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.rowBtn} onPress={() => {
                        onArchiveArea(selectedArea, true);
                        closeAreaEditor();
                      }}>
                        <Text allowFontScaling={false} style={styles.rowBtnText}>Archive Projects Too</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.rowBtn} onPress={() => setConfirmingArchiveAreaId(null)}>
                        <Text allowFontScaling={false} style={styles.rowBtnText}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <>
                    <View style={styles.projectHead}>
                      <Text allowFontScaling={false} style={styles.projectName}>
                        {selectedArea.icon ? `${selectedArea.icon} ` : ''}{selectedArea.name}
                      </Text>
                      <TouchableOpacity style={styles.projectDueBtn} onPress={() => {
                        setEditingAreaId(selectedArea.id);
                        setEditName(selectedArea.name);
                      }}>
                        <Text allowFontScaling={false} style={styles.projectDueText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.projectDueBtn} onPress={() => setConfirmingArchiveAreaId(selectedArea.id)}>
                        <Text allowFontScaling={false} style={styles.projectDueText}>Archive</Text>
                      </TouchableOpacity>
                    </View>
                    <Text allowFontScaling={false} style={styles.projectMeta}>
                      Ongoing Area · {shown.length} active project{shown.length === 1 ? '' : 's'}
                    </Text>
                  </>
                )}
                {editingAreaId !== selectedArea.id &&
                  confirmingAreaId !== selectedArea.id &&
                  confirmingArchiveAreaId !== selectedArea.id && (
                    <ParaFilesPanel
                      itemKey={selectedArea.id}
                      folder={folderFor('area', selectedArea)}
                      onListEntries={folder => onListEntries('area', selectedArea, folder)}
                      onOpenFile={onOpenFile}
                      onNewNote={(name, folder) => onNewNote('area', selectedArea, name, folder)}
                      onChooseFolder={folder => onChooseFolder('area', selectedArea, folder)}
                    />
                  )}
              </View>
            )}

            {showAreas && selectedArea && shown.map(project => (
              <TouchableOpacity key={project.id} style={styles.projectCard} onPress={() => onOpenProject(project)}>
                <View style={styles.projectHead}>
                  <Text allowFontScaling={false} style={styles.projectName}>{project.name}</Text>
                  <Text allowFontScaling={false} style={styles.projectMeta}>
                    {projectProgress(tasks, project.id, lookup).percent}%
                  </Text>
                </View>
              </TouchableOpacity>
            ))}

            {showAreas && selectedArea && selectedAreaTasks.length > 0 && (
              <View style={styles.projectCard}>
                <Text allowFontScaling={false} style={styles.groupHeading}>Area Tasks</Text>
                {selectedAreaTasks.map((task, idx) => (
                  <View key={task.uid} style={styles.taskRow}>
                    <Text allowFontScaling={false} style={styles.treeStem}>
                      {idx === selectedAreaTasks.length - 1 ? '└─' : '├─'}
                    </Text>
                    <TouchableOpacity onPress={() => onToggleTask(task)}>
                      <Text allowFontScaling={false} style={styles.taskGlyph}>
                        {statusGlyph(taskStatus(task))}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.taskBody} onPress={() => onEditTask(task)}>
                      <Text
                        allowFontScaling={false}
                        numberOfLines={1}
                        style={[styles.taskText, isDone(task) && styles.taskTextDone]}
                      >
                        {task.title}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {showAreas && selectedArea && selectedAreaEvents.length > 0 && (
              <View style={styles.projectCard}>
                <Text allowFontScaling={false} style={styles.groupHeading}>Upcoming Area Events</Text>
                {selectedAreaEvents.map((event, idx) => (
                  <TouchableOpacity
                    key={`${event.uid}-${event.start.toISOString()}`}
                    style={styles.taskRow}
                    onPress={() => onEditEvent(event)}
                  >
                    <Text allowFontScaling={false} style={styles.treeStem}>
                      {idx === selectedAreaEvents.length - 1 ? '└─' : '├─'}
                    </Text>
                    <View style={styles.taskBody}>
                      <Text allowFontScaling={false} numberOfLines={1} style={styles.taskText}>
                        {event.summary}
                      </Text>
                      <Text allowFontScaling={false} style={styles.projectItemMeta}>
                        {event.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {showProjects && shown.length === 0 && (
              <Text allowFontScaling={false} style={styles.empty}>
                {selectedAreaId
                  ? 'No active projects in this area.'
                  : 'No active projects. An area never finishes; a project does.'}
              </Text>
            )}

            {showProjects && (
              <View>
                {shown.map((project, projectIndex) => {
                  const progress = projectProgress(tasks, project.id, lookup);
                  const { openTasks, completedTasks, upcomingEvents: projectEvents } = projectOverviewItems(
                    project.id,
                    tasks,
                    events,
                    projectOf,
                    projectOfEvent
                  );
                  const overdue = projectOverdue(project);
                  const projectArea = areas.find(candidate => candidate.id === project.areaId);

                  return (
                    <View key={project.id} style={styles.projectCard}>
                      <View style={styles.projectHead}>
                        {reorderProjects && (
                          <View style={styles.reorderBtns}>
                            <TouchableOpacity
                              style={[styles.reorderBtn, projectIndex === 0 && styles.reorderBtnDisabled]}
                              disabled={projectIndex === 0}
                              onPress={() => onMoveProject(project, 'up')}
                            >
                              <Text allowFontScaling={false} style={[styles.reorderBtnText, projectIndex === 0 && styles.reorderBtnTextDisabled]}>↑</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.reorderBtn, projectIndex === shown.length - 1 && styles.reorderBtnDisabled]}
                              disabled={projectIndex === shown.length - 1}
                              onPress={() => onMoveProject(project, 'down')}
                            >
                              <Text allowFontScaling={false} style={[styles.reorderBtnText, projectIndex === shown.length - 1 && styles.reorderBtnTextDisabled]}>↓</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                        <TouchableOpacity
                          style={styles.projectNameBtn}
                          onPress={() => onOpenProject(project)}
                        >
                          <Text allowFontScaling={false} style={styles.projectName} numberOfLines={1}>
                            {project.name}
                          </Text>
                          <Text allowFontScaling={false} style={styles.projectAreaMeta} numberOfLines={1}>
                            {projectArea
                              ? `Area: ${projectArea.icon ? `${projectArea.icon} ` : ''}${projectArea.name}`
                              : 'No Area'}
                          </Text>
                        </TouchableOpacity>

                        {/* Due lives on the card, where projects are actually
                            looked at — and the shared picker cannot open from
                            the manage sheet, which is itself a modal. */}
                        <TouchableOpacity
                          style={styles.projectDueBtn}
                          onPress={() => onSetProjectDue(project)}
                        >
                          <Text allowFontScaling={false} style={styles.projectDueText}>
                            {project.dueDate
                              ? `${overdue ? '⚠ ' : '📅 '}${project.dueDate.toLocaleDateString(
                                  'en-US',
                                  { month: 'short', day: 'numeric' }
                                )}`
                              : '📅 Due…'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.projectNoteBtn} onPress={() => {
                          onArchiveProject(project);
                        }}>
                          <Text allowFontScaling={false} style={styles.projectNoteText}>Archive</Text>
                        </TouchableOpacity>
                      </View>

                      <View style={styles.projectMetaRow}>
                        <Text allowFontScaling={false} style={styles.projectMeta}>
                          {progressBar(progress.percent)} {progress.done}/{progress.total} tasks (
                          {progress.percent}%)
                        </Text>
                      </View>

                      <View style={useProjectColumns ? styles.projectWorkColumns : styles.projectWorkStack}>
                        <View style={[styles.projectWorkColumn, useProjectColumns && styles.projectWorkColumnOpen]}>
                          <Text allowFontScaling={false} style={styles.projectColumnHeading}>OPEN &amp; UPCOMING</Text>
                          {openTasks.length === 0 && projectEvents.length === 0 ? (
                            <Text allowFontScaling={false} style={styles.projectColumnEmpty}>Nothing open.</Text>
                          ) : null}
                          {openTasks.map(task => (
                            <View key={task.uid} style={styles.projectItemRow}>
                              <TouchableOpacity onPress={() => onToggleTask(task)}>
                                <Text allowFontScaling={false} style={styles.taskGlyph}>{statusGlyph(taskStatus(task))}</Text>
                              </TouchableOpacity>
                              <TouchableOpacity style={styles.taskBody} onPress={() => onEditTask(task)}>
                                <Text allowFontScaling={false} numberOfLines={1} style={styles.projectItemText}>{task.title}</Text>
                                {task.dueDate ? (
                                  <Text allowFontScaling={false} style={styles.projectItemMeta}>
                                    {task.dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  </Text>
                                ) : null}
                              </TouchableOpacity>
                            </View>
                          ))}
                          {projectEvents.map(event => (
                            <TouchableOpacity key={`${event.uid}-${event.start.toISOString()}`} style={styles.projectItemRow} onPress={() => onEditEvent(event)}>
                              <Text allowFontScaling={false} style={styles.eventGlyph}>○</Text>
                              <View style={styles.taskBody}>
                                <Text allowFontScaling={false} numberOfLines={1} style={styles.projectItemText}>{event.summary}</Text>
                                <Text allowFontScaling={false} style={styles.projectItemMeta}>
                                  {event.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  {event.allDay ? ' · All day' : ` · ${formatDateTime(event.start, timeFormat)}`}
                                </Text>
                              </View>
                            </TouchableOpacity>
                          ))}
                          <TouchableOpacity style={styles.addTaskRow} onPress={() => onAddTaskToProject(project)}>
                            <Text allowFontScaling={false} style={styles.addTaskText}>+ Add task…</Text>
                          </TouchableOpacity>
                        </View>

                        <View style={styles.projectWorkColumn}>
                          <Text allowFontScaling={false} style={styles.projectColumnHeading}>COMPLETED ({completedTasks.length})</Text>
                          {completedTasks.length === 0 ? (
                            <Text allowFontScaling={false} style={styles.projectColumnEmpty}>Nothing completed yet.</Text>
                          ) : completedTasks.slice(0, 3).map(task => (
                            <View key={task.uid} style={styles.projectItemRow}>
                              <TouchableOpacity onPress={() => onToggleTask(task)}>
                                <Text allowFontScaling={false} style={styles.taskGlyph}>{statusGlyph(taskStatus(task))}</Text>
                              </TouchableOpacity>
                              <TouchableOpacity style={styles.taskBody} onPress={() => onEditTask(task)}>
                                <Text allowFontScaling={false} numberOfLines={1} style={[styles.projectItemText, styles.taskTextDone]}>{task.title}</Text>
                              </TouchableOpacity>
                            </View>
                          ))}
                          {completedTasks.length > 3 ? (
                            <TouchableOpacity onPress={() => onOpenProject(project)}>
                              <Text allowFontScaling={false} style={styles.viewCompletedText}>View all {completedTasks.length} completed ›</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      </View>
                      {selectedProjectId === project.id && (
                        <ParaFilesPanel
                          itemKey={project.id}
                          folder={folderFor('project', project)}
                          onListEntries={folder => onListEntries('project', project, folder)}
                          onOpenFile={onOpenFile}
                          onNewNote={(name, folder) => onNewNote('project', project, name, folder)}
                          onChooseFolder={folder => onChooseFolder('project', project, folder)}
                        />
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {showResources && resources.filter(item => !item.archived).length === 0 && (
              <Text allowFontScaling={false} style={styles.empty}>
                No active resources. Resources are reference topics with folders of files, not work to complete.
              </Text>
            )}
            {showResources && resources
              .filter(item => !item.archived && (!selectedResourceId || item.id === selectedResourceId))
              .map(resource => {
              const editing = editingResourceId === resource.id;
              if (!selectedResourceId) {
                return (
                  <TouchableOpacity
                    key={resource.id}
                    style={styles.projectCard}
                    onPress={() => setSelectedItemId(resource.id)}
                  >
                    <View style={styles.projectHead}>
                      <Text allowFontScaling={false} style={styles.projectName}>
                        {resource.icon ? `${resource.icon} ` : '📚 '}{resource.name}
                      </Text>
                      <Text allowFontScaling={false} style={styles.projectMeta} numberOfLines={1}>
                        📁 {resource.folder ? resource.folder.split('/').pop() : 'New folder'}
                      </Text>
                    </View>
                    {resource.description ? (
                      <Text allowFontScaling={false} style={styles.projectMeta}>{resource.description}</Text>
                    ) : null}
                  </TouchableOpacity>
                );
              }
              return (
              <View key={resource.id} style={styles.projectCard}>
                {editing ? (
                  <>
                    <HandwritingTextInput
                      ref={resourceNameInputRef}
                      style={styles.areaInput}
                      value={resourceName}
                      onChangeText={setResourceName}
                      placeholder="Resource name"
                      placeholderTextColor="#707070"
                    />
                    <HandwritingTextInput
                      ref={resourceDescriptionInputRef}
                      style={[styles.areaInput, styles.resourceDescriptionInput]}
                      value={resourceDescription}
                      onChangeText={setResourceDescription}
                      placeholder="What reference material belongs here?"
                      placeholderTextColor="#707070"
                      multiline
                    />
                    <View style={styles.iconStrip}>
                      {ICON_CHOICES.map(icon => (
                        <TouchableOpacity key={icon} style={styles.iconChoice} onPress={() => setResourceIcon(icon)}>
                          <Text allowFontScaling={false} style={styles.iconChoiceText}>{resourceIcon === icon ? `✓${icon}` : icon}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TouchableOpacity
                      style={styles.projectNoteBtn}
                      onPress={() => {
                        const name = (resourceNameInputRef.current?.getValue() ?? resourceName).trim();
                        const description = resourceDescriptionInputRef.current?.getValue() ?? resourceDescription;
                        if (name) onUpdateResource({
                          ...resource,
                          name,
                          description: description.trim() || undefined,
                          icon: resourceIcon || undefined,
                        });
                        setEditingResourceId(null);
                      }}
                    >
                      <Text allowFontScaling={false} style={styles.projectNoteText}>Save Resource</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                <View style={styles.projectHead}>
                  <Text allowFontScaling={false} style={styles.projectName} numberOfLines={1}>
                    {resource.icon ? `${resource.icon} ` : '📚 '}{resource.name}
                  </Text>
                  <TouchableOpacity
                    style={styles.projectDueBtn}
                    onPress={() => {
                      setEditingResourceId(resource.id);
                      setResourceName(resource.name);
                      setResourceDescription(resource.description || '');
                      setResourceIcon(resource.icon || '');
                    }}
                  >
                    <Text allowFontScaling={false} style={styles.projectDueText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.projectDueBtn} onPress={() => {
                    onArchiveResource(resource);
                    setSelectedItemId(null);
                  }}>
                    <Text allowFontScaling={false} style={styles.projectDueText}>Archive</Text>
                  </TouchableOpacity>
                </View>
                {resource.description ? (
                  <Text allowFontScaling={false} style={styles.projectMeta}>{resource.description}</Text>
                ) : null}
                <ParaFilesPanel
                  itemKey={resource.id}
                  folder={folderFor('resource', resource)}
                  onListEntries={folder => onListEntries('resource', resource, folder)}
                  onOpenFile={onOpenFile}
                  onNewNote={(name, folder) => onNewNote('resource', resource, name, folder)}
                  onChooseFolder={folder => onChooseFolder('resource', resource, folder)}
                />
                  </>
                )}
              </View>
              );
            })}

            {showArchive &&
              !selectedItemId &&
              archivedProjects(projects).length === 0 &&
              areas.filter(area => area.archived).length === 0 &&
              resources.filter(resource => resource.archived).length === 0 && (
                <Text allowFontScaling={false} style={styles.empty}>Nothing is archived or completed yet.</Text>
              )}

            {showArchive && selectedItemId === 'projects' && archivedProjects(projects).length === 0 && (
              <Text allowFontScaling={false} style={styles.empty}>No archived or finished Projects.</Text>
            )}
            {showArchive && (!selectedItemId || selectedItemId === 'projects') && archivedProjects(projects).length > 0 && (
              <Text allowFontScaling={false} style={styles.groupHeading}>Projects</Text>
            )}
            {showArchive && (!selectedItemId || selectedItemId === 'projects') && archivedProjects(projects).map(project => (
              <View key={project.id} style={styles.projectCard}>
                <View style={styles.projectHead}>
                  <Text allowFontScaling={false} style={styles.projectName} numberOfLines={1}>{project.name}</Text>
                  <Text allowFontScaling={false} style={styles.projectMeta}>
                    {project.status === 'done' ? 'Finished' : 'Archived'}
                  </Text>
                  <TouchableOpacity style={styles.projectNoteBtn} onPress={() => onBrowseFiles('project', project)}>
                    <Text allowFontScaling={false} style={styles.projectNoteText}>📂 Files</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.projectDueBtn} onPress={() => onRestoreProject(project)}>
                    <Text allowFontScaling={false} style={styles.projectDueText}>Restore</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            {showArchive && selectedItemId === 'areas' && areas.filter(area => area.archived).length === 0 && (
              <Text allowFontScaling={false} style={styles.empty}>No archived Areas.</Text>
            )}
            {showArchive && (!selectedItemId || selectedItemId === 'areas') && areas.filter(area => area.archived).length > 0 && (
              <Text allowFontScaling={false} style={styles.groupHeading}>Areas</Text>
            )}
            {showArchive && (!selectedItemId || selectedItemId === 'areas') && areas.filter(area => area.archived).map(area => (
              <View key={area.id} style={styles.projectCard}>
                <View style={styles.projectHead}>
                  <Text allowFontScaling={false} style={styles.projectName}>{area.icon ? `${area.icon} ` : ''}{area.name}</Text>
                  <TouchableOpacity style={styles.projectNoteBtn} onPress={() => onBrowseFiles('area', area)}>
                    <Text allowFontScaling={false} style={styles.projectNoteText}>📂 Files</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.projectDueBtn} onPress={() => onRestoreArea(area)}>
                    <Text allowFontScaling={false} style={styles.projectDueText}>Restore</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            {showArchive && selectedItemId === 'resources' && resources.filter(resource => resource.archived).length === 0 && (
              <Text allowFontScaling={false} style={styles.empty}>No archived Resources.</Text>
            )}
            {showArchive && (!selectedItemId || selectedItemId === 'resources') && resources.filter(resource => resource.archived).length > 0 && (
              <Text allowFontScaling={false} style={styles.groupHeading}>Resources</Text>
            )}
            {showArchive && (!selectedItemId || selectedItemId === 'resources') && resources.filter(resource => resource.archived).map(resource => (
              <View key={resource.id} style={styles.projectCard}>
                <View style={styles.projectHead}>
                  <Text allowFontScaling={false} style={styles.projectName}>{resource.icon ? `${resource.icon} ` : '📚 '}{resource.name}</Text>
                  <TouchableOpacity style={styles.projectNoteBtn} onPress={() => onBrowseFiles('resource', resource)}>
                    <Text allowFontScaling={false} style={styles.projectNoteText}>📂 Files</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.projectDueBtn} onPress={() => onRestoreResource(resource)}>
                    <Text allowFontScaling={false} style={styles.projectDueText}>Restore</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

/**
 * Progress as blocks rather than a drawn bar.
 *
 * A View-based bar renders as a grey smear on e-ink at these widths; solid
 * block characters stay legible and cost nothing to repaint.
 */
function progressBar(percent: number): string {
  const filled = Math.round((percent / 100) * 5);
  return '█'.repeat(filled) + '░'.repeat(5 - filled);
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: '#000000',
    paddingBottom: 6,
    marginBottom: 6,
  },
  topTitle: { fontSize: 15, fontWeight: 'bold', color: '#000000' },
  topActions: { flexDirection: 'row' },
  topBtn: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginLeft: 6,
    backgroundColor: '#ffffff',
  },
  topBtnText: { fontSize: 12, fontWeight: 'bold', color: '#000000' },
  topBtnActive: { backgroundColor: '#e0e0e0' },
  areaTap: { flex: 1 },
  areaEditLink: { fontSize: 11, fontWeight: 'bold', color: '#000000', paddingLeft: 6 },
  areaEditing: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    padding: 6,
    marginBottom: 4,
    backgroundColor: '#ffffff',
  },
  areaEditRow: { flexDirection: 'row', alignItems: 'center' },
  areaInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
    fontSize: 12,
    color: '#000000',
  },
  resourceDescriptionInput: { minHeight: 52, textAlignVertical: 'top', marginTop: 5 },
  iconBtn: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 6,
  },
  iconBtnText: { fontSize: 14, color: '#000000' },
  iconStrip: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 4 },
  iconChoice: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginRight: 4,
    marginBottom: 4,
  },
  iconChoiceText: { fontSize: 14, color: '#000000' },
  areaConfirm: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    padding: 6,
    marginBottom: 4,
    backgroundColor: '#ffffff',
  },
  areaConfirmText: { fontSize: 11, color: '#000000', marginBottom: 6 },
  rowBtn: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
    marginTop: 6,
  },
  rowBtnText: { fontSize: 11, fontWeight: 'bold', color: '#000000' },
  addRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  addInput: {
    flex: 1,
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginRight: 6,
    fontSize: 13,
    color: '#000000',
  },
  columns: { flex: 1, flexDirection: 'row' },
  leftPane: {
    width: '32%',
    borderRightWidth: 2,
    borderRightColor: '#000000',
    paddingRight: 8,
  },
  rightPane: { flex: 1, paddingLeft: 10 },
  paneHeading: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000000',
    backgroundColor: '#e8e8e8',
    paddingVertical: 3,
    paddingHorizontal: 6,
    marginBottom: 4,
    marginTop: 4,
  },
  paneScroll: { flex: 1 },
  areaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingVertical: 7,
    paddingHorizontal: 8,
    marginBottom: 4,
    backgroundColor: '#ffffff',
  },
  areaRowActive: { backgroundColor: '#000000' },
  areaText: { fontSize: 14, fontWeight: 'bold', color: '#000000' },
  areaTextActive: { color: '#ffffff' },
  treeRow: {
    marginLeft: 12,
    paddingVertical: 7,
    paddingHorizontal: 7,
    marginBottom: 2,
    borderRadius: 4,
  },
  treeRowActive: { backgroundColor: '#000000' },
  treeRowText: { fontSize: 13, color: '#202020' },
  groupHeading: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#303030',
    marginTop: 6,
    marginBottom: 2,
  },
  projectCard: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
    backgroundColor: '#ffffff',
  },
  projectHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reorderBtns: { flexDirection: 'row', marginRight: 6 },
  reorderBtn: { minWidth: 34, minHeight: 34, borderWidth: 1, borderColor: '#000000', alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  reorderBtnText: { fontSize: 20, fontWeight: 'bold', color: '#000000' },
  reorderBtnDisabled: { borderColor: '#a0a0a0' },
  reorderBtnTextDisabled: { color: '#a0a0a0' },
  projectNameBtn: { flex: 1, paddingRight: 6 },
  projectName: { fontSize: 16, fontWeight: 'bold', color: '#000000' },
  projectAreaMeta: { fontSize: 13, color: '#404040', marginTop: 2 },
  projectDueBtn: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginLeft: 6,
  },
  projectDueText: { fontSize: 12, fontWeight: 'bold', color: '#000000' },
  projectNoteBtn: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginLeft: 6,
  },
  projectNoteText: { fontSize: 12, fontWeight: 'bold', color: '#000000' },
  treeStem: { fontSize: 11, color: '#606060', marginRight: 4 },
  projectMeta: { fontSize: 12, color: '#303030', marginTop: 4 },
  projectMetaRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: 5 },
  projectWorkColumns: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#000000' },
  projectWorkStack: { flexDirection: 'column', borderTopWidth: 1, borderTopColor: '#000000' },
  projectWorkColumn: { flex: 2, paddingHorizontal: 8, paddingVertical: 7 },
  projectWorkColumnOpen: { flex: 3, borderRightWidth: 1, borderRightColor: '#000000' },
  projectColumnHeading: { fontSize: 13, fontWeight: 'bold', color: '#000000', marginBottom: 4 },
  projectColumnEmpty: { fontSize: 12, color: '#505050', paddingVertical: 5 },
  projectItemRow: { flexDirection: 'row', alignItems: 'center', minHeight: 42, borderBottomWidth: 1, borderBottomColor: '#d0d0d0', paddingVertical: 4 },
  projectItemText: { fontSize: 14, color: '#000000' },
  projectItemMeta: { fontSize: 12, color: '#404040', marginTop: 2 },
  eventGlyph: { width: 23, fontSize: 17, fontWeight: 'bold', color: '#000000' },
  viewCompletedText: { fontSize: 12, fontWeight: 'bold', color: '#000000', paddingVertical: 8 },
  taskRow: { flexDirection: 'row', alignItems: 'center', marginTop: 5 },
  taskGlyph: { fontSize: 16, color: '#000000', marginRight: 7 },
  taskBody: { flex: 1 },
  taskText: { fontSize: 14, color: '#000000' },
  taskTextDone: { textDecorationLine: 'line-through', color: '#606060' },
  addTaskRow: { marginTop: 6 },
  addTaskText: { fontSize: 11, color: '#505050' },
  empty: { fontSize: 12, color: '#505050', paddingVertical: 14 },
});
