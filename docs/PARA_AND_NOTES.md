# PARA and Notes

PARA is an organization model, not a required filing exercise. Create a category only when it helps you find or act on something.

## Projects

A Project is an outcome with a finish line: complete a course assignment, prepare a proposal, or plan a trip.

Projects can contain tasks, related events, and a folder of notes or reference files. **Finish** records completion. **Archive** removes an inactive Project without claiming it was completed.

## Areas

An Area is an ongoing responsibility without a finish line: health, finances, a business role, or a field of study.

An Area can contain Projects and can link to its own folder. Tasks and events may also be assigned directly to an Area. A Project assigned to an Area derives that Area automatically rather than storing two potentially conflicting answers; otherwise an event's explicit Area overrides its Event Type default.

## Resources

A Resource is reference material that may be useful later but is not itself an outcome: recipes, research, manuals, or travel ideas.

Each Resource points to a folder rather than a single note. SNFolio lists ordinary file types supported by the device, including Supernote notes, PDF, EPUB, Office documents, text, and images. Internal `.mark` files are hidden.

## Archive

Archive contains finished or inactive Projects, Areas, and Resources. Archiving a Project or Area always changes its SNFolio status first, then optionally moves its folder into the configured or newly selected Archive root. If permission is denied or the physical move fails, the item remains archived and its folder stays where it was. Supernote labels the move's removal of the old path as file-delete permission; moving does not delete the folder contents. SNFolio warns about native or external links it cannot update. Items can be restored, with an option to move a folder back to its recorded original location.

## Choosing folders

Supernote exposes a file picker rather than a true folder picker. To link an existing folder:

1. Tap **Choose Folder**.
2. Navigate into the intended folder.
3. Select any file inside that folder.
4. Return to SNFolio and tap **Refresh Files** if necessary.

For an empty or new folder, use the default SNFolio folder or type its full storage path where the screen provides a path field. SNFolio creates default folders for new PARA items.

## Creating and opening notes

Projects, Areas, and Resources provide **+ New Note**, **Refresh Files**, and **Choose Folder**. Opening a file temporarily leaves SNFolio for the native Supernote application; SNFolio remains available from the plugin toolbar inside supported notes and PDFs.

Linked notes work differently: tap an event or edit a task, then choose **Create Note** or **Open Note**. Before creating a file, SNFolio lets you edit the note name, shows the resolved template and destination, and lets you use the assigned Project/Area, the standard folder, or another folder selected from the device. Changing the note folder does not change the event or task's Project or Area. Event notes retain the Meeting/Class choice; occurrences in a recurring series share the selected series notebook, with a new page using the configured template appended for each occurrence. Task notes use the configured Task Notes folder and template and are also available from **All Tasks**.

Under **Connections & Settings → Notes**, **Default Event Note Location** chooses whether the confirmation initially selects the assigned Project/Area or the standard Meeting/Class folder. Advanced folder layout can configure a relative subpath such as `Meetings` or `Course Notes/Classes`; leaving it blank files directly in the Project or Area root. Project membership wins over Area membership. Events with neither use the Event Type or standard Meeting/Class folder, and an existing recurring notebook always stays at its recorded path.

Before opening another note, SNFolio clears transient recognition and lasso state to prevent handwriting from being carried into the destination file.

For an existing task, choose **Link Note** to browse for a Supernote `.note` file. Linking preserves the notebook contents. The task then offers **Open Note**. Task note actions appear above the compact Save Task and Delete controls, and All Tasks also offers Link Note for tasks without a linked notebook.
