/**
 * Times of day as minutes past midnight.
 *
 * Replaces the hour/minute/AM-PM chip rows plus a fixed duration list. That
 * arrangement needed three scrolling rows of chips — too wide for a Nomad —
 * and could only express the four durations someone thought of in advance, so
 * a two-and-a-half or five hour meeting was impossible to enter.
 *
 * Start and end are each nudged by discrete taps, which suits a display that
 * ghosts on frequent redraws far better than a slider or a spinner.
 */

export type TimeFormat = '12h' | '24h';

export function formatDateTime(date: Date, format: TimeFormat = '12h'): string {
  return formatTimeOfDay(minutesFromDate(date), format);
}

export const MINUTES_IN_DAY = 24 * 60;

/** Smallest gap an event may have, and the fine step size. */
export const TIME_STEP = 15;

export function minutesFromDate(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** Applies a time of day to a date, leaving the calendar day untouched. */
export function withTimeOfDay(day: Date, minutes: number): Date {
  const out = new Date(day);
  out.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return out;
}

export function formatTimeOfDay(minutes: number, format: TimeFormat = '12h'): string {
  const clamped = clampToDay(minutes);
  const hour24 = Math.floor(clamped / 60);
  const min = clamped % 60;
  if (format === '24h') return `${String(hour24).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(min).padStart(2, '0')} ${suffix}`;
}

/**
 * Clamps rather than wraps. A tap that rolled 11:45 PM round to midnight would
 * silently move the event to a different day.
 */
export function clampToDay(minutes: number): number {
  if (minutes < 0) return 0;
  if (minutes > MINUTES_IN_DAY - 1) return MINUTES_IN_DAY - 1;
  return minutes;
}

export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0m';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export interface TimeRange {
  start: number;
  end: number;
}

/**
 * Moves the start, carrying the end with it.
 *
 * Preserving the duration is what people expect when they discover a meeting
 * is an hour later than they thought; recomputing the end from scratch would
 * make them re-enter it every time.
 */
export function moveStart(range: TimeRange, delta: number): TimeRange {
  const duration = Math.max(TIME_STEP, range.end - range.start);
  const start = clampToDay(range.start + delta);
  return { start, end: clampToDay(Math.max(start + TIME_STEP, start + duration)) };
}

/** Moves the end, never letting it reach or pass the start. */
export function moveEnd(range: TimeRange, delta: number): TimeRange {
  const end = clampToDay(range.end + delta);
  return { start: range.start, end: Math.max(end, range.start + TIME_STEP) };
}

/** Repairs a range read from stored data, which may predate these rules. */
export function normaliseRange(range: TimeRange): TimeRange {
  const start = clampToDay(range.start);
  const end = clampToDay(range.end);
  return { start, end: end > start ? end : Math.min(start + TIME_STEP, MINUTES_IN_DAY - 1) };
}

/**
 * Reads a time someone typed or handwrote into a time field.
 *
 * More permissive than captureParser's matchTime, deliberately: that one hunts
 * for a time inside prose and so refuses a bare "930", which is far more often
 * a quantity. Here the whole field is the time, so bare forms are unambiguous
 * and refusing them would just make the user type punctuation.
 *
 * Accepts 9 · 9:30 · 930 · 0930 · 9.30 · 9h30 · 9am · 9:30 PM · 14:00 · 1430.
 *
 * @param after When given, a time at or before it with no explicit am/pm is
 *   read as the afternoon — so an end of "5" against a 9 AM start means 5 PM,
 *   which is what "9 to 5" means to everyone.
 */
export function parseTimeOfDay(input: string, after?: number): number | null {
  const text = (input || '').trim().toLowerCase();
  if (!text) return null;

  const meridiemMatch = text.match(/([ap])\.?m?\.?$/);
  const meridiem = meridiemMatch ? meridiemMatch[1] : null;
  const body = (meridiemMatch ? text.slice(0, meridiemMatch.index) : text).trim().replace(/\s+/g, '');
  if (!body) return null;

  let hours: number;
  let minutes: number;

  const separated = body.match(/^(\d{1,2})[:h.](\d{1,2})$/);
  if (separated) {
    hours = parseInt(separated[1], 10);
    minutes = parseInt(separated[2], 10);
  } else if (/^\d{1,2}$/.test(body)) {
    hours = parseInt(body, 10);
    minutes = 0;
  } else if (/^\d{3,4}$/.test(body)) {
    hours = parseInt(body.slice(0, body.length - 2), 10);
    minutes = parseInt(body.slice(-2), 10);
  } else {
    return null;
  }

  if (minutes > 59) return null;

  if (meridiem === 'p') {
    if (hours > 12) return null;
    if (hours < 12) hours += 12;
  } else if (meridiem === 'a') {
    if (hours > 12) return null;
    if (hours === 12) hours = 0;
  }

  if (hours > 23) return null;

  let total = hours * 60 + minutes;

  // "9 to 5": an unqualified end that lands before the start means the
  // afternoon, not the small hours of the same morning.
  if (!meridiem && after !== undefined && total <= after && hours < 12) {
    total += 12 * 60;
  }

  return total > MINUTES_IN_DAY - 1 ? null : total;
}

/** The clock part alone, for a field whose meridiem is a separate control. */
export function formatClock(minutes: number): string {
  const clamped = clampToDay(minutes);
  const hour24 = Math.floor(clamped / 60);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(clamped % 60).padStart(2, '0')}`;
}

export function isPm(minutes: number): boolean {
  return clampToDay(minutes) >= 12 * 60;
}

/**
 * Moves a time to the other half of the day, keeping the clock reading.
 *
 * 9:30 AM becomes 9:30 PM and back. Written as a swap rather than adding or
 * subtracting twelve hours so that repeated taps cannot drift.
 */
export function withMeridiem(minutes: number, pm: boolean): number {
  const clamped = clampToDay(minutes);
  const hour24 = Math.floor(clamped / 60);
  const hour12 = hour24 % 12;
  return clampToDay((pm ? hour12 + 12 : hour12) * 60 + (clamped % 60));
}
