# Calendar parser evaluation — 2026-09-12

Historical evaluation snapshot before implementation. Build 49 subsequently implements the timezone stage described in `CALENDAR_TIMEZONE_SUPPORT.md`; full recurrence-engine migration remains deferred.

## Decision

Recommend a staged migration to **ICAL.js 2.2.1** behind SNFolio's calendar adapter, with explicit timezone resolution, preserved source components, bounded recurrence expansion, and structured import diagnostics. Do not substitute the library directly into the released parser. This evaluation changes no production dependencies or application behavior.

The current parser can be patched for known Microsoft names quickly, but that alone leaves custom VTIMEZONE definitions, RDATE, and broader recurrence rules unsupported. A standards engine plus a small compatibility layer is a more sustainable foundation than separate provider parsers.

## Candidates

| Candidate | Runtime and timezone findings | Decision |
|---|---|---|
| Current SNFolio parser | Uses Intl/IANA names; ignores VTIMEZONE definitions; silently drops invalid dates; rejects broader recurrence rules | Preserve tests and app semantics, replace standards machinery incrementally |
| ICAL.js 2.2.1, kewisch/ical.js | No runtime dependencies; browser-oriented; embedded timezone and recurrence support; ES5 CJS distribution runs with RN 0.79.2's desktop Hermes | Preferred, subject to adapter and device verification |
| node-ical 0.27.1 | Windows mappings work in initial-date probes, but public entry imports node:fs and declares Node >=22; depends on temporal-polyfill and rrule-temporal; custom timezone probe fell back to wrong UTC time | Not preferred for React Native; no port attempted |

Do not confuse the `ical.js` npm package maintained at kewisch/ical.js with the older `ical` package at peterbraden/ical.js.

## Executed probes

The fixtures in `tools/parser-evaluation/fixtures.cjs` are **synthetic standards examples**, not the user's original Outlook export. No fixtures were imported into the plugin, device, or an external calendar. They are evaluated in memory only.

| Case | Current parser | Stock ICAL.js |
|---|---|---|
| UTC event | Correct | Correct |
| Windows TZID with embedded 1601 STANDARD/DAYLIGHT rules | Drops events | Correct instants across European DST change |
| Custom TZID with embedded rules | Drops events | Correct |
| IANA name with embedded definition | Correct for this matching definition | Correct |
| IANA name without definition | Correct | **Wrong: falls back to floating time** |
| Windows name without definition | Drops events | **Wrong: falls back to floating time** |
| Unknown name without definition | Drops events without diagnostic | **Wrong: falls back to floating time** |
| RRULE plus RDATE/EXDATE | Only original event with unsupported-rule warning | Correct occurrence set |
| Moved RECURRENCE-ID instance | Correct | Correct |
| Last weekday each month (BYSETPOS) | Only original event with unsupported-rule warning | Correct occurrence set |

Seven of nine fixtures with defined expected instants matched stock ICAL.js. Four matched the current parser. The tenth fixture intentionally has an unresolvable timezone: the desired behavior is a visible diagnostic, not guessed times. These counts describe this deliberately selected corpus, not an overall compatibility percentage.

Results were reproduced with the RN 0.79.2 desktop Hermes executable. The library also bundled through this project's Android Metro configuration, compiled to Hermes bytecode, and executed a parse smoke test. This is a host-side runtime test, **not Nomad hardware verification**. The ICAL.js ES5 file is approximately 320 KiB unminified; total production size with timezone data has not been measured.

`node-ical` comparison is limited to parsing initial dates; its recurrence engine was not evaluated. The existing 622 SNFolio tests remain baseline tests, not evidence that an ICAL.js replacement passes them. No complete replacement adapter exists yet.

## Required architecture

