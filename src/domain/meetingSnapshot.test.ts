import { createMeetingSnapshot, generateNoteFilename, noteIdentity, safeNoteFilename } from './meetingSnapshot';
import { CalendarEvent } from './types';

describe('meetingSnapshot', () => {
  const sampleEvent: CalendarEvent = {
    uid: 'evt-100',
    summary: 'Q3 Product Strategy Sync',
    description: '1. Review Q3 Goals\n2. Design System updates',
    location: 'Conference Room 4B / Zoom',
    // Device-local wall time on purpose. A note is filed under the local date
    // its meeting appears on, so pinning the instant in UTC would assert a
    // filename that only holds in host zones sitting close to UTC.
    start: new Date(2026, 7, 16, 10, 0, 0),
    end: new Date(2026, 7, 16, 11, 0, 0),
    allDay: false,
    organizer: { name: 'Sarah Connor', email: 's.connor@acme.com' },
    attendees: [
      { name: 'John Doe', email: 'j.doe@acme.com', status: 'ACCEPTED' },
      { name: 'Alex Smith', email: 'a.smith@acme.com', status: 'TENTATIVE' },
    ],
  };

  test('generateNoteFilename formats single meeting filename cleanly', () => {
    const filename = generateNoteFilename(sampleEvent);
    expect(filename).toBe('2026-08-16 - Q3 Product Strategy Sync.note');
  });

  test('generateNoteFilename formats recurring series filename cleanly', () => {
    const recurringEvent: CalendarEvent = {
      ...sampleEvent,
      recurringSeriesId: 'series-999',
      rrule: 'FREQ=WEEKLY',
    };
    const filename = generateNoteFilename(recurringEvent, true, 'Series - ');
    expect(filename).toBe('Series - Q3 Product Strategy Sync.note');
  });

  test('safeNoteFilename accepts a user title without allowing path characters or duplicate extension', () => {
    expect(safeNoteFilename('  Client: Review / Decisions.note  ')).toBe('Client Review Decisions.note');
  });

  test('createMeetingSnapshot formats header text block with all fields', () => {
    const snapshot = createMeetingSnapshot(sampleEvent);
    expect(snapshot.title).toBe('Q3 Product Strategy Sync');
    expect(snapshot.organizerStr).toContain('Sarah Connor');
    expect(snapshot.formattedHeaderText).toContain('MEETING: Q3 PRODUCT STRATEGY SYNC');
    expect(snapshot.formattedHeaderText).toContain('John Doe (j.doe@acme.com) [ACCEPTED]');
    expect(snapshot.formattedHeaderText).toContain('Conference Room 4B / Zoom');
    expect(snapshot.formattedHeaderText).toContain('1. Review Q3 Goals');
    expect(snapshot.formattedHeaderText).toContain('[Snapshot Frozen:');
  });

  test('createMeetingSnapshot handles allDay, empty attendees, and missing description', () => {
    const minimalEvent: CalendarEvent = {
      uid: 'evt-200',
      summary: 'Company Holiday',
      start: new Date('2026-12-25T00:00:00Z'),
      end: new Date('2026-12-25T23:59:59Z'),
      allDay: true,
      attendees: [],
    };

    const snapshot = createMeetingSnapshot(minimalEvent);
    expect(snapshot.timeStr).toBe('All Day');
    expect(snapshot.organizerStr).toBe('N/A');
    expect(snapshot.attendeesStr).toContain('No attendees listed');
    expect(snapshot.locationStr).toBe('N/A');
    expect(snapshot.descriptionStr).toContain('No agenda or description provided.');
  });
});

describe('noteIdentity', () => {
  test('a one-off event is its own identity', () => {
    expect(noteIdentity({ uid: 'evt-1', recurringSeriesId: undefined })).toBe('evt-1');
  });

  test('every occurrence of a series shares the series identity', () => {
    // expandRruleInstances mints `${seriesUid}_${date}` per occurrence, so
    // without this a weekly class would be asked its kind every week.
    const week1 = { uid: 'class-101_2026-08-24', recurringSeriesId: 'class-101' };
    const week2 = { uid: 'class-101_2026-08-31', recurringSeriesId: 'class-101' };

    expect(noteIdentity(week1)).toBe('class-101');
    expect(noteIdentity(week2)).toBe(noteIdentity(week1));
  });

  test('two different series stay distinct', () => {
    expect(noteIdentity({ uid: 'a_2026-08-24', recurringSeriesId: 'a' })).not.toBe(
      noteIdentity({ uid: 'b_2026-08-24', recurringSeriesId: 'b' })
    );
  });
});
