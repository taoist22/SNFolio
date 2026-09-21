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

## Build 61 — 0.1.23-rc.1 floating icon behaviour and startup persistence

Built from release 0.1.22 (18140f4). Earlier uncommitted builds 61–67 (navigation diagnostics and host hide/reshow experiments) were discarded.

- Floating icon inside SNFolio: tap opens the picker; long press does nothing. From an open note, PDF, or EPUB: tap reopens SNFolio; long press opens Quick Add, and Save Task / Save Event / Close store the item first and then return to the file.
- Recent Notes is now Recent Files: remembers up to 12 .note, .pdf, and .epub paths. Notes open in the note editor; PDFs and EPUBs open through the document opener. Browse Files… opens the native picker at storage root and opens any chosen file, adding notes, PDFs, and EPUBs to Recent Files.
- Startup persistence protection restored: Recent Files capture and writes are skipped until calendarStorage.isLoaded(), so a launcher-triggered settings save cannot write empty collections over stored data.
- Fixed a pre-existing test type error (MeetingNoteMapping.seriesId) that failed typecheck on 0.1.22.
- 655 tests / 48 suites pass (new: long press ignored in foreground and Quick Add from a file; save stores before closing for tasks and events; PDF/EPUB recent files; no pre-hydration writes). Typecheck passes; lint has zero errors (615 warnings). Clean build and package validation pass for 0.1.23-rc.1/build 61.
- Not confirmed: whether PluginCommAPI.getCurrentFilePath returns the PDF/EPUB path in the DOC app. If not, documents opened outside SNFolio will not enter Recent Files.
- Device checks: (1) inside SNFolio, tap icon → Recent Files; long press → nothing. (2) In a note: tap → SNFolio opens; long press → Quick Add → Save Task, then Save Event, then Close; each returns to the note and saved items appear in SNFolio. (3) Same from a PDF and an EPUB, and check the document appears in Recent Files. (4) Recent Files → open a note, a PDF, an EPUB. (5) Browse Files… → open a file; cancel the picker. (6) Existing tasks/events survive exit, restart, and reopening via the icon.

## Build 62 — 0.1.23-rc.2 Browse Files steps aside first

- Build 61 device result: checks 1–4 passed (icon tap/long press in SNFolio and from a note, Quick Add Save Task / Save Event / Close). Browse Files… did nothing after SNFolio had been reopened from the icon — the picker opened behind the panel, as previously observed after a showPluginView reopen.
- Browse Files… now clears note lasso state, minimizes SNFolio (icon kept), waits 200 ms, then opens the native picker. Picking a file opens it with SNFolio closed. Cancelling the picker, or a failed open, reopens SNFolio via restoreFolio().
- 656 tests / 48 suites pass (new: restoreFolio reopen and refused reopen). Typecheck passes; lint has zero errors (618 warnings). Clean build and package validation pass for 0.1.23-rc.2/build 62; restoreFolio confirmed in bundle.
- Device checks: after reopening SNFolio from the icon, Browse Files… → picker visible → open a note, then a PDF; repeat and cancel → SNFolio returns to the same view. Then finish build 61 checks 5–7.

## Build 63 — 0.1.23-rc.3 in-panel file browser

- Build 62 device result: Browse Files was unreliable — sometimes SNFolio stayed on screen, sometimes Open File returned to SNFolio instead of the chosen file, and sometimes a pick dropped back to SNFolio rather than the note. The native picker path (RattaFileSelector) is abandoned.
- Browse Files… now opens FileBrowserModal inside SNFolio, following sn-lastnote's in-panel browser: Internal/SD roots, ↑ Up, folders and files listed through the existing native listFolderEntries. Tapping a file opens it through the same open-then-close path as Recent Files; a failed open is shown in the browser, which stays open. restoreFolio() removed.
- 657 tests / 49 suites pass (new: folder navigation, file handoff, Up; failed open reported). Typecheck passes; lint has zero errors (622 warnings). Clean build and package validation pass for 0.1.23-rc.3/build 63.
- Device checks: after reopening SNFolio from the icon, icon → Browse Files… → navigate folders, Up, SD root if present → open a note, then a PDF, then an EPUB; each should come to the front with SNFolio closed. Cancel returns to SNFolio. Repeat several times. Then finish build 61 checks 5–7.

