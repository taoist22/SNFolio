# Troubleshooting

## A Google calendar does not appear

- Confirm that the address is Google's **Secret address in iCal format**, not the normal calendar webpage.
- Use `https://` or `webcal://`; insecure `http://` feeds are rejected.
- Put long addresses in a text file and use **Import Setup or Calendar File** instead of typing them on the device.
- Tap **Sync Now** and read the result shown for calendar feeds.
- For work or school Google accounts, the administrator may have disabled secret iCal addresses. Ask the administrator if **Secret address in iCal format** is absent from **Integrate calendar**.

## A Google event cannot be edited or deleted

This is expected for an iCal subscription. Tap the event and choose **Copy as Editable** to make a separate local/CalDAV event, or **Hide on Supernote** to suppress the subscribed copy locally. Neither changes Google.

## An Apple calendar will not connect

- Use the Apple Account email and an app-specific password, not the normal Apple Account password.
- Generate the password under **account.apple.com → Sign-In and Security → App-Specific Passwords**. Two-factor authentication must be enabled.
- If the main Apple Account password was changed, generate a new app-specific password; Apple revokes the old ones.
- Run **Connect & Test** again and confirm that a writable event calendar is found.
- If it still fails, run the CalDAV diagnostic and record the failing step and HTTP status. The trace is intended for diagnosis; it should not be needed during ordinary use.

## A SNFolio task does not appear in Apple Reminders

Modern Apple Reminders is not available through iCloud CalDAV. Keep the task local, mirror dated tasks into Apple Calendar, or configure a separate VTODO-capable CalDAV service on both SNFolio and the Apple device.

## Tasks remain after disconnecting a VTODO provider

Use **Remove Task Account** rather than **Pause Task Sync**. Choose whether to keep the synchronized tasks locally or remove that account's local copies. Both choices leave the remote provider unchanged. Device-only tasks are never removed by this account cleanup.

## A deleted task returned after reconnecting

Current builds queue deletions made while a synchronized task's account is paused and send them only when that same account resumes. If the account was removed, pending remote changes are intentionally discarded because removing an account promises not to alter its server.

## Imported events do not update

An imported `.ics` file is a retained snapshot. Import a newer copy to update it. For continuous updates, use a feed URL or CalDAV connection.

## A note cannot be created while a PDF is open

SNFolio reports that the device does not allow notes to be created or added to while a PDF is open. This applies to the day's journal, event and task notes, and adding a page to a series notebook.

- Close the PDF, open any `.note`, then open SNFolio from the toolbar there and try again.
- This is a restriction in the device's plugin system, not a setting: a plugin cannot create a note from inside the PDF reader, and SNFolio cannot work around it.

## SNFolio is slow, or a sync brought in too much

SNFolio keeps its data in the plugin host's storage, so **removing and reinstalling the plugin does not clear it**, and there is no cache file to delete.

- **⚙ → Connections & Settings → Calendars & Sync → Remove Synced Events from SNFolio** clears the events pulled from the account and keeps the account connected. Nothing changes on the server, and **Sync Now** reads them back.
- **Remove Calendar Account…** disconnects the account, keeping or removing its events, so nothing pulls them back.
- **Help & Setup → Workspace Backup & Restore… → Reset SNFolio…** empties everything after saving a verified backup first. Notes, PDFs and folders are untouched.
- A calendar with hundreds of repeating events is the heaviest case. Events, tasks and PARA items you create yourself are not what makes a device slow.

## A folder shows no files

- Tap **Choose Folder**, enter the folder, and select a file inside it. Supernote does not expose a true folder-selection action.
- Tap **Refresh Files** after returning.
- Confirm the files use ordinary device-supported formats. Internal `.mark` files are intentionally hidden.
- If the intended folder is empty, create a note with **+ New Note** or use the default folder.

## A file is listed but does not open

SNFolio hands the file to the native Supernote application. Confirm the device itself supports that file type. Notes and PDFs should open directly; SNFolio remains accessible through the plugin toolbar in supported file viewers.

## Create Note is missing from a short event block

Tap the event block. **Create Note** or **Open Note** is always available in event details, including short, all-day, and recurring events. Taller blocks also show the command inline.

## A recurring event is wrong

Confirm the event's start date, interval, selected weekdays, and end condition. Editing an occurrence edits the series. Deletion asks whether to remove only that date or the entire series. After synchronization, restart SNFolio and verify that the exception or series remains correct.

## Duplicate events appear

Run **Sync Now** once and allow it to finish. SNFolio deduplicates identical event UIDs and conservative feed matches, but two genuinely separate source events remain separate. Record both event sources, titles, and times if a duplicate persists.

## Handwriting appears in the wrong note

Stop switching files and record the source and destination file types. SNFolio clears lasso and recognition state before native file navigation; a repeatable transfer after the validated build is a regression and should be reported with the exact navigation sequence.
