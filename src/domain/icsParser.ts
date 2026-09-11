import { Attendee, CalendarEvent } from './types';

/**
 * Unfolds folded lines in ICS files as specified in RFC 5545 (line ending + whitespace)
 */
export function unfoldIcsContent(icsData: string): string[] {
  const lines = icsData.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const unfolded: string[] = [];

  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }

  return unfolded;
}

/**
 * Unescapes ICS string values
 */
export function unescapeIcsValue(val: string): string {
  return val
    .replace(/\\\\/g, '\\')
    .replace(/\\;/g, ';')
    .replace(/\\,/g, ',')
    .replace(/\\n/gi, '\n');
}

/**
 * Parses ICS date strings into JS Date objects
 */
export function parseIcsDate(datePropStr: string): { date: Date; allDay: boolean } {
  let valStr = datePropStr;
  let allDay = false;

  if (datePropStr.includes(':')) {
    const parts = datePropStr.split(':');
    const paramPart = parts[0];
    valStr = parts.slice(1).join(':');

    if (paramPart.includes('VALUE=DATE')) {
      allDay = true;
    }
  }

  valStr = valStr.trim();

  // All day YYYYMMDD
  if (valStr.length === 8 && !valStr.includes('T')) {
    const yr = parseInt(valStr.slice(0, 4), 10);
    const mo = parseInt(valStr.slice(4, 6), 10) - 1;
    const dy = parseInt(valStr.slice(6, 8), 10);
    return { date: new Date(yr, mo, dy, 0, 0, 0), allDay: true };
  }

  // YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
  const match = valStr.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (match) {
    const yr = parseInt(match[1], 10);
    const mo = parseInt(match[2], 10) - 1;
    const dy = parseInt(match[3], 10);
    const hr = parseInt(match[4], 10);
    const mn = parseInt(match[5], 10);
    const sc = parseInt(match[6], 10);
    const isUtc = match[7] === 'Z';

    if (isUtc) {
      return { date: new Date(Date.UTC(yr, mo, dy, hr, mn, sc)), allDay };
    }
    const tzid = datePropStr.match(/(?:^|;)TZID=([^;:]+)/i)?.[1]?.replace(/^"|"$/g, '');
    if (tzid) {
      return { date: zonedDate(yr, mo, dy, hr, mn, sc, tzid), allDay };
    }
    return { date: new Date(yr, mo, dy, hr, mn, sc), allDay };
  }

  const fallback = new Date(valStr);
  return { date: fallback, allDay };
}

/** Converts wall-clock fields in an IANA zone to an absolute Date. */
function zonedDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
  generated = false
): Date {
  const desired = Date.UTC(year, month, day, hour, minute, second);
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });

    const representedFields = (instant: number): CalendarFields => {
      const parts = Object.fromEntries(
        formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value])
      );
      return {
        year: Number(parts.year),
        month: Number(parts.month) - 1,
        day: Number(parts.day),
        hour: Number(parts.hour),
        minute: Number(parts.minute),
        second: Number(parts.second),
      };
    };
    const offsetAt = (instant: number): number => {
      const fields = representedFields(instant);
      return Date.UTC(
        fields.year, fields.month, fields.day,
        fields.hour, fields.minute, fields.second
      ) - instant;
    };
    const desiredFields: CalendarFields = { year, month, day, hour, minute, second };
    const sameFields = (fields: CalendarFields): boolean =>
      fields.year === desiredFields.year &&
      fields.month === desiredFields.month &&
      fields.day === desiredFields.day &&
      fields.hour === desiredFields.hour &&
      fields.minute === desiredFields.minute &&
      fields.second === desiredFields.second;

    const sampleOffsets = [...new Set([
      offsetAt(desired - 36 * 60 * 60 * 1000),
      offsetAt(desired - 12 * 60 * 60 * 1000),
      offsetAt(desired),
      offsetAt(desired + 12 * 60 * 60 * 1000),
      offsetAt(desired + 36 * 60 * 60 * 1000),
    ])];
    const exactCandidates = sampleOffsets
      .map(offset => desired - offset)
      .filter(instant => sameFields(representedFields(instant)))
      .sort((a, b) => a - b);

    if (exactCandidates.length > 0) {
      // RFC 5545 chooses the first occurrence when a wall time is repeated.
      return new Date(exactCandidates[0]);
    }

    if (generated) {
      // A recurrence-generated nonexistent local time is omitted and does not
      // consume COUNT.
      return new Date(Number.NaN);
    }

    // An explicitly supplied gap time uses the UTC offset immediately before
    // the discontinuity.
    return new Date(desired - offsetAt(desired - 36 * 60 * 60 * 1000));
  } catch (_error) {
    return new Date(Number.NaN);
  }
}

