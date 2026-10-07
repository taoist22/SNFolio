import { NoteKind } from './types';

/**
 * Background templates for generated notes.
 *
 * The device ships 28 built-ins, reported by PluginCommAPI.getNoteSystemTemplates()
 * as `{ hUri, vUri, name }` — landscape resource, portrait resource, and a
 * canonical name. The plugin previously passed only file paths, so none of them
 * was ever reachable and every note fell back to a PNG.
 *
 * `name` is the identifier to use, and it cannot be derived from the resource
 * path: style_h_3_by_3_grid is named style_nine_palace_lattice, and
 * style_h_hand_drawn_diary is style_hand_sketch_diary. getNotePageTemplate
 * corroborates this — it reports a system template by name with `md5: 0`,
 * reserving the md5 for custom ones.
 */
export interface SystemTemplate {
  name: string;
  hUri?: string;
  vUri?: string;
}

/** 8mm ruled: the default for every note kind. */
export const DEFAULT_SYSTEM_TEMPLATE = 'style_8mm_ruled_line';

/**
 * What kind of thing a template setting points at.
 *
 * A built-in is a bare name; anything absolute is a file. The file is a flat
 * background image unless it is a .note, in which case it is a whole notebook
 * to be duplicated — strokes, layers and titles included, which an image can
 * never carry.
 *
 * The distinction matters because the two are made by different calls.
 * createNote's `template` is documented as a system template name or a custom
 * template *image* path, so a .note is not accepted there; it is copied with
 * FileUtils.copyFile instead (verified on device 2026-10-06).
 */
export type TemplateKind = 'builtin' | 'image' | 'note';

export function templateKind(value: string): TemplateKind {
  const trimmed = (value || '').trim();
  if (!trimmed.startsWith('/')) return 'builtin';
  return trimmed.toLowerCase().endsWith('.note') ? 'note' : 'image';
}

/** True when the template is a notebook to duplicate rather than a background. */
export function isNoteTemplate(value: string): boolean {
  return (value || '').trim().length > 0 && templateKind(value) === 'note';
}

/**
 * The template to use when appending a page to an existing notebook.
 *
 * insertNotePage takes a name or an image, and no API merges one note into
 * another — so a .note cannot furnish page two. A recurring notebook keeps its
 * templated first page and continues on the default ruling rather than failing
 * to append at all.
 */
export function appendPageTemplate(value: string, fallback: string = DEFAULT_SYSTEM_TEMPLATE): string {
  return isNoteTemplate(value) ? fallback : value;
}

/**
 * True when a template setting names a built-in rather than pointing at a
 * custom file. Custom values are absolute paths, so the leading slash decides.
 */
export function isSystemTemplate(value: string): boolean {
  const trimmed = (value || '').trim();
  return trimmed.length > 0 && templateKind(trimmed) === 'builtin';
}

/**
 * Human label for a template value.
 *
 * Built-in names arrive as snake_case identifiers; a custom template shows its
 * filename, since the full path is far too long for a settings row.
 */
export function templateLabel(value: string): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return 'Built-in default';

  if (!isSystemTemplate(trimmed)) {
    return trimmed.split('/').pop() || trimmed;
  }

  const words = trimmed
    .replace(/^style_/, '')
    .split('_')
    .filter(Boolean)
    .map(word => {
      // Measurements read better tight: "8mm" not "8 Mm".
      if (/^\d+mm$/i.test(word)) return word.toLowerCase();
      if (word.length <= 2) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    });

  return words.join(' ') || trimmed;
}

/** Settings key holding the template for a given note kind. */
export function templateSettingKey(kind: NoteKind): 'meetingTemplate' | 'classTemplate' | 'dailyNoteTemplate' {
  switch (kind) {
    case 'class':
      return 'classTemplate';
    case 'daily':
      return 'dailyNoteTemplate';
    default:
      return 'meetingTemplate';
  }
}

/**
 * The values to try when creating a note, best first.
 *
 * The SDK is ambiguous about what `createNote` wants: its type definition calls
 * the parameter a "Template path" while insertNotePage calls the same field a
 * "template name", and the published quick-reference says either is accepted.
 * A custom PNG is unambiguous, but a built-in is worth retrying as its portrait
 * resource URI if the bare name is rejected.
 */
export function templateCandidates(value: string, available: SystemTemplate[] = []): string[] {
  const trimmed = (value || '').trim();
  if (!trimmed) return systemTemplateCandidates(DEFAULT_SYSTEM_TEMPLATE, available);
  if (!isSystemTemplate(trimmed)) return [trimmed];

  return systemTemplateCandidates(trimmed, available);
}

/**
 * Resolves a saved built-in name against the templates exposed by this device.
 *
 * Template identifiers can gain a device suffix after an OS update (for
 * example, `style_8mm_ruled_line_a5x2`).  A setting saved on the previous OS
 * must therefore not be the only value attempted.  `createNote` now explicitly
 * requires a reported Template.name, so resource URIs are no longer candidates.
 */
function systemTemplateCandidates(value: string, available: SystemTemplate[]): string[] {
  const exact = available.find(t => t.name === value)?.name;
  const deviceVariant = available.find(t => t.name.startsWith(`${value}_`))?.name;
  const defaultExact = available.find(t => t.name === DEFAULT_SYSTEM_TEMPLATE)?.name;
  const defaultVariant = available.find(t =>
    t.name.startsWith(`${DEFAULT_SYSTEM_TEMPLATE}_`)
  )?.name;

  return Array.from(
    new Set(
      [exact, deviceVariant, value, defaultExact, defaultVariant, available[0]?.name].filter(
        (candidate): candidate is string => Boolean(candidate)
      )
    )
  );
}

/** Normalises whatever getNoteSystemTemplates returns into a usable list. */
export function parseSystemTemplates(raw: unknown): SystemTemplate[] {
  // Current documentation shows an APIResponse wrapper while the SDK type
  // still advertises the older raw array. Accept both during the transition.
  const source = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).result)
      ? ((raw as Record<string, unknown>).result as unknown[])
      : [];

  const templates: SystemTemplate[] = [];
  for (const entry of source) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!name) continue;
    templates.push({
      name,
      hUri: typeof record.hUri === 'string' ? record.hUri : undefined,
      vUri: typeof record.vUri === 'string' ? record.vUri : undefined,
    });
  }
  return templates;
}

/**
 * Where a note goes and what it looks like, given the event's type.
 *
 * An event type carries a default folder and template. Create Note displays
 * these resolved defaults and may override the folder for that one note.
 * Falls back to the per-kind settings when a type has no preference of its
 * own, or when the event has no type at all.
 */
export function resolveNoteDestination(
  type: { folder?: string; template?: string } | undefined,
  fallback: { folder: string; template: string }
): { folder: string; template: string } {
  return {
    folder: type?.folder?.trim() || fallback.folder,
    template: type?.template?.trim() || fallback.template,
  };
}

/**
 * Icons offered for Areas and Event Types.
 *
 * A fixed set rather than a free text field: the Supernote keyboard has no
 * emoji, and handwriting recognition will not produce one either, so a text
 * box for an icon can never be filled on this device.
 *
 * Every entry is Unicode 6.0 or earlier. Newer emoji are far likelier to be
 * missing from the device font and render as tofu — the same failure that took
 * out an arrow glyph in the project manager.
 */
export const ICON_CHOICES: string[] = [
  '💼',
  '🎓',
  '🏠',
  '👤',
  '💰',
  '❤️',
  '👪',
  '✈️',
  '🔧',
  '📚',
  '🎨',
  '⚙️',
];
