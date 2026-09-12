import ICAL from 'ical.js';
import moment from 'moment-timezone';
import windowsZones from './windowsTimezones.json';

export type TimezoneDefinitions = Record<string, string>;
export interface WallFields {
  year: number; month: number; day: number; hour: number; minute: number; second: number;
}

/** CLDR 47 global Windows mappings; timezone rules are bundled with moment-timezone. */
export function canonicalTimezone(id: string): string | undefined {
  const alias = (windowsZones as Record<string, string>)[id];
  const mapped = typeof alias === 'string' ? alias : id;
  return moment.tz.zone(mapped)?.name;
}

// Cache by the definition itself, never by TZID alone: different files may reuse a name.
const definitionCache = new Map<string, ICAL.Timezone>();
function embeddedZone(id: string, definitions?: TimezoneDefinitions): ICAL.Timezone | undefined {
  const source = definitions?.[id];
  if (!source) return undefined;
  let zone = definitionCache.get(source);
  if (!zone) {
    const root = new ICAL.Component(ICAL.parse(source));
    const component = root.getFirstSubcomponent('vtimezone');
    if (!component) throw new Error('Missing VTIMEZONE component');
    zone = new ICAL.Timezone({ component, tzid: id });
    if (definitionCache.size >= 64) definitionCache.clear();
    definitionCache.set(source, zone);
  }
  return zone;
}

export function readTimezoneDefinitions(content: string): TimezoneDefinitions {
  const definitions: TimezoneDefinitions = Object.create(null);
  const blocks = content.match(/BEGIN:VTIMEZONE\s*[\s\S]*?END:VTIMEZONE/gi) || [];
  for (const block of blocks) {
    if (block.length > 200000 || blocks.length > 128) throw new Error('Calendar timezone definitions exceed supported limits.');
    const source = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${block}\r\nEND:VCALENDAR`;
    const root = new ICAL.Component(ICAL.parse(source));
    const component = root.getFirstSubcomponent('vtimezone');
    const id = component?.getFirstPropertyValue('tzid');
    if (typeof id !== 'string' || !id || /[\r\n]/.test(id)) throw new Error('Invalid calendar timezone identifier.');
    if (definitions[id] && definitions[id] !== source) throw new Error(`Conflicting timezone definitions: ${id.slice(0, 80)}`);
    const observances = component!.getAllSubcomponents();
    if (!observances.length) {
      if (canonicalTimezone(id)) continue;
      throw new Error(`Timezone ${id.slice(0, 80)} has no rules and is not recognized.`);
    }
    for (const rule of observances) {
      if (!['standard', 'daylight'].includes(rule.name) || !rule.hasProperty('dtstart') ||
          !rule.hasProperty('tzoffsetfrom') || !rule.hasProperty('tzoffsetto')) {
        throw new Error(`Incomplete timezone rules: ${id.slice(0, 80)}`);
      }
      const recurrence = rule.getFirstPropertyValue('rrule');
      if (recurrence) {
        const parts = recurrence.toString().split(';');
        const supported = new Set(['FREQ', 'UNTIL', 'COUNT', 'INTERVAL', 'BYMONTH', 'BYDAY', 'BYMONTHDAY']);
        if (!parts.includes('FREQ=YEARLY') || parts.some(part => !supported.has(part.split('=')[0]) || part.length > 100)) {
          throw new Error(`Unsupported timezone transition rule: ${id.slice(0, 80)}`);
        }
      }
    }
    definitions[id] = source;
  }
  return definitions;
}

export function timezoneFields(date: Date, id: string, definitions?: TimezoneDefinitions): WallFields {
  const embedded = embeddedZone(id, definitions);
  if (embedded) {
    const time = ICAL.Time.fromJSDate(date, true).convertToZone(embedded);
    return { year: time.year, month: time.month - 1, day: time.day, hour: time.hour, minute: time.minute, second: time.second };
  }
  const name = canonicalTimezone(id);
  if (!name) throw new Error(`Unsupported calendar timezone: ${id.slice(0, 80)}`);
  const time = moment.tz(date, name);
  return { year: time.year(), month: time.month(), day: time.date(), hour: time.hour(), minute: time.minute(), second: time.second() };
}

/** Preserve RFC gap/fold behavior from the existing recurrence implementation. */
export function timezoneDate(fields: WallFields, id: string, definitions?: TimezoneDefinitions, generated = false): Date {
  const desired = Date.UTC(fields.year, fields.month, fields.day, fields.hour, fields.minute, fields.second);
  const offsetAt = (instant: number) => {
    const f = timezoneFields(new Date(instant), id, definitions);
    return Date.UTC(f.year, f.month, f.day, f.hour, f.minute, f.second) - instant;
  };
  const offsets = [...new Set([-36, -12, 0, 12, 36].map(h => offsetAt(desired + h * 3600000)))];
  const candidates = offsets.map(offset => desired - offset).filter(instant => {
    const f = timezoneFields(new Date(instant), id, definitions);
    return f.year === fields.year && f.month === fields.month && f.day === fields.day &&
      f.hour === fields.hour && f.minute === fields.minute && f.second === fields.second;
  }).sort((a, b) => a - b);
  if (candidates.length) return new Date(candidates[0]);
  return generated ? new Date(Number.NaN) : new Date(desired - offsetAt(desired - 36 * 3600000));
}

export function exportTimezoneDefinitions(definitions?: TimezoneDefinitions): string[] {
  return Object.values(definitions || {}).flatMap(source => {
    const component = new ICAL.Component(ICAL.parse(source)).getFirstSubcomponent('vtimezone');
    if (!component) throw new Error('Missing saved timezone definition');
    return component.toString().split(/\r?\n/).filter(Boolean);
  });
}
