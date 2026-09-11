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
