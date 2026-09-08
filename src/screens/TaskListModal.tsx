import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Area, CalendarTask, Project } from '../domain/types';
import { statusGlyph, taskRowLabel, taskStatus } from '../domain/taskModel';
import {
  TASK_GROUPINGS,
  TASK_SCOPES,
  TaskGrouping,
  TaskScope,
  countGrouped,
  filterByArea,
  activeProjects,
  filterByProject,
  filterByScope,
  groupTasks,
  groupingLabel,
  projectProgress,
  projectsInArea,
  scopeLabel,
} from '../domain/taskListView';

interface TaskListModalProps {
  visible: boolean;
  tasks: CalendarTask[];
  areas: Area[];
  /** Area membership by task uid; it lives outside the task itself. */
  areaOf: (uid: string) => string | undefined;
  projects: Project[];
  projectOf: (uid: string) => string | undefined;
  onClose: () => void;
  onToggle: (task: CalendarTask) => void;
  onEdit: (task: CalendarTask) => void;
  notePathFor: (uid: string) => string | undefined;
  onLinkNote?: (task: CalendarTask) => void;
  onNoteAction: (task: CalendarTask, existingPath?: string) => void;
}

/**
 * Every task in one place, which is where status and priority finally become
 * useful — until now they were a glyph on rows scattered across the Day View
 * and the month strip.
 *
 * Driven entirely by discrete taps. This display ghosts badly on frequent
 * redraws, so there is no search-as-you-type: you pick a scope and a grouping,
 * and the list repaints once.
 */