type CalendarFields = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function calendarFields(date: Date, timeZone?: string): CalendarFields {
  if (!timeZone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth(),
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
    };
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(date).map(part => [part.type, part.value])
    );
    return {
      year: Number(parts.year),
      month: Number(parts.month) - 1,
      day: Number(parts.day),
      hour: Number(parts.hour),
      minute: Number(parts.minute),
      second: Number(parts.second),
    };
  } catch (_error) {
    return calendarFields(date);
  }
}

function localDateKey(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

type RecurrenceValueType = NonNullable<CalendarEvent['recurrenceValueType']>;
type ParsedCalendarEvent = CalendarEvent & {
  cancelled?: boolean;
  recurrenceIdAllDay?: boolean;
};
const MAX_RECURRENCE_SCAN_DAYS = 100000;

/**
 * Bounds a server-supplied fragment before it is quoted into a stored warning.
 * These strings persist on the event and are rendered, so an unbounded RRULE
 * token from a hostile or broken server must not become an unbounded record.
 */
function quoteRruleToken(token: string): string {
  return token.length > 40 ? `${token.slice(0, 40)}…` : token;
}

function validateRrule(rrule: string, valueType: RecurrenceValueType): string | undefined {
  const supportedParts = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'WKST']);
  const parsed: Record<string, string> = {};

  for (const rawPart of rrule.split(';')) {
    const at = rawPart.indexOf('=');
    if (at <= 0 || at === rawPart.length - 1) return 'RRULE contains a malformed part';
    const key = rawPart.slice(0, at).toUpperCase();
    const value = rawPart.slice(at + 1).toUpperCase();
    if (parsed[key] !== undefined) return `RRULE contains duplicate ${quoteRruleToken(key)}`;
    if (!supportedParts.has(key)) return `RRULE part ${quoteRruleToken(key)} is unsupported`;
    parsed[key] = value;
  }

  const freq = parsed.FREQ;
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) {
    return 'RRULE requires a supported FREQ';
  }
  if (parsed.COUNT && parsed.UNTIL) return 'RRULE cannot contain both COUNT and UNTIL';
  if (parsed.INTERVAL && !/^[1-9]\d*$/.test(parsed.INTERVAL)) {
    return 'RRULE INTERVAL must be a positive integer';
  }
  if (parsed.COUNT && !/^[1-9]\d*$/.test(parsed.COUNT)) {
    return 'RRULE COUNT must be a positive integer';
  }

  if (parsed.UNTIL) {
    const isDate = /^\d{8}$/.test(parsed.UNTIL);
    const isUtcDateTime = /^\d{8}T\d{6}Z$/.test(parsed.UNTIL);
    const isFloatingDateTime = /^\d{8}T\d{6}$/.test(parsed.UNTIL);
    const validUntil =
      (valueType === 'date' && isDate) ||
      (valueType === 'floating' && isFloatingDateTime) ||
      ((valueType === 'utc' || valueType === 'zoned') && isUtcDateTime);
    if (!validUntil) return `RRULE UNTIL does not match ${valueType} DTSTART`;
  }

  if (parsed.BYDAY) {
    const tokens = parsed.BYDAY.split(',');
    for (const token of tokens) {
      const match = token.match(/^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/);
      if (!match) return `RRULE BYDAY token ${quoteRruleToken(token)} is invalid`;
      if (match[1]) {
        const ordinal = Number(match[1]);
        if (ordinal === 0 || Math.abs(ordinal) > 5) return `RRULE BYDAY ordinal ${match[1]} is invalid`;
        if (freq !== 'MONTHLY') return 'Ordinal BYDAY is supported only for MONTHLY rules';
      }
    }
    if (freq === 'YEARLY') return 'YEARLY BYDAY is unsupported';
    if (freq === 'MONTHLY' && Number(parsed.INTERVAL || '1') > 1 &&
        tokens.some(token => /^[+-]?5(?:SU|MO|TU|WE|TH|FR|SA)$/.test(token))) {
      return 'Fifth-weekday MONTHLY rules with INTERVAL greater than one are unsupported';
    }
  }

  // WKST fixes where each interval week begins. It only changes a schedule for
  // WEEKLY rules with INTERVAL greater than one, but it is accepted for any
  // rule because calendar servers emit it routinely — Google sends WKST=SU on
  // ordinary weekly events — and rejecting it would quarantine those series.
  if (parsed.WKST && !['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].includes(parsed.WKST)) {
    return `RRULE WKST value ${quoteRruleToken(parsed.WKST)} is invalid`;
  }

  if (parsed.BYMONTHDAY) {
    if (freq !== 'MONTHLY') return 'BYMONTHDAY is supported only for MONTHLY rules';
    for (const token of parsed.BYMONTHDAY.split(',')) {
      if (!/^[+-]?\d{1,2}$/.test(token)) return `RRULE BYMONTHDAY token ${quoteRruleToken(token)} is invalid`;
      const day = Number(token);
      if (day === 0 || Math.abs(day) > 31) return `RRULE BYMONTHDAY value ${token} is invalid`;
    }
  }

  // COUNT rules that cannot be fast-forwarded must fit inside the bounded
  // day-by-day expansion horizon. Reject oversized rules visibly rather than
  // returning a plausible but truncated schedule.
  if (parsed.COUNT && !(freq === 'DAILY' && !parsed.BYDAY && valueType === 'utc')) {
    const count = Number(parsed.COUNT);
    const interval = Number(parsed.INTERVAL || '1');
    let worstHorizonDays: number;
    if (freq === 'DAILY') {
      worstHorizonDays = count * interval * (parsed.BYDAY ? 7 : 1);
    } else if (freq === 'WEEKLY') {
      worstHorizonDays = count * interval * 7;
    } else if (freq === 'MONTHLY' && parsed.BYDAY && parsed.BYMONTHDAY) {
      // Intersecting weekday and month-day filters can be sparse across the
      // 400-year Gregorian cycle, so accept only a deliberately small horizon.
      worstHorizonDays = count * interval * 14610;
    } else if (freq === 'MONTHLY' && parsed.BYDAY) {
      // A fifth weekday may skip months, but always recurs within a quarter.
      worstHorizonDays = count * interval * 93;
    } else if (freq === 'MONTHLY') {
      // February 29 can be eight years apart across a non-leap century. Scale
      // that bound when the rule skips more than twelve months per period.
      worstHorizonDays = count * 2928 * Math.max(1, Math.ceil(interval / 12));
    } else {
      // YEARLY is limited to DTSTART's month/day; February 29 is the sparse case.
      worstHorizonDays = count * interval * 2928;
    }
    if (worstHorizonDays > MAX_RECURRENCE_SCAN_DAYS) {
      return 'RRULE COUNT exceeds the supported expansion horizon';
    }
  }

  return undefined;
}

