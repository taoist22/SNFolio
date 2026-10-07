import {
  appendPageTemplate,
  DEFAULT_SYSTEM_TEMPLATE,
  isNoteTemplate,
  templateKind,
  ICON_CHOICES,
  isSystemTemplate,
  parseSystemTemplates,
  templateCandidates,
  templateLabel,
  resolveNoteDestination,
  templateSettingKey,
} from './noteTemplates';

/**
 * Verbatim entries from the device probe run on 2026-08-18, including the three
 * whose name does not match their resource path — the reason names are never
 * constructed from the URI.
 */
const PROBE_SAMPLE = [
  {
    hUri: 'android.resource://com.ratta.supernote.pluginhost/drawable/style_h_8mm_ruled_line',
    vUri: 'android.resource://com.ratta.supernote.pluginhost/drawable/style_8mm_ruled_line',
    name: 'style_8mm_ruled_line',
  },
  {
    hUri: 'android.resource://com.ratta.supernote.pluginhost/drawable/style_h_3_by_3_grid',
    vUri: 'android.resource://com.ratta.supernote.pluginhost/drawable/style_by_3_grid',
    name: 'style_nine_palace_lattice',
  },
  {
    hUri: 'android.resource://com.ratta.supernote.pluginhost/drawable/style_h_meeting_notes',
    vUri: 'android.resource://com.ratta.supernote.pluginhost/drawable/style_meeting_notes',
    name: 'style_meeting_notes',
  },
];

describe('system template identification', () => {
  test('a built-in name is not a path', () => {
    expect(isSystemTemplate('style_8mm_ruled_line')).toBe(true);
    expect(isSystemTemplate('style_daily_calendar')).toBe(true);
  });

  test('a custom template is an absolute path', () => {
    expect(isSystemTemplate('/storage/emulated/0/MyStyle/mine.png')).toBe(false);
  });

  test('an empty value is neither', () => {
    expect(isSystemTemplate('')).toBe(false);
    expect(isSystemTemplate('   ')).toBe(false);
  });
});

describe('templateLabel', () => {
  test('turns a built-in name into a readable label', () => {
    expect(templateLabel('style_college_ruled')).toBe('College Ruled');
    expect(templateLabel('style_meeting_notes')).toBe('Meeting Notes');
    expect(templateLabel('style_daily_calendar')).toBe('Daily Calendar');
  });

  test('keeps measurements tight rather than title-casing them', () => {
    expect(templateLabel('style_8mm_ruled_line')).toBe('8mm Ruled Line');
    expect(templateLabel('style_5mm_engineering_grid')).toBe('5mm Engineering Grid');
  });

  test('shows only the filename for a custom PNG', () => {
    expect(templateLabel('/storage/emulated/0/MyStyle/my_grid.png')).toBe('my_grid.png');
  });

  test('falls back to a plain description when nothing is set', () => {
    expect(templateLabel('')).toBe('Built-in default');
  });
});

describe('templateSettingKey', () => {
  test('maps each note kind to its own setting', () => {
    expect(templateSettingKey('meeting')).toBe('meetingTemplate');
    expect(templateSettingKey('class')).toBe('classTemplate');
    expect(templateSettingKey('daily')).toBe('dailyNoteTemplate');
  });
});

describe('templateCandidates', () => {
  test('uses the reported built-in name without passing its resource URI', () => {
    const candidates = templateCandidates('style_8mm_ruled_line', PROBE_SAMPLE);
    expect(candidates).toEqual(['style_8mm_ruled_line']);
  });

  test('falls back to a valid reported template for an unknown built-in', () => {
    expect(templateCandidates('style_not_on_this_device', PROBE_SAMPLE)).toEqual([
      'style_not_on_this_device',
      'style_8mm_ruled_line',
    ]);
  });

  test('resolves a legacy template name to a device-suffixed variant', () => {
    const deviceTemplates = [
      { name: 'style_8mm_ruled_line_a5x2' },
      { name: 'style_blank_a5x2' },
    ];
    expect(templateCandidates('style_8mm_ruled_line', deviceTemplates)).toEqual([
      'style_8mm_ruled_line_a5x2',
      'style_8mm_ruled_line',
    ]);
  });

  test('a custom PNG is used as given, with no fallback', () => {
    const path = '/storage/emulated/0/MyStyle/mine.png';
    expect(templateCandidates(path, PROBE_SAMPLE)).toEqual([path]);
  });

  test('an unset template falls back to 8mm ruled', () => {
    expect(templateCandidates('', PROBE_SAMPLE)).toEqual([DEFAULT_SYSTEM_TEMPLATE]);
  });
});

