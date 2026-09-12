import { formatTimeOfDay, TimeFormat } from './timeOfDay';
/**
 * Extracts a date, a time and a title from text recognised off a lasso
 * selection, so a capture can pre-fill the creation modal instead of making
 * the user navigate to a date and place the item by hand.
 *
 * Deliberately narrow: numeric dates, month names and clock times. Not general
 * natural language. OCR output is fallible, so everything here degrades to
 * "no match" rather than guessing — a wrong date is worse than no date.
 */

/**
 * Which component leads in an all-numeric date that is otherwise ambiguous.
 * 'auto' reads the device's regional setting, which is right for most users
 * without them ever finding the preference.
 */
export type DateOrder = 'MDY' | 'DMY';
export type DateOrderSetting = DateOrder | 'auto';

/**
 * Derives the order from the device locale by formatting a known date and
 * seeing which part comes first. Falls back to MDY if Intl is unavailable —
 * Hermes ships Intl but `formatToParts` support has varied by version.
 */
export function detectDateOrder(): DateOrder {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(2026, 8, 22));

    const monthIdx = parts.findIndex(p => p.type === 'month');
    const dayIdx = parts.findIndex(p => p.type === 'day');
    if (monthIdx >= 0 && dayIdx >= 0) {
      return monthIdx < dayIdx ? 'MDY' : 'DMY';
    }
  } catch (e) {
    // Intl missing or formatToParts unsupported — fall through.
  }
  return 'MDY';
}

/** Resolves a stored preference, consulting the device only for 'auto'. */
export function resolveDateOrder(setting?: DateOrderSetting): DateOrder {
  if (setting === 'MDY' || setting === 'DMY') return setting;
  return detectDateOrder();
}