1. **Parse and preserve components.** Retain the relevant VEVENT/VTODO, exceptions, and VTIMEZONE data (serializable jCal or original ICS), associated with the source collection/resource. Preserve provider fields instead of reconstructing every server resource from the subset understood by the UI.
2. **Resolve timezones before converting dates.** Prefer definitions scoped to the calendar file. If absent, resolve recognized IANA identifiers through maintained timezone data, and translate Windows names using Unicode CLDR before resolving. A real floating event remains floating; a named but unresolved zone must never become floating automatically. Test embedded and global definitions with identical names but different rules to prevent cross-calendar contamination.
3. **Adapt to current app behavior.** Preserve UID/series identity, linked notes, CalDAV URL and ETag handling, source/read-only distinctions, VTODO semantics, all-day exclusive end dates, and existing date-window display behavior. Current storage and exporter use IANA strings/Date objects and cannot preserve arbitrary embedded definitions alone.
4. **Use one recurrence engine.** Migrate parsing, occurrence expansion, and export together behind the adapter rather than splitting complex series between two engines. Bound work for untrusted rules, old series and large feeds; cache by source/revision and query window. Measure performance on Nomad before rollout.
5. **Report failures.** Return events plus diagnostics with counts, affected item identifiers and reason. An empty import must distinguish an empty calendar from unsupported timezone data. Preserve unresolved original data for retry/export; do not fabricate instants.
6. **Keep regression coverage.** Retain Colin's recurrence/DST and stale-ETag tests and our deletion/storage tests. Some tests intentionally assert that currently unsupported valid rules fail closed; change those expectations only when the new engine's supported behavior is proven. Add vendor-export fixtures separately from synthetic standards tests, with consent and anonymization.

## Rollout gates

- Prototype adapter and explicit timezone resolver; avoid a public release based only on alias mapping.
- Run the full suite through the adapter; explain every semantic difference. Test missing VTIMEZONE, Windows aliases, embedded custom definitions, old 1601 rules, floating/date-only values, RDATE periods, moved/cancelled instances, DST gaps/folds, malformed input, and resource limits.
- Round-trip source components through storage reload and export, verifying timezone rules, exceptions, UIDs, unknown properties, and ETags survive. Re-run deletion and task/note tests.
- Obtain a minimal anonymized original Outlook sample before claiming the reported export is fixed. Current synthetic reproduction is sufficient to establish a parser gap, not to establish compatibility with the full original file.
- Build a separately numbered candidate using the existing clean-build/version/native-validation protocol. Verify Nomad display, performance, restart, and real calendar sync before merge/release.

24-hour display is a separate UI preference; account authentication and two-way sync are separate from ICS file compatibility.

## Licensing and maintenance

ICAL.js is MPL-2.0. Mozilla's FAQ explicitly permits combination with Apache-licensed code. Distribution must include appropriate notices and access to the MPL-covered source; modifications to covered files remain subject to MPL. Prefer an unmodified pinned dependency and separately authored adapter. Include the license and exact source/version reference in release packaging; inspect the final bundle notices. This is a packaging requirement to implement, not a reason to reject the library.

The default ICAL.js distribution omits a timezone database. Choose and version the timezone-data source and update policy explicitly. CLDR mappings and timezone data also require their notices. Neither a maintained library nor a mapping table is a universal-calendar guarantee.

## Primary sources

- [ICAL.js upstream](https://github.com/kewisch/ical.js): browser design, dependency and timezone-data policy, MPL license.
- [ICAL.js parsing/recurrence API](https://github.com/kewisch/ical.js/wiki/Parsing-iCalendar).
- [node-ical upstream](https://github.com/jens-maus/node-ical); installed package 0.27.1 inspected for actual entry points and dependencies.
- [Unicode Windows timezone mappings](https://github.com/unicode-org/cldr/blob/main/common/supplemental/windowsZones.xml).
- [Mozilla MPL FAQ, Q8–Q13](https://www.mozilla.org/en-US/MPL/2.0/FAQ/): notices/source availability, file-level scope, and Apache compatibility.

The installed package lock and raw probe results are retained under `tools/parser-evaluation/`. No production package version was bumped and no installable plugin was produced for this evaluation.
