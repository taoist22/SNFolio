import { eventNoteMapping } from '../domain/eventNoteMapping';
import { notePageCount } from '../domain/notePageCount';
import { FileUtils, PluginCommAPI, PluginFileAPI } from 'sn-plugin-lib';
import { CalendarEvent, CalendarSettings, CalendarTask, EventType, NoteKind } from '../domain/types';
import { generateNoteFilename, safeNoteFilename } from '../domain/meetingSnapshot';
import {
  DEFAULT_SYSTEM_TEMPLATE,
  resolveNoteDestination,
  parseSystemTemplates,
  SystemTemplate,
  templateCandidates,
} from '../domain/noteTemplates';
import { calendarStorage } from '../storage/calendarStorage';
import { ensureFileWritePermission } from './pluginPermissions';

export interface MeetingNoteResult {
  success: boolean;
  notePath: string;
  pageNum: number;
  isNewFile: boolean;
  error?: string;
  warning?: string;
}

/**
 * The device refuses createNote while a PDF is open (measured: error 102,
 * "This app is not allowed to use this API"), and says so in a way that gives
 * no clue what to do. Nothing in the plugin can lift that, so explain it.
 */
export function noteCreationError(message: string): string {
  return /not allowed to use this API/i.test(message || '')
    ? 'The device does not allow notes to be created or added to while a PDF is open. Close the PDF, open a note, then try again.'
    : message;
}