## Build 64 — 0.1.23-rc.4 two-column Recent Files

- Build 63 device result: maintainer reported everything working, including the in-panel file browser.
- Recent Files card shows files as two half-width tiles per row, filled across rows (newest top-left). Each tile shows the file name on one line and its folder on a second, both truncated. Browse Files… (left) and Cancel (right) share a bottom row outside the scrolling list, at equal height. Limit remains 12 files.
- Layout-only change with no new tests. 657 tests / 49 suites pass; typecheck passes; lint has zero errors (622 warnings). Clean build and package validation pass for 0.1.23-rc.4/build 64.
- Device checks on Manta and Nomad: tiles in two columns in newest-first row order, long names truncate without wrapping, empty state spans the card, buttons side by side and reachable with a full list of 12, tapping a tile / Browse / Cancel behave as in build 63.

## Release 0.1.23 / build 65

The maintainer accepted build 64 ("works") and authorized README updates, commit, and release. Build 65 promotes the same application code with final version metadata and documentation.

Final validation: 657 tests / 49 suites pass; typecheck passes; lint has zero errors (622 warnings); clean native build and package validation pass for 0.1.23/build 65, including app.npk.

## Build 66 — 0.1.24-rc.1 floating icon removed

- 0.1.23 device result: with the floating icon on, Link Note in a new event form did nothing, Day Planner + Add Task did nothing, and Quick Add stopped opening, whether SNFolio was opened from the icon or the toolbar. With the icon off, everything worked as designed. A further test showed the native note picker opening with the SN icon on top of its Link Note button. Code reading: ItemCreationModal hides itself while `pickingNote` is true and waits on the native picker; a picker that never returns leaves every later use of the form hidden. The maintainer chose to remove the floating icon.
- Removed: floating icon and its App & View setting, ⚙ Minimize, Quick Add, Recent Files, the in-panel Browse Files browser, FloatingLauncherModule (native overlay), the SYSTEM_ALERT_WINDOW permission, and the floatingLauncherEnabled / recentNotePaths settings. index.js, exportService.ts, CalendarFilePackage.java and AndroidManifest.xml are identical to 0.1.21; Exit and note opening close the panel with PluginManager.closePluginView() as in 0.1.21.
- Kept: all other 0.1.22/0.1.23 changes, including the Nomad layouts, note linking, the save-before-close test, and the calendarStorage test type fix. The startup data-loss race is gone with its only trigger (launcher-driven recent-file capture before storage loaded).
- 646 tests / 46 suites pass; typecheck passes; lint has zero errors (580 warnings). Clean build and package validation pass for 0.1.24-rc.1/build 66; the native package no longer contains the launcher module and the bundle has no icon, Recent Files, Minimize, or Browse Files text.
- Before installing over 0.1.23, turn the floating icon off or restart the device afterwards, so no leftover overlay remains.
- Device checks: Day Planner + Add Task saves; new event and new task Link Note pick and save; Create/Open Note from events and tasks; lasso Add to Calendar; Exit closes SNFolio; App & View shows no floating icon setting; ⚙ menu has no Minimize; existing tasks, events and settings survive update, Exit, and restart.

## Build 67 — 0.1.24-rc.2 SNFolio never deletes notes

