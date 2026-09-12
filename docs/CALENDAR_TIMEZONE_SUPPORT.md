# Calendar timezone compatibility — build 49 candidate

SNFolio 0.1.21-rc.1/build 49 adds offline timezone resolution to the existing calendar parser. This is the first stage of the ICAL.js migration, not a replacement of Colin's recurrence engine. Existing supported recurrence rules, ETag persistence, entire-series cleanup, and task-note behavior remain in place. RDATE and wider recurrence-rule support are still outside this stage.

## Resolution

1. Use the calendar file's embedded VTIMEZONE rules, parsed by ICAL.js 2.2.1. Persist these definitions with events and include them on export. Cache by definition, not just timezone name.
2. For missing definitions, resolve IANA names from Moment Timezone 0.6.3 (IANA data 2026c). Resolve Windows names through bundled Unicode CLDR 47 global mappings first.
3. Empty named timezone shells use the database only for recognized names. Unknown/incomplete/conflicting definitions raise an import error. Annual STANDARD/DAYLIGHT transition rules are supported, with bounds on definitions and supported transition-rule complexity.
4. A genuinely floating event stays floating. An unresolved named zone is never guessed as device-local time.

## Data protection

File import and CalDAV/feed loading use strict diagnostics: rejected event dates/timezones cause a visible import/sync error. Failed CalDAV parsing does not become a successful empty response that could delete cached items. Feed refresh retains the batch when timezone import errors occur. Original imported file copies remain unchanged. The existing low-level parseIcsContent API can return diagnostics explicitly.

Existing push signatures remain byte-compatible for events without embedded definitions. Events with definitions include them in their signatures so timezone edits are not missed. Definitions survive JSON storage, recurrence expansion, exception deletion, event editing, note time formatting, and outbound serialization.

## Validation and scope

631 tests pass, including all 622 existing tests and nine new tests for Windows/custom definitions, 1601 transition anchors, DST, missing definitions, same-name isolation, unknown-zone diagnostics, storage/export of exclusions, and definition precedence. Seven timezone environments were exercised: UTC, Honolulu, New York, Chicago, Sydney, Kiritimati, and Kolkata. TypeScript passes; lint has zero errors.

The Microsoft and custom-zone test data is synthetic and only runs in memory. No fabricated calendar data has been loaded onto a device or a calendar account. The original reporting user's Outlook file has not been provided; its complete compatibility is not yet confirmed.

Dependency licenses and exact source links are packaged under licenses/. The candidate is built from clean output and must pass explicit native package validation. macOS build path tested; PowerShell notice-copy change not executed on this host.

## Device acceptance

- Optional confirmation by the original reporter on their own Nomad: import their unmodified Outlook .ics through Add a Calendar, without sharing the file. Confirm event counts, times, and repeating events against Outlook, especially dates across a daylight-saving change. No stripping TZID or VTIMEZONE.
- Close/reopen SNFolio and confirm imported events remain correct.
- On the already connected iCloud calendar, repeat the verified sequence: delete one occurrence in SNFolio, wait for success, then delete the whole series without an intervening refresh. Confirm it remains absent after sync.
- Open an existing linked task note and spot-check an existing Apple event's time.

The maintainer reported the requested build 49 device checks working. The original reporter’s exact calendar remains unverified; no private calendar file is required or requested. Describe the tested Microsoft-format support accurately without claiming confirmation on that specific file.
