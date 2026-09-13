# SNFolio Device Test Matrix

Use this matrix for a candidate build after automated tests pass. Record the
build number and mark each result Pass, Fail, or Not Tested.

## Recurring Events

| ID | Test | Expected result |
|---|---|---|
| REC-01 | Create a daily timed event with no end | It appears every day at the same time and duration. |
| REC-02 | Create an event every 2 weeks on two selected weekdays | It appears only on both selected weekdays in alternating weeks. |
| REC-03 | Create a monthly event | It repeats on the same calendar day each month. |
| REC-04 | Create a yearly all-day event | It repeats on the same month and day each year. |
| REC-05 | Set recurrence to end on a date | The event appears on the inclusive end date and not afterward. |
| REC-06 | Set recurrence to end after a count | Exactly that number of occurrences is produced, including the first. |
| REC-07 | Restart SNFolio and the device | The rule and all occurrences persist without duplicates. |
| REC-08 | Edit an occurrence's title, time, interval, and end condition | SNFolio states that the series is being edited; all remaining occurrences reflect the change and no detached duplicate is created. |
| REC-09 | Delete one occurrence | Only the selected date disappears and remains absent after restart/sync. |
| REC-10 | Delete the entire series | Every occurrence disappears while an associated series notebook is not silently deleted. |
| REC-11 | Sync a recurring event through editable CalDAV | The server receives RRULE/EXDATE, and pulling it back does not duplicate the series. |
| REC-12 | View a recurring subscribed Google event | It expands correctly but remains read-only. |
| REC-13 | Append notes for two occurrences | Both occurrences open the same series notebook on separate appended pages. |

### Build 20 observations

- REC-03 failed: Apple received the monthly series, but SNFolio did not display its occurrences. Root cause reproduced in the local recurrence expander for a monthly rule without `BYMONTHDAY`.
- REC-11 Apple-to-SNFolio round trip passed for creating and deleting events.
- Regression found: short event blocks (observed on an every-two-days series) had no room for the inline Create Note command. Event details must provide the command for every event duration.

### Build 21 release-candidate result

- REC-01 through REC-13: Pass on device.
- CORE-01 through CORE-04: Pass on device.
- Additional verified behavior: Google feed display, two-way Apple event creation/deletion, nested PARA folders and notes, event/task editing and deletion, persistence after restart, and no handwriting transfer between notes.

### Build 45 (0.1.19) candidate checks

- TypeScript: Pass.
- Lint: Pass with 505 warnings, zero errors.
- Full coverage suite: Pass, 516 tests across 37 suites.
- Past-series regression: Pass locally for missing cached masters, saved resource selection, and removal of persisted exceptions after reload without removing similarly prefixed UIDs.
- Reported stuck past-series deletion: Pass on device, confirmed by the maintainer after installing build 45. The broader checks below were not individually confirmed.
- REC-01 through REC-13 and CORE-01 through CORE-04: Not Tested on device for this build.
- Additional device check: delete an ended series with a moved occurrence, restart and sync, then verify every occurrence remains absent and its notebook remains intact. Not Tested.

## Core Regression After Recurrence Changes

| ID | Test | Expected result |
|---|---|---|
| CORE-01 | Create, edit, and delete a non-recurring event | Normal event behavior is unchanged. |
| CORE-02 | Create a Project note while the keyboard is open | One tap creates and immediately opens the new note. |
| CORE-03 | Open another note without deliberately lassoing ink | No handwriting or selection transfers between notes. |
| CORE-04 | Restart SNFolio | Projects, Areas, Resources, tasks, folders, and settings persist. |

## Build 47 (0.1.20-rc.1) combined PR candidate

Clean native build and explicit native package validation: Pass (94 Gradle tasks executed; app.npk included).

Sources: main 6c86af6 plus PR #2 c195b97. Includes both deletion fixes and current task-note linking. Parser-only lint cleanup replaces unused destructuring aliases with deletion of the same internal properties on a copy.