- Build 66 device result: maintainer reported everything working with the floating icon removed.
- Maintainer decision after accidentally deleting linked notes with Delete both: SNFolio must never delete a note, whether linked or created by SNFolio.
- Delete sheet for a non-recurring event with a note: Delete both removed; "Delete the event, keep the note" deletes the event, unlinks the note, and reports the kept note by name; "Replace the note, keep the event" becomes "Unlink the note, keep the event" (clears the recorded Meeting/Class kind, file untouched).
- Deleting a task with a linked note unlinks it and reports the kept note by name.
- All FileUtils.deleteFile calls removed: no immediate note deletion, no queueing, and no queue flush when a note is created or opened (DELETE_BEFORE_OPEN_DELAY_MS removed). calendarStorage.queueNoteDeletion removed.
- Help & Setup adds Notes Queued for Deletion: Check Queued Notes lists anything an older version queued (with "Not found" for missing files) and Keep These Notes empties the queue on disk. Queue paths are still rewritten on PARA folder moves.
- README documents that SNFolio never deletes notes and the queue check.
- 647 tests / 46 suites pass (new: clearing the queue persists across reload; folder-move test seeds the queue from stored data). Typecheck passes; lint has zero errors (572 warnings). Clean build and package validation pass for 0.1.24-rc.2/build 67.
- Device checks: (1) BEFORE opening any note from SNFolio, Help & Setup → Check Queued Notes; record the result; Keep These Notes if anything is listed. (2) Delete an event with a linked note → only "Delete the event, keep the note", "Unlink the note, keep the event", Cancel; delete → event gone, note file still in its folder, message names it. (3) Unlink on another event → Create Note asks Meeting or Class; old file still present. (4) Delete a task with a linked note → message names the kept note; file present. (5) Create Note and Open Note still work.

## Build 68 — 0.1.24-rc.3 task delete confirmation

- Build 67 device result (Manta): deleting a task with a linked note deleted the task immediately, kept and unlinked the note, and showed the kept-note message — but did not ask first, unlike events. Maintainer asked for the same confirmation for tasks.
- Maintainer also reported Create Note missing from new event and task forms. Not a regression: ItemCreationModal is unchanged since 0.1.22 and has shown Create Note only for existing items since 0.1.21 (tasks) / 0.1.22 (events). Adding it to new-item forms would be a new feature; not built.
- Task deletion from the task form and the task row ✕ now goes through requestDeleteTask: a task with a linked note shows "Only the task is deleted…", the note name, "🗑️ Delete the task, keep the note", and Cancel. Tasks without a note delete as before.
- 647 tests / 46 suites pass; typecheck passes; lint has zero errors (574 warnings). Clean build and package validation pass for 0.1.24-rc.3/build 68.
- Device checks: delete a task with a linked note from the task form, then from a task row ✕ → sheet appears; Cancel keeps the task; Delete removes the task, keeps the note file, shows the message. A task without a note deletes without the sheet. Event delete sheet unchanged.

## Release 0.1.24 / build 69

The maintainer accepted build 68 ("this is good") and authorized commit, push, and release. Build 69 promotes the same application code with final version metadata.

Final validation: 647 tests / 46 suites pass; typecheck passes; lint has zero errors (574 warnings); clean native build and package validation pass for 0.1.24/build 69, including app.npk without the floating launcher module.


## Workspace backup and restore — local validation

Version metadata remains unchanged at 0.1.24 / build 69. No release has been created.

Local automated coverage: failed storage reads and corrupt JSON block writes; valid datasets
remain readable internally; encrypted-store failures block saves; version/shape/date/import
validation; credential exclusion; external backup readback; denied permissions; missing imports;
replacement restore; replay after partial writes or journal cleanup failure.

Device acceptance checks (not yet run):

- Create a backup with local tasks/events, PARA records, links, and imported calendars. Verify
  the file in Export / SNFolio Backups and copy it to a computer.
- Restore after additional edits. Confirm the before-restore backup contains those edits,
  restored counts match the preview, and note files remain untouched.
- Confirm missing linked notes are listed and all restored feeds/accounts are paused.
- Confirm reconnection is blocked until review is acknowledged; re-enter credentials and
  selectively enable feeds. Test pending changes against a disposable CalDAV account.
- Deny read/write permissions and confirm no replacement occurs. Try truncated/unsupported
  backup files and an unavailable imported calendar.
- On a disposable test device, back up notes and the workspace externally, reset PluginHost
  storage, reinstall the full plugin, restore the workspace, and verify imported calendars.
