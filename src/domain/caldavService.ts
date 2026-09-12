import { CalendarEvent } from './types';
import { generateOutboundIcsEvent, generateOutboundIcsTodo } from './noteExporter';
import { parseIcsContentStrict } from './icsParser';

/**
 * Items created before the isTask flag existed are identified by the legacy
 * "[TASK] " summary prefix, so stored data keeps routing correctly.
 */
export function isTaskItem(item: CalendarEvent): boolean {
  return item.isTask === true || /^\[TASK\]\s*/i.test(item.summary || '');
}

/**
 * Calendar VEVENTs created solely as an Apple-visible mirror of a local task.
 * New mirrors carry an explicit X-property. The UID fallback is limited to
 * CalDAV and the exact timestamp form SNFolio generated before that marker
 * existed, so an unrelated feed event named "task" is not hidden.
 */
export function isTaskMirrorEvent(item: CalendarEvent): boolean {
  return item.isTaskMirror === true ||
    (item.sourceKind === 'caldav' && /^task-\d+$/.test(item.uid || ''));
}

export type CaldavProviderType = 'icloud' | 'google' | 'nextcloud' | 'fastmail' | 'yahoo' | 'custom';

export interface CaldavCredentials {
  provider?: CaldavProviderType;
  appleId: string; // Used as username / email across providers
  appPassword?: string;
  calendarUrl?: string;
  /** VTODO-capable collection used by an independently configured task account. */
  taskListUrl?: string;
  customUrl?: string;
}

export interface CaldavTestResult {
  success: boolean;
  message: string;
  calendarUrl?: string;
  taskListUrl?: string;
  /** All compatible task lists, so the user can choose instead of guessing. */
  taskLists?: CalendarCollection[];
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

function toBase64(str: string): string {
  let output = '';
  let block = 0;
  for (let i = 0; i < str.length; i++) {
    block = (block << 8) | str.charCodeAt(i);
    if ((i + 1) % 3 === 0) {
      output += BASE64_CHARS.charAt((block >> 18) & 63);
      output += BASE64_CHARS.charAt((block >> 12) & 63);
      output += BASE64_CHARS.charAt((block >> 6) & 63);
      output += BASE64_CHARS.charAt(block & 63);
      block = 0;
    }
  }
  const rem = str.length % 3;
  if (rem === 1) {
    block = block << 16;
    output += BASE64_CHARS.charAt((block >> 18) & 63);
    output += BASE64_CHARS.charAt((block >> 12) & 63);
    output += '==';
  } else if (rem === 2) {
    block = block << 8;
    output += BASE64_CHARS.charAt((block >> 18) & 63);
    output += BASE64_CHARS.charAt((block >> 12) & 63);
    output += BASE64_CHARS.charAt((block >> 6) & 63);
    output += '=';
  }
  return output;
}

function makeBasicAuthHeader(username: string, password?: string): string {
  const raw = `${username.trim()}:${(password || '').trim()}`;
  return `Basic ${toBase64(raw)}`;
}

/**
 * Namespace-agnostic XML helper to extract href values from CalDAV responses
 * Handles <current-user-principal>, <DAV:current-user-principal>, <D:current-user-principal>, etc.
 */
export function extractHrefFromXml(xml: string, tagName: string): string | null {
  if (!xml) return null;

  // 1. Try matching with optional namespace prefix e.g. <DAV:tagName>...<DAV:href>url</DAV:href>
  const tagRegex = new RegExp(`(?:<[^:]+:${tagName}|<${tagName})[^>]*>[\\s\\S]*?(?:<[^:]+:href|<href)[^>]*>([^<]+)<\\/`, 'i');
  const match = xml.match(tagRegex);
  if (match && match[1]) {
    return match[1].trim();
  }

  // 2. Direct fallback for numeric DSID paths like /123456789/principal/ or /123456789/calendars/
  if (tagName === 'current-user-principal') {
    const dsidMatch = xml.match(/(\/[0-9]+\/principal\/)/i);
    if (dsidMatch && dsidMatch[1]) return dsidMatch[1].trim();
  }
  if (tagName === 'calendar-home-set') {
    const homeMatch = xml.match(/(\/[0-9]+\/calendars\/)/i);
    if (homeMatch && homeMatch[1]) return homeMatch[1].trim();
  }

  return null;
}

/**
 * Resolves an href returned by a CalDAV server against the URL that produced it.
 * Hrefs are frequently absolute paths, and iCloud moves the principal onto a
 * per-shard host (pNN-caldav.icloud.com), so the base must be the responding
 * URL rather than the original entry point.
 */
export function resolveUrl(baseUrl: string, href: string): string {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const originMatch = baseUrl.match(/^(https?:\/\/[^/]+)/i);
  const origin = originMatch ? originMatch[1] : baseUrl.replace(/\/$/, '');

  if (trimmed.startsWith('/')) return `${origin}${trimmed}`;
  return `${baseUrl.replace(/[^/]*$/, '')}${trimmed}`;
}

/** Splits a DAV multistatus body into its individual <response> blocks. */
export function splitMultistatusResponses(xml: string): string[] {
  if (!xml) return [];
  const blocks: string[] = [];
  const re = /<(?:[^:>\s]+:)?response[\s>][\s\S]*?<\/(?:[^:>\s]+:)?response>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    blocks.push(match[0]);
  }
  return blocks;
}