export interface ParsedCapture {
  /** Text with the recognised date/time spans removed. */
  title: string;
  /** Local-midnight date when a date was found, or the time's date. */
  date?: Date;
  hours?: number;
  minutes?: number;
  /** A date with no time reads as an all-day item. */
  allDay: boolean;
  /**
   * Nothing date-like at all means this is a to-do, not a calendar event —
   * "email the professor" is a task; "Meeting A 09/22 10:00A" is an event.
   */
  kind: 'event' | 'task';
  /** True when both numbers were <= 12 and dateOrder had to break the tie. */
  ambiguousDateOrder: boolean;
  /** Human-readable summary to show before saving, so a misread is visible. */
  interpretation: string;
  /** Raw recognised text, carried through so the UI can show what was read. */
  sourceText?: string;
  /** Whether a date was actually found, as opposed to defaulted. */
  hasDate?: boolean;
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

const MONTH_NAMES = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

/** Two-digit years are assumed to be this century. */
function normaliseYear(raw: string, fallbackYear: number): number {
  if (!raw) return fallbackYear;
  const n = parseInt(raw, 10);
  if (raw.length <= 2) return 2000 + n;
  return n;
}

function isValidDayMonth(day: number, month0: number, year: number): boolean {
  if (month0 < 0 || month0 > 11 || day < 1) return false;
  const probe = new Date(year, month0, day);
  return probe.getMonth() === month0 && probe.getDate() === day;
}

interface DateMatch {
  date: Date;
  span: [number, number];
  ambiguous: boolean;
}

/** ISO first — YYYY-MM-DD is never ambiguous. */
function matchIsoDate(text: string, ): DateMatch | null {
  const m = text.match(/\b(\d{4})[-./](\d{1,2})[-./](\d{1,2})\b/);
  if (!m || m.index === undefined) return null;
  const year = parseInt(m[1], 10);
  const month0 = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  if (!isValidDayMonth(day, month0, year)) return null;
  return {date: new Date(year, month0, day), span: [m.index, m.index + m[0].length], ambiguous: false};
}

/**
 * All-numeric dates. `/`, `.` and `-` separators are all in common use —
 * dot-separated (22.09.2026) is standard across much of Europe.
 */
function matchNumericDate(text: string, order: DateOrder, fallbackYear: number): DateMatch | null {
  const m = text.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
  if (!m || m.index === undefined) return null;

  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  const year = normaliseYear(m[3] || '', fallbackYear);

  let day: number;
  let month0: number;
  let ambiguous = false;

  if (a > 12 && b <= 12) {
    // 22/09 — the first cannot be a month, so this is unambiguously D/M.
    day = a;
    month0 = b - 1;
  } else if (b > 12 && a <= 12) {
    // 09/22 — unambiguously M/D.
    month0 = a - 1;
    day = b;
  } else if (a <= 12 && b <= 12) {
    // Genuinely ambiguous; the user's preference breaks the tie and the
    // caller surfaces that it was a guess.
    ambiguous = true;
    if (order === 'DMY') {
      day = a;
      month0 = b - 1;
    } else {
      month0 = a - 1;
      day = b;
    }
  } else {
    return null;
  }

  if (!isValidDayMonth(day, month0, year)) return null;
  return {date: new Date(year, month0, day), span: [m.index, m.index + m[0].length], ambiguous};
}

/** Month names in either order: "Sep 22 2026" or "22 September 2026". */
function matchNamedDate(text: string, fallbackYear: number): DateMatch | null {
  // The year must be separated by whitespace. Allowing none let "September
  // 2026" split into day=20 + year=26 instead of failing over to day-first.
  const monthFirst = new RegExp(`\\b(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{2,4}))?\\b`, 'i');
  const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAMES})\\.?(?:,?\\s+(\\d{2,4}))?\\b`, 'i');

  let m = text.match(monthFirst);
  if (m && m.index !== undefined) {
    const month0 = MONTHS[m[1].toLowerCase()];
    const day = parseInt(m[2], 10);
    const year = normaliseYear(m[3] || '', fallbackYear);
    if (isValidDayMonth(day, month0, year)) {
      return {date: new Date(year, month0, day), span: [m.index, m.index + m[0].length], ambiguous: false};
    }
  }

  m = text.match(dayFirst);
  if (m && m.index !== undefined) {
    const day = parseInt(m[1], 10);
    const month0 = MONTHS[m[2].toLowerCase()];
    const year = normaliseYear(m[3] || '', fallbackYear);
    if (isValidDayMonth(day, month0, year)) {
      return {date: new Date(year, month0, day), span: [m.index, m.index + m[0].length], ambiguous: false};
    }
  }

  return null;
}

interface TimeMatch {
  hours: number;
  minutes: number;
  span: [number, number];
}

/**
 * Clock times: "10:00A", "10am", "2:30 PM", "14:00", "14h00", "1000".
 * Bare 3–4 digit forms are only accepted with an explicit marker or a leading
 * "at", because a bare "1000" is far more likely to be a quantity than a time.
 */
function matchTime(text: string): TimeMatch | null {
  const colon = text.match(/\b(\d{1,2})[:h.](\d{2})\s*([ap])\.?m?\.?\b/i) || text.match(/\b(\d{1,2})[:h](\d{2})\b/);
  if (colon && colon.index !== undefined) {
    let hours = parseInt(colon[1], 10);
    const minutes = parseInt(colon[2], 10);
    const meridiem = colon[3]?.toLowerCase();
    if (minutes > 59) return null;
    if (meridiem === 'p' && hours < 12) hours += 12;
    if (meridiem === 'a' && hours === 12) hours = 0;
    if (hours > 23) return null;
    return {hours, minutes, span: [colon.index, colon.index + colon[0].length]};
  }

  const bare = text.match(/\b(\d{1,2})\s*([ap])\.?m\.?\b/i);
  if (bare && bare.index !== undefined) {
    let hours = parseInt(bare[1], 10);
    const meridiem = bare[2].toLowerCase();
    if (hours > 12) return null;
    if (meridiem === 'p' && hours < 12) hours += 12;
    if (meridiem === 'a' && hours === 12) hours = 0;
    return {hours, minutes: 0, span: [bare.index, bare.index + bare[0].length]};
  }

  const at = text.match(/\bat\s+(\d{1,2})(\d{2})\b/i);
  if (at && at.index !== undefined) {
    const hours = parseInt(at[1], 10);
    const minutes = parseInt(at[2], 10);
    if (hours > 23 || minutes > 59) return null;
    return {hours, minutes, span: [at.index, at.index + at[0].length]};
  }

  return null;
}

/** Punctuation people write between a date and a time: "09-01 / 1:00AM". */
const PUNCT_ONLY = /^[-–—/\\,:;.|·•]+$/;

function stripSpans(text: string, spans: Array<[number, number]>): string {
  const ordered = [...spans].sort((a, b) => b[0] - a[0]);
  let out = text;
  for (const [start, end] of ordered) {
    out = out.slice(0, start) + ' ' + out.slice(end);
  }

  // Removing the date and time spans can strand the separator that sat
  // between them, which then leads the title ("/ Dentist"). Drop any token
  // that is nothing but punctuation, wherever it ended up.
  return out
    .split(/\s+/)
    .filter(token => token.length > 0 && !PUNCT_ONLY.test(token))
    .join(' ')
    .replace(/^[-–—/\\,:;.|·•\s]+/, '')
    .replace(/[-–—/\\,:;.|·•\s]+$/, '')
    .trim();
}

function formatInterpretation(result: Omit<ParsedCapture, 'interpretation'>, timeFormat: TimeFormat = '12h'): string {
  if (result.kind === 'task') {
    return `Task${result.date ? ` · ${formatDate(result.date)}` : ''}`;
  }
  const parts = ['Event'];
  if (result.date) parts.push(formatDate(result.date));
  if (!result.allDay && result.hours !== undefined) {
    parts.push(formatTimeOfDay(result.hours * 60 + (result.minutes ?? 0), timeFormat));
  } else {
    parts.push('all day');
  }
  return parts.join(' · ') + (result.ambiguousDateOrder ? ' (date order assumed)' : '');
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', {weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'});
}

export function parseCapturedText(
  text: string,
  opts?: {dateOrder?: DateOrder; now?: Date; timeFormat?: TimeFormat},
): ParsedCapture {
  const now = opts?.now ?? new Date();
  const order = opts?.dateOrder ?? 'MDY';
  // Writing spread over several lines comes back with newlines in it; collapse
  // them so a date split across lines still matches as one span.
  const source = (text || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

  const dateMatch =
    matchIsoDate(source) ??
    matchNamedDate(source, now.getFullYear()) ??
    matchNumericDate(source, order, now.getFullYear());
  const timeMatch = matchTime(source);

  const spans: Array<[number, number]> = [];
  if (dateMatch) spans.push(dateMatch.span);
  if (timeMatch) spans.push(timeMatch.span);

  const title = stripSpans(source, spans);

  // No date and no time => a to-do, dated today. This is the common case for
  // "email the professor about chapter 4".
  if (!dateMatch && !timeMatch) {
    const base: Omit<ParsedCapture, 'interpretation'> = {
      title,
      date: undefined,
      allDay: true,
      kind: 'task',
      ambiguousDateOrder: false,
    };
    return {...base, interpretation: formatInterpretation(base, opts?.timeFormat)};
  }

  const date = dateMatch
    ? new Date(dateMatch.date)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const base: Omit<ParsedCapture, 'interpretation'> = {
    title,
    date,
    hours: timeMatch?.hours,
    minutes: timeMatch?.minutes,
    allDay: !timeMatch,
    kind: 'event',
    ambiguousDateOrder: dateMatch?.ambiguous ?? false,
  };

  return {...base, interpretation: formatInterpretation(base, opts?.timeFormat)};
}