- Interrupt restoration and reopen: recovery must finish before the workspace becomes editable.
- Check the scrollable confirmation dialog on both Nomad and Manta.


Backup permission-window correction:
- Device report: the native backup modal covered the file permission prompt, leaving Working visible indefinitely.
- Backup now uses a screen-level in-panel overlay; permission prompts and the native picker can appear above it.
- Pending operations disable duplicate actions and closing; permission denial returns usable controls.
- Device retest: with file permissions revoked, Create Backup → allow read/write → verified result;
  repeat with Deny → error and usable Close; Choose Backup to Restore → visible picker → cancel or preview.


Legacy backup-settings correction:
- Device report: backup validation rejected recentNotePaths retained from the removed Recent Files feature.
- Validator now accepts legacy recentNotePaths string arrays and floatingLauncherEnabled booleans,
  while continuing to reject malformed values. These settings do not re-enable removed features.
- Regression coverage seeds an upgraded installation, exports, parses, restores, and exports again.
- Device retest pending: Create Backup with existing settings, then review the resulting file.

PARA file-list refresh correction:
- Device report: selecting a Project repeatedly flashed attachments and the reading-files message.
- Cause: workspace activity updates re-rendered the parent, replacing the folder-reader callback;
  the panel's effect treated each replacement as another request to reload.
- File listing now uses the latest callback without depending on its identity, and ignores stale
  request results after changing folders/items or unmounting.
- Automated checks: 682 tests / 51 suites pass; typecheck passes; lint has zero errors.
- Device retest pending: select Projects, Areas, and Resources; verify files settle, manual Refresh
  works, and switching items quickly does not show results from the previous folder.


PDF linking for events and tasks:
- Shared Link Note / PDF picker accepts .note and .pdf files and starts at the user-storage root.
- Linked PDFs open through the native document reader; notebooks retain the note editor.
- Automated coverage includes PDF selection, uppercase extension, denial/cancellation, draft
  event/task PDF links on Save, and native document-versus-note dispatch.
- Device retest pending: link a PDF to an existing and a new event/task; save, reopen SNFolio,
  open the PDF, change the link, and unlink. Confirm the PDF file remains unchanged.

Linked-file markers:
- Individual task/event titles display [N] for linked notes and [PDF] for linked PDF documents.
- Markers appear in calendar month/week, day schedule, task lists, planner/focus/review, and PARA.
- Markers read existing in-memory mappings, follow recurring-event series links, and update on unlink.
- Device retest pending: link/change/unlink a note or PDF on a task and an event; verify the markers
  across views, including recurring events and narrow Nomad month cells.

Calendar designations (Class / Meeting):
- Agreed design: Project category General / Class / Work plus an optional Default calendar designation (Category default, None, Class, Meeting). Class projects default their events to Class; other projects stay unmarked unless their default is set to Meeting. Each event can follow the project default or choose None, Class, or Meeting, including standalone meetings without a project.
- Markers: C = Class, M = Meeting, shown before titles in all views and as month-cell badges (counting items hidden behind the overflow count). [N] / [PDF] remain independent attachment markers, e.g. "C [PDF]". Month-cell C/M now describe designations, replacing the old note-kind C/M/N badges; D still marks a daily journal.
- Create Note preselects Class or Meeting from the event's designation. Designations and project categories are included in workspace backups and validated on restore.
- Tasks (maintainer decision 2026-09-20): tasks inherit C when their project's events default to Class; tasks never get M and have no per-task override. Marker labels are now "Class" / "Meeting" so they fit tasks and events.
- Automated checks: 704 tests / 54 suites pass; typecheck passes; lint has zero errors.
- Device retest pending: set a project to Class → its events and tasks show C in month cells, Day Planner, task lists, Week view and PARA; set a Work project's default to Meeting → its events show M, its tasks show nothing; override one event to None; create a standalone Meeting event; confirm C/M sit alongside [N]/[PDF]; Create Note on a Class event preselects Class; check narrow Nomad month cells.
- Build 2026-09-20 18:45 (version unchanged 0.1.24 / 69): build/generated and build/outputs removed first, fresh build and package validation pass. Bundle confirmed to contain workspace backup, Link Note / PDF, calendar designation and project category controls, the queued-notes check, the task delete sheet, and task C inheritance; native package contains the backup read/write methods and no floating launcher module. First build to include the designation feature.
- Project detail: "📝 Associated Notes" renamed "🔗 Linked Files" (it lists linked notes and PDFs, not a folder), rows use 📄 instead of the folder icon, and the empty-state text explains it. README documents Project Files vs Linked Files, Project category and designations, the C/M/[N]/[PDF]/D markers, Link Note / PDF, and Workspace Backup & Restore; docs/PARA_AND_NOTES.md updated to match. 704 tests pass; typecheck passes. Device check: open a Project, confirm the Linked Files heading and 📄 rows render.
- Linked PDFs: the open action now reads "Open PDF" (📄) instead of "Open Note" in the item form, event details, All Tasks, and Day schedule blocks; notes keep "Open Note". Shared isPdfPath / openLinkedFileLabel helpers. 707 tests pass. Device check: an item linked to a PDF shows Open PDF in each place and opens the reader.