/**
 * Parses attendee line into Attendee object
 */
export function parseAttendee(line: string): Attendee {
  const colonIdx = line.indexOf(':');
  const paramPart = colonIdx >= 0 ? line.slice(0, colonIdx) : line;
  const valuePart = colonIdx >= 0 ? line.slice(colonIdx + 1) : '';

  let name: string | undefined;
  let email: string | undefined;
  let status: Attendee['status'] = 'NEEDS-ACTION';

  const params = paramPart.split(';');
  for (const param of params) {
    const [k, v] = param.split('=');
    if (!k || !v) continue;
    const cleanV = v.replace(/^"/, '').replace(/"$/, '');
    if (k.toUpperCase() === 'CN') {
      name = cleanV;
    } else if (k.toUpperCase() === 'PARTSTAT') {
      const p = cleanV.toUpperCase();
      if (p === 'ACCEPTED') status = 'ACCEPTED';
      else if (p === 'DECLINED') status = 'DECLINED';
      else if (p === 'TENTATIVE') status = 'TENTATIVE';
      else status = 'NEEDS-ACTION';
    }
  }

  if (valuePart.toLowerCase().startsWith('mailto:')) {
    email = valuePart.slice(7);
  } else if (valuePart) {
    email = valuePart;
  }

  if (!name && email) {
    name = email.split('@')[0];
  }

  return { name, email, status };
}

