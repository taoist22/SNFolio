import { NativeModules } from 'react-native';
import { FileUtils } from 'sn-plugin-lib';
import {
  ensureFileDeletePermission,
  ensureFileReadPermission,
  ensureFileWritePermission,
} from './pluginPermissions';

type CalendarFileModule = {
  writeTextFile(path: string, content: string): Promise<string>;
  openNote(path: string, page: number): Promise<boolean>;
  openDocument(path: string): Promise<boolean>;
  listNoteFiles(path: string): Promise<string[]>;
  listFolderEntries(path: string): Promise<ParaFolderEntry[]>;
  getStorageRoots(): Promise<string[]>;
  moveFolder(sourcePath: string, destinationPath: string): Promise<string>;
};

const CalendarFile = NativeModules.CalendarFile as CalendarFileModule | undefined;

function isVisibleResourcePath(path: unknown): path is string {
  if (typeof path !== 'string') return false;
  const name = path.split('/').pop() || '';
  // .mark annotations and .sdr reading folders belong to a document, not the user's file list.
  return Boolean(name) && !name.startsWith('.') && !name.toLowerCase().endsWith('.mark') && !name.toLowerCase().endsWith('.sdr');
}

/** Fallback if getExportPath is unavailable; the standard user-visible area. */
const FALLBACK_EXPORT_ROOT = '/storage/emulated/0/Export';

export interface ExportResult {
  success: boolean;
  /** Where the file actually landed, as reported by the native writer. */
  path?: string;
  message: string;
}

export interface ParaFolderEntry {
  /** Last modified, in milliseconds; absent from older native builds. */
  modified?: number;
  /** Size in bytes; absent from older native builds. */
  size?: number;
  name: string;
  path: string;
  isFolder: boolean;
}

/**
 * Files Supernote keeps beside a document: `<name>.pdf.mark` holds its
 * handwriting and annotations, and `<name without extension>.sdr` a folder of
 * reading data. They must travel with the file or the annotations are lost.
 */
export function companionPaths(filePath: string): string[] {
  const slash = filePath.lastIndexOf('/');
  const dir = filePath.slice(0, slash);
  const name = filePath.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return [`${filePath}.mark`, `${dir}/${stem}.sdr`];
}

/**
 * Moves one file, and any companion files, into another folder on the same
 * storage. Nothing is overwritten. If any step fails, what was already moved is
 * moved back, so a document and its annotations are never separated.
 */
export async function moveFileToFolder(sourcePath: string, destinationFolder: string): Promise<ExportResult> {
  const canWrite = await ensureFileWritePermission();
  const canDelete = canWrite ? await ensureFileDeletePermission() : false;
  if (!canWrite || !canDelete) {
    return { success: false, message: 'Moving a file needs both File Write and File Delete permission.' };
  }
  if (!FileUtils.renameToFile || !FileUtils.exists) {
    return { success: false, message: 'This device does not support moving files from SNFolio.' };
  }
  const source = sourcePath.replace(/\/+$/, '');
  const folder = destinationFolder.replace(/\/+$/, '');
  const name = source.slice(source.lastIndexOf('/') + 1);
  const destination = `${folder}/${name}`;
  if (source.slice(0, source.lastIndexOf('/')) === folder) {
    return { success: false, message: `${name} is already in ${folder.split('/').pop()}.` };
  }
  try {
    // One native call at a time: concurrent file calls have frozen the device before.
    if (!(await FileUtils.exists(source))) return { success: false, message: `${name} could not be found.` };
    if (!(await FileUtils.exists(folder))) return { success: false, message: `The folder ${folder.split('/').pop()} does not exist.` };
    if (await FileUtils.exists(destination)) {
      return { success: false, message: `${folder.split('/').pop()} already has a file named ${name}. Nothing was moved.` };
    }
    const pairs: Array<[string, string]> = [[source, destination]];
    const sourceCompanions = companionPaths(source);
    const destinationCompanions = companionPaths(destination);
    for (let i = 0; i < sourceCompanions.length; i++) {
      if (await FileUtils.exists(sourceCompanions[i])) {
        if (await FileUtils.exists(destinationCompanions[i])) {
          return { success: false, message: `${folder.split('/').pop()} already has ${destinationCompanions[i].split('/').pop()}. Nothing was moved.` };
        }
        pairs.push([sourceCompanions[i], destinationCompanions[i]]);
      }
    }
    const moved: Array<[string, string]> = [];
    for (const [from, to] of pairs) {
      const ok = await FileUtils.renameToFile(from, to);
      if (!ok || !(await FileUtils.exists(to))) {
        for (const [undoFrom, undoTo] of moved.reverse()) {
          try { await FileUtils.renameToFile(undoTo, undoFrom); } catch (e) { /* Best effort; reported below. */ }
        }
        return { success: false, message: `Supernote could not move ${from.split('/').pop()}. Nothing was moved; close the file if it is open and try again.` };
      }
      moved.push([from, to]);
    }
    const extra = pairs.length - 1;
    return {
      success: true,
      path: destination,
      message: `Moved ${name} to ${folder.split('/').pop()}${extra ? ` with its ${extra === 1 ? 'annotation file' : 'annotation and reading files'}` : ''}.`,
    };
  } catch (e: any) {
    return { success: false, message: e?.message || 'Supernote could not move the file.' };
  }
}