Project screen safety, class weeks, and existing folders (2026-09-20):
- Device report: IDS105 vanished after its category was changed and a due date set. Backup comparison (Sep 16 vs Sep 20) showed the project intact with 11 attached tasks but status "done" without completedAt: Finish had been tapped (read as "finish editing"), and the due-date save then wrote back the screen's stale copy. Recoverable via Archive → Projects → Reopen.
- Project saves (due date, class start, grouping, rename, status) now read the stored project and refresh the open screen; the date picker no longer writes a captured copy.
- Finish renamed Mark Complete and moved, with Archive / Move to Areas / Delete, into Project Actions… at the bottom of the project screen. Mark Complete confirms with an explanation (moves to Archive → Projects labeled Finished; tasks, events, linked files, folder, due date and settings unchanged; Reopen from Archive).
- Category panel heading reads "▾ Change" / "▴ Close", states that choices save as tapped, and has a Close button.
- Class projects: Class start date and Group Linked Files by None / Week. Calendar weeks from the week containing the start date (week-start setting), counting through breaks; empty weeks hidden; a file appears under each week it is linked from; Before Week 1 and No date groups. New project fields classStartDate / linkedFilesGrouping load, back up, and validate.
- Restore dialog: when no folder was moved into Archive it says so, shows the folder location, hides the folder-move warning, and offers Reopen (completed Project) or Restore; the result message says the folder is unchanged.
- PARA → + Existing Folder… → Project / Area / Resource → in-panel folder browser. A folder already used by an item brings that item back (active) with its tasks; otherwise a new item named after the folder is created.
- README and docs/PARA_AND_NOTES.md updated. Automated: 719 tests / 56 suites pass (new: week grouping, project screen actions/confirmation/close/grouping, class-field backup round trip); typecheck passes; lint has zero errors.
- Device checks: (1) Archive → Projects → IDS105 → Reopen dialog wording, then Reopen. (2) Category panel Change/Close. (3) Set IDS105 class start date and Group by Week; confirm headings and a shared notebook under several weeks. (4) Set a due date and confirm status, category and designations are unchanged. (5) Project Actions → Mark Complete → read explanation → Cancel; then confirm on a disposable project and Reopen it. (6) + Existing Folder… → Project → pick an unlinked folder; then pick a completed project's folder and confirm it returns. (7) Nomad: PARA top bar wraps cleanly.
- Choose Folder (Projects, Areas, Resources) now saves the new folder onto the stored item and refreshes the open project, instead of writing back the caller's copy (same stale-copy class as the IDS105 status loss). 719 tests pass.
- Build 2026-09-20 19:49 (version unchanged 0.1.24 / 69): build/generated and build/outputs removed first; fresh build and package validation pass. Bundle confirmed to contain Project Actions / Mark Complete, category Close text, class start date and weekly grouping, + Existing Folder, the truthful restore dialog, Open PDF, Linked Files, task C, designations, and backup; native package has the backup methods and no floating launcher.