- TypeScript: Pass.
- Lint: Pass, zero errors and 529 warnings.
- Full suite: 622 tests / 41 suites pass in UTC, Pacific/Honolulu, America/Chicago, America/New_York, Australia/Sydney, Pacific/Kiritimati, and Asia/Kolkata. UTC coverage generated.
- Device checks below: Not Tested for build 47. Build 46 previously passed occurrence-then-series deletion on device; build 45 previously passed the reported stuck-series deletion.

### Device checklist

Use disposable events in the connected iCloud calendar. No imported synthetic ICS or simulated CalDAV data is needed.

1. **Deletion:** Create a daily series in Apple Calendar and sync it into SNFolio. Delete one occurrence in SNFolio, wait for success, then delete the entire series without refreshing first. Refresh afterward and check Apple Calendar too: the series must be gone.
2. **Recurrence and sync:** In SNFolio, create a daily event ending after three occurrences and a weekly event ending on a chosen date. Sync and compare with Apple Calendar: dates, times, and final occurrences must agree. Edit one series title and sync again; it must remain one series. Also spot-check a monthly and a yearly repeat.
3. **Timezone/DST:** In Apple Calendar, create a weekly 10:00 AM America/New_York event starting October 25, 2026, ending after three occurrences. Compare October 25, November 1, and November 8 in SNFolio with Apple Calendar displayed in the same device timezone. On a Honolulu device, the expected times are 4:00 AM, 5:00 AM, and 5:00 AM respectively. Do not change the Supernote clock. If timezone selection is unavailable in your Apple Calendar interface, mark this item Not Tested.
4. **All-day and moved occurrence:** Create an all-day repeat in Apple Calendar and move just one occurrence to another date. After sync, confirm SNFolio shows the replacement once, omits its original date, and retains the other occurrences. Delete the whole disposable series in SNFolio and verify none return after sync.
5. **Restart and existing data:** Restart SNFolio. Confirm recurring edits/deletions persist, normal events remain correct, and an existing task's linked note still opens.

Record Pass/Fail/Not Tested for each item and any exact error. These are device acceptance checks; automated tests provide the broader recurrence edge-case coverage.

## Final 0.1.20 / build 48

Maintainer confirmed all five build 47 device acceptance checks passed: occurrence/series deletion; bounded recurrence, editing and sync; New York DST display; all-day moved occurrence and series cleanup; restart persistence and linked note opening.

Build 48 promotes the tested application code unchanged. Only version metadata changes from 0.1.20-rc.1/build 47 to 0.1.20/build 48.

## Build 49 — 0.1.21-rc.1 timezone compatibility candidate

- Offline database: IANA 2026c via moment-timezone 0.6.3; Microsoft mappings from CLDR 47.
- Existing 622 tests plus 9 timezone integration tests: Pass (631 total). Seven timezone environments pass.
- TypeScript: Pass. Lint: zero errors.
- Original reporter’s private Outlook file: unavailable; no file requested. Synthetic Microsoft-format cases pass locally.
- iCloud occurrence-then-series deletion on this candidate: maintainer reported passing.
- Maintainer reported the requested device checks working, including recurrence/all-day and restart checks.
- See docs/CALENDAR_TIMEZONE_SUPPORT.md for the acceptance procedure and scope.

Build 49 clean native package validation: Pass. Host Hermes bytecode/runtime checks: Pass for Microsoft/custom embedded definitions and missing IANA/Windows definitions.

## Build 50 — 0.1.21-rc.2 timezone and clock candidate

- Saved 24-hour clock switch under Settings → Calendar; defaults to 12-hour.
- Calendar labels, event details, creation pickers, capture interpretation, and tomorrow summary honor the preference. Snapshot text formatter also accepts the preference; current native note creation uses templates rather than inserting snapshot text.
- Midnight displays 00:00; 24-hour picker offers 00–23. Switching format does not edit event dates or sync data.
- 635 tests / 43 suites pass; typecheck passes; lint has zero errors (549 warnings).
- Device acceptance of the new clock option: pending.
- Clean build and native package validation: pass; packaged manifest confirms 0.1.21-rc.2/build 50 and app.npk.

## Build 51 — 0.1.21-rc.3 settings usability candidate

