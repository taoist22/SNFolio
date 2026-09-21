import { eventNoteKey, eventNoteMapping } from './eventNoteMapping';
import { MeetingNoteMapping } from './types';

const series: MeetingNoteMapping = { eventUid: 'lec_20260902', seriesId: 'lec', notePath: '/N/Course - Lecture.note', lastPageNum: 3, lastCreatedIso: '' };
const session: MeetingNoteMapping = { eventUid: 'lec_20260909', seriesId: 'lec', notePath: '/N/Week 02/2026-09-09 - Lecture.note', lastPageNum: 1, lastCreatedIso: '', perSession: true };
const store: Record<string, MeetingNoteMapping> = { lec: series, lec_20260902: series, lec_20260909: session };
const get = (key: string) => store[key];

test('with series notebooks, every session opens the series notebook unless it has its own note', () => {
  expect(eventNoteMapping(get, { uid: 'lec_20260916', recurringSeriesId: 'lec' }, false)).toBe(series);
  expect(eventNoteMapping(get, { uid: 'lec_20260909', recurringSeriesId: 'lec' }, false)).toBe(session);
});

test('with one note per session, only a session\'s own note counts; the series notebook is not reused', () => {
  expect(eventNoteMapping(get, { uid: 'lec_20260909', recurringSeriesId: 'lec' }, true)).toBe(session);
  expect(eventNoteMapping(get, { uid: 'lec_20260916', recurringSeriesId: 'lec' }, true)).toBeUndefined();
  // The session the series notebook was first made from does not claim it as its own note.
  expect(eventNoteMapping(get, { uid: 'lec_20260902', recurringSeriesId: 'lec' }, true)).toBeUndefined();
});

test('one-off events use their own note either way, and new links go to the session only when per-session', () => {
  expect(eventNoteMapping(() => series, { uid: 'x' }, true)).toBe(series);
  expect(eventNoteKey({ uid: 'lec_20260916', recurringSeriesId: 'lec' }, true)).toBe('lec_20260916');
  expect(eventNoteKey({ uid: 'lec_20260916', recurringSeriesId: 'lec' }, false)).toBe('lec');
  expect(eventNoteKey({ uid: 'x' }, true)).toBe('x');
});