export function TaskListModal({
  visible,
  tasks,
  areas,
  areaOf,
  projects,
  projectOf,
  onClose,
  onToggle,
  onEdit,
  notePathFor,
  onNoteAction,
  onLinkNote,
}: TaskListModalProps): React.JSX.Element {
  const [scope, setScope] = useState<TaskScope>('open');
  const [grouping, setGrouping] = useState<TaskGrouping>('due');
  const [areaId, setAreaId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  const lookup = {
    areaOf,
    nameOf: (id: string) => areas.find(a => a.id === id)?.name || 'Area',
  };
  const projectLookup = {
    projectOf,
    nameOf: (id: string) => projects.find(p => p.id === id)?.name || 'Project',
  };

  const scoped = filterByProject(
    filterByArea(filterByScope(tasks, scope), areaId, lookup),
    projectId,
    projectLookup
  );

  const groups = groupTasks(scoped, grouping, new Date(), lookup, projectLookup);
  const total = countGrouped(groups);

  /**
   * Filtering to one area makes grouping by area pointless — every row would
   * land in a single heading — so the grouping steps aside.
   */
  const chooseArea = (next: string | null) => {
    setAreaId(next);
    if (next && grouping === 'area') setGrouping('due');
    // A project filter from another area would silently show nothing.
    if (projectId && next && !projects.some(p => p.id === projectId && p.areaId === next)) {
      setProjectId(null);
    }
  };

  const chooseProject = (next: string | null) => {
    setProjectId(next);
    if (next && grouping === 'project') setGrouping('due');
  };

  /**
   * Only the projects belonging to the selected area.
   *
   * This is the hierarchy made visible: pick ENG 102 and you are offered its
   * projects, not every project you have. Without it, Areas and Projects are
   * two parallel lists and choosing between them is arbitrary.
   */
  const offeredProjects = projectsInArea(activeProjects(projects), areaId);

  /**
   * Says which filter emptied the list.
   *
   * "Nothing here" is true but unhelpful — a project with no area disappears
   * the moment an area is selected, and the list going quiet gives no clue
   * that a filter did it.
   */
  const emptyReason = (() => {
    if (projectId) {
      const name = projects.find(p => p.id === projectId)?.name;
      return `No ${scopeLabel(scope).toLowerCase()} tasks in ${name || 'this project'}.`;
    }
    if (areaId) {
      const name = areas.find(a => a.id === areaId)?.name;
      return `No ${scopeLabel(scope).toLowerCase()} tasks in ${name || 'this area'}.`;
    }
    return `Nothing ${scopeLabel(scope).toLowerCase()}.`;
  })();

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text allowFontScaling={false} style={styles.headerTitle}>
              ☑ All Tasks ({total})
            </Text>
            {/* Centred and named for what it opens. Tucked beside Close and
                labelled "Areas" it read as part of the dismiss controls, and
                said nothing about projects living there too. */}
            <TouchableOpacity onPress={onClose}>
              <Text allowFontScaling={false} style={styles.close}>
                ✕ Close
              </Text>
            </TouchableOpacity>
          </View>

          <Text allowFontScaling={false} style={styles.filterLabel}>
            Show
          </Text>
          <View style={styles.chipRow}>
            {TASK_SCOPES.map(s => (
              <TouchableOpacity
                key={s}
                style={[styles.chip, scope === s && styles.chipActive]}
                onPress={() => setScope(s)}
              >
                <Text
                  allowFontScaling={false}
                  style={[styles.chipText, scope === s && styles.chipTextActive]}
                >
                  {scopeLabel(s)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text allowFontScaling={false} style={styles.filterLabel}>
            Group by
          </Text>
          <View style={styles.chipRow}>
            {TASK_GROUPINGS.map(g => (
              <TouchableOpacity
                key={g}
                style={[styles.chip, grouping === g && styles.chipActive]}
                onPress={() => setGrouping(g)}
              >
                <Text
                  allowFontScaling={false}
                  style={[styles.chipText, grouping === g && styles.chipTextActive]}
                >
                  {groupingLabel(g)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {areas.length > 0 && (
            <>
              <Text allowFontScaling={false} style={styles.filterLabel}>
                Area
              </Text>
              <View style={styles.chipRow}>
                <TouchableOpacity
                  style={[styles.chip, areaId === null && styles.chipActive]}
                  onPress={() => chooseArea(null)}
                >
                  <Text
                    allowFontScaling={false}
                    style={[styles.chipText, areaId === null && styles.chipTextActive]}
                  >
                    All
                  </Text>
                </TouchableOpacity>

                {areas
                  .filter(a => !a.archived)
                  .map(a => (
                    <TouchableOpacity
                      key={a.id}
                      style={[styles.chip, areaId === a.id && styles.chipActive]}
                      onPress={() => chooseArea(a.id)}
                    >
                      <Text
                        allowFontScaling={false}
                        style={[styles.chipText, areaId === a.id && styles.chipTextActive]}
                      >
                        {a.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
              </View>
            </>
          )}

          {offeredProjects.length > 0 && (
            <>
              <Text allowFontScaling={false} style={styles.filterLabel}>
                Project
              </Text>
              <View style={styles.chipRow}>
                <TouchableOpacity
                  style={[styles.chip, projectId === null && styles.chipActive]}
                  onPress={() => chooseProject(null)}
                >
                  <Text
                    allowFontScaling={false}
                    style={[styles.chipText, projectId === null && styles.chipTextActive]}
                  >
                    All
                  </Text>
                </TouchableOpacity>

                {offeredProjects.map(p => {
                  const progress = projectProgress(tasks, p.id, projectLookup);
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.chip, projectId === p.id && styles.chipActive]}
                      onPress={() => chooseProject(p.id)}
                    >
                      <Text
                        allowFontScaling={false}
                        style={[styles.chipText, projectId === p.id && styles.chipTextActive]}
                      >
                        {p.name} {progress.done}/{progress.total}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {groups.length === 0 ? (
              <Text allowFontScaling={false} style={styles.empty}>
                {emptyReason}
              </Text>
            ) : (
              groups.map(group => (
                <View key={group.key}>
                  {group.label ? (
                    <Text allowFontScaling={false} style={styles.groupHeading}>
                      {group.label} ({group.tasks.length})
                    </Text>
                  ) : null}

                  {group.tasks.map(task => {
                    const notePath = notePathFor(task.uid);
                    return (
                    <View key={task.uid} style={styles.row}>
                      <TouchableOpacity onPress={() => onToggle(task)} style={styles.check}>
                        <Text allowFontScaling={false} style={styles.checkText}>
                          {statusGlyph(taskStatus(task))}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity style={styles.rowBody} onPress={() => onEdit(task)}>
                        <Text
                          allowFontScaling={false}
                          numberOfLines={1}
                          style={[styles.rowText, task.completed && styles.rowTextDone]}
                        >
                          {taskRowLabel(task, true)}
                        </Text>
                      </TouchableOpacity>

                      {!notePath && onLinkNote && (
                        <TouchableOpacity style={styles.noteButton} onPress={() => onLinkNote(task)}>
                          <Text allowFontScaling={false} style={styles.noteButtonText}>Link Note</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={styles.noteButton}
                        onPress={() => onNoteAction(task, notePath)}
                        accessibilityLabel={notePath ? `Open note for ${task.title}` : `Create note for ${task.title}`}
                      >
                        <Text allowFontScaling={false} style={styles.noteButtonText}>
                          {notePath ? '📂 Open Note' : '📝 Create Note'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    );
                  })}
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 8,
    padding: 12,
    width: '88%',
    maxHeight: '86%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: '#000000',
    paddingBottom: 6,
    marginBottom: 6,
  },
  headerTitle: { fontSize: 16, fontWeight: 'bold', color: '#000000' },
  close: { fontSize: 14, fontWeight: 'bold', color: '#000000', marginLeft: 12 },
  manageBtn: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: '#ffffff',
  },
  manageText: { fontSize: 12, fontWeight: 'bold', color: '#000000' },
  filterLabel: { fontSize: 11, fontWeight: 'bold', color: '#505050', marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  chip: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginRight: 5,
    marginTop: 4,
    backgroundColor: '#ffffff',
  },
  chipActive: { backgroundColor: '#000000' },
  chipText: { fontSize: 12, fontWeight: 'bold', color: '#000000' },
  chipTextActive: { color: '#ffffff' },
  list: { marginTop: 6 },
  groupHeading: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#000000',
    backgroundColor: '#e8e8e8',
    paddingVertical: 3,
    paddingHorizontal: 6,
    marginTop: 8,
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#d0d0d0',
    paddingVertical: 7,
  },
  check: { paddingHorizontal: 6, paddingVertical: 2 },
  checkText: { fontSize: 16, color: '#000000' },
  rowBody: { flex: 1, paddingRight: 4 },
  rowText: { fontSize: 13, color: '#000000' },
  rowTextDone: { textDecorationLine: 'line-through', color: '#606060' },
  noteButton: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 4,
    marginLeft: 4,
  },
  noteButtonText: { fontSize: 11, fontWeight: 'bold', color: '#000000' },
  empty: { fontSize: 13, color: '#505050', textAlign: 'center', paddingVertical: 20 },
});
