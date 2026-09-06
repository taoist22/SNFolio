export type RepeatChoice = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type RepeatEndMode = 'never' | 'until' | 'count';

export const WEEKDAY_OPTIONS = [
  { code: 'SU', short: 'Sun' },
  { code: 'MO', short: 'Mon' },
  { code: 'TU', short: 'Tue' },
  { code: 'WE', short: 'Wed' },
  { code: 'TH', short: 'Thu' },
  { code: 'FR', short: 'Fri' },
  { code: 'SA', short: 'Sat' },
] as const;

export type WeekdayCode = typeof WEEKDAY_OPTIONS[number]['code'];

export interface RepeatSettings {
  choice: RepeatChoice;
  interval: number;
  weekDays: WeekdayCode[];
  endMode: RepeatEndMode;
  until?: Date;
  count: number;
}

const pad = (value: number) => String(value).padStart(2, '0');

function ruleParts(rrule?: string): Record<string, string> {
  return Object.fromEntries(
    (rrule || '')
      .split(';')
      .map(part => part.split('='))
      .filter(pair => pair.length === 2)
      .map(([key, value]) => [key.toUpperCase(), value.toUpperCase()])
  );
}

/** The repeat frequencies SNFolio can create without exposing RRULE syntax. */
export function repeatChoiceFromRrule(rrule?: string): RepeatChoice {
  const frequency = ruleParts(rrule).FREQ;
  return ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(frequency)
    ? frequency.toLowerCase() as RepeatChoice
    : 'none';
}

function parseUntil(value?: string): Date | undefined {
  if (!value) {
    return undefined;
  }
  const utc = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (utc) {
    const instant = new Date(Date.UTC(
      Number(utc[1]), Number(utc[2]) - 1, Number(utc[3]),
      Number(utc[4]), Number(utc[5]), Number(utc[6])
    ));
    return new Date(instant.getFullYear(), instant.getMonth(), instant.getDate(), 23, 59, 59);
  }
  const match = value.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) {
    return undefined;
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59);
}

export function repeatSettingsFromRrule(rrule: string | undefined, start: Date): RepeatSettings {
  const parts = ruleParts(rrule);
  const choice = repeatChoiceFromRrule(rrule);
  const parsedDays = (parts.BYDAY || '')
    .split(',')
    .map(day => day.replace(/^[+-]?\d+/, ''))
    .filter((day): day is WeekdayCode => WEEKDAY_OPTIONS.some(option => option.code === day));
  const until = parseUntil(parts.UNTIL);
  const count = Math.max(1, Number.parseInt(parts.COUNT || '10', 10) || 10);
  return {
    choice,
    interval: Math.max(1, Number.parseInt(parts.INTERVAL || '1', 10) || 1),
    weekDays: parsedDays.length > 0
      ? parsedDays
      : [WEEKDAY_OPTIONS[start.getDay()].code],
    endMode: until ? 'until' : parts.COUNT ? 'count' : 'never',
    until,
    count,
  };
}

function dateValue(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function localDateTimeValue(date: Date): string {
  return `${dateValue(date)}T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** Builds the bounded RRULE subset exposed by the SNFolio event form. */
export function rruleForRepeat(
  settings: RepeatSettings,
  start: Date,
  allDay = false
): string | undefined {
  if (settings.choice === 'none') {
    return undefined;
  }

  const lines = [`FREQ=${settings.choice.toUpperCase()}`];
  const interval = Math.max(1, Math.round(settings.interval));
  if (interval > 1) {
    lines.push(`INTERVAL=${interval}`);
  }
  if (settings.choice === 'weekly') {
    const selected = WEEKDAY_OPTIONS
      .map(option => option.code)
      .filter(code => settings.weekDays.includes(code));
    lines.push(`BYDAY=${(selected.length > 0 ? selected : [WEEKDAY_OPTIONS[start.getDay()].code]).join(',')}`);
  }
  if (settings.endMode === 'count') {
    lines.push(`COUNT=${Math.max(1, Math.round(settings.count))}`);
  } else if (settings.endMode === 'until' && settings.until) {
    const inclusive = new Date(settings.until);
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    if (inclusive < startDay) {
      inclusive.setFullYear(startDay.getFullYear(), startDay.getMonth(), startDay.getDate());
    }
    if (allDay) {
      lines.push(`UNTIL=${dateValue(inclusive)}`);
    } else {
      inclusive.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
      lines.push(`UNTIL=${localDateTimeValue(inclusive)}`);
    }
  }
  return lines.join(';');
}
