import { meetingNoteService } from './meetingNoteService';
import { CalendarEvent, CalendarTask } from '../domain/types';
import { calendarStorage } from '../storage/calendarStorage';
import { noteIdentity } from '../domain/meetingSnapshot';
import { PluginFileAPI } from 'sn-plugin-lib';

jest.mock('sn-plugin-lib', () => ({
  PluginFileAPI: {
    createNote: jest.fn().mockResolvedValue({ success: true, result: true }),
    getNoteTotalPageNum: jest.fn().mockResolvedValue({ success: false }),
    insertNotePage: jest.fn().mockResolvedValue({ success: true }),
    insertElements: jest.fn().mockResolvedValue({ success: true }),
    generateNoteTemplatePng: jest.fn().mockResolvedValue({ success: true }),
  },
  PluginNoteAPI: {
    insertText: jest.fn().mockResolvedValue({ success: true }),
  },
  PluginCommAPI: {
    getNoteSystemTemplates: jest.fn().mockResolvedValue([
      {
        name: 'style_8mm_ruled_line',
        hUri: 'android.resource://com.ratta.supernote.pluginhost/drawable/style_h_8mm_ruled_line',
        vUri: 'android.resource://com.ratta.supernote.pluginhost/drawable/style_8mm_ruled_line',
      },
    ]),
  },
  // listFiles is deliberately absent: it does not exist on the device, and
  // mocking it previously made a dead code path look tested.
  FileUtils: {
    makeDir: jest.fn().mockResolvedValue(true),
    openFilePath: jest.fn().mockResolvedValue(true),
  },
  PluginManager: {
    hasPermission: jest.fn().mockResolvedValue(1),
    requestPermission: jest.fn().mockResolvedValue(1),
  },
}));

const sampleEvent: CalendarEvent = {
  uid: 'evt-300',
  summary: 'Design Review',
  description: 'Review UI mockups',
  start: new Date('2026-08-16T15:00:00Z'),
  end: new Date('2026-08-16T16:00:00Z'),
  allDay: false,
  attendees: [{ name: 'Bob', email: 'bob@example.com' }],
};