/**
 * Parses raw ICS content string into an array of CalendarEvents
 */
export function parseIcsContent(icsData: string, calendarName = 'Calendar'): CalendarEvent[] {
  const lines = unfoldIcsContent(icsData);
  const events: ParsedCalendarEvent[] = [];

  let inEvent = false;
  let componentKind: 'VEVENT' | 'VTODO' = 'VEVENT';
  let currentEvent: Partial<ParsedCalendarEvent> & { actionItems?: string[] } = {};
  let eventCounter = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT' || trimmed === 'BEGIN:VTODO') {
      inEvent = true;
      componentKind = trimmed === 'BEGIN:VTODO' ? 'VTODO' : 'VEVENT';
      eventCounter++;
      currentEvent = {
        attendees: [],
        actionItems: [],
        calendarName,
      };
      continue;
    }

    if (trimmed === 'END:VEVENT' || trimmed === 'END:VTODO') {
      if (inEvent) {
        const uid = currentEvent.uid || `evt-auto-${Date.now()}-${eventCounter}`;
        if (componentKind === 'VEVENT' && !currentEvent.start) {
          if (currentEvent.cancelled && currentEvent.recurrenceId) {
            currentEvent.start = currentEvent.recurrenceId;
          } else {
            inEvent = false;
            currentEvent = {};
            continue;
          }
        }
        const start = currentEvent.start || new Date(0);
        const defaultEnd = new Date(start);
        if (currentEvent.allDay) {
          defaultEnd.setDate(defaultEnd.getDate() + 1);
        } else {
          defaultEnd.setHours(defaultEnd.getHours() + 1);
        }
        const end = currentEvent.end || defaultEnd;
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
          inEvent = false;
          currentEvent = {};
          continue;
        }
        if (end < start) {
          inEvent = false;
          currentEvent = {};
          continue;
        }
        const recurrenceValueType = currentEvent.recurrenceValueType ??
          (currentEvent.allDay ? 'date' : currentEvent.timeZone ? 'zoned' : 'floating');
        const recurrenceError = currentEvent.recurrenceError ??
          (currentEvent.rrule ? validateRrule(currentEvent.rrule, recurrenceValueType) : undefined);
        events.push({
          uid,
          summary: currentEvent.summary || '(No Title)',
          description: currentEvent.description,
          location: currentEvent.location,
          start,
          end,
          allDay: currentEvent.allDay || false,
          isTask: componentKind === 'VTODO',
          undatedTask: componentKind === 'VTODO' && !currentEvent.start,
          completed: currentEvent.completed,
          priority: currentEvent.priority,
          organizer: currentEvent.organizer,
          attendees: currentEvent.attendees || [],
          actionItems: currentEvent.actionItems || [],
          rrule: currentEvent.rrule,
          recurringSeriesId: currentEvent.rrule || currentEvent.recurrenceId ? uid : undefined,
          recurrenceId: currentEvent.recurrenceId,
          exceptionDates: currentEvent.exceptionDates,
          recurrenceExceptionInstants: currentEvent.recurrenceExceptionInstants,
          timeZone: currentEvent.timeZone,
          recurrenceTimeZone: currentEvent.recurrenceTimeZone,
          recurrenceValueType,
          recurrenceError,
          // Kept internal until overrides are folded into their master below.
          ...(currentEvent.cancelled ? { cancelled: true } : {}),
          ...(currentEvent.recurrenceIdAllDay !== undefined
            ? { recurrenceIdAllDay: currentEvent.recurrenceIdAllDay }
            : {}),
          calendarName: currentEvent.calendarName,
          isTaskMirror: currentEvent.isTaskMirror,
        });
      }
      inEvent = false;
      currentEvent = {};
      continue;
    }

    if (!inEvent) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const propNameAndParams = trimmed.slice(0, colonIdx);
    const propVal = trimmed.slice(colonIdx + 1);

    const mainProp = propNameAndParams.split(';')[0].toUpperCase();

    switch (mainProp) {
      case 'UID':
        currentEvent.uid = propVal;
        break;
      case 'SUMMARY':
        currentEvent.summary = unescapeIcsValue(propVal);
        break;
      case 'X-SNFOLIO-TASK-MIRROR':
        currentEvent.isTaskMirror = propVal.trim().toUpperCase() === 'TRUE';
        break;
      case 'DESCRIPTION': {
        const unescaped = unescapeIcsValue(propVal);
        currentEvent.description = unescaped;
        // Parse line items as action items if bulleted
        const actionLines = unescaped
          .split('\n')
          .map(l => l.trim())
          .filter(l => l.startsWith('-') || l.startsWith('*') || /^\d+\./.test(l));
        if (actionLines.length > 0) {
          currentEvent.actionItems = actionLines.map(l => l.replace(/^[-*\d.]+\s*/, ''));
        }
        break;
      }
      case 'LOCATION':
        currentEvent.location = unescapeIcsValue(propVal);
        break;
      case 'DTSTART':
      case 'DUE': {
        const { date, allDay } = parseIcsDate(trimmed);
        const tzid = propNameAndParams.match(/(?:^|;)TZID=([^;:]+)/i)?.[1]?.replace(/^"|"$/g, '');
        const isUtc = /Z$/i.test(propVal.trim());
        currentEvent.start = date;
        currentEvent.allDay = allDay;
        currentEvent.timeZone = tzid;
        currentEvent.recurrenceTimeZone = tzid || (isUtc ? 'UTC' : undefined);
        currentEvent.recurrenceValueType = allDay ? 'date' : tzid ? 'zoned' : isUtc ? 'utc' : 'floating';
        if (allDay && tzid) currentEvent.recurrenceError = 'TZID is invalid on DATE DTSTART';
        if (isUtc && tzid) currentEvent.recurrenceError = 'TZID is invalid on UTC DTSTART';
        break;
      }
      case 'DTEND': {
        const { date } = parseIcsDate(trimmed);
        currentEvent.end = date;
        break;
      }
      case 'ORGANIZER': {
        const att = parseAttendee(trimmed);
        currentEvent.organizer = { name: att.name, email: att.email };
        break;
      }
      case 'ATTENDEE': {
        const att = parseAttendee(trimmed);
        if (!currentEvent.attendees) currentEvent.attendees = [];
        currentEvent.attendees.push(att);
        break;
      }
      case 'RRULE': {
        if (currentEvent.rrule) {
          currentEvent.recurrenceError = 'Multiple RRULE properties are unsupported';
        } else {
          currentEvent.rrule = propVal;
        }
        break;
      }
      case 'RDATE':
        currentEvent.recurrenceError = 'RDATE is unsupported';
        break;
      case 'EXDATE': {
        const parsedDates = propVal
          .split(',')
          .map(value => parseIcsDate(`${propNameAndParams}:${value}`))
          .filter(parsed => !Number.isNaN(parsed.date.getTime()));
        currentEvent.exceptionDates = [
          ...(currentEvent.exceptionDates || []),
          ...parsedDates.filter(parsed => parsed.allDay).map(parsed => localDateKey(parsed.date)),
        ];
        currentEvent.recurrenceExceptionInstants = [
          ...(currentEvent.recurrenceExceptionInstants || []),
          ...parsedDates.filter(parsed => !parsed.allDay).map(parsed => parsed.date.toISOString()),
        ];
        break;
      }
      case 'RECURRENCE-ID': {
        const recurrenceId = parseIcsDate(trimmed);
        currentEvent.recurrenceId = recurrenceId.date;
        currentEvent.recurrenceIdAllDay = recurrenceId.allDay;
        break;
      }
      case 'STATUS':
        if (componentKind === 'VTODO') {
          currentEvent.completed = propVal.toUpperCase() === 'COMPLETED';
        } else {
          currentEvent.cancelled = propVal.toUpperCase() === 'CANCELLED';
        }
        break;
      case 'PERCENT-COMPLETE':
        if (componentKind === 'VTODO' && Number(propVal) >= 100) currentEvent.completed = true;
        break;
      case 'PRIORITY': {
        const icalPriority = Number(propVal);
        if (componentKind === 'VTODO' && icalPriority > 0) {
          currentEvent.priority = icalPriority <= 2 ? 4 : icalPriority <= 5 ? 3 : icalPriority <= 8 ? 2 : 1;
        }
        break;
      }
    }
  }

  // A RECURRENCE-ID VEVENT has the same UID as its master. Fold it into the
  // series as an exception plus a standalone replacement so UID deduplication
  // cannot discard it.
  const masters = new Map(events.filter(e => e.rrule).map(e => [e.uid, e]));
  const output: CalendarEvent[] = [];
  for (const event of events) {
    if (!event.recurrenceId) {
      output.push(event);
      continue;
    }
    const master = masters.get(event.uid);
    const key = localDateKey(event.recurrenceId);
    if (master) {
      if (Boolean(event.recurrenceIdAllDay) !== master.allDay) {
        master.recurrenceError = master.recurrenceError ??
          'RECURRENCE-ID value type does not match DTSTART';
        continue;
      }
      if (event.recurrenceIdAllDay) {
        master.exceptionDates = [...new Set([...(master.exceptionDates || []), key])];
      } else {
        master.recurrenceExceptionInstants = [
          ...new Set([...(master.recurrenceExceptionInstants || []), event.recurrenceId.toISOString()]),
        ];
      }
    }
    if (!event.cancelled) {
      const replacement = { ...event };
      delete replacement.recurrenceIdAllDay;
      delete replacement.cancelled;
      output.push({
        ...replacement,
        recurrenceId: undefined,
        uid: `${event.uid}_${key}`,
        rrule: undefined,
        recurringSeriesId: event.uid,
      });
    }
  }
  return output;
}