/** Fast, same-storage folder move. The native layer refuses overwrite/merge. */
export async function moveParaFolder(sourcePath: string, destinationPath: string): Promise<ExportResult> {
  // Request sequentially: Android cannot reliably present two permission
  // prompts at the same time on the plugin panel.
  const canWrite = await ensureFileWritePermission();
  const canDelete = canWrite ? await ensureFileDeletePermission() : false;
  if (!canWrite || !canDelete) {
    return {
      success: false,
      message: 'Folder moves need both File Write and File Delete permission.',
    };
  }

  const source = sourcePath.replace(/\/+$/, '');
  const destination = destinationPath.replace(/\/+$/, '');
  const slash = destination.lastIndexOf('/');
  const parent = slash > 0 ? destination.slice(0, slash) : '';

  // Use Supernote's supported file bridge first. Plugin permissions are
  // enforced around this module; an arbitrary native File.renameTo can be
  // denied even after the user granted the plugin-level permission.
  if (FileUtils.renameToFile && FileUtils.exists && FileUtils.makeDir) {
    try {
      if (!(await FileUtils.exists(source))) {
        return { success: false, message: `Source folder does not exist: ${source}` };
      }
      if (await FileUtils.exists(destination)) {
        return { success: false, message: `Archive destination already exists: ${destination}` };
      }
      if (!parent) return { success: false, message: 'Archive destination has no parent folder.' };
      const parentReady = await FileUtils.makeDir(parent);
      if (!parentReady && !(await FileUtils.exists(parent))) {
        return { success: false, message: `Could not create archive folder: ${parent}` };
      }
      const renamed = await FileUtils.renameToFile(source, destination);
      if (!renamed) {
        return {
          success: false,
          message: 'Supernote could not rename the folder. Check that both locations are on the same storage device.',
        };
      }
      const [sourceStillExists, destinationExists] = await Promise.all([
        FileUtils.exists(source),
        FileUtils.exists(destination),
      ]);
      if (sourceStillExists || !destinationExists) {
        return { success: false, message: 'Supernote reported success, but the folder move could not be verified.' };
      }
      return { success: true, path: destination, message: `Moved folder to ${destination}` };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Supernote folder move failed.' };
    }
  }

  if (!CalendarFile?.moveFolder) {
    return { success: false, message: 'This build is missing folder-move support.' };
  }
  try {
    const path = await CalendarFile.moveFolder(source, destination);
    return { success: true, path, message: `Moved folder to ${path}` };
  } catch (e: any) {
    return { success: false, message: e?.message || 'Folder move failed.' };
  }
}

/** Mounted user-storage roots: internal storage followed by any SD cards. */
export async function listStorageRoots(): Promise<string[]> {
  const fallback = '/storage/emulated/0';
  if (!CalendarFile?.getStorageRoots) return [fallback];
  try {
    const roots = await CalendarFile.getStorageRoots();
    return Array.from(new Set([fallback, ...(Array.isArray(roots) ? roots : [])]))
      .filter(root => typeof root === 'string' && root.startsWith('/storage/'));
  } catch (_error) {
    return [fallback];
  }
}

/** One navigable level of a PARA folder, including subfolders and files. */
export async function listParaFolderEntries(folder: string): Promise<ParaFolderEntry[]> {
  if (!(await ensureFileReadPermission())) {
    throw new Error('File access was not allowed. Grant file access to browse PARA folders.');
  }

  if (CalendarFile?.listFolderEntries) {
    try {
      const entries = await CalendarFile.listFolderEntries(folder);
      return Array.isArray(entries)
        ? entries
            .filter(entry => entry && isVisibleResourcePath(entry.path))
            .sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name))
        : [];
    } catch (e) {
      // Fall through to the public SDK for older native builds.
    }
  }

  try {
    const raw: any = await FileUtils.listFiles(folder);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry: any): ParaFolderEntry | undefined => {
        const path = typeof entry === 'string' ? entry : entry?.path;
        if (!isVisibleResourcePath(path)) return undefined;
        const name = path.split('/').pop() || path;
        return {
          name,
          path,
          isFolder: typeof entry !== 'string' && entry?.type === 0 && !name.toLowerCase().endsWith('.note'),
        };
      })
      .filter((entry: ParaFolderEntry | undefined): entry is ParaFolderEntry => Boolean(entry))
      .sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name));
  } catch (e) {
    return [];
  }
}

