# SNFolio for Supernote


https://github.com/user-attachments/assets/83200e64-08d4-444a-adb7-5c56df30a18a






An e-ink-optimized planner, calendar, task, PARA, and note workspace for Supernote.

> [!WARNING]
> This version requires the newest Supernote Plugin Preview firmware:
> **Chauvet 3.29.43 Beta** for Manta / Nomad or **Chauvet 2.26.40 Beta** for A5 X / A6 X.
> It will not open on earlier system versions.

## Start Here

- [Getting Started](docs/GETTING_STARTED.md) — install SNFolio and choose the simplest setup for your needs.
- [Calendar Connections](docs/CALENDAR_CONNECTIONS.md) — Google feeds, iCloud CalDAV, custom CalDAV, and what is editable.
- [PARA and Notes](docs/PARA_AND_NOTES.md) — what Projects, Areas, Resources, and Archive mean in SNFolio.
- [Troubleshooting](docs/TROUBLESHOOTING.md) — common setup, sync, folder, and note-opening problems.

SNFolio works without an online account. Calendar connections and PARA organization are optional and can be added later.

---

## Key Features

- **iCal / `.ics` Feed Integration**: Subscribe to public or private iCal HTTPS URLs (Google Calendar, Outlook, Apple Calendar, Fastmail, Proton) or import `.ics` files.
- **Month and Week Calendars**: Navigate high-contrast month and week views, choose a Sunday-through-Saturday week start, and display either five or seven days. Week View combines the calendar with Weekly Focus, due and unscheduled tasks, progress, and a Weekly Review note.
- **Day Planner and Weekly Review**: Use the Day Planner for the selected day's schedule, journal, focus tasks, deliverables, project attention, and tomorrow's schedule. Weekly Review summarizes completed, remaining, overdue, and upcoming work, shows **This Week by Project** (each Project's tasks due, events, and linked notes for the week, with its week number), and opens or creates a handwritten weekly note.
- **CalDAV Two-Way Sync**: Synchronize calendar events and, through an optional independent VTODO-capable account, tasks including completion, priorities, undated items, remote deletions, and conflict-protected edits when the server supplies ETags.
- **PARA Workspace**: Organize actionable Projects, ongoing Areas, reference Resources, and a unified Archive. Reorder Projects, assign them directly to Areas, review open and completed work in separate columns, and link Projects, Areas, and Resources to folders of Supernote notes and other files.
- **Daily and PARA Notes**: Open or create daily journals and create, browse, and open notes and other files connected to Projects, Areas, and Resources. Create named notes for events and tasks, optionally filing them beneath their assigned Project or Area folder, or link an existing note or PDF.
- **Weekly Project Folders**: Give any Project (a course, a client engagement, a quarter of sprints) a start and due date, and SNFolio creates a folder per week, files each event or task note in the week it belongs to, and lists last, this and next week first. Files linked to the Project's tasks and events show **🔗** and what they are linked to.
- **Auto-file from Calendars**: File Canvas, Outlook, Google and CalDAV items under a Project automatically by a word in their title, such as a course code or client name.
- **Undo**: Undo Mark Complete, Archive, Move to Areas, Delete, and file moves from the message that confirms them.
- **Class and Meeting Markers**: Mark Projects as Class or Work, and events as Class or Meeting. The calendar shows **C** and **M** beside items, and **[N]** or **[PDF]** when a note or PDF is linked.
- **Workspace Backup & Restore**: Save tasks, calendars, PARA organization, settings, and note links to a backup file, automatically once a day if you like, and restore them later without touching your notes.
- **Recurring Meetings**: Handle common RRULE schedules, cancellations, and moved occurrences, then append a fresh page using the configured template to the series notebook, or give each session its own dated note, chosen per Project.
- **Repeat Controls**: Create daily, weekly, monthly, or yearly series; choose intervals and weekly days; end on a date or after a count; edit a series; and delete one occurrence or the entire series.
- **Auto-Launch**: Immediately open a newly created note or appended page on device so you can start handwriting right away.
- **E-Ink-Friendly Controls**: Use tap-based date, time, duration, recurrence, and folder controls with larger touch targets. Choose a saved 12-hour or 24-hour clock format. Settings navigation stays visible while the section contents scroll, and clock/filter choices use clearly labeled black-and-white buttons. A startup status banner makes it clear when calendars and tasks are still loading.

---

## How to Install on Supernote

1. Connect your Supernote Nomad (A6 X2) or Manta (A5 X2) via USB or ADB.
2. Copy `build/outputs/SNFolio.snplg` to the `/MyStyle/` folder on your Supernote storage:
3. On your Supernote device:
   - Go to **Settings → Apps → Plugins**.
   - Tap **Add Plugin** and select `SNFolio.snplg`.
4. Open any **NOTE** or **DOC** file. You will see the **SNFolio** plugin button on your toolbar.

On first use, Supernote may ask for network or file permissions when a feature first needs them. Network access is used only for configured feeds and CalDAV connections. File read/write access is required to browse PARA folders and create or open notes. If loading takes a moment, SNFolio displays **Loading calendar and tasks…** until saved data and the opening refresh are ready.

---

## How to Use

For a first-time walkthrough, use [Getting Started](docs/GETTING_STARTED.md). The sections below are a feature reference.

### Adding Events and Tasks by Handwriting

Write the item in any note, lasso it with the native lasso tool, then tap **Add to Calendar** on
the lasso toolbar. The plugin recognises the writing, pulls out a date and time, and opens the
creation form already filled in. Saving returns you to your note.

**Write the date, time and title on a single line:**

```
08-20-2026 10:00A Meeting B
```

> **Known limitation.** Splitting the date, time and title across separate lines confuses the
> handwriting recogniser. In on-device testing, `11:00AM` written on its own line was read as
> `/ 1:00AM` — a ten-hour error — while the identical text on one line parsed perfectly. This is
> a recogniser behaviour, not a parsing bug; the same content simply recognises far better as one
> line.

The creation form always shows what was read and how it was interpreted, so check it before
saving:

```
read: "08-20-2026 10:00A Meeting B"
→ Event · Thu, Aug 20, 2026 · 10:00 AM
```

Rules worth knowing:

- **No date or time found → it becomes an undated task**, rather than inventing an appointment or due date.
- Ambiguous dates such as `09/10` are flagged with a warning, since they could be Sep 10 or
  9 Oct. Dates like `22/09` resolve themselves. The order used for ambiguous dates follows your
  device's region setting by default, and can be overridden under **⚙ → Connections & Settings**.
- Numeric dates accept `/`, `-` and `.` separators; times accept `10:00A`, `10am`, `14:00` and
  `14h00`.

### 1. Subscribe to Your Calendar Feeds
1. Tap the **SNFolio** icon on your toolbar to open the plugin panel.
2. Tap the **⚙** button and choose **Connections & Settings**.
3. Paste an HTTPS `.ics` feed URL from Google Calendar, Outlook, or Apple Calendar, then tap **Subscribe**. `webcal://` URLs are accepted and upgraded to HTTPS; plaintext HTTP is rejected.

To avoid typing long private feed addresses on the device, create a text file (.txt) on a computer, move it to your Supernote device and import it with **Import Setup or Calendar File**. Use one feed per line, either as a bare address or `Calendar Name|https://…`. Blank lines and lines beginning with `#` are ignored. Delete the setup file after confirming the feeds, because it contains the private addresses in plaintext. You can also import an `.ics` file directly; the plugin keeps a private app-owned copy so the calendar remains available after the original file is moved.

Subscribed feeds are read-only. Tapping one of their events shows its source and offers **Copy as Editable** or **Hide on Supernote**; neither action changes Google. Hidden items can be restored from **Calendars & Sync**. Identical copies of the same event from multiple subscribed calendars are collapsed conservatively by title, time, all-day state, and location.
4. Alternatively, import an `.ics` file or a `.txt` file containing one HTTPS/webcal URL per line.

Private subscription URLs and CalDAV passwords are stored through Android Keystore-backed encryption rather than shared plugin storage.

Calendar imports support embedded timezone definitions, including Microsoft Outlook Windows timezone names such as `W. Europe Standard Time` and definitions with 1601 transition dates. When definitions are missing, recognized Windows and IANA timezone names use bundled timezone data without an online lookup. Keep timezone information in the file; removing it can change event times. If a timezone cannot be resolved, SNFolio reports an import/sync error instead of silently treating it as the device timezone. See [Calendar Timezone Support](docs/CALENDAR_TIMEZONE_SUPPORT.md) for the tested scope and limitations.

### CalDAV Events and Tasks

Use **⚙ → Connections & Settings → Calendars & Sync** to connect iCloud or another CalDAV server for events. Choose **Sync Now** from the ⚙ menu to push local changes first and then pull remote changes.

Modern iCloud Reminders lists are not exposed through iCloud's CalDAV endpoint. Although iCloud may advertise and accept writes to a legacy collection named `Reminders`, those tasks do not appear in the current Reminders app. To synchronize tasks through VTODO, configure the plugin's separate **Task CalDAV Account** using a provider that supports VTODO, and add that same account to the Reminders app on the Apple device. Existing iCloud reminders are not moved. Alternatively, keep tasks local and enable the task-to-calendar event mirror for dated tasks. Mirrored events include an alert at the due time; date-only tasks use 9:00 AM.

If a task provider exposes more than one VTODO list, SNFolio asks which list to use. **Pause Task Sync** keeps the account, tasks, and pending changes without contacting it. **Remove Task Account** removes the saved connection and asks whether synchronized task copies should remain on the Supernote; neither choice deletes anything from the server. Tasks remain tied to their original collection, so connecting a different provider never uploads old synchronized tasks into the new account. A task deleted while its owning account is paused is queued for deletion when that same account resumes.

Connecting a task account does not upload tasks that were already stored only on the Supernote. They remain device-only unless the user confirms **Upload Existing Device Tasks**. Tasks created after the connection can synchronize normally.

After a manual sync, the Calendar & Sync page shows each source's result, pending uploads, and the time of the last fully successful sync.

Time entry is tap-only for device usability: choose an hour and quarter-hour minute, with ±5-minute adjustment when needed. The 12-hour picker includes AM/PM; the 24-hour picker offers hours 00–23. Events use common duration buttons and expose an exact-end picker for unusual lengths.

### Settings Navigation and Clock Format

Open **⚙ → Connections & Settings**. The **Calendars & Sync**, **Notes & Storage**, **App & View**, and **Help & Setup** buttons stay visible while you scroll the selected section. Switching sections returns its contents to the top.

Under **Calendars & Sync**:

- **Time format**: Choose **12-hour** or **24-hour**. The preference applies to calendar times, event details, and time pickers, and is saved across restarts. The default is 12-hour; midnight in 24-hour format is **00:00**. Changing the format does not change event times or synchronization.
- **Hide All-Day Events** and **Hide Solo Events**: Choose **ON** to hide matching events or **OFF** to show them. Solo events have no attendees. These display filters do not delete events.

For all three controls, the selected choice has a **black background with white text**; the other choice has a white background and black outline.

### PARA Workspace

The **PARA** tab now represents all four categories:

- **Projects** are actionable outcomes with due dates, progress, tasks, assigned events, linked meeting notes, and a folder of supporting files. Each Project card separates open and upcoming items from completed tasks. **Mark Complete** records that a Project is done; **Archive** removes unfinished work from the active view without claiming it was completed. Both are under **Project Actions…** at the bottom of the Project.
- **Areas** are ongoing responsibilities that contain active projects and can carry their own folder of notes and reference files. Tasks and events can be assigned directly to an Area; an event assigned to a Project derives the Project's Area. Archiving an Area asks whether its active Projects should also be archived or should remain active and become unfiled.
- **Resources** are non-actionable reference topics backed by folders. Link an existing folder by choosing any file inside it; SNFolio lists the same regular files the device exposes, including `.note`, PDF, EPUB, Office, text, and image files. SNFolio can also create additional `.note` files. New Resources default to `/Note/SNFolio/Resources/<Resource name>`.
- **Archive** combines finished or archived Projects, retired Areas, and archived Resources. Projects and Areas are archived in SNFolio before any optional folder move, so a denied permission or failed move leaves the item archived and its folder untouched. Supernote describes moving as file-delete permission because the old path is removed; folder contents are not deleted. Each item can be restored; restoring a Project also restores its Area when necessary.
- Projects, Areas, and Resources share the same **Refresh Files**, **+ New Note**, and **Choose Folder** workflow. Defaults are `/Note/SNFolio/Projects/<name>`, `/Note/SNFolio/Areas/<name>`, and `/Note/SNFolio/Resources/<name>`; existing Project notebooks migrate to their current containing folder.
- The left pane follows PARA order—Projects, Areas, Resources, Archive—and each section expands into its items. Selecting an Area opens its projects; selecting a Resource lists the actual files in its folder on the right.
- Choose **Reorder Projects** and use the arrow controls to save a preferred Project order in both panes.
- Open a Project and tap its Area button to choose an Area directly, remove the assignment with **No Area**, or create and assign a new Area with **Add Area**.

#### Setting up a class or client project

The same steps work for a 16-week course or a 12-week client engagement:

1. In **PARA**, tap **+ New Project** (or **+ Existing Folder…** to use a folder you already have) and open it.
2. Tap **📅 Set a due date** and choose when the class or engagement ends.
3. Tap **Project settings … ▾ Change**:
   - Choose **Class** or **Work** as the Project category, so its events show **C** or **M**.
   - Under **Weeks**, tap **📅 Set start date**, check the Week 1 dates shown, and pick another weekday under **Weeks run** if your weeks start differently.
   - Tap **📁 Create Week Folders**.
   - Under **Notes for recurring events**, keep **One notebook for the series**, or choose **One note per session** to get a dated note for each lecture or meeting in its week folder.
   - Under **Auto-file from calendars**, enter the course code or client name as it appears in your calendar's item titles, and tap **Save**.
   - Tap **Close**.
4. From now on, **Create Note** on the Project's events, and on its tasks, offers the right week folder first. Anything else you write goes in with **+ New Note** in the week's section.
5. Once a week, open **Planner ▾ → Weekly Review** and check **This Week by Project**.

#### Inside a Project

On a wide screen (the Manta, or anything 1000 px or wider) a Project has two columns: **files on the left**, and **📅 Upcoming**, **Actionable Deliverables**, **Completed Deliverables** and **Project Actions…** on the right. Each column scrolls on its own. On a narrower screen they are stacked, work first.

- **📅 Upcoming** lists the Project's next five events in the coming 60 days (tap one to open it), with a count of any more.

- **📁 Project Files** lists what is actually in the Project's folder: notes, PDFs, EPUBs, and other documents, with each subfolder (such as `Week 01`) as a section you tap to open or close. Each open section lists its files and has its own **+ New Note in …**. **+ New Note** creates a note in this folder, **Choose Folder** points the Project at a different folder, and **Refresh Files** reads the folder again.
- A file linked to one of the Project's events or tasks shows **🔗**, with a grey line underneath saying what it is linked to, for example *↳ Task: Read chapter 4* or *↳ Research Methods (Sep 23)*. A file linked to several items names the first and adds *+1 more*. A note created from Project Files is not linked to any event or task, so it has no 🔗 and does not appear on the calendar.
- **🔗 Linked from elsewhere (N)**, below Project Files, lists linked files stored outside the Project's folder, for example a meeting note in `/Note/Meetings` or a PDF in `Document`. Tap it to open the list. It only appears while there are such files, and disappears once you have moved them all into the Project.

**Project category** (in the Project's details) is **General**, **Class**, or **Work**:

- A **Class** Project marks its events **Class (C)** by default, and its tasks show **C** too.
- Other Projects leave events unmarked unless you set **Default calendar designation** to **Meeting**, which marks their events **M**. Tasks never show **M**.
- Each event can follow the Project default or choose **None**, **Class**, or **Meeting** in its form, for example to keep a deadline in a Work Project unmarked. An event without a Project can also be marked as a Meeting.

Tap **Project settings … ▾ Change** to open these settings. Choices are saved as you tap them; tap **Close** (or the heading again) when you are done.

**Weeks** work for every Project, whether a 16-week course, a 12-week client engagement, or a quarter of sprints:

- **Start date.** Week 1 is the week containing it. Set the **due date** to when the class, engagement or project ends.
- **Weeks run:** **From start day** (the default: each week is seven days from the start date, so a Project starting on a Wednesday has Wednesday–Tuesday weeks) or a chosen weekday such as **Mon** for Monday–Sunday weeks. The panel shows the resulting Week 1 dates and, with a due date, the last week. This applies only to the Project's weeks; your calendar views keep their own week start.
- **Create Week Folders** makes `Week 01`, `Week 02`, … in the Project's folder, from the start date to the due date. Folders that already exist are kept. While the Project is running, the current week's section is open and marked **this week**, and the top **+ New Note** files notes there. To keep a long Project short, Project Files lists only last week, this week and next week; the rest are under **▸ All weeks (N)**. Before the Project starts it lists Weeks 1–2, and after it ends the final two. Other subfolders are always listed.
- Once a Project has a start and due date, **Create Note** on one of its events, and on its tasks, suggests the week folder for the event's date or the task's due date, selected first, for example *Project: IDS105 · Week 05*. You can still pick another folder before the note is made.
- **Notes for recurring events:** **One notebook for the series** (the default: a weekly lecture or standing meeting keeps one notebook, with a new page for each session, in the Project's folder) or **One note per session** (each session gets its own dated note, filed in its week folder when the Project has weeks). Notes already made keep their links when you switch.
- Creating a note while browsing a subfolder files it in that subfolder and leaves the Project's folder unchanged.

**Auto-file from calendars:** enter words such as a course code (`IDS105`) or client name (`Acme`), separated by commas, and tap **Save**. Items from subscribed calendars (Canvas, Outlook, Google) and CalDAV whose title contains any of them are filed under this Project as they sync, so they get its **C**/**M** marker, appear in **Upcoming**, and their notes go to its folder. Items you have already filed elsewhere are left alone, and an item you unfile by hand is not filed again.

**Project Actions…** at the bottom of a Project holds the actions that change its status:

- **Mark Complete** asks first and explains what happens: the Project leaves the Projects list and appears in **Archive → Projects**, labeled **Finished**. Its tasks, events, linked files, folder, due date, and settings stay exactly as they are; nothing is moved or deleted. Open it in Archive and tap **Reopen** to bring it back.
- **Archive** sets a Project aside without marking it done, and can move its folder into your Archive folder.
- **Move to Areas** turns the Project into an ongoing Area.
- **Delete** removes the Project from SNFolio after you confirm. Its tasks and files are kept.

After **Mark Complete**, **Archive**, **Move to Areas**, **Delete**, or moving a file, the message at the top has an **Undo** button. It puts the Project, its filing and its note links back as they were, and moves any folder or file back. Undo stays available while that message is showing, and only if nothing else in PARA has changed since.

#### Moving files into week folders or other subfolders

Every file in **Project Files** and **Linked from elsewhere** has **Move…**. Choose the Project folder or one of its subfolders, including weeks under All weeks; for a file linked from elsewhere, the week of its linked event or task is listed first as **(suggested)**.

- A PDF or EPUB moves together with its annotation (`.mark`) and reading (`.sdr`) files, so your handwriting on it is kept.
- SNFolio updates its own links to the file, so **[N]** / **[PDF]**, **Open Note** / **Open PDF**, and the 🔗 in Project Files keep working. Links to it from inside other Supernote notes are not updated.
- Nothing is overwritten: if the folder already has a file with that name, nothing is moved. If any part of the move fails, SNFolio puts the file back.
- Close a file before moving it. SNFolio will not move the note that is open behind it.
- Moving a linked file in Supernote's own file manager instead breaks SNFolio's link to it; use **Change Link…** on the event or task to fix it.

#### Adding an existing folder

Tap **+ Existing Folder…** at the top of PARA, choose **Project**, **Area**, or **Resource**, then browse to the folder (SD cards included) and tap **Use This Folder**. If the folder already belongs to a completed or archived item, that item is brought back with its tasks and linked files; otherwise a new item named after the folder is created.

#### Restoring from Archive

Opening an archived or completed item offers **Restore** (or **Reopen** for a completed Project). If SNFolio moved its folder into your Archive folder, you can move it back or leave it where it is. If the folder was never moved, SNFolio says so and shows where it is.

### 2. Navigate the Calendar and Planner

- Tap **Calendar ▾** and choose **Month View** or **Week View**.
- Tap **Planner ▾** and choose **Day Planner** or **Weekly Review**.
- Use the previous and next controls to move by the current view's natural interval: month, week, or day. Tap **Today** to return to the current date.
- Configure the starting weekday and five- or seven-day Week View under **⚙ → Connections & Settings → App & View → Calendar Week Layout**. The selected starting day is also used by Month View, date pickers, and Weekly Review.
- Month View shows events and dated tasks, plus quick access to work that would otherwise be invisible on a date grid: today, upcoming, no-date, and past-due tasks.
- Week View shows events and tasks by day, Project labels where available, Weekly Focus, work due that week, unscheduled tasks, progress, and the Weekly Review note.
- Day Planner shows the selected day's schedule, journal, three focus tasks, grouped Tasks & Deliverables, Projects needing attention, and Tomorrow's Schedule.
- Meetings display start/end times, locations, attendee lists, and agenda previews.

Markers beside events and tasks, and in Month View day cells:

| Marker | Meaning |
|---|---|
| **C** | Class: an event marked Class, or a task in a Class Project |
| **M** | Meeting: an event marked Meeting |
| **[N]** | A note is linked |
| **[PDF]** | A PDF is linked |
| **D** | Month View only: the day has a daily journal note |

Class/Meeting and the attachment markers are independent, so a class with a linked PDF shows **C [PDF]**. Month View day cells also count items hidden behind the "more" count.

On **Nomad**, Day Planner sections are collapsible and have fixed shortcuts for Schedule, Journal, Focus, Tasks, Projects, and Tomorrow. They start collapsed on first use and remember your expansion choices. Weekly Review keeps its note button and summary counts visible, with collapsible This Week, Projects, Deadlines, and Journals sections and separate saved expansion choices. PARA has fixed Projects, Areas, Resources, and Archive shortcuts. **Manta keeps its expanded planner layouts and existing PARA navigation.**

### 3. Link or Create a Note

- When creating a task or event, choose **Link Note / PDF** to select an existing `.note` file or PDF. The picker starts at the top of your storage. The link is saved only when you save the item; canceling discards the pending link.
- Existing tasks and events offer **Create Note** and **Link Note / PDF** when unlinked. Linked items offer **Open Note** (or **Open PDF** for a linked PDF), **Change Link**, and **Unlink** in their editor or event details. A linked note opens in the note editor; a linked PDF opens in the document reader.
- Linking, changing a link, or unlinking returns to the previous planner section. **Unlink** only removes the association; it does not delete the note file.
- **SNFolio never deletes notes.** Deleting an event or task deletes only that item and unlinks its note, whether you linked the note or SNFolio created it. The note stays in its folder; delete it in Files if you no longer need it. Deleting an event or task that has a note first asks you to confirm, and says the note will be kept. For an event, the sheet also offers **Unlink the note, keep the event**, which makes Create Note ask Meeting or Class again.
- Versions before 0.1.24 could queue a replaced note for deletion. **⚙ → Connections & Settings → Help & Setup → Check Queued Notes** shows anything still queued, and **Keep These Notes** clears the queue without touching the files.

To create a new note:
- Tap an event and choose **Create Note**. Taller Day View blocks also show the command directly. For a task, edit it or use its note action in **All Tasks**.
- Edit the proposed note name, then review the resolved folder and template. Event notes retain the Meeting/Class choice. Choose the assigned Project/Area folder, the standard folder, or browse to another folder without changing the item's PARA membership.
- The plugin then:
  1. Creates a new `.note` file in the confirmed folder using the resolved Event Type or Meeting/Class template.
  2. Links the note to the event.
  3. Opens the note so you can start handwriting immediately.

### 4. Back Up and Restore Your Workspace

Open **⚙ → Connections & Settings → Help & Setup → Workspace Backup & Restore…**.

- **Automatic daily backup** is on unless you switch it off here. Once a day, when SNFolio opens or syncs (before anything syncs), it saves `SNFolio Auto Backup - Mon` … `Sun` in `Export/SNFolio Backups`, each replacing last week's file for that day, so the last seven days are kept. Your own backups are never replaced. If an automatic backup fails, SNFolio says so and tries again next time.
- **Create Backup** saves your tasks, calendars, PARA organization, settings, and note links to `Export/SNFolio Backups` and checks the saved file. Copy backups off the device to protect against loss; they contain your planning data in plain text.
- Notes and other linked files are **not** in the backup. Back them up separately.
- Passwords and private subscription addresses are **not** in the backup. Enter them again after restoring.
- **Choose Backup to Restore…** shows the backup's date and item counts, and lists any linked notes that can no longer be found. **Create Safety Backup and Replace Workspace** first saves a verified backup of your current workspace, then replaces it. Notes are never changed.
- After a restore, calendar feeds and account synchronization stay **paused** until you review the restored items and reconnect, so old edits or queued deletions are not sent to your server by surprise.

---

## Notes Directory

By default, meeting notes are saved in:
```
/storage/emulated/0/Note/Meetings/
```

You can change the standard Meeting/Class folders and templates under **⚙ → Connections & Settings → Notes & Storage**. Event Types can use their own folder and template. **Default Event Note Location** decides which location Create Note selects initially; the confirmation sheet can override it for one note.



---

## Attribution & Credits

- Author: `taoist22`
- Icon: <a href="https://www.flaticon.com/free-icons/calendar" title="calendar icons">Calendar icons created by srip - Flaticon</a>

---

## License

SNFolio is licensed under the [Apache License 2.0](LICENSE).
