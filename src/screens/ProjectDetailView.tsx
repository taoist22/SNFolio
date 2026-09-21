import { designationLabel, EventDesignation, ProjectCategory, projectEventDesignation } from '../domain/eventDesignation';
import { LinkedFileMarker } from './LinkedFileMarker';
import { classWeekCount, classWeekNumber, classWeekRange, classWeekStartDay, currentWeekFolderName, isInsideFolder, linkCaption, LinkedFileEntry, pathKey, visibleWeekNumbers, weekFolderName } from '../domain/linkedFileWeeks';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekdayDate = (date: Date) => date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
import React from 'react';
import { Dimensions, LayoutChangeEvent, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Area, CalendarEvent, CalendarTask, Project } from '../domain/types';
import { isDone, statusGlyph, taskStatus } from '../domain/taskModel';
import { projectOverdue, projectProgress, ProjectLookup } from '../domain/taskListView';
import { ParaFilesPanel } from './ParaFilesPanel';
import { ParaFolderEntry } from '../supernote/exportService';
import { HandwritingTextInput, HandwritingTextInputHandle } from './HandwritingTextInput';
import { deriveProjectShortLabel, normalizeProjectShortLabel } from '../domain/projectLabel';

const DELIVERABLE_PREVIEW_LIMIT = 4;
/** Width at which files and deliverables sit side by side; PARA's own columns use the same. */
const TWO_COLUMN_WIDTH = 1000;
const UPCOMING_LIMIT = 5;

function upcomingWhen(event: CalendarEvent): string {
  const day = event.start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  if (event.allDay) return day;
  const time = event.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
}

interface DeliverableTaskRowProps {
  task: CalendarTask;
  index: number;
  total: number;
  onToggle: (task: CalendarTask) => void;
  onEdit: (task: CalendarTask) => void;
}