/**
 * Opens a note in the editor.
 *
 * FileUtils.openFilePath() only reaches the file manager — it navigates to the
 * containing folder without opening anything, which is why "Open Note" has
 * been dropping users into a file list. The native module launches the note
 * activity directly instead.
 */
export async function openNoteInEditor(path: string, page = 0): Promise<ExportResult> {
  if (!(await ensureFileReadPermission())) {
    return { success: false, path, message: 'File access was not allowed.' };
  }
  if (!CalendarFile?.openNote) {
    return { success: false, message: 'Cannot open notes — this build is missing its native module.' };
  }
  try {
    await CalendarFile.openNote(path, page);
    return { success: true, path, message: `Opened ${path.split('/').pop()}` };
  } catch (e: any) {
    return { success: false, message: `Could not open note: ${e?.message || 'open failed'}` };
  }
}

export async function listResourceFiles(folder: string): Promise<string[]> {
  if (!(await ensureFileReadPermission())) {
    throw new Error('File access was not allowed. Grant file access to browse Resources.');
  }

  // The SDK declaration claims string[], but its Android implementation sends
  // [{ path, type }]. Accept both so this works across plugin-lib versions.
  try {
    const raw: any = await FileUtils.listFiles(folder);
    if (Array.isArray(raw)) {
      const sdkPaths = raw
        .filter(entry => typeof entry === 'string' || entry?.type !== 0 || entry?.path?.toLowerCase().endsWith('.note'))
        .map(entry => (typeof entry === 'string' ? entry : entry?.path))
        .filter(isVisibleResourcePath)
        .sort((a, b) => a.localeCompare(b));
      if (sdkPaths.length > 0) return sdkPaths;
    }
  } catch (e) {
    // Older firmware can reject the public list call; use our narrow native
    // .note-only reader below.
  }

  if (CalendarFile?.listNoteFiles) {
    try {
      const paths = await CalendarFile.listNoteFiles(folder);
      return Array.isArray(paths)
        ? paths
            .filter(isVisibleResourcePath)
            .sort((a, b) => a.localeCompare(b))
        : [];
    } catch (e) {
      return [];
    }
  }
  return [];
}

export async function openResourceFile(path: string): Promise<ExportResult> {
  if (!(await ensureFileReadPermission())) {
    return { success: false, path, message: 'File access was not allowed.' };
  }
  if (path.toLowerCase().endsWith('.note')) return openNoteInEditor(path);
  if (!CalendarFile?.openDocument) {
    return { success: false, path, message: 'Cannot open documents — this build is missing its native module.' };
  }
  try {
    await CalendarFile.openDocument(path);
    return { success: true, path, message: `Opened ${path.split('/').pop()}` };
  } catch (e: any) {
    return { success: false, path, message: `Could not open file: ${e?.message || 'open failed'}` };
  }
}

/** Strips characters that are illegal in Android filenames. */
export function safeFileName(name: string): string {
  return (name || 'export')
    .replace(/[/\\?%*:|"<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'export';
}

async function exportRoot(): Promise<string> {
  try {
    const base = await FileUtils.getExportPath();
    if (typeof base === 'string' && base) return `${base}/sn-calendar`;
  } catch (e) {
    // getExportPath is not guaranteed; fall through.
  }
  return `${FALLBACK_EXPORT_ROOT}/sn-calendar`;
}

/**
 * Writes text to the user-visible export area.
 *
 * The export area rather than the plugin sandbox, so files survive a plugin
 * reinstall and can be pulled off the device over Browse & Access — the same
 * reasoning as the ink-capture destination.
 */
export async function writeExport(fileName: string, content: string): Promise<ExportResult> {
  if (!(await ensureFileWritePermission())) {
    return { success: false, message: 'File access was not allowed.' };
  }
  if (!CalendarFile?.writeTextFile) {
    return {
      success: false,
      message: 'File writing is unavailable — this build is missing its native module.',
    };
  }

  try {
    const dir = await exportRoot();
    const path = `${dir}/${safeFileName(fileName)}`;
    const written = await CalendarFile.writeTextFile(path, content);
    return { success: true, path: written, message: `Exported to ${written}` };
  } catch (e: any) {
    return { success: false, message: `Export failed: ${e?.message || 'write error'}` };
  }
}
