import { CalendarEvent } from './types';


const pad = (n: number) => String(n).padStart(2, '0');

/** RFC 5545 UTC date-time form, e.g. 20260825T100000Z */
function formatIcsDateTime(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(
    d.getUTCMinutes()
  )}${pad(d.getUTCSeconds())}Z`;
}

/** RFC 5545 local DATE-TIME form in either the device or an explicit IANA zone. */
function formatIcsWallTime(d: Date, timeZone?: string): string {
  if (!timeZone) {
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(
      d.getMinutes()
    )}${pad(d.getSeconds())}`;
  }
  if (!/^[A-Za-z0-9._+/-]+$/.test(timeZone)) throw new Error('Invalid calendar timezone');
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map(part => [part.type, part.value])
  );
  return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}`;
}

function formatTimedProperty(name: 'DTSTART' | 'DTEND' | 'EXDATE', d: Date, event: CalendarEvent): string {
  if (event.recurrenceValueType === 'zoned' && event.recurrenceTimeZone) {
    return `${name};TZID=${event.recurrenceTimeZone}:${formatIcsWallTime(d, event.recurrenceTimeZone)}`;
  }
  if (event.recurrenceValueType === 'floating' || (!event.recurrenceValueType && event.rrule)) {
    return `${name}:${formatIcsWallTime(d)}`;
  }
  return `${name}:${formatIcsDateTime(d)}`;
}

/** RFC 5545 DATE form for all-day events, e.g. 20260825 */
function formatIcsDate(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function legacyTimedException(key: string, event: CalendarEvent): Date | undefined {
  const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const date = new Date(event.start);
  date.setFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) return undefined;
  return date;
}

/**
 * Escapes an RFC 5545 TEXT value. Backslash must be escaped first so the
 * escapes introduced below are not themselves re-escaped.
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Folds a content line to 75 octets per RFC 5545 section 3.1. Counting is by
 * UTF-8 byte length, not characters, and a multi-byte sequence is never split
 * across a fold boundary.
 */
export function foldIcsLine(line: string): string {
  const octets = (s: string) => {
    let n = 0;
    for (const ch of s) {
      const cp = ch.codePointAt(0) as number;
      n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    }
    return n;
  };

  if (octets(line) <= 75) return line;

  const parts: string[] = [];
  let current = '';
  let limit = 75;

  for (const ch of line) {
    if (octets(current) + octets(ch) > limit) {
      parts.push(current);
      current = '';
      // Continuation lines carry a leading space that counts toward the 75.
      limit = 74;
    }
    current += ch;
  }
  if (current) parts.push(current);

  return parts.join('\r\n ');
}


/**
 * Generates an RFC 5545 VCALENDAR / VEVENT ICS string for outbound CalDAV export.
 *
 * DTSTAMP is mandatory in a VEVENT; iCloud rejects the PUT with HTTP 400 without it.
 * All-day events use the DATE value type with a non-inclusive DTEND, per spec.
 */
export function generateOutboundIcsEvent(event: CalendarEvent): string {
  const dtStamp = formatIcsDateTime(new Date());

  const dateLines = event.allDay
    ? [`DTSTART;VALUE=DATE:${formatIcsDate(event.start)}`, `DTEND;VALUE=DATE:${formatIcsDate(event.end)}`]
    : [formatTimedProperty('DTSTART', event.start, event), formatTimedProperty('DTEND', event.end, event)];
  const exceptionLines: string[] = [];
  if (event.allDay && event.exceptionDates?.length) {
    exceptionLines.push(`EXDATE;VALUE=DATE:${event.exceptionDates.map(d => d.replace(/-/g, '')).join(',')}`);
  } else if (!event.allDay) {
    // Older saved events used device-local date keys. They can be upgraded
    // without guessing only when the recurrence is floating or has no domain metadata.
    const legacyExceptions = !event.recurrenceValueType || event.recurrenceValueType === 'floating'
      ? (event.exceptionDates || []).map(key => legacyTimedException(key, event))
      : [];
    const exceptionInstants = [
      ...legacyExceptions,
      ...(event.recurrenceExceptionInstants || []).map(value => new Date(value)),
    ]
      .filter((date): date is Date => date instanceof Date && !Number.isNaN(date.getTime()))
      .map(date => formatTimedProperty('EXDATE', date, event));
    if (exceptionInstants.length) {
      const unique = [...new Set(exceptionInstants)];
      const prefix = unique[0].slice(0, unique[0].indexOf(':') + 1);
      exceptionLines.push(`${prefix}${unique.map(line => line.slice(prefix.length)).join(',')}`);
    }
  }
  const organizerLine = event.organizer?.email
    ? `ORGANIZER${event.organizer.name ? `;CN=${escapeIcsText(event.organizer.name)}` : ''}:mailto:${event.organizer.email}`
    : '';
  const attendeeLines = event.attendees
    .filter(attendee => attendee.email)
    .map(attendee =>
      `ATTENDEE${attendee.name ? `;CN=${escapeIcsText(attendee.name)}` : ''}` +
      `${attendee.status ? `;PARTSTAT=${attendee.status}` : ''}:mailto:${attendee.email}`
    );
  const alarmLines = Number.isFinite(event.alarmMinutesBefore) && (event.alarmMinutesBefore as number) >= 0
    ? [
        `BEGIN:VALARM`,
        `TRIGGER:${event.alarmMinutesBefore === 0 ? 'PT0M' : `-PT${event.alarmMinutesBefore}M`}`,
        `ACTION:DISPLAY`,
        `DESCRIPTION:${escapeIcsText(event.summary)}`,
        `END:VALARM`,
      ]
    : [];

  const lines = [
    `BEGIN:VCALENDAR`,
    `VERSION:2.0`,
    `PRODID:-//SNFolio for Supernote//EN`,
    `CALSCALE:GREGORIAN`,
    `BEGIN:VEVENT`,
    `UID:${escapeIcsText(event.uid)}`,
    `DTSTAMP:${dtStamp}`,
    `SUMMARY:${escapeIcsText(event.summary)}`,
    event.isTaskMirror ? `X-SNFOLIO-TASK-MIRROR:TRUE` : '',
    ...dateLines,
    event.location ? `LOCATION:${escapeIcsText(event.location)}` : '',
    event.description ? `DESCRIPTION:${escapeIcsText(event.description)}` : '',
    event.rrule ? `RRULE:${event.rrule}` : '',
    ...exceptionLines,
    organizerLine,
    ...attendeeLines,
    ...alarmLines,
    `END:VEVENT`,
    `END:VCALENDAR`,
  ].filter(Boolean);

  // Trailing CRLF: every content line is terminated, including the last.
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

