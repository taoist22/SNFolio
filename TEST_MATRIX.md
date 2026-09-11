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