Week folders for Class projects (maintainer decision 2026-09-20, option A):
- Problem: more notes per week than tasks/events, and each task/event links one file, so most Project Files had no week.
- Class projects with a class start date and due date get Create Week Folders: Week 01 … Week NN (zero-padded) in the project folder, one per calendar week from the start date to the due date; existing folders are kept; created sequentially; the file panel refreshes afterwards.
- While the class is running, Project Files opens in the current week's folder (only if it exists, once per visit), so + New Note files there; Up returns to the project folder.
- Bug fixed on the way: creating a note while browsing a subfolder re-pointed the project (or area/resource) folder to that subfolder. Note creation now records the item's own folder only when it has none.
- Automated: 724 tests / 56 suites pass (new: week folder names/counts/current week, panel preferred start folder and fallback, Create Week Folders button and missing-date hint); typecheck passes; lint has zero errors.
- Device checks: set IDS105 start date and due date → Create Week Folders → status shows counts; folders appear in Project Files and the Supernote file manager; reopen IDS105 → opens in this week's folder; + New Note there → note lands in the week folder and the project folder stays the same (Choose Folder path unchanged); Up shows all week folders; run Create Week Folders again → reports them as already there.
- Per-class week start (maintainer decision 2026-09-20): new Project field classWeekStartsOn. Default (unset) = weeks run seven days from the class start date's weekday; optionally a fixed weekday (Mon … Sun). Used for Linked Files week headings, the week count / Create Week Folders, and the current-week folder; calendar views keep the app-wide week start. The panel shows "Week 1: <dates>" and, with a due date, the week count and last week. Backed up and validated (0–6). 725 tests pass. Device check: IDS105 with its real start date → confirm Week 1 dates under both "From class start day" and "Mon"; Create Week Folders count matches; grouping headings move accordingly.
- Build 2026-09-20 20:40 (version unchanged 0.1.24 / 69): build/generated and build/outputs removed first; fresh build and package validation pass. Bundle confirmed to contain week folders, per-class "Weeks run", Project Actions / Mark Complete, + Existing Folder, the Reopen dialog, Open PDF, and weekly Linked Files grouping; native package has the backup methods and no floating launcher.

Project Files sections and Move… (maintainer decision 2026-09-20):
- Project Files (Projects, Areas, Resources) now shows files in the item's folder followed by each subfolder as a collapsible section (loaded when opened, with a file count once read). A class's current week section opens automatically once per visit and is marked "this week"; the top + New Note files there; each open section has "+ New Note in <folder>". Deeper folders and Choose Folder still browse. This replaces opening Project Files inside the current week folder.
- Move… on every file in Project Files and Linked Files: destinations are the item folder and its subfolders (linked files list the linked item's class week first as "(suggested)"). moveFileToFolder moves the file plus <name>.<ext>.mark annotations and <stem>.sdr reading data (confirmed on device), one native call at a time, refuses to overwrite, and moves everything back if any step fails. Afterwards calendarStorage.rewritePathPrefix repoints mappings; open-behind note is refused.
- .sdr folders are now hidden from file listings like .mark files.
- Automated: 733 tests / 56 suites pass (new: move with companions, no overwrite, rollback, same-folder refusal; sections, auto-open current week, collapse, + New Note targets, Move targets and refusal message; linked Move suggestion order); typecheck passes; lint has zero errors.
- Device checks: IDS105 Project Files shows week sections, this week open; open/close another; + New Note in a section. Move an unlinked note into a week; move a linked PDF with annotations → annotations intact, [PDF] still opens it, Linked Files shows the new path; try moving onto an existing name → refused, nothing moved; try moving the note open behind SNFolio → refused.
- Build 2026-09-20 21:16 (version unchanged 0.1.24 / 69): build/generated and build/outputs removed first; fresh build and package validation pass. Bundle confirmed to contain Project Files sections ("this week", "+ New Note in"), Move… with suggested week, companion moves, link updates and the open-note refusal, plus all earlier features; native package has the backup methods and no floating launcher.