function readBlockHref(block: string): string {
  const m = block.match(/<(?:[^:>\s]+:)?href[^>]*>([^<]+)<\//i);
  return m ? m[1].trim() : '';
}

function readBlockEtag(block: string): string {
  const m = block.match(/<(?:[^:>\s]+:)?getetag[^>]*>([^<]*)<\//i);
  return m ? m[1].trim() : '';
}

function readBlockDisplayName(block: string): string {
  const m = block.match(/<(?:[^:>\s]+:)?displayname[^>]*>([^<]*)<\//i);
  return m ? m[1].trim() : '';
}

/**
 * True when the response block describes a real calendar collection —
 * <resourcetype> containing <calendar/> — and not a scheduling inbox/outbox.
 */
function isCalendarCollection(block: string): boolean {
  const rt = block.match(
    /<(?:[^:>\s]+:)?resourcetype[^>]*>([\s\S]*?)<\/(?:[^:>\s]+:)?resourcetype>/i
  );
  if (!rt) return false;
  if (/schedule-(inbox|outbox)/i.test(rt[1])) return false;
  return /<(?:[^:>\s]+:)?calendar[\s/>]/i.test(rt[1]);
}

/**
 * True when the collection accepts the given component type. An absent
 * supported-calendar-component-set means "any component", per RFC 4791.
 *
 * Apple mixes quoting styles within one document: the enclosing element is
 * double-quoted but the inner <comp name='VEVENT'/> is single-quoted.
 */
function supportsComponent(block: string, component: 'VEVENT' | 'VTODO'): boolean {
  const set = block.match(
    /<(?:[^:>\s]+:)?supported-calendar-component-set[^>]*>([\s\S]*?)<\/(?:[^:>\s]+:)?supported-calendar-component-set>/i
  );
  if (!set) return true;
  return new RegExp(`name\\s*=\\s*["']?${component}\\b`, 'i').test(set[1]);
}


/**
 * Pulls the iCalendar payload out of a <calendar-data> element.
 *
 * iCloud wraps it in CDATA; the spec permits XML-entity escaping instead, and
 * other servers do that. Handle both rather than assuming the one Apple
 * happens to use.
 */
export function extractCalendarData(responseBlock: string): string | null {
  const m = responseBlock.match(
    /<(?:[^:>\s]+:)?calendar-data[^>]*>([\s\S]*?)<\/(?:[^:>\s]+:)?calendar-data>/i
  );
  if (!m) return null;

  let payload = m[1];

  const cdata = payload.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cdata) {
    payload = cdata[1];
  } else {
    payload = payload
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }

  const trimmed = payload.trim();
  return trimmed.includes('BEGIN:VCALENDAR') ? trimmed : null;
}

/** UTC stamp in the form a time-range filter expects: 20260817T000000Z */
export function toCalDavStamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
  );
}