- Settings title, Close control, and four section buttons are outside the content ScrollView and remain visible while scrolling. Existing section-change scroll reset is retained.
- Time format uses 12-hour / 24-hour choices. Hide All-Day and Hide Solo use OFF / ON choices. Selected choices have solid black backgrounds and white labels, with explicit accessibility checked state and 44-point minimum touch height.
- Existing stored preferences and their update handlers are retained.
- Typecheck passes; 635 tests / 43 suites pass; lint has zero errors (549 existing warnings).
- Nomad acceptance pending: scroll each section, switch sections while scrolled down, check selected-state clarity, and confirm preferences after restart.
- Clean build and native package validation pass; packaged manifest confirms 0.1.21-rc.3/build 51 and app.npk.

## Release 0.1.21 / build 52

The maintainer accepted build 51 on the Nomad (“this is good”) and authorized release. Build 52 promotes the same application code with final version metadata; README documentation was updated after candidate acceptance.

Final checks: 635 tests / 43 suites pass; TypeScript passes; lint has zero errors (549 warnings); clean build and native package validation pass, including app.npk and final version 0.1.21/build 52.

## Build 53 — 0.1.22-rc.1 Nomad Day Planner candidate

- SDK device type 4 (A6 X2 / Nomad) enables collapsible sections; other devices, including Manta (type 5), retain the expanded Day Planner layout.
- Schedule, Daily Journal, Focus, Tasks & Deliverables, Projects Needing Attention, and Tomorrow start collapsed on first use, with summaries visible. Expansion preferences are saved after storage loads.
- Fixed shortcuts expand a selected section and scroll to it without collapsing other sections.
- 637 tests / 44 suites pass, including expanded non-Nomad behavior and Nomad expansion persistence/shortcut opening. Typecheck passes; lint has zero errors (558 warnings).
- Device acceptance pending: Nomad section toggles, shortcut scrolling, saved state after reopening, and existing journal/task actions; Manta expanded layout spot-check.
- Floating launcher remains a separate follow-up; this candidate covers the Day Planner change.
- Clean native build and package validation pass; packaged version is 0.1.22-rc.1/build 53 with app.npk.

## Build 54 — 0.1.22-rc.2 Nomad Weekly Review and PARA candidate

- Extends the accepted build 53 Day Planner behavior to Weekly Review: fixed weekly note control and summary counts, plus Projects / Deadlines / Journals shortcuts and collapsible sections. Expansion preferences are stored separately from Day Planner.
- Nomad PARA adds fixed Projects / Areas / Resources / Archive shortcuts. Selecting one opens the category, scrolls its navigation entry into view, and resets the details pane to the top. Existing category expansion and two-pane navigation remain available.
- Manta and other non-Nomad devices retain expanded Weekly Review and existing PARA navigation.
- 638 tests / 44 suites pass; typecheck passes; lint has zero errors (558 warnings).
- Device checks pending: Weekly Review scrolling/persistence and note actions, PARA navigation with a long list, Day Planner regression check, and Manta layout spot-check.
- Clean native build and package validation pass; packaged version is 0.1.22-rc.2/build 54 with app.npk.

## Build 55 — 0.1.22-rc.3 floating launcher candidate

- App & View includes an explicit Floating SNFolio icon OFF / ON choice, default off, for both Nomad and Manta.
- When enabled, Minimize shows a draggable native SN icon and closes the panel. Tap reopens the existing view; hold at least 700 ms and release opens the existing event/task form. Save/cancel returns to the floating icon. Position is saved in private Android preferences and clamped to the screen when shown.
- Toolbar activation clears the icon while retaining existing host toolbar-toggle behavior. Exit closes and removes it; turning the preference off removes it. Native teardown and plugin unmount/destroy remove the overlay.
- Opening linked notes through closePanel retains the icon when enabled. Overlay creation failure keeps the plugin open and reports the error.
- 642 tests / 45 suites pass; typecheck passes; lint has zero errors (577 warnings).
- On-device acceptance pending on both models: enable, minimize/tap restoration, hold Quick Add for event/task and save/cancel, drag vs tap, toolbar close, Exit, toggle off, linked-note return, and plugin removal cleanup.
- Clean native build and package validation pass; version 0.1.22-rc.3/build 55, launcher class in DEX, and Android overlay permission verified.