/**
 * Generates an RFC 5545 VCALENDAR / VTODO string for outbound CalDAV export.
 *
 * A task is a VTODO, not a VEVENT — that is what makes it land in Apple
 * Reminders rather than appearing as an event on the calendar. VTODO uses DUE
 * for its deadline and has no DTEND; a start time is optional and omitted here
 * because the plugin only captures a due date.
 */
export function generateOutboundIcsTodo(task: CalendarEvent): string {
  const dtStamp = formatIcsDateTime(new Date());
  const completed = task.completed === true;

  // Strip the legacy display marker so Reminders shows a clean title.
  const summary = task.summary.replace(/^\[TASK\]\s*/i, '');

  const dueLine = task.undatedTask
    ? ''
    : task.allDay
      ? `DUE;VALUE=DATE:${formatIcsDate(task.start)}`
      : `DUE:${formatIcsDateTime(task.start)}`;

  const lines = [
    `BEGIN:VCALENDAR`,
    `VERSION:2.0`,
    `PRODID:-//SNFolio for Supernote//EN`,
    `CALSCALE:GREGORIAN`,
    `BEGIN:VTODO`,
    `UID:${escapeIcsText(task.uid)}`,
    `DTSTAMP:${dtStamp}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    dueLine,
    `STATUS:${completed ? 'COMPLETED' : 'NEEDS-ACTION'}`,
    `PERCENT-COMPLETE:${completed ? 100 : 0}`,
    task.priority && task.priority > 1
      ? `PRIORITY:${task.priority === 4 ? 1 : task.priority === 3 ? 5 : 7}`
      : '',
    completed ? `COMPLETED:${dtStamp}` : '',
    task.description ? `DESCRIPTION:${escapeIcsText(task.description)}` : '',
    `END:VTODO`,
    `END:VCALENDAR`,
  ].filter(Boolean);

  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}