/** The calendar-query body asking for VEVENTs inside a window. */
export function buildCalendarQuery(start: Date, end: Date): string {
  return `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag />
    <C:calendar-data />
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${toCalDavStamp(start)}" end="${toCalDavStamp(end)}" />
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;
}

/** Requests all VTODO resources, including undated tasks that a time range would omit. */
export function buildTodoQuery(): string {
  return `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag /><C:calendar-data /></D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR"><C:comp-filter name="VTODO" /></C:comp-filter>
  </C:filter>
</C:calendar-query>`;
}

export interface CalendarCollection {
  url: string;
  displayName: string;
  supportsVEvent: boolean;
  supportsVTodo: boolean;
}

/**
 * Chooses the sync target from the discovered collections.
 *
 * Document order is not meaningful — on a typical iCloud account the first
 * entry is whatever third-party calendar sorted highest (a fitness tracker,
 * say), and the account's primary calendar sits further down. Prefer the one
 * named "Calendar", which is what iCloud calls the default, and fall back to
 * the first only when there is no such collection.
 */
export function chooseDefaultCollection(
  collections: CalendarCollection[]
): CalendarCollection | undefined {
  const eventCollections = collections.filter(c => c.supportsVEvent);
  if (eventCollections.length === 0) return undefined;
  const preferred = eventCollections.find(c => c.displayName.trim().toLowerCase() === 'calendar');
  return preferred || eventCollections[0];
}

/**
 * Chooses a VTODO collection independently of the event calendar. Some servers
 * expose task-only collections; iCloud's legacy result is intentionally ignored
 * by the higher-level iCloud connection flow.
 */
export function chooseDefaultTaskList(
  collections: CalendarCollection[]
): CalendarCollection | undefined {
  // Prefer a VTODO-only collection; a dual-capable collection may primarily be
  // intended for events.
  const todoOnly = collections.filter(c => c.supportsVTodo && !c.supportsVEvent);
  if (todoOnly.length > 0) {
    const named = todoOnly.find(c => c.displayName.trim().toLowerCase().includes('reminder'));
    return named || todoOnly[0];
  }
  return collections.find(c => c.supportsVTodo);
}

export class CaldavService {
  /**
   * Resolves the initial CalDAV entry server URL for a given provider preset
   */
  resolveProviderInitialUrl(provider?: CaldavProviderType, customUrl?: string): string {
    switch (provider) {
      case 'google':
        return 'https://apidata.googleusercontent.com/caldav/v2/';
      case 'fastmail':
        return 'https://caldav.fastmail.com/';
      case 'yahoo':
        return 'https://caldav.calendar.yahoo.com/';
      case 'nextcloud':
      case 'custom':
        if (customUrl && customUrl.trim()) {
          return customUrl.trim().startsWith('http') ? customUrl.trim() : `https://${customUrl.trim()}`;
        }
        return 'https://caldav.icloud.com/';
      case 'icloud':
      default:
        return 'https://caldav.icloud.com/';
    }
  }

  /**
   * Runs a 6-step interactive diagnostic trace outputting exact HTTP status, URLs, and probe results
   */
  async runCalDavDiagnostics(credentials: CaldavCredentials): Promise<string[]> {
    const logs: string[] = [];
    const log = (msg: string) => logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);

    log(`=== Starting CalDAV Diagnostics ===`);
    log(`Provider: ${credentials.provider || 'icloud'}`);
    log(`User Email: ${credentials.appleId || 'MISSING'}`);
    log(`Password Present: ${Boolean(credentials.appPassword)}`);

    if (!credentials.appleId || !credentials.appPassword) {
      log(`❌ ERROR: Missing credentials.`);
      return logs;
    }

    const authHeader = makeBasicAuthHeader(credentials.appleId, credentials.appPassword);
    const initialUrl = this.resolveProviderInitialUrl(credentials.provider, credentials.customUrl);
    log(`Step 1: Entry Server URL -> ${initialUrl}`);

    try {
      const propfindPrincipalXml = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:current-user-principal />
  </D:prop>
</D:propfind>`;

      log(`Step 2: Sending PROPFIND to entry URL...`);
      const res1 = await fetch(initialUrl, {
        method: 'PROPFIND',
        headers: {
          Authorization: authHeader,
          Depth: '0',
          'Content-Type': 'text/xml; charset=utf-8',
        },
        body: propfindPrincipalXml,
      });

      log(`Step 2 Response Status: HTTP ${res1.status} ${res1.statusText || ''}`);
      const text1 = await res1.text();
      log(`Step 2 Body Snippet: ${text1.slice(0, 150).replace(/\n/g, ' ')}...`);

      if (res1.status === 401 || res1.status === 403) {
        log(`❌ Step 2 AUTH FAILED: Check App-Specific Password.`);
        return logs;
      }

      const principalPath = extractHrefFromXml(text1, 'current-user-principal');
      if (principalPath) {
        log(`Step 3: Discovered Principal Href -> ${principalPath}`);
      } else {
        log(`Step 3: Principal Href not found in XML response.`);
      }

      const principalUrl = principalPath ? resolveUrl(initialUrl, principalPath) : initialUrl;

      log(`Step 4: Querying Principal URL -> ${principalUrl}`);
      const propfindHomeXml = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <C:calendar-home-set />
  </D:prop>
</D:propfind>`;

      const res2 = await fetch(principalUrl, {
        method: 'PROPFIND',
        headers: {
          Authorization: authHeader,
          Depth: '0',
          'Content-Type': 'text/xml; charset=utf-8',
        },
        body: propfindHomeXml,
      });

      log(`Step 4 Response Status: HTTP ${res2.status}`);
      const text2 = await res2.text();
      const homeHref = extractHrefFromXml(text2, 'calendar-home-set');

      if (!homeHref) {
        log(`❌ Step 4: No calendar-home-set in response. Cannot continue.`);
        return logs;
      }

      let calendarHomeUrl = resolveUrl(principalUrl, homeHref);
      if (!calendarHomeUrl.endsWith('/')) {
        calendarHomeUrl += '/';
      }
      log(`Step 4: Discovered Calendar Home Set -> ${calendarHomeUrl}`);

      log(`Step 5: Enumerating calendar collections (Depth: 1 PROPFIND)...`);
      const collections = await this.listCalendarCollections(calendarHomeUrl, authHeader, log);
      const eventCollections = collections.filter(collection => collection.supportsVEvent);
      const todoCollections = collections.filter(collection => collection.supportsVTodo);
      log(
        `Step 5: Found ${eventCollections.length} VEVENT collection(s) and ` +
        `${todoCollections.length} VTODO collection(s).`
      );
      collections.forEach((c, i) => {
        log(`   [${i}] ${c.displayName || '(unnamed)'} -> ${c.url}`);
      });

      if (eventCollections.length === 0) {
        log(`❌ Step 5: No writable calendar found. The home set is a container, not a calendar.`);
        return logs;
      }

      const targetCollection = chooseDefaultCollection(collections) as CalendarCollection;
      log(`Step 5: Selected target -> "${targetCollection.displayName || '(unnamed)'}" ${targetCollection.url}`);

      log(`Step 6: Testing Event PUT Probe to -> ${targetCollection.url}diag-test-probe.ics`);
      const testEvt: CalendarEvent = {
        uid: 'diag-test-probe',
        summary: 'CalDAV Diagnostic Probe Test',
        start: new Date(),
        end: new Date(Date.now() + 1800000),
        allDay: false,
        attendees: [],
      };

      const pushRes = await this.pushIcloudEvent(testEvt, {
        ...credentials,
        calendarUrl: targetCollection.url,
      });

      log(`Step 6 PUT Result: ${pushRes.success ? '✅ SUCCESS (HTTP 201/204)' : `❌ FAILED: ${pushRes.message}`}`);

      if (pushRes.success) {
        log(`Step 7: Cleaning probe event (DELETE)...`);
        await this.deleteIcloudEvent('diag-test-probe', {
          ...credentials,
          calendarUrl: targetCollection.url,
        });
        log(`✅ Event push path working.`);
      }

      // Modern iCloud Reminders uses a different store. iCloud still advertises
      // a legacy VTODO collection, but accepting a resource there does not make
      // it appear in the lists shown by current Apple devices. Do not present a
      // successful transport probe as Reminders integration.
      if ((credentials.provider || 'icloud') === 'icloud') {
        log(
          `Step 8: Legacy iCloud VTODO collection detected but intentionally not tested. ` +
          `It is not the modern Apple Reminders database.`
        );
        log(`✅ DIAGNOSTIC COMPLETE — event CalDAV path verified.`);
        return logs;
      }

      // For a separate/non-iCloud task account, test the VTODO collection.
      const taskList = chooseDefaultTaskList(collections);
      if (!taskList) {
        log(`Step 8: No VTODO collection found — tasks have nowhere to go.`);
        return logs;
      }

      log(`Step 8: Testing VTODO probe -> "${taskList.displayName || '(unnamed)'}" ${taskList.url}`);

      const probeTask: CalendarEvent = {
        uid: 'diag-test-todo-probe',
        summary: 'CalDAV Diagnostic Reminder Probe',
        start: new Date(),
        end: new Date(Date.now() + 1800000),
        allDay: false,
        attendees: [],
        isTask: true,
      };

      const todoIcs = generateOutboundIcsTodo(probeTask);
      log(`Step 8 payload: ${todoIcs.replace(/\r\n/g, ' | ').slice(0, 220)}`);

      const todoUrl = `${taskList.url}diag-test-todo-probe.ics`;
      try {
        const todoRes = await fetch(todoUrl, {
          method: 'PUT',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'text/calendar; charset=utf-8',
          },
          body: todoIcs,
        });

        let todoBody = '';
        try {
          todoBody = await todoRes.text();
        } catch (e) {}

        log(`Step 8 VTODO PUT -> HTTP ${todoRes.status} ${todoBody.slice(0, 120) || '(empty body)'}`);

        if (todoRes.status === 200 || todoRes.status === 201 || todoRes.status === 204) {
          log(`✅ VTODO accepted by the server.`);
          log(`Step 9: Verifying it reads back (GET)...`);

          const verify = await fetch(todoUrl, { method: 'GET', headers: { Authorization: authHeader } });
          const verifyBody = verify.ok ? await verify.text() : '';
          log(
            `Step 9 GET -> HTTP ${verify.status}; contains VTODO: ${verifyBody.includes('BEGIN:VTODO')}`
          );

          log(`Step 10: Cleaning VTODO probe...`);
          await this.deleteIcloudEvent('diag-test-todo-probe', { ...credentials, taskListUrl: taskList.url }, true);
          log(
            `✅ VTODO transport verified for "${taskList.displayName}". ` +
            `Device visibility requires adding this same CalDAV account to the device.`
          );
        } else {
          log(`❌ Step 8 FAILED: the Reminders list rejected the VTODO.`);
        }
      } catch (todoErr: any) {
        log(`❌ Step 8 threw: ${todoErr?.message || todoErr}`);
      }
    } catch (err: any) {
      log(`❌ UNHANDLED ERROR during diagnostic: ${err?.message || err}`);
    }

    return logs;
  }

  /**
   * Enumerates the calendar collections inside a calendar-home-set via a
   * Depth: 1 PROPFIND. The home-set is a container, not a calendar — writing an
   * .ics directly into it is rejected (iCloud answers HTTP 400), so a real
   * collection URL has to be selected before any PUT.
   */
  async listCalendarCollections(
    calendarHomeUrl: string,
    authHeader: string,
    onTrace?: (msg: string) => void
  ): Promise<CalendarCollection[]> {
    const trace = (msg: string) => onTrace && onTrace(msg);

    const propfindCollectionsXml = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:resourcetype />
    <D:displayname />
    <C:supported-calendar-component-set />
  </D:prop>
</D:propfind>`;

    let res: Response;
    try {
      res = await fetch(calendarHomeUrl, {
        method: 'PROPFIND',
        headers: {
          Authorization: authHeader,
          Depth: '1',
          'Content-Type': 'text/xml; charset=utf-8',
        },
        body: propfindCollectionsXml,
      });
    } catch (e: any) {
      trace(`   PROPFIND threw: ${e?.message || e}`);
      return [];
    }

    trace(`   Depth:1 PROPFIND status -> HTTP ${res.status}`);

    if (res.status === 401 || res.status === 403) {
      trace(`   AUTH REJECTED on the calendar-home host.`);
      return [];
    }

    const xml = await res.text();
    trace(`   Body length: ${xml.length} chars`);
    trace(`   Body head: ${xml.slice(0, 300).replace(/\s+/g, ' ')}`);

    const blocks = splitMultistatusResponses(xml);
    trace(`   Parsed ${blocks.length} <response> block(s).`);
    blocks.forEach(block => {
      trace(
        `   href=${readBlockHref(block) || '(none)'} isCal=${isCalendarCollection(block)} ` +
          `vevent=${supportsComponent(block, 'VEVENT')} vtodo=${supportsComponent(block, 'VTODO')}`
      );
    });

    return blocks
      .filter(isCalendarCollection)
      .map(block => ({
        url: resolveUrl(calendarHomeUrl, readBlockHref(block)),
        displayName: readBlockDisplayName(block),
        supportsVEvent: supportsComponent(block, 'VEVENT'),
        supportsVTodo: supportsComponent(block, 'VTODO'),
      }))
      .filter(c => Boolean(c.url) && c.url !== calendarHomeUrl)
      .map(c => ({ ...c, url: c.url.endsWith('/') ? c.url : `${c.url}/` }));
  }

  /**
   * Discovers CalDAV Calendar Home Set & Primary Calendar Collection URL with React Native fallbacks
   */
  async discoverIcloudCalendarUrl(
    credentials: CaldavCredentials,
    target: 'events' | 'tasks' = 'events'
  ): Promise<CaldavTestResult> {
    if (!credentials.appleId || !credentials.appPassword) {
      return {
        success: false,
        message: 'Please provide both Email / Username and Password.',
      };
    }

    const authHeader = makeBasicAuthHeader(credentials.appleId, credentials.appPassword);
    const initialUrl = this.resolveProviderInitialUrl(credentials.provider, credentials.customUrl);
    const providerName = credentials.provider ? credentials.provider.toUpperCase() : 'CalDAV';

    const propfindPrincipalXml = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:current-user-principal />
  </D:prop>
</D:propfind>`;

    try {
      let res1: Response | null = null;
      let text1 = '';

      try {
        res1 = await fetch(initialUrl, {
          method: 'PROPFIND',
          headers: {
            Authorization: authHeader,
            Depth: '0',
            'Content-Type': 'text/xml; charset=utf-8',
          },
          body: propfindPrincipalXml,
        });
      } catch (propfindErr) {
        // Fallback for React Native Android if PROPFIND method is restricted
        res1 = await fetch(initialUrl, {
          method: 'GET',
          headers: {
            Authorization: authHeader,
          },
        });
      }

      if (res1.status === 401 || res1.status === 403) {
        return {
          success: false,
          message: `HTTP ${res1.status}: Authentication failed for ${providerName}. Verify App-Specific Password.`,
        };
      }

      try {
        text1 = await res1.text();
      } catch (e) {}

      const principalPath = extractHrefFromXml(text1, 'current-user-principal');
      const principalUrl = principalPath ? resolveUrl(initialUrl, principalPath) : initialUrl;

      // Step 2: PROPFIND principal to get calendar-home-set
      let calendarHomeUrl = '';
      try {
        const propfindHomeXml = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <C:calendar-home-set />
  </D:prop>
</D:propfind>`;

        const res2 = await fetch(principalUrl, {
          method: 'PROPFIND',
          headers: {
            Authorization: authHeader,
            Depth: '0',
            'Content-Type': 'text/xml; charset=utf-8',
          },
          body: propfindHomeXml,
        });

        const text2 = await res2.text();
        const homeHref = extractHrefFromXml(text2, 'calendar-home-set');
        if (homeHref) {
          calendarHomeUrl = resolveUrl(principalUrl, homeHref);
        }
      } catch (e) {}

      if (!calendarHomeUrl) {
        return {
          success: false,
          message: `Reached ${providerName}, but it returned no calendar-home-set. Run the diagnostic trace.`,
        };
      }

      if (!calendarHomeUrl.endsWith('/')) {
        calendarHomeUrl += '/';
      }

      // Step 3: the home set is a container — pick a real calendar collection inside it
      const collections = await this.listCalendarCollections(calendarHomeUrl, authHeader);

      if (collections.length === 0) {
        return {
          success: false,
          message: target === 'tasks'
            ? `Found the ${providerName} calendar home but no VTODO task list inside it.`
            : `Found the ${providerName} calendar home but no writable VEVENT calendar inside it.`,
        };
      }

      const chosen = chooseDefaultCollection(collections);
      const taskList = chooseDefaultTaskList(collections);

      if (target === 'events' && !chosen) {
        return {
          success: false,
          message: `Found the ${providerName} calendar home but no writable VEVENT calendar inside it.`,
        };
      }
      if (target === 'tasks' && !taskList) {
        return {
          success: false,
          message: `Found the ${providerName} calendar home but no VTODO task list inside it.`,
        };
      }

      const isIcloud = (credentials.provider || 'icloud') === 'icloud';
      const taskNote = isIcloud
        ? taskList
          ? ' A legacy VTODO collection was detected but is not used for modern Apple Reminders.'
          : ''
        : taskList
          ? ` VTODO list available: "${taskList.displayName || 'Tasks'}".`
          : ' No VTODO task list found.';

      return {
        success: true,
        message:
          `Connected to ${providerName} CalDAV` +
          (chosen ? ` — writing events to "${chosen.displayName || 'calendar'}"` : '') +
          ` (${collections.length} found).${taskNote}`,
        calendarUrl: chosen?.url,
        // iCloud's advertised legacy collection is deliberately not returned;
        // task sync must use an independent account that users also add to the
        // Reminders app on their Apple devices.
        taskListUrl: isIcloud ? undefined : taskList?.url,
        taskLists: isIcloud ? [] : collections.filter(collection => collection.supportsVTodo),
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Network error: ${err?.message || 'Check Wi-Fi connection'}`,
      };
    }
  }

  /**
   * Reads events from a collection inside a date window.
   *
   * This is the direction the plugin never had: PROPFIND/PUT/DELETE only ever
   * discovered containers and wrote to them, so everything shown on the device
   * came from a subscribed .ics feed. A calendar-query REPORT asks the server
   * what is actually on the calendar, and the time-range filter means the
   * server sends only the window — a feed file has to be downloaded whole.
   */
  async fetchEventsInRange(
    collectionUrl: string,
    credentials: CaldavCredentials,
    start: Date,
    end: Date,
    calendarName = 'iCloud',
    onTrace?: (msg: string) => void
  ): Promise<{ events: CalendarEvent[]; error?: string }> {
    if (!credentials.appleId || !credentials.appPassword) {
      return { events: [], error: 'CalDAV credentials missing.' };
    }

    const trace = (m: string) => onTrace && onTrace(m);
    const authHeader = makeBasicAuthHeader(credentials.appleId, credentials.appPassword);

    try {
      const res = await fetch(collectionUrl, {
        method: 'REPORT',
        headers: {
          Authorization: authHeader,
          Depth: '1',
          'Content-Type': 'text/xml; charset=utf-8',
        },
        body: buildCalendarQuery(start, end),
      });

      trace(`   REPORT ${collectionUrl} -> HTTP ${res.status}`);

      if (res.status === 401 || res.status === 403) {
        return { events: [], error: `Authentication failed (HTTP ${res.status}).` };
      }

      const xml = await res.text();

      if (res.status !== 207 && res.status !== 200) {
        return { events: [], error: `HTTP ${res.status}: ${xml.slice(0, 80) || 'no body'}` };
      }

      const blocks = splitMultistatusResponses(xml);
      trace(`   ${blocks.length} item(s) returned`);

      const events: CalendarEvent[] = [];
      for (const block of blocks) {
        const ics = extractCalendarData(block);
        if (!ics) continue;
        // The payload is ordinary iCalendar, the same shape a feed delivers,
        // so the existing parser handles it unchanged.
        const resourceUrl = resolveUrl(collectionUrl, readBlockHref(block));
        const etag = readBlockEtag(block);
        events.push(...parseIcsContentStrict(ics, calendarName).map(event => ({
          ...event,
          sourceKind: 'caldav' as const,
          caldavUrl: resourceUrl,
          etag: etag || undefined,
        })));
      }

      return { events };
    } catch (e: any) {
      return { events: [], error: `REPORT failed: ${e?.message || 'network error'}` };
    }
  }

  async fetchTasks(
    collectionUrl: string,
    credentials: CaldavCredentials,
    onTrace?: (msg: string) => void
  ): Promise<{ tasks: CalendarEvent[]; error?: string }> {
    if (!credentials.appleId || !credentials.appPassword) {
      return { tasks: [], error: 'CalDAV credentials missing.' };
    }
    try {
      const res = await fetch(collectionUrl, {
        method: 'REPORT',
        headers: {
          Authorization: makeBasicAuthHeader(credentials.appleId, credentials.appPassword),
          Depth: '1',
          'Content-Type': 'text/xml; charset=utf-8',
        },
        body: buildTodoQuery(),
      });
      onTrace?.(`   VTODO REPORT ${collectionUrl} -> HTTP ${res.status}`);
      const xml = await res.text();
      if (res.status === 401 || res.status === 403) {
        return { tasks: [], error: `Authentication failed (HTTP ${res.status}).` };
      }
      if (res.status !== 207 && res.status !== 200) {
        return { tasks: [], error: `HTTP ${res.status}: ${xml.slice(0, 80) || 'no body'}` };
      }
      const tasks = splitMultistatusResponses(xml).flatMap(block => {
        const ics = extractCalendarData(block);
        const resourceUrl = resolveUrl(collectionUrl, readBlockHref(block));
        const etag = readBlockEtag(block);
        return ics ? parseIcsContentStrict(ics, 'CalDAV Tasks').filter(isTaskItem).map(task => ({
          ...task,
          caldavUrl: resourceUrl,
          etag: etag || undefined,
        })) : [];
      });
      return { tasks };
    } catch (e: any) {
      return { tasks: [], error: `VTODO REPORT failed: ${e?.message || 'network error'}` };
    }
  }

  /**
   * Pushes a new or updated item to CalDAV via HTTP PUT.
   *
   * Tasks are sent as VTODO to the independently configured task list;
   * everything else is a VEVENT to the calendar collection. Routing by item
   * kind is what stops tasks appearing as calendar events on iPhone/iPad.
   */
  async pushIcloudEvent(event: CalendarEvent, credentials: CaldavCredentials): Promise<{
    success: boolean;
    message: string;
    etag?: string;
    caldavUrl?: string;
  }> {
    if (!credentials.appleId || !credentials.appPassword) {
      return { success: false, message: 'CalDAV credentials missing.' };
    }

    const authHeader = makeBasicAuthHeader(credentials.appleId, credentials.appPassword);
    const isTask = isTaskItem(event);

    // Neither collection path is guessable — iCloud names collections with
    // UUIDs — so a missing target is a hard error rather than constructed.
    const targetBaseUrl = isTask ? credentials.taskListUrl : credentials.calendarUrl;
    if (!targetBaseUrl) {
      return {
        success: false,
        message: isTask
          ? 'No VTODO task list selected. Connect the separate task account first.'
          : 'No calendar selected. Run Connect & Test first.',
      };
    }

    const uid = event.uid.endsWith('.ics') ? event.uid.slice(0, -4) : event.uid;
    const eventUrl = event.caldavUrl || `${targetBaseUrl.endsWith('/') ? targetBaseUrl : targetBaseUrl + '/'}${uid}.ics`;

    const icsPayload = isTask ? generateOutboundIcsTodo(event) : generateOutboundIcsEvent(event);

    try {
      const res = await fetch(eventUrl, {
        method: 'PUT',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'text/calendar; charset=utf-8',
          ...(event.etag ? { 'If-Match': event.etag } : {}),
        },
        body: icsPayload,
      });

      if (res.status === 201 || res.status === 204 || res.status === 200) {
        return {
          success: true,
          message: isTask ? 'Task synced to the VTODO account!' : 'Event synced to CalDAV!',
          etag: res.headers?.get?.('etag') || undefined,
          caldavUrl: eventUrl,
        };
      } else {
        let errBody = '';
        try { errBody = await res.text(); } catch(e) {}
        return { success: false, message: `CalDAV HTTP ${res.status}: ${errBody.slice(0, 60) || 'Save failed'}` };
      }
    } catch (e: any) {
      return { success: false, message: `CalDAV PUT error: ${e?.message || 'Network error'}` };
    }
  }

  /**
   * Deletes a CalendarEvent from CalDAV via HTTP DELETE
   */
  async deleteIcloudEvent(
    eventUid: string,
    credentials: CaldavCredentials,
    isTask = false,
    resource?: { url?: string; etag?: string }
  ): Promise<{ success: boolean; message: string }> {
    if (!credentials.appleId || !credentials.appPassword) {
      return { success: false, message: 'CalDAV credentials missing.' };
    }

    const authHeader = makeBasicAuthHeader(credentials.appleId, credentials.appPassword);
    // Must match the collection the item was PUT into, or the DELETE 404s
    // against the wrong list and the item survives on the server.
    const targetBaseUrl = isTask ? credentials.taskListUrl : credentials.calendarUrl;
    if (!targetBaseUrl) {
      return {
        success: false,
        message: isTask ? 'No VTODO task list selected.' : 'No calendar selected. Run Connect & Test first.',
      };
    }

    const uid = eventUid.endsWith('.ics') ? eventUid.slice(0, -4) : eventUid;
    const eventUrl = resource?.url || `${targetBaseUrl.endsWith('/') ? targetBaseUrl : targetBaseUrl + '/'}${uid}.ics`;

    try {
      const res = await fetch(eventUrl, {
        method: 'DELETE',
        headers: {
          Authorization: authHeader,
          ...(resource?.etag ? { 'If-Match': resource.etag } : {}),
        },
      });

      if (res.status === 200 || res.status === 204 || res.status === 404) {
        return { success: true, message: `Event deleted from CalDAV!` };
      } else {
        return { success: false, message: `CalDAV HTTP ${res.status}: Failed to delete event.` };
      }
    } catch (e: any) {
      return { success: false, message: `CalDAV DELETE error: ${e?.message || 'Network error'}` };
    }
  }
}

export const caldavService = new CaldavService();