function DeliverableTaskRow({
  task,
  index,
  total,
  onToggle,
  onEdit,
}: DeliverableTaskRowProps): React.JSX.Element {
  return (
    <View style={styles.taskRow}>
      <Text allowFontScaling={false} style={styles.stem}>
        {index === total - 1 ? '└─' : '├─'}
      </Text>
      <TouchableOpacity onPress={() => onToggle(task)}>
        <Text allowFontScaling={false} style={styles.glyph}>
          {statusGlyph(taskStatus(task))}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.taskBody} onPress={() => onEdit(task)}>
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={[styles.taskText, isDone(task) && styles.taskDone]}
        >
          <LinkedFileMarker item={task} />{task.title}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

interface ProjectDetailViewProps {
  project: Project;
  area?: Area;
  areas: Area[];
  tasks: CalendarTask[];
  projectOf: (uid: string) => string | undefined;
  /** Notes and PDFs linked to this project's events and tasks, wherever they are stored, with each item's date. */
  linkedNotes: LinkedFileEntry[];
  /** First day of the week (0 = Sunday), used for a class without its own week start. */
  weekStartsOn: number;
  onSetClassStart: () => void;
  /** Creates Week 01 … Week NN in the project folder, from the class start to the due date. */
  onCreateWeekFolders: () => void;
  /** Sets the weekday a class week begins; undefined means the class start date's weekday. */
  onSetClassWeekStart: (day?: number) => void;
  /** One notebook per recurring series, or one note per session. */
  onSetRecurringNotes: (mode: 'series' | 'session') => void;
  /** Saves the comma-separated words that file calendar items under this project; blank turns it off. */
  onSetAutoFileMatch: (words: string) => void;
  /** This project's upcoming events, soonest first. */
  upcomingEvents: CalendarEvent[];
  onOpenEvent: (event: CalendarEvent) => void;
  /** Moves a file (and its annotation files) into another folder, updating SNFolio's links; rejects with a message. */
  onMoveFile: (path: string, destinationFolder: string) => Promise<void>;
  /** Changes when the project's files change outside the panel, so it reads them again. */
  filesRevision?: number;
  onBack: () => void;
  onSetDue: () => void;
  /** Assigns the project directly to the selected Area, or removes its Area. */
  onAssignArea: (areaId?: string) => void;
  onCreateArea: (name: string) => string | undefined;
  /** A project is renamed, finished and deleted here, where it lives. */
  onUpdateClassification: (category: ProjectCategory, defaultKind?: EventDesignation) => void;
  onRename: (name: string, shortLabel?: string) => void;
  onToggleStatus: () => void;
  onArchive: () => void;
  /** Repairs a PARA classification without deleting and recreating files. */
  onConvertToArea: () => void;
  onDelete: () => void;
  folder: string;
  onListEntries: (folder: string) => Promise<ParaFolderEntry[]>;
  onNewNote: (name: string, folder: string) => Promise<void>;
  onChooseFolder: (folder: string) => Promise<void>;
  onOpenFile: (path: string) => void;
  onOpenNote: (path: string) => void;
  onAddTask: () => void;
  onToggleTask: (task: CalendarTask) => void;
  onEditTask: (task: CalendarTask) => void;
}

/**
 * One project: what it is for, how far along, what is written about it, and
 * what is left to do.
 *
 * The notebooks are the reason this screen exists rather than being a filtered
 * task list. A project that holds only tasks is a to-do list with a name.
 */
export function ProjectDetailView({
  project,
  area,
  areas,
  tasks,
  projectOf,
  linkedNotes,
  weekStartsOn,
  onSetClassStart,
  onCreateWeekFolders,
  onSetClassWeekStart,
  onMoveFile,
  onSetRecurringNotes,
  onSetAutoFileMatch,
  upcomingEvents,
  onOpenEvent,
  filesRevision = 0,
  onBack,
  onSetDue,
  onAssignArea,
  onCreateArea,
  onRename,
  onUpdateClassification,
  onToggleStatus,
  onArchive,
  onConvertToArea,
  onDelete,
  folder,
  onListEntries,
  onNewNote,
  onChooseFolder,
  onOpenFile,
  onOpenNote,
  onAddTask,
  onToggleTask,
  onEditTask,
}: ProjectDetailViewProps): React.JSX.Element {
  const lookup: ProjectLookup = { projectOf, nameOf: () => project.name };
  const progress = projectProgress(tasks, project.id, lookup);
  const mine = tasks.filter(t => projectOf(t.uid) === project.id);
  const actionableDeliverables = mine.filter(task => !isDone(task));
  const completedDeliverables = mine
    .filter(isDone)
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
  const overdue = projectOverdue(project);

  const [classificationOpen, setClassificationOpen] = React.useState(false);
  const [renaming, setRenaming] = React.useState<boolean>(false);
  const [draftName, setDraftName] = React.useState<string>(project.name);
  const [draftShortLabel, setDraftShortLabel] = React.useState<string>(project.shortLabel || '');
  const draftNameInputRef = React.useRef<HandwritingTextInputHandle>(null);
  const draftShortLabelInputRef = React.useRef<HandwritingTextInputHandle>(null);
  const [confirmingDelete, setConfirmingDelete] = React.useState<boolean>(false);
  const [confirmingConversion, setConfirmingConversion] = React.useState<boolean>(false);
  const [confirmingComplete, setConfirmingComplete] = React.useState<boolean>(false);
  const [actionsOpen, setActionsOpen] = React.useState<boolean>(false);
  const [autoFileDraft, setAutoFileDraft] = React.useState(project.autoFileMatch || '');
  const autoFileInputRef = React.useRef<HandwritingTextInputHandle>(null);
  React.useEffect(() => { setAutoFileDraft(project.autoFileMatch || ''); }, [project.id, project.autoFileMatch]);
  // Start from the window width so the layout does not switch (and re-read the folder) on first layout.
  const [width, setWidth] = React.useState(() => Dimensions.get('window').width);
  const wide = width >= TWO_COLUMN_WIDTH;
  const [elsewhereOpen, setElsewhereOpen] = React.useState(false);
  // Move… on a file linked from outside the project folder: the project folder and its subfolders, with the linked item's week suggested.
  const [movingLinked, setMovingLinked] = React.useState<{ key: string; path: string } | null>(null);
  const [moveTargets, setMoveTargets] = React.useState<string[]>([]);
  const [moveBusy, setMoveBusy] = React.useState(false);
  const [moveMessage, setMoveMessage] = React.useState('');
  const projectRoot = folder.replace(/\/+$/, '');
  const startMove = async (key: string, path: string) => {
    if (movingLinked?.key === key) { setMovingLinked(null); return; }
    setMovingLinked({ key, path });
    setMoveMessage('');
    setMoveTargets([projectRoot]);
    try {
      const entries = await onListEntries(projectRoot);
      setMoveTargets([projectRoot, ...entries.filter(entry => entry.isFolder).map(entry => entry.path.replace(/\/+$/, ''))]);
    } catch (e: any) {
      setMoveMessage(e?.message || 'Could not read the project folder.');
    }
  };
  const moveLinked = async (path: string, target: string) => {
    setMoveBusy(true);
    setMoveMessage('');
    try {
      await onMoveFile(path, target);
      setMovingLinked(null);
    } catch (e: any) {
      setMoveMessage(e?.message || 'Could not move the file.');
    } finally {
      setMoveBusy(false);
    }
  };
  const suggestedFolder = (path: string): string | undefined => {
    if (!project.classStartDate) return undefined;
    const dates = linkedNotes.filter(note => pathKey(note.path) === pathKey(path) && note.date).map(note => note.date as Date);
    if (!dates.length) return undefined;
    const week = classWeekNumber(dates[0], project.classStartDate, classWeekStartDay(project.classStartDate, project.classWeekStartsOn));
    return week >= 1 ? `${projectRoot}/${weekFolderName(week)}` : undefined;
  };
  const linkedFileRows = (files: Array<{ label: string; path: string }>, keyPrefix: string) => files.map(note => {
    const key = `${keyPrefix}-${note.path}`;
    const parent = note.path.slice(0, note.path.lastIndexOf('/'));
    const suggested = suggestedFolder(note.path);
    const caption = linkCaption(linkedNotes, note.path);
    return (
      <View key={key}>
        <View style={styles.linkedRow}>
          <TouchableOpacity style={styles.linkedOpen} onPress={() => onOpenNote(note.path)}>
            <Text allowFontScaling={false} style={styles.noteLabel} numberOfLines={1}>
              {`📄 ${note.label}  🔗`}
            </Text>
            {Boolean(caption) && (
              <Text allowFontScaling={false} style={styles.caption} numberOfLines={1}>{`↳ ${caption}`}</Text>
            )}
            <Text allowFontScaling={false} style={styles.caption} numberOfLines={1}>{parent}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkedMove} onPress={() => void startMove(key, note.path)}>
            <Text allowFontScaling={false} style={styles.headBtnText}>Move…</Text>
          </TouchableOpacity>
        </View>
        {movingLinked?.key === key && (
          <View style={styles.confirmRow}>
            <Text allowFontScaling={false} style={styles.confirmText}>
              Move {note.label} to a folder in this project. Its links in SNFolio follow it; links inside other notes do not. Close it first if it is open.
            </Text>
            <View style={styles.classificationRow}>
              {moveTargets.filter(target => target !== parent)
                .sort((a, b) => Number(b === suggested) - Number(a === suggested))
                .map(target => (
                  <TouchableOpacity key={target} disabled={moveBusy} style={styles.headBtn} onPress={() => void moveLinked(note.path, target)}>
                    <Text allowFontScaling={false} style={styles.headBtnText}>
                      📁 {target === projectRoot ? 'Project folder' : target.split('/').pop()}{target === suggested ? ' (suggested)' : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              <TouchableOpacity disabled={moveBusy} style={styles.headBtn} onPress={() => setMovingLinked(null)}>
                <Text allowFontScaling={false} style={styles.headBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
            {suggested && !moveTargets.includes(suggested) && (
              <Text allowFontScaling={false} style={styles.hint}>
                Its week folder, {suggested.split('/').pop()}, does not exist yet. Create Week Folders under Project category first.
              </Text>
            )}
            {moveBusy && <Text allowFontScaling={false} style={styles.hint}>Moving…</Text>}
            {Boolean(moveMessage) && <Text allowFontScaling={false} style={styles.confirmText}>{moveMessage}</Text>}
          </View>
        )}
      </View>
    );
  });
  // A class's weeks follow its own week start, not the calendar's.
  const classWeekStart = project.classStartDate
    ? classWeekStartDay(project.classStartDate, project.classWeekStartsOn)
    : weekStartsOn;
  const weekCount = project.classStartDate && project.dueDate
    ? classWeekCount(project.classStartDate, project.dueDate, classWeekStart)
    : 0;
  const currentWeekFolder = project.classStartDate && project.dueDate
    ? currentWeekFolderName(new Date(), project.classStartDate, project.dueDate, classWeekStart)
    : undefined;
  const firstWeek = project.classStartDate ? classWeekRange(1, project.classStartDate, classWeekStart) : undefined;
  const lastWeek = project.classStartDate && weekCount > 0 ? classWeekRange(weekCount, project.classStartDate, classWeekStart) : undefined;
  const weekWindow = project.classStartDate && weekCount > 0
    ? visibleWeekNumbers(new Date(), project.classStartDate, weekCount, classWeekStart)
    : undefined;
  // Linked files already in the project folder show 🔗 in Project Files; the rest are listed separately.
  const elsewhere = linkedNotes.filter((note, index) =>
    !isInsideFolder(note.path, projectRoot)
    && linkedNotes.findIndex(other => pathKey(other.path) === pathKey(note.path)) === index);
  const [areaPickerOpen, setAreaPickerOpen] = React.useState<boolean>(false);
  const [addingArea, setAddingArea] = React.useState<boolean>(false);
  const [newAreaName, setNewAreaName] = React.useState<string>('');
  const newAreaInputRef = React.useRef<HandwritingTextInputHandle>(null);
  const [deliverablesView, setDeliverablesView] = React.useState<'actionable' | 'completed' | null>(null);

  const commitRename = () => {
    const next = (draftNameInputRef.current?.getValue() ?? draftName).trim();
    const nextShortLabel = normalizeProjectShortLabel(
      draftShortLabelInputRef.current?.getValue() ?? draftShortLabel
    );
    // A blank field is a mistake, not a request to lose the name.
    if (next) {
      onRename(next, nextShortLabel);
    }
    setRenaming(false);
  };

  if (deliverablesView) {
    const focusedTasks = deliverablesView === 'actionable'
      ? actionableDeliverables
      : completedDeliverables;
    const focusedTitle = deliverablesView === 'actionable'
      ? 'Actionable Deliverables'
      : 'Completed Deliverables';

    return (
      <View style={styles.root}>
        <View style={styles.focusedHeader}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setDeliverablesView(null)}>
            <Text allowFontScaling={false} style={styles.breadcrumb}>‹ Project</Text>
          </TouchableOpacity>
          <Text allowFontScaling={false} style={styles.focusedTitle} numberOfLines={1}>
            {focusedTitle} ({focusedTasks.length})
          </Text>
          {deliverablesView === 'actionable' && (
            <TouchableOpacity style={styles.addTaskBtn} onPress={onAddTask}>
              <Text allowFontScaling={false} style={styles.addTask}>+ Add Task</Text>
            </TouchableOpacity>
          )}
        </View>
        <ScrollView style={styles.focusedList} keyboardShouldPersistTaps="always">
          {focusedTasks.length === 0 && (
            <Text allowFontScaling={false} style={styles.hint}>
              {deliverablesView === 'actionable' ? 'Nothing to do yet.' : 'Nothing completed yet.'}
            </Text>
          )}
          {focusedTasks.map((task, index) => (
            <DeliverableTaskRow
              key={task.uid}
              task={task}
              index={index}
              total={focusedTasks.length}
              onToggle={onToggleTask}
              onEdit={onEditTask}
            />
          ))}
        </ScrollView>
      </View>
    );
  }

  // Files on the left and work on the right when there is room; stacked, work first, when there is not.
  const filesSection = (
    <>
      <Text allowFontScaling={false} style={styles.sectionHeading}>
        📁 Project Files
      </Text>
      <ParaFilesPanel
        itemKey={`${project.id}:${filesRevision}`}
        currentSubfolder={currentWeekFolder ? `${projectRoot}/${currentWeekFolder}` : undefined}
        weekWindow={weekWindow}
        linkCaption={path => linkCaption(linkedNotes, path)}
        onMoveFile={onMoveFile}
        folder={folder}
        onListEntries={onListEntries}
        onOpenFile={onOpenFile}
        onNewNote={onNewNote}
        onChooseFolder={onChooseFolder}
      />

      {elsewhere.length > 0 && (
        <>
          <TouchableOpacity style={styles.elsewhereHeader} onPress={() => setElsewhereOpen(value => !value)}
            accessibilityRole="button" accessibilityState={{ expanded: elsewhereOpen }}>
            <Text allowFontScaling={false} style={styles.elsewhereTitle}>
              {`${elsewhereOpen ? '▾' : '▸'} 🔗 Linked from elsewhere (${elsewhere.length})`}
            </Text>
          </TouchableOpacity>
          {elsewhereOpen && (
            <>
              <Text allowFontScaling={false} style={styles.hint}>
                Linked to this project's events and tasks, but stored outside its folder. Use Move… to bring one into this project.
              </Text>
              {linkedFileRows(elsewhere, 'elsewhere')}
            </>
          )}
        </>
      )}
    </>
  );
  const workSection = (
    <>
      <View style={styles.upcoming}>
        <Text allowFontScaling={false} style={styles.deliverableCardTitle}>
          {`📅 Upcoming (${upcomingEvents.length})`}
        </Text>
        {upcomingEvents.length === 0 && (
          <Text allowFontScaling={false} style={styles.hint}>
            No events filed under this project in the next 60 days.
          </Text>
        )}
        {upcomingEvents.slice(0, UPCOMING_LIMIT).map(event => (
          <TouchableOpacity key={`${event.uid}-${event.start.getTime()}`} style={styles.upcomingRow} onPress={() => onOpenEvent(event)}>
            <Text allowFontScaling={false} style={styles.upcomingWhen}>{upcomingWhen(event)}</Text>
            <Text allowFontScaling={false} style={styles.taskText} numberOfLines={1}>{event.summary}</Text>
          </TouchableOpacity>
        ))}
        {upcomingEvents.length > UPCOMING_LIMIT && (
          <Text allowFontScaling={false} style={styles.hint}>{`+${upcomingEvents.length - UPCOMING_LIMIT} more in the calendar`}</Text>
        )}
      </View>
      <View style={[styles.deliverableCards, wide && styles.deliverableCardsStacked]}>
        <View style={[styles.deliverableCard, wide ? styles.deliverableCardStacked : styles.deliverableCardFirst]}>
          <View style={styles.deliverableCardHeader}>
            <Text allowFontScaling={false} style={styles.deliverableCardTitle} numberOfLines={1}>
              ☑ Actionable Deliverables ({actionableDeliverables.length})
            </Text>
            <TouchableOpacity style={styles.addTaskBtn} onPress={onAddTask}>
              <Text allowFontScaling={false} style={styles.addTask}>+ Add Task</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.deliverablePreview}>
            {actionableDeliverables.length === 0 && (
              <Text allowFontScaling={false} style={styles.hint}>Nothing to do yet.</Text>
            )}
            {actionableDeliverables.slice(0, DELIVERABLE_PREVIEW_LIMIT).map((task, index) => (
              <DeliverableTaskRow
                key={task.uid}
                task={task}
                index={index}
                total={Math.min(actionableDeliverables.length, DELIVERABLE_PREVIEW_LIMIT)}
                onToggle={onToggleTask}
                onEdit={onEditTask}
              />
            ))}
          </View>
          {actionableDeliverables.length > 0 && (
            <TouchableOpacity style={styles.openDeliverablesBtn} onPress={() => setDeliverablesView('actionable')}>
              <Text allowFontScaling={false} style={styles.openDeliverablesText}>
                Open all {actionableDeliverables.length} ›
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.deliverableCard}>
          <View style={styles.deliverableCardHeader}>
            <Text allowFontScaling={false} style={styles.deliverableCardTitle} numberOfLines={1}>
              ✓ Completed Deliverables ({completedDeliverables.length})
            </Text>
          </View>
          <View style={styles.deliverablePreview}>
            {completedDeliverables.length === 0 && (
              <Text allowFontScaling={false} style={styles.hint}>Nothing completed yet.</Text>
            )}
            {completedDeliverables.slice(0, DELIVERABLE_PREVIEW_LIMIT).map((task, index) => (
              <DeliverableTaskRow
                key={task.uid}
                task={task}
                index={index}
                total={Math.min(completedDeliverables.length, DELIVERABLE_PREVIEW_LIMIT)}
                onToggle={onToggleTask}
                onEdit={onEditTask}
              />
            ))}
          </View>
          {completedDeliverables.length > 0 && (
            <TouchableOpacity style={styles.openDeliverablesBtn} onPress={() => setDeliverablesView('completed')}>
              <Text allowFontScaling={false} style={styles.openDeliverablesText}>
                Open all {completedDeliverables.length} ›
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      <View style={styles.actionsSection}>
        <TouchableOpacity style={styles.dueBtn} onPress={() => {
          setActionsOpen(value => !value);
          setConfirmingComplete(false);
          setConfirmingDelete(false);
          setConfirmingConversion(false);
        }}>
          <Text allowFontScaling={false} style={styles.dueText}>⚙ Project Actions…   {actionsOpen ? '▴ Close' : '▾'}</Text>
        </TouchableOpacity>
        {actionsOpen && (
          <View>
            {project.status === 'active' ? (
              <TouchableOpacity style={styles.actionRow} onPress={() => setConfirmingComplete(true)}>
                <Text allowFontScaling={false} style={styles.headBtnText}>☑ Mark Complete</Text>
                <Text allowFontScaling={false} style={styles.hint}>The project is done. Moves it to Archive, labeled Finished.</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.actionRow} onPress={onToggleStatus}>
                <Text allowFontScaling={false} style={styles.headBtnText}>Reopen</Text>
                <Text allowFontScaling={false} style={styles.hint}>Returns the project to the Projects list.</Text>
              </TouchableOpacity>
            )}
            {confirmingComplete && (
              <View style={styles.confirmRow}>
                <Text allowFontScaling={false} style={styles.confirmText}>
                  Mark "{project.name}" complete?{'\n'}
                  • It leaves the Projects list and appears in PARA → Archive → Projects, labeled Finished.{'\n'}
                  • Its {mine.length} task{mine.length === 1 ? '' : 's'}, events, linked files, and folder stay exactly as they are. Nothing is moved or deleted.{'\n'}
                  • Its due date, category, and settings are kept.{'\n'}
                  • To bring it back, open it in Archive and tap Reopen.
                </Text>
                <View style={styles.metaActions}>
                  <TouchableOpacity style={styles.headBtn} onPress={() => { setConfirmingComplete(false); onToggleStatus(); }}>
                    <Text allowFontScaling={false} style={styles.headBtnText}>Mark Complete</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.headBtn} onPress={() => setConfirmingComplete(false)}>
                    <Text allowFontScaling={false} style={styles.headBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            <TouchableOpacity style={styles.actionRow} onPress={onArchive}>
              <Text allowFontScaling={false} style={styles.headBtnText}>Archive</Text>
              <Text allowFontScaling={false} style={styles.hint}>Set aside without marking it done. You can also move its folder into your Archive folder.</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionRow} onPress={() => setConfirmingConversion(true)}>
              <Text allowFontScaling={false} style={styles.headBtnText}>Move to Areas</Text>
              <Text allowFontScaling={false} style={styles.hint}>Turn it into an ongoing Area.</Text>
            </TouchableOpacity>
            {confirmingConversion && (
              <View style={styles.confirmRow}>
                <Text allowFontScaling={false} style={styles.confirmText}>
                  Convert “{project.name}” to an ongoing Area? Its folder and filed items will be kept, but project due date and completion status will be removed.
                </Text>
                <View style={styles.metaActions}>
                  <TouchableOpacity style={styles.headBtn} onPress={onConvertToArea}>
                    <Text allowFontScaling={false} style={styles.headBtnText}>Convert to Area</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.headBtn} onPress={() => setConfirmingConversion(false)}>
                    <Text allowFontScaling={false} style={styles.headBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            <TouchableOpacity style={styles.actionRow} onPress={() => setConfirmingDelete(true)}>
              <Text allowFontScaling={false} style={styles.headBtnText}>Delete</Text>
              <Text allowFontScaling={false} style={styles.hint}>Remove the project from SNFolio. Its tasks and files are kept.</Text>
            </TouchableOpacity>
            {confirmingDelete && (
              <View style={styles.confirmRow}>
                <Text allowFontScaling={false} style={styles.confirmText}>
                  Delete "{project.name}"? Its {mine.length} task{mine.length === 1 ? '' : 's'} and any
                  notebooks are kept — only the project goes.
                </Text>
                <View style={styles.metaActions}>
                  <TouchableOpacity style={styles.headBtn} onPress={onDelete}>
                    <Text allowFontScaling={false} style={styles.headBtnText}>Delete</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.headBtn} onPress={() => setConfirmingDelete(false)}>
                    <Text allowFontScaling={false} style={styles.headBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}
      </View>
    </>
  );

  return (
    <View style={styles.root} onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}>
      <View style={styles.header}>
        <View style={styles.headerControls}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text allowFontScaling={false} style={styles.breadcrumb}>
            ‹ Back
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.areaBtn}
          activeOpacity={1}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPressIn={() => setAreaPickerOpen(true)}
        >
          <Text allowFontScaling={false} style={styles.areaBtnText} numberOfLines={1}>
            {area ? `${area.icon ? `${area.icon} ` : ''}${area.name}` : 'No Area'}  {areaPickerOpen ? '▴' : '▾'}
          </Text>
        </TouchableOpacity>
        </View>
        {renaming ? (
          <>
            <HandwritingTextInput
              ref={draftNameInputRef}
              style={styles.titleInput}
              value={draftName}
              onChangeText={setDraftName}
              placeholder="Project name"
              placeholderTextColor="#707070"
              autoCorrect={false}
            />
            <HandwritingTextInput
              ref={draftShortLabelInputRef}
              style={styles.shortLabelInput}
              value={draftShortLabel}
              onChangeText={setDraftShortLabel}
              placeholder={`Day label: ${deriveProjectShortLabel(draftName)}`}
              placeholderTextColor="#707070"
              autoCorrect={false}
            />
            <TouchableOpacity style={styles.headBtn} onPress={commitRename}>
              <Text allowFontScaling={false} style={styles.headBtnText}>
                Done
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text allowFontScaling={false} style={styles.title} numberOfLines={1}>
            🚀 {project.name}
          </Text>
        )}
      </View>

      {areaPickerOpen && (
        <View style={styles.areaPicker}>
          <Text allowFontScaling={false} style={styles.areaPickerTitle}>Assign Project to Area</Text>
          <View style={styles.areaOptions}>
            <TouchableOpacity
              style={[styles.areaOption, styles.areaOptionNoArea, !area && styles.areaOptionSelected]}
              onPress={() => { onAssignArea(undefined); setAreaPickerOpen(false); }}
            >
              <Text allowFontScaling={false} style={styles.areaOptionText}>{!area ? '● ' : '○ '}No Area</Text>
            </TouchableOpacity>
            {areas.filter(candidate => !candidate.archived).map(candidate => {
              const selected = candidate.id === area?.id;
              return (
                <TouchableOpacity
                  key={candidate.id}
                  style={[styles.areaOption, selected && styles.areaOptionSelected]}
                  onPress={() => { onAssignArea(candidate.id); setAreaPickerOpen(false); }}
                >
                  <Text allowFontScaling={false} style={styles.areaOptionText} numberOfLines={1}>
                    {selected ? '● ' : '○ '}{candidate.icon ? `${candidate.icon} ` : ''}{candidate.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {!addingArea && (
              <TouchableOpacity style={[styles.areaOption, styles.addAreaOption]} onPress={() => setAddingArea(true)}>
                <Text allowFontScaling={false} style={styles.areaOptionText}>＋ Add Area</Text>
              </TouchableOpacity>
            )}
          </View>
          {addingArea && (
            <View style={styles.addAreaRow}>
              <HandwritingTextInput
                ref={newAreaInputRef}
                style={styles.addAreaInput}
                value={newAreaName}
                onChangeText={setNewAreaName}
                placeholder="New Area name"
                placeholderTextColor="#707070"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={styles.addAreaButton}
                onPress={() => {
                  const name = (newAreaInputRef.current?.getValue() ?? newAreaName).trim();
                  if (!name) return;
                  const id = onCreateArea(name);
                  if (id) onAssignArea(id);
                  setNewAreaName('');
                  setAddingArea(false);
                  setAreaPickerOpen(false);
                }}
              >
                <Text allowFontScaling={false} style={styles.areaOptionText}>Add</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.addAreaButton} onPress={() => { setNewAreaName(''); setAddingArea(false); }}>
                <Text allowFontScaling={false} style={styles.areaOptionText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      <View>
        <TouchableOpacity style={styles.dueBtn} onPress={() => setClassificationOpen(value => !value)}>
          <Text allowFontScaling={false} style={styles.dueText}>
            Project settings: {project.category === 'class' ? 'Class' : project.category === 'work' ? 'Work' : 'General'} · {designationLabel(projectEventDesignation(project))}   {classificationOpen ? '▴ Close' : '▾ Change'}
          </Text>
        </TouchableOpacity>
        {classificationOpen && <View>
        <Text allowFontScaling={false} style={styles.areaOptionText}>Project category</Text>
        <View style={styles.classificationRow}>
          {(['general', 'class', 'work'] as ProjectCategory[]).map(category => (
            <TouchableOpacity key={category} style={styles.headBtn}
              accessibilityRole="button" accessibilityState={{ selected: (project.category || 'general') === category }}
              onPress={() => onUpdateClassification(category, project.defaultEventDesignation)}>
              <Text allowFontScaling={false} style={styles.areaOptionText}>
                {(project.category || 'general') === category ? '● ' : '○ '}{category === 'class' ? 'Class' : category === 'work' ? 'Work' : 'General'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text allowFontScaling={false} style={styles.areaOptionText}>Default calendar designation</Text>
        <View style={styles.classificationRow}>
          {(['auto', 'none', 'class', 'meeting'] as const).map(value => (
            <TouchableOpacity key={value} style={styles.headBtn}
              accessibilityRole="button" accessibilityState={{ selected: (project.defaultEventDesignation || 'auto') === value }}
              onPress={() => onUpdateClassification(project.category || 'general', value === 'auto' ? undefined : value)}>
              <Text allowFontScaling={false} style={styles.areaOptionText}>
                {(project.defaultEventDesignation || 'auto') === value ? '● ' : '○ '}
                {value === 'auto' ? 'Category default' : designationLabel(value)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text allowFontScaling={false} style={styles.dueText}>
          Events default to {designationLabel(projectEventDesignation(project))}. Each event can override this. Tasks show C when their project's events default to Class.
          {'\n'}[N] and [PDF] show linked files independently. Notes created directly in a Project need a link to a dated item to appear on the calendar.
        </Text>
        <Text allowFontScaling={false} style={styles.panelHeading}>Weeks</Text>
        <Text allowFontScaling={false} style={styles.areaOptionText}>Start date</Text>
        <View style={styles.classificationRow}>
          <TouchableOpacity style={styles.headBtn} onPress={onSetClassStart}>
            <Text allowFontScaling={false} style={styles.areaOptionText}>
              {project.classStartDate
                ? `📅 Starts ${project.classStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                : '📅 Set start date'}
            </Text>
          </TouchableOpacity>
        </View>
        {project.classStartDate && <>
          <Text allowFontScaling={false} style={styles.areaOptionText}>Weeks run</Text>
          <View style={styles.classificationRow}>
            <TouchableOpacity style={styles.headBtn}
              accessibilityRole="button" accessibilityState={{ selected: project.classWeekStartsOn === undefined }}
              onPress={() => onSetClassWeekStart(undefined)}>
              <Text allowFontScaling={false} style={styles.areaOptionText}>
                {project.classWeekStartsOn === undefined ? '● ' : '○ '}From start day ({DAY_NAMES[project.classStartDate.getDay()]})
              </Text>
            </TouchableOpacity>
            {[1, 2, 3, 4, 5, 6, 0].map(day => (
              <TouchableOpacity key={day} style={styles.headBtn}
                accessibilityRole="button" accessibilityState={{ selected: project.classWeekStartsOn === day }}
                onPress={() => onSetClassWeekStart(day)}>
                <Text allowFontScaling={false} style={styles.areaOptionText}>
                  {project.classWeekStartsOn === day ? '● ' : '○ '}{DAY_NAMES[day]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {firstWeek && (
            <Text allowFontScaling={false} style={styles.dueText}>
              Week 1: {weekdayDate(firstWeek.start)} – {weekdayDate(firstWeek.end)}
              {lastWeek && weekCount > 1 ? ` · ${weekCount} weeks, ending Week ${weekCount}: ${weekdayDate(lastWeek.start)} – ${weekdayDate(lastWeek.end)}` : ''}
            </Text>
          )}
        </>}
        <Text allowFontScaling={false} style={styles.areaOptionText}>Week folders</Text>
        {weekCount > 0 ? (
          <>
            <View style={styles.classificationRow}>
              <TouchableOpacity style={styles.headBtn} onPress={onCreateWeekFolders}>
                <Text allowFontScaling={false} style={styles.areaOptionText}>📁 Create Week Folders</Text>
              </TouchableOpacity>
            </View>
            <Text allowFontScaling={false} style={styles.dueText}>
              Creates {weekFolderName(1)} – {weekFolderName(weekCount)} in this project's folder, from the start date to the due date. Existing folders are kept. Last, this and next week are listed in Project Files; the rest are under All weeks. This week's section is open, and + New Note and Create Note on this project's events file notes in the week they belong to.
            </Text>
          </>
        ) : (
          <Text allowFontScaling={false} style={styles.dueText}>
            Set a start date and a due date (when the class, engagement or project ends) to create a folder for each week.
          </Text>
        )}
        <Text allowFontScaling={false} style={styles.areaOptionText}>Notes for recurring events</Text>
        <View style={styles.classificationRow}>
          {(['series', 'session'] as const).map(mode => (
            <TouchableOpacity key={mode} style={styles.headBtn}
              accessibilityRole="button" accessibilityState={{ selected: (project.recurringNotes || 'series') === mode }}
              onPress={() => onSetRecurringNotes(mode)}>
              <Text allowFontScaling={false} style={styles.areaOptionText}>
                {(project.recurringNotes || 'series') === mode ? '● ' : '○ '}{mode === 'series' ? 'One notebook for the series' : 'One note per session'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text allowFontScaling={false} style={styles.dueText}>
          {(project.recurringNotes || 'series') === 'series'
            ? 'A weekly lecture or standing meeting keeps one notebook, with a new page for each session.'
            : 'Each session gets its own dated note, filed in its week folder when this project has week folders. Notes already made keep their links.'}
        </Text>
        <Text allowFontScaling={false} style={styles.panelHeading}>Auto-file from calendars</Text>
        <Text allowFontScaling={false} style={styles.dueText}>
          Subscribed-calendar and CalDAV items whose title contains any of these words are filed under this project, unless you have already filed them elsewhere. Separate words with commas, e.g. IDS105, Acme.
        </Text>
        <View style={styles.addAreaRow}>
          <HandwritingTextInput
            ref={autoFileInputRef}
            style={styles.addAreaInput}
            value={autoFileDraft}
            onChangeText={setAutoFileDraft}
            placeholder="Words in the item title"
            placeholderTextColor="#707070"
            autoCorrect={false}
          />
          <TouchableOpacity style={styles.addAreaButton}
            onPress={() => onSetAutoFileMatch((autoFileInputRef.current?.getValue() ?? autoFileDraft).trim())}>
            <Text allowFontScaling={false} style={styles.areaOptionText}>Save</Text>
          </TouchableOpacity>
        </View>
        {Boolean(project.autoFileMatch) && (
          <Text allowFontScaling={false} style={styles.hint}>{`Filing items containing: ${project.autoFileMatch}`}</Text>
        )}
        <View style={styles.classificationRow}>
          <Text allowFontScaling={false} style={styles.hint}>Choices are saved as you tap them.</Text>
          <TouchableOpacity style={styles.headBtn} onPress={() => setClassificationOpen(false)}>
            <Text allowFontScaling={false} style={styles.headBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
        </View>}
      </View>

      <View style={styles.metaRow}>
        <TouchableOpacity style={styles.dueBtn} onPress={onSetDue}>
          <Text allowFontScaling={false} style={styles.dueText}>
            {project.dueDate
              ? `${overdue ? '⚠' : '📅'} Due ${project.dueDate.toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}`
              : '📅 Set a due date'}
          </Text>
        </TouchableOpacity>
        <Text allowFontScaling={false} style={styles.progressText}>
          {bar(progress.percent)} {progress.done}/{progress.total} tasks ({progress.percent}%)
        </Text>

        <View style={styles.metaActions}>
          <TouchableOpacity
            style={styles.headBtn}
            onPress={() => {
              setDraftName(project.name);
              setDraftShortLabel(project.shortLabel || '');
              setRenaming(true);
            }}
          >
            <Text allowFontScaling={false} style={styles.headBtnText}>
              Rename
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {wide ? (
        <View style={styles.columns}>
          <ScrollView style={[styles.body, styles.leftColumn]} keyboardShouldPersistTaps="always">
            {filesSection}
          </ScrollView>
          <ScrollView style={[styles.body, styles.rightColumn]} keyboardShouldPersistTaps="always">
            {workSection}
          </ScrollView>
        </View>
      ) : (
        <ScrollView style={styles.body} keyboardShouldPersistTaps="always">
          {workSection}
          {filesSection}
        </ScrollView>
      )}
    </View>
  );
}

/** Blocks rather than a drawn bar; a View-based bar smears on e-ink. */
function bar(percent: number): string {
  const filled = Math.round((percent / 100) * 5);
  return '█'.repeat(filled) + '░'.repeat(5 - filled);
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: '#000000',
    paddingBottom: 6,
  },
  headerControls: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  backBtn: { minHeight: 42, minWidth: 104, borderWidth: 1, borderColor: '#000000', borderRadius: 5, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  breadcrumb: { fontSize: 14, fontWeight: 'bold', color: '#000000' },
  areaBtn: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 5,
    minHeight: 42,
    width: 104,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  areaBtnText: { fontSize: 14, fontWeight: 'bold', color: '#000000' },
  areaPicker: { borderWidth: 2, borderColor: '#000000', borderRadius: 5, padding: 8, marginBottom: 8, backgroundColor: '#ffffff' },
  areaPickerTitle: { fontSize: 13, fontWeight: 'bold', color: '#000000', marginBottom: 6 },
  areaOptions: { flexDirection: 'row', flexWrap: 'wrap' },
  areaOption: { minHeight: 40, minWidth: 150, borderWidth: 1, borderColor: '#000000', borderRadius: 4, justifyContent: 'center', paddingHorizontal: 10, marginRight: 6, marginBottom: 6 },
  areaOptionNoArea: { minWidth: 0, width: 112 },
  addAreaOption: { minWidth: 0, width: 150, backgroundColor: '#eeeeee' },
  areaOptionSelected: { backgroundColor: '#e2e2e2', borderWidth: 2 },
  areaOptionText: { fontSize: 13, fontWeight: 'bold', color: '#000000' },
  addAreaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  addAreaInput: { flex: 1, minHeight: 40, borderWidth: 1, borderColor: '#000000', paddingHorizontal: 8, fontSize: 13, color: '#000000' },
  addAreaButton: { minHeight: 40, minWidth: 76, borderWidth: 1, borderColor: '#000000', alignItems: 'center', justifyContent: 'center', marginLeft: 6, paddingHorizontal: 8 },
  title: { flex: 1, fontSize: 18, fontWeight: 'bold', color: '#000000' },
  titleInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    fontSize: 15,
    fontWeight: 'bold',
    color: '#000000',
  },
  shortLabelInput: {
    width: 150,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginLeft: 6,
    fontSize: 13,
    color: '#000000',
  },
  headBtn: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginLeft: 6,
  },
  headBtnText: { fontSize: 13, fontWeight: 'bold', color: '#000000' },
  metaActions: { flexDirection: 'row', alignItems: 'center' },
  confirmRow: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    padding: 8,
    marginBottom: 6,
    backgroundColor: '#ffffff',
  },
  confirmText: { fontSize: 14, color: '#000000' },
  classificationRow: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 8, rowGap: 8 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  dueBtn: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  dueText: { fontSize: 14, fontWeight: 'bold', color: '#000000' },
  progressText: { fontSize: 14, color: '#000000' },
  body: { flex: 1 },
  sectionHeading: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#000000',
    backgroundColor: '#e8e8e8',
    paddingVertical: 3,
    paddingHorizontal: 6,
    marginTop: 8,
    marginBottom: 4,
  },
  noteRow: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingVertical: 7,
    paddingHorizontal: 8,
    marginBottom: 5,
    backgroundColor: '#ffffff',
  },
  noteLabel: { fontSize: 14, fontWeight: 'bold', color: '#000000' },
  hint: { fontSize: 14, color: '#505050', paddingHorizontal: 4, paddingBottom: 6 },
  linkedRow: { flexDirection: 'row', alignItems: 'center' },
  linkedOpen: { flex: 1 },
  linkedMove: { paddingVertical: 8, paddingHorizontal: 10 },
  caption: { fontSize: 12, color: '#505050', marginTop: 1 },
  panelHeading: { fontSize: 14, fontWeight: 'bold', color: '#000000', borderTopWidth: 1, borderTopColor: '#b0b0b0', paddingTop: 8, marginTop: 8 },
  upcoming: { borderWidth: 2, borderColor: '#000000', borderRadius: 6, padding: 8, marginTop: 8, backgroundColor: '#ffffff' },
  upcomingRow: { flexDirection: 'row', alignItems: 'center', minHeight: 40, borderTopWidth: 1, borderTopColor: '#d0d0d0' },
  upcomingWhen: { width: 170, fontSize: 13, fontWeight: 'bold', color: '#000000' },
  elsewhereHeader: { borderBottomWidth: 1, borderBottomColor: '#b0b0b0', paddingVertical: 8, paddingHorizontal: 4, marginTop: 8, marginBottom: 4 },
  elsewhereTitle: { fontSize: 13, fontWeight: 'bold', color: '#000000' },
  columns: { flex: 1, flexDirection: 'row' },
  leftColumn: { marginRight: 8, paddingRight: 8, borderRightWidth: 1, borderRightColor: '#b0b0b0' },
  rightColumn: { marginLeft: 8 },
  deliverableCardsStacked: { flexDirection: 'column' },
  deliverableCardStacked: { marginBottom: 10 },
  actionsSection: { marginTop: 12, marginBottom: 24 },
  actionRow: { borderTopWidth: 1, borderTopColor: '#d0d0d0', paddingVertical: 10, paddingHorizontal: 4 },
  deliverableCards: { flexDirection: 'row', marginTop: 8, marginBottom: 8 },
  deliverableCard: {
    flex: 1,
    height: 280,
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    padding: 8,
    backgroundColor: '#ffffff',
  },
  deliverableCardFirst: { marginRight: 10 },
  deliverableCardHeader: { minHeight: 40, flexDirection: 'row', alignItems: 'center' },
  deliverableCardTitle: { flex: 1, fontSize: 15, fontWeight: 'bold', color: '#000000' },
  deliverablePreview: { flex: 1 },
  openDeliverablesBtn: {
    minHeight: 36,
    borderTopWidth: 1,
    borderTopColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  openDeliverablesText: { fontSize: 14, fontWeight: 'bold', color: '#000000' },
  addTaskBtn: {
    minHeight: 34,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    justifyContent: 'center',
    paddingHorizontal: 10,
    marginLeft: 8,
  },
  addTask: { fontSize: 14, fontWeight: 'bold', color: '#000000' },
  taskRow: { flexDirection: 'row', alignItems: 'center', minHeight: 42, paddingVertical: 5 },
  stem: { fontSize: 13, color: '#606060', marginRight: 4 },
  glyph: { fontSize: 17, color: '#000000', marginRight: 6 },
  taskBody: { flex: 1 },
  taskText: { fontSize: 15, color: '#000000' },
  taskDone: { textDecorationLine: 'line-through', color: '#606060' },
  focusedHeader: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: '#000000',
    paddingBottom: 6,
  },
  focusedTitle: { flex: 1, fontSize: 18, fontWeight: 'bold', color: '#000000' },
  focusedList: { flex: 1, paddingTop: 8 },
});