export class MeetingNoteService {
  async ensureDirectory(dirPath: string): Promise<boolean> {
    try {
      if (!(await ensureFileWritePermission())) return false;
      if (FileUtils.makeDir) {
        await FileUtils.makeDir(dirPath);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Templates the device offers, fetched once and reused.
   *
   * Only needed to resolve a built-in's portrait URI if createNote rejects the
   * bare name, so a failure here is not fatal — the name is tried regardless.
   */
  private systemTemplates: SystemTemplate[] | null = null;

  async getSystemTemplates(): Promise<SystemTemplate[]> {
    if (this.systemTemplates) return this.systemTemplates;
    try {
      const raw = await PluginCommAPI.getNoteSystemTemplates();
      this.systemTemplates = parseSystemTemplates(raw);
    } catch (e) {
      this.systemTemplates = [];
    }
    return this.systemTemplates;
  }

  /**
   * Creates a note, trying each candidate template in turn.
   *
   * Previously this resolved a PNG path through two strategies that both called
   * FileUtils.listFiles — unavailable on device — so both silently skipped and
   * every note fell through to a hardcoded PNG that may not even exist. The
   * built-in templates were reachable all along via their name.
   */
  private async createNoteWithTemplate(
    notePath: string,
    templateValue: string,
    isPortrait = true
  ): Promise<{ success: boolean; usedTemplate?: string; error?: string }> {
    const candidates = templateCandidates(templateValue, await this.getSystemTemplates());
    let lastError = 'createNote failed';

    for (const candidate of candidates) {
      try {
        const res: any = await PluginFileAPI.createNote({
          notePath,
          template: candidate,
          mode: 0,
          isPortrait,
        });
        // APIResponse.success only means the native call completed. The note
        // exists only when its boolean result is also true.
        if (res?.success === true && res?.result === true) {
          return { success: true, usedTemplate: candidate };
        }
        lastError =
          res?.error?.message ||
          (res?.success === true && res?.result === false
            ? `The device rejected template ${candidate}.`
            : lastError);
      } catch (e: any) {
        lastError = e?.message || lastError;
      }
    }

    return { success: false, error: noteCreationError(lastError) };
  }

  /**
   * Creates the day's journal note and opens it. Used by the Day View's Daily
   * Note action when exists() reports the file is not already there.
   */
  async createDailyNote(
    notePath: string,
    settings: CalendarSettings
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const separator = notePath.lastIndexOf('/');
      const directory = separator > 0 ? notePath.slice(0, separator) : '';
      if (!directory || !(await this.ensureDirectory(directory))) {
        return { success: false, error: 'File write access was not allowed.' };
      }

      // A journal page wants its own background, not the meeting-note one.
      const createRes = await this.createNoteWithTemplate(
        notePath,
        settings.dailyNoteTemplate || DEFAULT_SYSTEM_TEMPLATE
      );

      if (!createRes.success) {
        return { success: false, error: createRes.error };
      }

      // openFilePath only reaches the file manager; the caller opens the note
      // through the native activity intent instead.
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || 'unknown error' };
    }
  }

  /**
   * @param kind What this note is. Passed in rather than derived from a global
   *   mode, so a class note stays a class note whatever the settings say later.
   */
  /**
   * Creates a project's own notebook.
   *
   * A project that holds only tasks is a to-do list with a name; the notebook
   * is what makes it the container it is meant to be. Filed in the project's
   * folder with its template when it has them, which is what finally makes
   * those two fields mean something.
   */
  async createProjectNote(
    projectName: string,
    folder: string,
    template: string
  ): Promise<{ success: boolean; notePath?: string; error?: string }> {
    const dir = folder || '/storage/emulated/0/Note';
    if (!(await this.ensureDirectory(dir))) {
      return { success: false, error: 'File write access was not allowed.' };
    }

    const safe = projectName.replace(/[/\\?%*:|"<>]/g, '').replace(/\s+/g, ' ').trim() || 'Project';
    const notePath = `${dir}/${safe}.note`;

    const res = await this.createNoteWithTemplate(notePath, template || DEFAULT_SYSTEM_TEMPLATE);
    return res.success ? { success: true, notePath } : { success: false, error: res.error };
  }

  /** Creates one note linked to a task; tasks do not append recurring pages. */
  async createTaskNote(
    task: CalendarTask,
    noteName: string,
    folder: string,
    template: string
  ): Promise<{ success: boolean; notePath: string; error?: string }> {
    const notePath = `${folder.replace(/\/+$/, '')}/${safeNoteFilename(noteName)}`;
    if (!(await this.ensureDirectory(folder))) {
      return { success: false, notePath, error: 'File write access was not allowed.' };
    }
    try {
      const existing: any = await PluginFileAPI.getNoteTotalPageNum(notePath);
      if (notePageCount(existing) !== undefined) {
        return { success: false, notePath, error: `${safeNoteFilename(noteName)} already exists in this folder.` };
      }
      const created = await this.createNoteWithTemplate(notePath, template || DEFAULT_SYSTEM_TEMPLATE);
      if (!created.success) return { success: false, notePath, error: created.error };
      calendarStorage.setMapping({
        eventUid: task.uid,
        seriesId: task.uid,
        notePath,
        lastPageNum: 1,
        lastCreatedIso: new Date().toISOString(),
      });
      return { success: true, notePath };
    } catch (error: any) {
      return { success: false, notePath, error: error?.message || 'Could not create task note.' };
    }
  }

  async createOrAppendMeetingNote(
    event: CalendarEvent,
    forceNewFile = false,
    kind: NoteKind = 'meeting',
    /** The event's type, when it has one; its folder and template win. */
    eventType?: EventType,
    /** Folder confirmed by the user; omitted only by legacy/internal callers. */
    selectedFolder?: string,
    /** Editable title confirmed before the first file is created. */
    noteName?: string,
    /** A recurring event's session gets its own note instead of a page in the series notebook. */
    perSession = false
  ): Promise<MeetingNoteResult> {
    const settings = calendarStorage.getSettings();
    // The confirmation UI shows this same resolution. Event Type remains a
    // default for folder/template rather than preventing a per-note override.
    const destination = resolveNoteDestination(eventType, {
      folder:
        (kind === 'class'
          ? settings.classNotesDirectory || settings.notesDirectory
          : settings.notesDirectory) || '/storage/emulated/0/Note/Meetings',
      template:
        (kind === 'class' ? settings.classTemplate : settings.meetingTemplate) ||
        DEFAULT_SYSTEM_TEMPLATE,
    });

    const templateValue = destination.template;

    const isRecurringSeries = Boolean(event.recurringSeriesId && !forceNewFile && !perSession);
    const filename = noteName
      ? safeNoteFilename(noteName)
      : generateNoteFilename(event, isRecurringSeries, settings.seriesNotebookPrefix, kind);
    // Once a note exists, its recorded path wins. Otherwise changing a
    // Project, Area, Event Type, or routing setting would split a recurring
    // series across multiple notebooks without warning.
    const existingMapping = forceNewFile
      ? undefined
      : eventNoteMapping(key => calendarStorage.getMapping(key), event, perSession);
    const proposedDir = selectedFolder || destination.folder;
    const notePath = existingMapping?.notePath || `${proposedDir}/${filename}`;
    const noteSlash = notePath.lastIndexOf('/');
    const targetDir = noteSlash > 0 ? notePath.slice(0, noteSlash) : proposedDir;
    if (!(await this.ensureDirectory(targetDir))) {
      return {
        success: false,
        notePath,
        pageNum: 1,
        isNewFile: false,
        error: 'File write access was not allowed.',
      };
    }

    try {
      let pageNum = 1;
      let isNewFile = false;

      // Check total page num to see if notebook exists
      const totalPagesRes: any = await PluginFileAPI.getNoteTotalPageNum(notePath);

      const pages = notePageCount(totalPagesRes);
      if (pages !== undefined) {
        if (noteName && !existingMapping) {
          return {
            success: false,
            notePath,
            pageNum: pages,
            isNewFile: false,
            error: `${filename} already exists in this folder. Choose another note name.`,
          };
        }
        // File exists -> Append page to existing series notebook
        const lastPage = pages;
        // insertNotePage documents its template as a name, so the configured
        // value goes straight through; a custom PNG path is passed as-is too.
        const insertRes: any = await PluginFileAPI.insertNotePage({
          notePath,
          page: lastPage,
          template: templateValue,
        });

        if (!insertRes || insertRes.success !== true) {
          return {
            success: false,
            notePath,
            pageNum: lastPage,
            isNewFile: false,
            error: noteCreationError(insertRes?.error?.message || 'Could not append a page to the recurring notebook.'),
          };
        }
        pageNum = lastPage + 1;
      } else {
        // File does not exist -> Create new note file
        isNewFile = true;
        const createRes = await this.createNoteWithTemplate(notePath, templateValue);

        if (!createRes.success) {
          return {
            success: false,
            notePath,
            pageNum: 1,
            isNewFile: true,
            error: createRes.error || `Failed to create note file using template ${templateValue}.`,
          };
        }
        pageNum = 1;
      }

      // Record mapping
      calendarStorage.setMapping({
        eventUid: event.uid,
        // Recorded because the grid badge and per-type templates both need to
        // know what this note was after the event is rebuilt from sync data.
        kind,
        seriesId: event.recurringSeriesId || event.uid,
        notePath,
        lastPageNum: pageNum,
        lastCreatedIso: new Date().toISOString(),
        ...(perSession && event.recurringSeriesId ? { perSession: true, eventStartIso: event.start.toISOString() } : {}),
      });
      const persistenceError = await calendarStorage.flush();

      // Opening is the caller's job. openFilePath only reaches the file
      // manager, which is what made a successful creation look like nothing
      // had happened; the screen opens the note through the native intent
      // instead, exactly as daily notes already do.

      return {
        success: true,
        notePath,
        pageNum,
        isNewFile,
        warning: persistenceError
          ? `The note was created, but its calendar link could not be saved: ${persistenceError}`
          : undefined,
      };
    } catch (err: any) {
      return {
        success: false,
        notePath,
        pageNum: 1,
        isNewFile: false,
        error: err?.message || 'Unexpected error creating meeting note.',
      };
    }
  }
}

export const meetingNoteService = new MeetingNoteService();