## Build 56 — 0.1.22-rc.4 two-way floating launcher

- Enabled icon remains visible inside SNFolio. Single tap there opens Recent Notes; single tap from a note reopens the retained SNFolio view. Hold Quick Add and drag behavior retained.
- Recent Notes stores up to 12 deduplicated note paths observed when returning to SNFolio or opened through its shared note opener. It is not a device-wide history scan or open-window list. Failed metadata reads do not block navigation.
- Note selection uses existing opening/error handling and returns to the icon. Toolbar/Exit cleanup retained; toolbar activation reconciles icon visibility after the host toggles its view.
- 645 tests / 46 suites pass, including foreground/background tap dispatch and recent-history ordering/bounds. Typecheck and lint pass with zero errors. Clean native package validation passes for 0.1.22-rc.4/build 56.
- Both-device acceptance pending: icon in Month/Day/Weekly/PARA, choose recent note and return to same view, Quick Add, drag, toolbar close/Exit, and history after restart.

## Build 57 — 0.1.22-rc.5 task Link Note fix

- Confirmed in bundled SDK native bridge: getNoteTotalPageNum returns success/result, while Link Note incorrectly checked data. Added shared validated page-count handling with legacy data compatibility and used it for linking and existing notebook checks.
- Link Note now requests file-read access and allows its dialog to dismiss before launching the native picker. Failed note reads retain the SDK error message.
- Updated note service fixtures to the actual SDK result shape. 647 tests / 47 suites pass; typecheck passes; lint has zero errors (590 warnings).
- Device acceptance pending: edit an existing task, Link Note, select a .note file, reopen task and use Open Note; verify link after reopening SNFolio. Also check picker cancellation.
- Clean native package validation passes for 0.1.22-rc.5/build 57, including app.npk.

## Build 58 — 0.1.22-rc.6 task linking flow correction

- Build 57 device feedback: linking still returned to Create Task Note. The fallback routing was incorrect and page-count validation remained an unnecessary prerequisite.
- Link Note now saves the selected .note path directly, with first-page metadata, without querying notebook page count. It does not create or modify the note.
- Successful linking returns to the task editor showing Open Note. Cancellation and errors also return to the task editor, never to Create Task Note.
- 647 tests / 47 suites pass; typecheck passes; lint has zero errors (590 warnings). Device acceptance pending for linking/opening and picker cancellation.
- Clean native package validation passes for 0.1.22-rc.6/build 58, including app.npk.

## Build 59 — 0.1.22-rc.7 consistent note actions

- Linking an existing task/event now dismisses item dialogs and returns to the prior planner view, without reopening a task editor or Create Task Note.
- New task/event forms offer Link Note. Picker selection remains a draft until Save; Cancel discards it. Existing items offer Create Note or Open Note, plus Link Note / Change Link and Unlink. Event details also expose linking/unlinking.
- Unlink removes mapping aliases without deleting or queuing deletion of the note file; other items linked to the same file remain linked.
- Task saves retain editingTask.uid rather than depending solely on a synthetic editingEvent uid.
- 651 tests / 48 suites pass, including draft task/event link saves, draft cancellation, and mapping-only unlink. Typecheck passes; lint has zero errors (611 warnings).
- Both-device acceptance pending: link existing task/event returns to planner, new task/event Link Note then Save/Cancel, Create/Open Note actions, Change Link and Unlink preserving files.
- Clean native package validation passes for 0.1.22-rc.7/build 59, including app.npk.

## Release 0.1.22 / build 60

The maintainer accepted build 59 (“This is good”) and authorized README updates, commit, push, and release. Build 60 promotes the same application code with final version metadata and documentation.

Final validation: 651 tests / 48 suites pass; typecheck passes; lint has zero errors (611 warnings); clean native build and package validation pass for 0.1.22/build 60, including native launcher code.