describe('parseSystemTemplates', () => {
  test('reads the shape the device actually returns', () => {
    const parsed = parseSystemTemplates(PROBE_SAMPLE);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].name).toBe('style_8mm_ruled_line');
    expect(parsed[0].vUri).toContain('style_8mm_ruled_line');
  });

  test('also reads the APIResponse shape used by current documentation', () => {
    expect(parseSystemTemplates({ success: true, result: PROBE_SAMPLE })).toHaveLength(3);
  });

  test('keeps names that do not match their resource path', () => {
    // style_h_3_by_3_grid is named style_nine_palace_lattice; deriving the name
    // from the URI would have produced the wrong identifier.
    const parsed = parseSystemTemplates(PROBE_SAMPLE);
    expect(parsed.map(t => t.name)).toContain('style_nine_palace_lattice');
  });

  test('survives the API returning nothing usable', () => {
    expect(parseSystemTemplates(null)).toEqual([]);
    expect(parseSystemTemplates(undefined)).toEqual([]);
    expect(parseSystemTemplates('not an array')).toEqual([]);
    expect(parseSystemTemplates([])).toEqual([]);
  });

  test('skips malformed entries rather than failing wholesale', () => {
    const parsed = parseSystemTemplates([null, {}, { name: '' }, { name: 'style_white' }]);
    expect(parsed).toEqual([{ name: 'style_white', hUri: undefined, vUri: undefined }]);
  });
});

describe('resolveNoteDestination', () => {
  const fallback = { folder: '/Note/Meetings', template: DEFAULT_SYSTEM_TEMPLATE };

  test('an event type overrides both', () => {
    expect(
      resolveNoteDestination({ folder: '/Note/SNHU', template: 'style_college_ruled' }, fallback)
    ).toEqual({ folder: '/Note/SNHU', template: 'style_college_ruled' });
  });

  test('a type may override only one', () => {
    // A type that only cares where its notes land keeps the default look.
    expect(resolveNoteDestination({ folder: '/Note/SNHU' }, fallback)).toEqual({
      folder: '/Note/SNHU',
      template: DEFAULT_SYSTEM_TEMPLATE,
    });
  });

  test('an untyped event falls back entirely', () => {
    expect(resolveNoteDestination(undefined, fallback)).toEqual(fallback);
  });

  test('blank settings are treated as unset, not as an empty path', () => {
    // Otherwise a cleared field files notes at the filesystem root.
    expect(resolveNoteDestination({ folder: '   ', template: '' }, fallback)).toEqual(fallback);
  });
});

describe('ICON_CHOICES', () => {
  test('offers a workable spread without becoming a grid to scan', () => {
    expect(ICON_CHOICES.length).toBeGreaterThanOrEqual(8);
    expect(ICON_CHOICES.length).toBeLessThanOrEqual(16);
  });

  test('has no duplicates', () => {
    expect(new Set(ICON_CHOICES).size).toBe(ICON_CHOICES.length);
  });

  test('covers the PARA ground CT named', () => {
    // Work, school, home, personal, finance — the areas people actually keep.
    for (const icon of ['💼', '🎓', '🏠', '👤', '💰']) {
      expect(ICON_CHOICES).toContain(icon);
    }
  });

  test('avoids emoji newer than Unicode 6.0', () => {
    // Newer codepoints are far likelier to be missing from the device font and
    // render as tofu, which is how an arrow glyph was lost in the project
    // manager. 🧍 (Unicode 12) is the tempting one to reach for here.
    for (const risky of ['🧍', '🧑', '🏦', '🩺', '🛠️']) {
      expect(ICON_CHOICES).not.toContain(risky);
    }
  });
});

describe('templateKind', () => {
  test('a bare name is a built-in', () => {
    expect(templateKind('style_8mm_ruled_line')).toBe('builtin');
    expect(templateKind('')).toBe('builtin');
  });

  test('an absolute path to an image is a background', () => {
    expect(templateKind('/storage/emulated/0/MyStyle/grid.png')).toBe('image');
  });

  test('an absolute path to a notebook is a note template', () => {
    expect(templateKind('/storage/emulated/0/Note/Templates/Daily.note')).toBe('note');
  });

  test('the suffix decides regardless of case or stray spaces', () => {
    expect(templateKind('  /Note/Daily.NOTE  ')).toBe('note');
  });

  test('a built-in whose name happens to end in note is still a built-in', () => {
    // Only an absolute path can be a file; style_meeting_notes must not be
    // mistaken for one.
    expect(templateKind('style_meeting_notes')).toBe('builtin');
    expect(isNoteTemplate('style_meeting_notes')).toBe(false);
  });
});

describe('isSystemTemplate with note templates', () => {
  test('a .note is not a system template', () => {
    expect(isSystemTemplate('/Note/Templates/Daily.note')).toBe(false);
  });
});

describe('appendPageTemplate', () => {
  test('a .note cannot furnish a page, so the default ruling is used', () => {
    // insertNotePage takes a name or an image, and no API merges one note into
    // another. A recurring notebook keeps its templated first page and carries
    // on rather than failing to append.
    expect(appendPageTemplate('/Note/Templates/Daily.note')).toBe(DEFAULT_SYSTEM_TEMPLATE);
  });

  test('an explicit fallback is honoured', () => {
    expect(appendPageTemplate('/Note/Templates/Daily.note', 'style_college_ruled')).toBe(
      'style_college_ruled'
    );
  });

  test('every other template passes through untouched', () => {
    expect(appendPageTemplate('style_college_ruled')).toBe('style_college_ruled');
    expect(appendPageTemplate('/MyStyle/grid.png')).toBe('/MyStyle/grid.png');
    expect(appendPageTemplate('')).toBe('');
  });
});