describe('meetingNoteService', () => {

  test('requests write access before creating a daily note', async () => {
    const { PluginManager } = jest.requireMock('sn-plugin-lib');
    PluginManager.hasPermission.mockResolvedValueOnce(0);
    PluginManager.requestPermission.mockResolvedValueOnce(1);

    const res = await meetingNoteService.createDailyNote(
      '/storage/emulated/0/Note/Daily Notes/2026-08-26.note',
      { ...calendarStorage.getSettings(), dailyNoteTemplate: 'style_8mm_ruled_line' },
    );

    expect(res.success).toBe(true);
    expect(PluginManager.requestPermission).toHaveBeenCalledWith(
      'plugin.permission.FILE:WRITE',
      expect.stringContaining('journal'),
    );
  });

  test('creates a meeting note with the configured system template', async () => {
    (PluginFileAPI.createNote as jest.Mock).mockClear();
    await meetingNoteService.createOrAppendMeetingNote(sampleEvent);

    const [args] = (PluginFileAPI.createNote as jest.Mock).mock.calls[0];
    // The built-in name, not a PNG path — the whole point of the change.
    expect(args.template).toBe('style_8mm_ruled_line');
    expect(args.isPortrait).toBe(true);
  });

  test('does not report success when createNote returns result false', async () => {
    (PluginFileAPI.createNote as jest.Mock)
      .mockClear()
      .mockResolvedValueOnce({ success: true, result: false });

    const res = await meetingNoteService.createOrAppendMeetingNote({ ...sampleEvent, uid: 'evt-301' });

    expect(res.success).toBe(false);
    expect(res.error).toContain('rejected template');
  });

  test('records what kind of note was created', async () => {
    (PluginFileAPI.createNote as jest.Mock)
      .mockClear()
      .mockResolvedValue({ success: true, result: true });
    await meetingNoteService.createOrAppendMeetingNote({ ...sampleEvent, uid: 'evt-302' });

    // Untyped notes default to meeting; Class is selected per event/type.
    expect(calendarStorage.getMapping('evt-302')?.kind).toBe('meeting');
  });

  test('creates new meeting note file when notebook does not exist', async () => {
    (PluginFileAPI.insertElements as jest.Mock).mockClear();
    const res = await meetingNoteService.createOrAppendMeetingNote(sampleEvent);
    expect(res.success).toBe(true);
    expect(res.isNewFile).toBe(true);
    expect(res.pageNum).toBe(1);
    expect(PluginFileAPI.createNote).toHaveBeenCalled();
    expect(PluginFileAPI.insertElements).not.toHaveBeenCalled();
  });

  test('appends page to existing recurring meeting notebook', async () => {
    (PluginFileAPI.getNoteTotalPageNum as jest.Mock).mockResolvedValueOnce({
      success: true,
      result: 3,
    });

    const recurringEvent: CalendarEvent = {
      ...sampleEvent,
      recurringSeriesId: 'series-400',
    };

    const res = await meetingNoteService.createOrAppendMeetingNote(recurringEvent);
    expect(res.success).toBe(true);
    expect(res.isNewFile).toBe(false);
    expect(res.pageNum).toBe(4);
    expect(PluginFileAPI.insertNotePage).toHaveBeenCalled();
  });

  test('one note per session: each session gets its own dated note instead of a page in the series notebook', async () => {
    (PluginFileAPI.createNote as jest.Mock).mockClear().mockResolvedValue({ success: true, result: true });
    (PluginFileAPI.insertNotePage as jest.Mock).mockClear();
    const seriesNote = { eventUid: 'lecture_20260902', seriesId: 'lecture', notePath: '/N/Course - Lecture.note', lastPageNum: 2, lastCreatedIso: '' };
    calendarStorage.setMapping(seriesNote);
    const session: CalendarEvent = {
      ...sampleEvent, uid: 'lecture_20260930', summary: 'Lecture', recurringSeriesId: 'lecture',
      start: new Date('2026-09-30T15:00:00Z'), end: new Date('2026-09-30T16:00:00Z'),
    };
    const res = await meetingNoteService.createOrAppendMeetingNote(
      session, false, 'class', undefined, '/N/IDS105/Week 05', undefined, true);
    expect(res.success).toBe(true);
    expect(res.isNewFile).toBe(true);
    expect(res.notePath).toBe('/N/IDS105/Week 05/2026-09-30 - Lecture.note');
    expect(PluginFileAPI.insertNotePage).not.toHaveBeenCalled();
    const mapping = calendarStorage.getMapping('lecture_20260930');
    expect(mapping?.perSession).toBe(true);
    expect(mapping?.seriesId).toBe('lecture');
    expect(mapping?.eventStartIso).toBe('2026-09-30T15:00:00.000Z');
    // The series notebook link is untouched.
    expect(calendarStorage.getMapping('lecture')?.notePath).toBe('/N/Course - Lecture.note');
  });

  test('fails cleanly when appending a recurring notebook page fails', async () => {
    (PluginFileAPI.getNoteTotalPageNum as jest.Mock).mockResolvedValueOnce({ success: true, result: 3 });
    (PluginFileAPI.insertNotePage as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: { message: 'page locked' },
    });

    const res = await meetingNoteService.createOrAppendMeetingNote({
      ...sampleEvent,
      uid: 'evt-append-fail',
      recurringSeriesId: 'series-append-fail',
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('page locked');
  });
});

describe('note kind routing', () => {
  beforeEach(() => {
    (PluginFileAPI.createNote as jest.Mock)
      .mockClear()
      .mockResolvedValue({ success: true, result: true });
    calendarStorage.updateSettings({
      notesDirectory: '/storage/emulated/0/Note/Meetings',
      classNotesDirectory: '/storage/emulated/0/Note/Classes',
      meetingTemplate: 'style_meeting_notes',
      classTemplate: 'style_college_ruled',
    });
  });

  test('a class note uses the class folder and class template', async () => {
    const res = await meetingNoteService.createOrAppendMeetingNote(
      { ...sampleEvent, uid: 'evt-class-1' },
      false,
      'class'
    );

    expect(res.notePath).toContain('/Note/Classes/');
    const [args] = (PluginFileAPI.createNote as jest.Mock).mock.calls[0];
    expect(args.template).toBe('style_college_ruled');
  });

  test('a meeting note uses the meeting folder and meeting template', async () => {
    const res = await meetingNoteService.createOrAppendMeetingNote(
      { ...sampleEvent, uid: 'evt-meet-1' },
      false,
      'meeting'
    );

    expect(res.notePath).toContain('/Note/Meetings/');
    const [args] = (PluginFileAPI.createNote as jest.Mock).mock.calls[0];
    expect(args.template).toBe('style_meeting_notes');
  });

  test('the kind is recorded on the mapping, not inferred later', async () => {
    await meetingNoteService.createOrAppendMeetingNote(
      { ...sampleEvent, uid: 'evt-class-2' },
      false,
      'class'
    );
    expect(calendarStorage.getMapping('evt-class-2')?.kind).toBe('class');
  });

  test('omitting the kind still produces a meeting note', async () => {
    // Callers that predate per-note kinds must keep working unchanged.
    const res = await meetingNoteService.createOrAppendMeetingNote({
      ...sampleEvent,
      uid: 'evt-default-1',
    });
    expect(res.notePath).toContain('/Note/Meetings/');
  });

  test('a contextual Project or Area folder overrides the global folder but not the template', async () => {
    const res = await meetingNoteService.createOrAppendMeetingNote(
      { ...sampleEvent, uid: 'evt-project-route' },
      false,
      'meeting',
      undefined,
      '/storage/emulated/0/Note/Clients/Acme/Meetings'
    );

    expect(res.notePath).toContain('/Note/Clients/Acme/Meetings/');
    const [args] = (PluginFileAPI.createNote as jest.Mock).mock.calls[0];
    expect(args.template).toBe('style_meeting_notes');
  });

  test('uses an editable event-note name and refuses to append to an unrelated collision', async () => {
    (PluginFileAPI.getNoteTotalPageNum as jest.Mock).mockResolvedValueOnce({ success: true, result: 2 });
    const res = await meetingNoteService.createOrAppendMeetingNote(
      { ...sampleEvent, uid: 'evt-custom-collision' },
      false,
      'meeting',
      undefined,
      '/storage/emulated/0/Note/Meetings',
      'My Review'
    );

    expect(res.success).toBe(false);
    expect(res.notePath).toBe('/storage/emulated/0/Note/Meetings/My Review.note');
    expect(res.error).toContain('already exists');
    expect(PluginFileAPI.insertNotePage).not.toHaveBeenCalledWith(expect.objectContaining({
      notePath: res.notePath,
    }));
  });

  test('creates and maps a named note linked to a task', async () => {
    const task: CalendarTask = {
      uid: 'task-note-1',
      title: 'Prepare proposal',
      completed: false,
      createdAt: new Date('2026-08-31T00:00:00Z'),
    };
    const res = await meetingNoteService.createTaskNote(
      task,
      'Proposal Working Notes',
      '/storage/emulated/0/Note/Task Notes',
      'style_8mm_ruled_line'
    );

    expect(res.success).toBe(true);
    expect(res.notePath).toBe('/storage/emulated/0/Note/Task Notes/Proposal Working Notes.note');
    expect(calendarStorage.getMapping(task.uid)?.notePath).toBe(res.notePath);
  });

  test('an existing series mapping wins after routing settings or membership change', async () => {
    const mappedPath = '/storage/emulated/0/Note/Old Filing/Series - Design Review.note';
    calendarStorage.setMapping({
      eventUid: 'evt-series-routed-week-1',
      seriesId: 'series-routed',
      kind: 'meeting',
      notePath: mappedPath,
      lastPageNum: 1,
      lastCreatedIso: new Date().toISOString(),
    });
    (PluginFileAPI.getNoteTotalPageNum as jest.Mock).mockResolvedValueOnce({ success: true, result: 1 });

    const res = await meetingNoteService.createOrAppendMeetingNote(
      { ...sampleEvent, uid: 'evt-series-routed-week-2', recurringSeriesId: 'series-routed' },
      false,
      'meeting',
      undefined,
      '/storage/emulated/0/Note/Projects/New Project/Meetings'
    );

    expect(res.notePath).toBe(mappedPath);
    expect(PluginFileAPI.insertNotePage).toHaveBeenCalledWith(expect.objectContaining({
      notePath: mappedPath,
    }));
  });
});

describe('event kind store', () => {
  test('survives an event object being replaced by a sync', () => {
    // The reason kinds are keyed by uid rather than held on CalendarEvent:
    // parseIcsContent rebuilds events from ICS on every pull, carrying no
    // custom fields, so anything stored on the object would be lost here.
    calendarStorage.setEventKind('evt-sync-1', 'class');
    const rebuiltBySync: CalendarEvent = { ...sampleEvent, uid: 'evt-sync-1' };

    expect(rebuiltBySync).not.toHaveProperty('kind');
    expect(calendarStorage.getEventKind('evt-sync-1')).toBe('class');
  });

  test('an unseen event has no kind, so the caller can ask', () => {
    expect(calendarStorage.getEventKind('never-asked')).toBeUndefined();
  });

  test('an existing note outranks a later tag', async () => {
    // What the note was actually created as is the stronger answer.
    await meetingNoteService.createOrAppendMeetingNote(
      { ...sampleEvent, uid: 'evt-precedence' },
      false,
      'class'
    );
    calendarStorage.setEventKind('evt-precedence', 'meeting');

    expect(calendarStorage.getEventKind('evt-precedence')).toBe('class');
  });
});

describe('recurring series identity', () => {
  test('one occurrence answers for the whole series', () => {
    // Occurrences are minted as `${seriesUid}_${date}` by expandRruleInstances,
    // so keying on the raw uid would ask again every week — on exactly the
    // events most likely to be classes.
    const week1 = { uid: 'phys301_2026-08-24', recurringSeriesId: 'phys301' };
    const week2 = { uid: 'phys301_2026-08-31', recurringSeriesId: 'phys301' };

    calendarStorage.setEventKind(noteIdentity(week1), 'class');

    expect(calendarStorage.getEventKind(noteIdentity(week2))).toBe('class');
    // The occurrence's own uid was never stored.
    expect(calendarStorage.getEventKind(week2.uid)).toBeUndefined();
  });

  test('a one-off event is unaffected by series handling', () => {
    calendarStorage.setEventKind(noteIdentity({ uid: 'standalone' }), 'meeting');
    expect(calendarStorage.getEventKind('standalone')).toBe('meeting');
  });
});
