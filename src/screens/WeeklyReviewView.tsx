import { LinkedFileMarker } from './LinkedFileMarker';
import { DayPlannerSections, PlannerSection } from './DayPlannerSections';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CalendarTask, Project } from '../domain/types';
import { projectDisplayLabel } from '../domain/projectLabel';
import { ProjectWeek, projectsNeedingAttention, weeklyTaskSummary } from '../domain/plannerReview';
import { projectProgress } from '../domain/taskListView';

interface WeeklyReviewViewProps {
  isNomad?: boolean;
  selectedDate: Date;
  weekStartsOn: number;
  tasks: CalendarTask[];
  projects: Project[];
  projectOf: (uid: string) => string | undefined;
  journalDates: Date[];
  /** Each active project's week: what is due, scheduled, and written. */
  projectWeeks: ProjectWeek[];
  onOpenFile: (path: string) => void;
  weeklyNoteExists: boolean | null;
  onOpenWeeklyNote: () => void;
  onEditTask: (task: CalendarTask) => void;
  onOpenProject: (project: Project) => void;
  onOpenJournal: (date: Date) => void;
}

function blocks(percent: number): string {
  const filled = Math.round((percent / 100) * 5);
  return '█'.repeat(filled) + '░'.repeat(5 - filled);
}

export function WeeklyReviewView({
  isNomad = false,
  selectedDate,
  weekStartsOn,
  tasks,
  projects,
  projectOf,
  journalDates,
  projectWeeks,
  onOpenFile,
  weeklyNoteExists,
  onOpenWeeklyNote,
  onEditTask,
  onOpenProject,
  onOpenJournal,
}: WeeklyReviewViewProps): React.JSX.Element {
  const summary = weeklyTaskSummary(tasks, selectedDate, new Date(), weekStartsOn);
  const attention = projectsNeedingAttention(projects, tasks, projectOf, selectedDate, 5);
  const deadlines = [...summary.due].sort((a, b) =>
    (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0)
  );

  const header = (<>
      <View style={styles.noteCard}>
        <View style={styles.noteCopy}>
          <Text allowFontScaling={false} style={styles.noteTitle}>📝 Weekly Review Note</Text>
          <Text allowFontScaling={false} style={styles.noteHint}>
            Reflect and plan in a normal handwritten Supernote note.
          </Text>
        </View>
        <TouchableOpacity style={styles.primaryBtn} onPress={onOpenWeeklyNote}>
          <Text allowFontScaling={false} style={styles.primaryBtnText}>
            {weeklyNoteExists === false ? 'Create Note' : 'Open Note'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionHeader}>
        <Text allowFontScaling={false} style={styles.sectionHeaderText}>THIS WEEK</Text>
      </View>
      <View style={styles.metrics}>
        <View style={styles.metric}><Text allowFontScaling={false} style={styles.metricValue}>{summary.completed.length}</Text><Text allowFontScaling={false} style={styles.metricLabel}>Completed</Text></View>
        <View style={styles.metric}><Text allowFontScaling={false} style={styles.metricValue}>{summary.due.length}</Text><Text allowFontScaling={false} style={styles.metricLabel}>Open due</Text></View>
        <View style={[styles.metric, styles.metricLast]}><Text allowFontScaling={false} style={styles.metricValue}>{summary.overdue.length}</Text><Text allowFontScaling={false} style={styles.metricLabel}>Overdue now</Text></View>
      </View>

  </>);
  return (
    <DayPlannerSections enabled={isNomad} weekly header={header}>
      <PlannerSection id="thisweek" title="This Week by Project" summary={`${projectWeeks.length} project(s)`}>
      {!isNomad && (<View style={styles.sectionHeader}>
        <Text allowFontScaling={false} style={styles.sectionHeaderText}>THIS WEEK BY PROJECT</Text>
      </View>)}
      {projectWeeks.length === 0 ? (
        <Text allowFontScaling={false} style={styles.empty}>No project has tasks, events, or linked notes this week.</Text>
      ) : projectWeeks.map(({ project, due, events, notes, week }) => (
        <View key={project.id} style={styles.weekProject}>
          <TouchableOpacity style={styles.weekProjectHead} onPress={() => onOpenProject(project)}>
            <Text allowFontScaling={false} style={styles.rowTitle} numberOfLines={1}>
              {`🚀 ${project.name}${week ? ` · Week ${week}` : ''}`}
            </Text>
            <Text allowFontScaling={false} style={styles.openText}>Open ›</Text>
          </TouchableOpacity>
          {due.map(task => (
            <TouchableOpacity key={task.uid} style={styles.weekItem} onPress={() => onEditTask(task)}>
              <Text allowFontScaling={false} style={styles.dateText}>
                {`☐ ${task.dueDate?.toLocaleDateString('en-US', { weekday: 'short' }) ?? ''}`}
              </Text>
              <Text allowFontScaling={false} style={styles.weekItemText} numberOfLines={1}>{task.title}</Text>
            </TouchableOpacity>
          ))}
          {events.slice(0, 4).map(event => (
            <View key={`${event.uid}-${event.start.getTime()}`} style={styles.weekItem}>
              <Text allowFontScaling={false} style={styles.dateText}>
                {`📅 ${event.start.toLocaleDateString('en-US', { weekday: 'short' })}`}
              </Text>
              <Text allowFontScaling={false} style={styles.weekItemText} numberOfLines={1}>{event.summary}</Text>
            </View>
          ))}
          {events.length > 4 && (
            <Text allowFontScaling={false} style={styles.weekMore}>{`+${events.length - 4} more event(s)`}</Text>
          )}
          {notes.map(note => (
            <TouchableOpacity key={note.path} style={styles.weekItem} onPress={() => onOpenFile(note.path)}>
              <Text allowFontScaling={false} style={styles.dateText}>📝 Note</Text>
              <Text allowFontScaling={false} style={styles.weekItemText} numberOfLines={1}>{note.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ))}
      </PlannerSection>
      <PlannerSection id="projects" title="Project Check-In" summary={`${attention.length} project(s)`}>
      {!isNomad && (<View style={styles.sectionHeader}>
        <Text allowFontScaling={false} style={styles.sectionHeaderText}>PROJECT CHECK-IN</Text>
      </View>)}
      {attention.length === 0 ? (
        <Text allowFontScaling={false} style={styles.empty}>No projects need attention this week.</Text>
      ) : attention.map(project => {
        const progress = projectProgress(tasks, project.id, { projectOf, nameOf: () => project.name });
        const open = tasks.filter(task => projectOf(task.uid) === project.id && !task.completed);
        const next = [...open].sort((a, b) =>
          (a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY) -
          (b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY)
        )[0];
        return (
          <TouchableOpacity key={project.id} style={styles.projectRow} onPress={() => onOpenProject(project)}>
            <View style={styles.rowBody}>
              <Text allowFontScaling={false} style={styles.rowTitle} numberOfLines={1}>{project.name}</Text>
              <Text allowFontScaling={false} style={styles.rowDetail} numberOfLines={1}>
                {next && <LinkedFileMarker item={next} />}
                {next
                  ? `Next: ${next.title}${next.dueDate ? ` · ${next.dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}`
                  : 'No next task assigned'}
              </Text>
            </View>
            <Text allowFontScaling={false} style={styles.progress}>{blocks(progress.percent)} {progress.done}/{progress.total}</Text>
          </TouchableOpacity>
        );
      })}

      </PlannerSection>
      <PlannerSection id="deadlines" title="Upcoming Deadlines" summary={`${deadlines.length} open deadline(s)`}>
      {!isNomad && (<View style={styles.sectionHeader}>
        <Text allowFontScaling={false} style={styles.sectionHeaderText}>UPCOMING DEADLINES</Text>
      </View>)}
      {deadlines.length === 0 ? (
        <Text allowFontScaling={false} style={styles.empty}>No open tasks are due this week.</Text>
      ) : deadlines.map(task => {
        const project = projects.find(candidate => candidate.id === projectOf(task.uid));
        return (
        <TouchableOpacity key={task.uid} style={styles.deadlineRow} onPress={() => onEditTask(task)}>
          <Text allowFontScaling={false} style={styles.dateText}>
            {task.dueDate?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </Text>
          <Text allowFontScaling={false} style={styles.rowTitle} numberOfLines={1}>
            {project ? `${projectDisplayLabel(project)} — ` : ''}<LinkedFileMarker item={task} />{task.title}
          </Text>
          <Text allowFontScaling={false} style={styles.openText}>Edit ›</Text>
        </TouchableOpacity>
        );
      })}

      </PlannerSection>
      <PlannerSection id="journal" title="Daily Journal Notes" summary={`${journalDates.length} journal note(s)`}>
      {!isNomad && (<View style={styles.sectionHeader}>
        <Text allowFontScaling={false} style={styles.sectionHeaderText}>DAILY JOURNAL NOTES</Text>
      </View>)}
      {journalDates.length === 0 ? (
        <Text allowFontScaling={false} style={styles.empty}>No daily journal notes found for this week.</Text>
      ) : journalDates.map(date => (
        <TouchableOpacity key={date.toISOString()} style={styles.journalRow} onPress={() => onOpenJournal(date)}>
          <Text allowFontScaling={false} style={styles.dateText}>
            {date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </Text>
          <Text allowFontScaling={false} style={styles.rowTitle}>Daily Journal</Text>
          <Text allowFontScaling={false} style={styles.openText}>Open ›</Text>
        </TouchableOpacity>
      ))}
      </PlannerSection>
    </DayPlannerSections>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    padding: 12,
    marginBottom: 10,
  },
  noteCopy: { flex: 1, marginRight: 12 },
  noteTitle: { fontSize: 17, fontWeight: 'bold', color: '#000000' },
  noteHint: { fontSize: 13, color: '#303030', marginTop: 3 },
  primaryBtn: { backgroundColor: '#000000', borderRadius: 5, paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  primaryBtnText: { color: '#ffffff', fontSize: 13, fontWeight: 'bold' },
  sectionHeader: { backgroundColor: '#e8e8e8', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#000000', paddingHorizontal: 9, paddingVertical: 7, marginTop: 8 },
  sectionHeaderText: { color: '#000000', fontSize: 14, fontWeight: 'bold' },
  metrics: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#000000' },
  metric: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRightWidth: 1, borderRightColor: '#000000' },
  metricLast: { borderRightWidth: 0 },
  metricValue: { fontSize: 23, fontWeight: 'bold', color: '#000000' },
  metricLabel: { fontSize: 12, color: '#202020', marginTop: 2 },
  projectRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 9, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#c0c0c0' },
  deadlineRow: { flexDirection: 'row', alignItems: 'center', minHeight: 46, paddingHorizontal: 9, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#c0c0c0' },
  journalRow: { flexDirection: 'row', alignItems: 'center', minHeight: 46, paddingHorizontal: 9, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#c0c0c0' },
  rowBody: { flex: 1, marginRight: 10 },
  rowTitle: { flex: 1, fontSize: 14, fontWeight: 'bold', color: '#000000' },
  rowDetail: { fontSize: 12, color: '#303030', marginTop: 2 },
  progress: { fontSize: 12, color: '#000000' },
  dateText: { width: 82, fontSize: 13, color: '#000000' },
  openText: { fontSize: 12, fontWeight: 'bold', color: '#000000', marginLeft: 8 },
  empty: { fontSize: 13, color: '#404040', paddingHorizontal: 9, paddingVertical: 10 },
  weekProject: { borderBottomWidth: 1, borderBottomColor: '#c0c0c0', paddingBottom: 6 },
  weekProjectHead: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 9 },
  weekItem: { flexDirection: 'row', alignItems: 'center', minHeight: 36, paddingLeft: 21, paddingRight: 9 },
  weekItemText: { flex: 1, fontSize: 13, color: '#000000' },
  weekMore: { fontSize: 12, color: '#404040', paddingLeft: 21, paddingVertical: 4 },
});