/**
 * Whether an occupied interval touches a display range.
 *
 * End is exclusive, matching all-day DTEND semantics, so a normal event must
 * end strictly after the range opens. A zero-length event is a point in time
 * rather than an empty interval: the exclusive test would hide it on exactly
 * the day it belongs to whenever it starts at the range boundary, which for a
 * device-local day means every midnight event disappears entirely.
 */
function overlapsRange(start: Date, end: Date, rangeStart: Date, rangeEnd: Date): boolean {
  if (start > rangeEnd) return false;
  if (end.getTime() === start.getTime()) return start >= rangeStart;
  return end > rangeStart;
}

/**
 * Expands recurring events for a specific target day (or range)
 */
export function expandEventsForDate(events: CalendarEvent[], targetDate: Date): CalendarEvent[] {
  const result: CalendarEvent[] = [];
  const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0);
  const endOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59);

  for (const event of events) {
    if (!event.rrule) {
      // Include overnight and multi-day events on every day they overlap.
      if (overlapsRange(event.start, event.end, startOfDay, endOfDay)) {
        result.push(event);
      }
    } else if (event.recurrenceError) {
      // Preserve the explicitly supplied DTSTART but never invent later
      // occurrences from a rule that was not safely understood.
      if (overlapsRange(event.start, event.end, startOfDay, endOfDay)) result.push(event);
    } else {
      // Occurrences are generated from the recurrence's own timezone (see
      // expandRruleInstances) but are selected for display by instant against
      // the device-local day, exactly like the non-recurring branch above. A
      // zoned event and an identical zoned recurring event therefore appear on
      // the same device-local day even when that day differs from the day in
      // the event's source zone.
      const expandedInstances = expandRruleInstances(event, startOfDay, endOfDay);
      result.push(...expandedInstances);
    }
  }

  return result.sort((a, b) => a.start.getTime() - b.start.getTime());
}

function expandRruleInstances(event: CalendarEvent, rangeStart: Date, rangeEnd: Date): CalendarEvent[] {
  const instances: CalendarEvent[] = [];
  const rule = Object.fromEntries(
    (event.rrule || '').split(';').map(part => {
      const at = part.indexOf('=');
      return [part.slice(0, at).toUpperCase(), part.slice(at + 1).toUpperCase()];
    })
  );
  const freq = rule.FREQ;
  const interval = Math.max(1, Number.parseInt(rule.INTERVAL || '1', 10) || 1);
  const count = Math.max(0, Number.parseInt(rule.COUNT || '0', 10) || 0);
  const until = rule.UNTIL ? parseIcsDate(rule.UNTIL).date : null;
  const byDays = (rule.BYDAY || '').split(',').filter(Boolean);
  // An absent BYMONTHDAY is represented by an empty string. Number('') is 0,
  // so converting before filtering made a plain FREQ=MONTHLY rule look like
  // BYMONTHDAY=0 — a day that can never match. Keep only actual tokens first;
  // the normal monthly default below can then use DTSTART's day as intended.
  const byMonthDays = (rule.BYMONTHDAY || '')
    .split(',')
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);

  const origStart = event.start;
  const durationMs = event.end.getTime() - event.start.getTime();
  const allDayDurationDays = event.allDay
    ? Math.max(0, Math.round((
        Date.UTC(event.end.getFullYear(), event.end.getMonth(), event.end.getDate()) -
        Date.UTC(event.start.getFullYear(), event.start.getMonth(), event.start.getDate())
      ) / 86400000))
    : 0;

  if (origStart > rangeEnd) return instances;

  const weekday = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const recurrenceTimeZone = event.recurrenceTimeZone ?? event.timeZone;
  const original = calendarFields(origStart, recurrenceTimeZone);
  const startDay = new Date(Date.UTC(original.year, original.month, original.day));

  // RFC 5545 counts weekly intervals in whole calendar weeks that begin on
  // WKST (default Monday), not in seven-day blocks measured from DTSTART.
  // Measuring from DTSTART puts any BYDAY weekday that falls earlier in the
  // week than DTSTART's own weekday into the following week, which both
  // invents occurrences inside skipped weeks and hides the real ones.
  const wkstIndex = Math.max(0, weekday.indexOf(rule.WKST || 'MO'));
  const startWeekStart = new Date(startDay);
  startWeekStart.setUTCDate(
    startWeekStart.getUTCDate() - ((startDay.getUTCDay() - wkstIndex + 7) % 7)
  );

  const cur = new Date(startDay);

  // Walking one day at a time from DTSTART makes a distant query cost time
  // proportional to the gap, and any fixed step budget then silently truncates
  // a long-running series instead of reporting anything. Occurrences that end
  // before the requested range cannot be displayed, so when the rule has no
  // COUNT to honour the cursor may start at the last period boundary that can
  // still overlap. Simple UTC daily COUNT rules can also fast-forward because
  // every period consumes exactly one COUNT occurrence; other COUNT rules are
  // enumerated from the beginning within the validated scan horizon.
  let generated = 0;
  const countCanFastForward = freq === 'DAILY' && byDays.length === 0 &&
    event.recurrenceValueType === 'utc';
  if (count === 0 || countCanFastForward) {
    const earliest = new Date(rangeStart.getTime() - Math.max(0, durationMs));
    // One day of slack absorbs the offset between a UTC day cursor and the
    // recurrence's own zone.
    const targetDay = new Date(Date.UTC(
      earliest.getUTCFullYear(), earliest.getUTCMonth(), earliest.getUTCDate()
    ));
    targetDay.setUTCDate(targetDay.getUTCDate() - 1);

    if (targetDay > startDay) {
      const dayMs = 86400000;
      if (freq === 'DAILY') {
        const periods = Math.floor((targetDay.getTime() - startDay.getTime()) / dayMs / interval);
        if (periods > 0) {
          cur.setUTCDate(cur.getUTCDate() + periods * interval);
          if (count > 0) generated = periods;
        }
      } else if (freq === 'WEEKLY') {
        const weeksGap = Math.floor((targetDay.getTime() - startWeekStart.getTime()) / dayMs / 7);
        const periods = Math.floor(weeksGap / interval);
        if (periods > 0) {
          cur.setTime(startWeekStart.getTime() + periods * interval * 7 * dayMs);
          if (cur < startDay) cur.setTime(startDay.getTime());
        }
      } else if (freq === 'MONTHLY') {
        const monthsGap =
          (targetDay.getUTCFullYear() - original.year) * 12 +
          (targetDay.getUTCMonth() - original.month);
        const periods = Math.floor(monthsGap / interval);
        if (periods > 0) {
          cur.setTime(Date.UTC(original.year, original.month + periods * interval, 1));
          if (cur < startDay) cur.setTime(startDay.getTime());
        }
      } else if (freq === 'YEARLY') {
        const periods = Math.floor((targetDay.getUTCFullYear() - original.year) / interval);
        if (periods > 0) {
          cur.setTime(Date.UTC(original.year + periods * interval, original.month, 1));
          if (cur < startDay) cur.setTime(startDay.getTime());
        }
      }
    }
  }

  let examined = 0;
  while (examined < MAX_RECURRENCE_SCAN_DAYS) {
    examined++;
    const year = cur.getUTCFullYear();
    const month = cur.getUTCMonth();
    const day = cur.getUTCDate();
    const daysSince = Math.floor((cur.getTime() - startDay.getTime()) / 86400000);
    const candidate = daysSince === 0
      ? origStart
      : recurrenceTimeZone
        ? recurrenceTimeZone === 'UTC'
          ? new Date(Date.UTC(year, month, day, original.hour, original.minute, original.second))
          : zonedDate(year, month, day, original.hour, original.minute, original.second, recurrenceTimeZone, true)
        : new Date(year, month, day, original.hour, original.minute, original.second);
    const candidateIsValid = !Number.isNaN(candidate.getTime());
    if (candidateIsValid && candidate > rangeEnd) break;

    const monthsSince =
      (year - original.year) * 12 + month - original.month;
    const yearsSince = year - original.year;
    const simpleByDays = byDays.map(v => v.replace(/^[+-]?\d+/, ''));
    let matches = false;

    if (freq === 'DAILY') {
      matches = daysSince >= 0 && daysSince % interval === 0 &&
        (simpleByDays.length === 0 || simpleByDays.includes(weekday[cur.getUTCDay()]));
    } else if (freq === 'WEEKLY') {
      const week = Math.floor((cur.getTime() - startWeekStart.getTime()) / 86400000 / 7);
      const wanted = simpleByDays.length > 0 ? simpleByDays : [weekday[startDay.getUTCDay()]];
      matches = daysSince >= 0 && week % interval === 0 && wanted.includes(weekday[cur.getUTCDay()]);
    } else if (freq === 'MONTHLY') {
      const wantedDays = byMonthDays.length > 0 ? byMonthDays : [original.day];
      const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const numericMatch = wantedDays.some(d => day === (d < 0 ? last + d + 1 : d));
      const ordinalMatch = byDays.some(token => {
        const m = token.match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
        if (!m || weekday[cur.getUTCDay()] !== m[2]) return false;
        if (!m[1]) return true;
        const ordinal = Number(m[1]);
        const occurrence = ordinal > 0
          ? Math.floor((day - 1) / 7) + 1
          : -(Math.floor((last - day) / 7) + 1);
        return occurrence === ordinal;
      });
      matches = monthsSince >= 0 && monthsSince % interval === 0 &&
        (byDays.length === 0 || ordinalMatch) &&
        (byMonthDays.length > 0 ? numericMatch : byDays.length > 0 || numericMatch);
    } else if (freq === 'YEARLY') {
      matches = yearsSince >= 0 && yearsSince % interval === 0 &&
        month === original.month && day === original.day;
    }
    if (daysSince === 0) matches = true;

    if (matches && candidateIsValid) {
      generated++;
      if ((count > 0 && generated > count) || (until && candidate > until)) break;
    }

    if (matches && candidateIsValid) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const excludedByInstant = event.recurrenceExceptionInstants?.includes(candidate.toISOString());
      const excludedByDate = event.exceptionDates?.includes(dateStr);
      if (!excludedByInstant && !excludedByDate) {
        const instStart = candidate;
        const instEnd = event.allDay
          ? new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate() + allDayDurationDays)
          : new Date(candidate.getTime() + durationMs);
        const instanceUid = `${event.uid}_${dateStr}`;

        if (overlapsRange(instStart, instEnd, rangeStart, rangeEnd)) {
          instances.push({
            ...event,
            uid: instanceUid,
            start: instStart,
            end: instEnd,
            recurringSeriesId: event.uid,
          });
        }
      }
    }

    if (count > 0 && generated >= count) break;

    if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) break;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return instances;
}
