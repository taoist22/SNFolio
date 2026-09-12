import {
  MINUTES_IN_DAY,
  TIME_STEP,
  clampToDay,
  formatClock,
  formatDuration,
  formatTimeOfDay,
  isPm,
  minutesFromDate,
  moveEnd,
  moveStart,
  normaliseRange,
  parseTimeOfDay,
  withMeridiem,
  withTimeOfDay,
} from './timeOfDay';

describe('formatting', () => {
  test('renders a 12-hour clock', () => {
    expect(formatTimeOfDay(9 * 60)).toBe('9:00 AM');
    expect(formatTimeOfDay(13 * 60 + 30)).toBe('1:30 PM');
  });

  test('midnight and noon read correctly rather than as 0:00', () => {
    expect(formatTimeOfDay(0)).toBe('12:00 AM');
    expect(formatTimeOfDay(12 * 60)).toBe('12:00 PM');
  });

  test('minutes are zero padded', () => {
    expect(formatTimeOfDay(9 * 60 + 5)).toBe('9:05 AM');
  });

  test('durations read in hours and minutes', () => {
    // The point of the change: any duration, not four presets.
    expect(formatDuration(30)).toBe('30m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(150)).toBe('2h 30m');
    expect(formatDuration(300)).toBe('5h');
  });

  test('a zero or negative duration does not render as nonsense', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(-30)).toBe('0m');
  });
});

describe('date conversion', () => {
  test('reads a time of day off a date', () => {
    expect(minutesFromDate(new Date(2026, 7, 19, 14, 45))).toBe(14 * 60 + 45);
  });

  test('applies a time without moving the calendar day', () => {
    const day = new Date(2026, 7, 19, 23, 30);
    const out = withTimeOfDay(day, 9 * 60);

    expect(out.getDate()).toBe(19);
    expect(out.getHours()).toBe(9);
    expect(out.getMinutes()).toBe(0);
    expect(out.getSeconds()).toBe(0);
  });

  test('a round trip through a date preserves the time', () => {
    const minutes = 17 * 60 + 15;
    expect(minutesFromDate(withTimeOfDay(new Date(2026, 7, 19), minutes))).toBe(minutes);
  });
});

describe('clamping', () => {
  test('never wraps past midnight in either direction', () => {
    // Wrapping would silently move the event to another day.
    expect(clampToDay(-30)).toBe(0);
    expect(clampToDay(MINUTES_IN_DAY + 60)).toBe(MINUTES_IN_DAY - 1);
  });
});

describe('moveStart', () => {
  test('carries the end along, preserving the duration', () => {
    const range = { start: 9 * 60, end: 10 * 60 + 30 };
    const moved = moveStart(range, 60);

    expect(formatTimeOfDay(moved.start)).toBe('10:00 AM');
    expect(moved.end - moved.start).toBe(90);
  });

  test('works backwards too', () => {
    const moved = moveStart({ start: 9 * 60, end: 10 * 60 }, -TIME_STEP);
    expect(formatTimeOfDay(moved.start)).toBe('8:45 AM');
    expect(moved.end - moved.start).toBe(60);
  });

  test('a long meeting keeps its length', () => {
    const range = { start: 9 * 60, end: 14 * 60 };
    expect(moveStart(range, 30).end - moveStart(range, 30).start).toBe(300);
  });

  test('cannot be pushed before midnight', () => {
    const moved = moveStart({ start: 15, end: 60 }, -60);
    expect(moved.start).toBe(0);
    expect(moved.end).toBeGreaterThan(moved.start);
  });
});

describe('moveEnd', () => {
  test('extends and shortens without touching the start', () => {
    const range = { start: 9 * 60, end: 10 * 60 };
    expect(moveEnd(range, 30).end).toBe(10 * 60 + 30);
    expect(moveEnd(range, 30).start).toBe(9 * 60);
  });

  test('never reaches or passes the start', () => {
    const range = { start: 9 * 60, end: 9 * 60 + TIME_STEP };
    const shrunk = moveEnd(range, -60);
    expect(shrunk.end).toBe(range.start + TIME_STEP);
    expect(shrunk.end).toBeGreaterThan(shrunk.start);
  });

  test('supports the durations the old preset list could not', () => {
    let range = { start: 9 * 60, end: 9 * 60 + TIME_STEP };
    range = moveEnd(range, 150 - TIME_STEP);
    expect(formatDuration(range.end - range.start)).toBe('2h 30m');

    range = moveEnd(range, 150);
    expect(formatDuration(range.end - range.start)).toBe('5h');
  });
});

describe('normaliseRange', () => {
  test('repairs an end that is not after the start', () => {
    expect(normaliseRange({ start: 600, end: 600 }).end).toBe(600 + TIME_STEP);
    expect(normaliseRange({ start: 600, end: 300 }).end).toBe(600 + TIME_STEP);
  });

  test('leaves a valid range alone', () => {
    const range = { start: 540, end: 660 };
    expect(normaliseRange(range)).toEqual(range);
  });

  test('brings out-of-range values back inside the day', () => {
    const fixed = normaliseRange({ start: -60, end: MINUTES_IN_DAY + 60 });
    expect(fixed.start).toBe(0);
    expect(fixed.end).toBe(MINUTES_IN_DAY - 1);
  });
});

describe('parseTimeOfDay', () => {
  test('reads the forms people actually write', () => {
    expect(parseTimeOfDay('9')).toBe(9 * 60);
    expect(parseTimeOfDay('9:30')).toBe(9 * 60 + 30);
    expect(parseTimeOfDay('930')).toBe(9 * 60 + 30);
    expect(parseTimeOfDay('0930')).toBe(9 * 60 + 30);
    expect(parseTimeOfDay('9.30')).toBe(9 * 60 + 30);
    expect(parseTimeOfDay('9h30')).toBe(9 * 60 + 30);
  });

  test('accepts bare forms that captureParser refuses', () => {
    // That parser hunts inside prose, where "930" is usually a quantity. Here
    // the whole field is the time.
    expect(parseTimeOfDay('1430')).toBe(14 * 60 + 30);
  });

  test('handles am and pm in their various spellings', () => {
    expect(parseTimeOfDay('9am')).toBe(9 * 60);
    expect(parseTimeOfDay('9 AM')).toBe(9 * 60);
    expect(parseTimeOfDay('9:30pm')).toBe(21 * 60 + 30);
    expect(parseTimeOfDay('9:30 p.m.')).toBe(21 * 60 + 30);
    expect(parseTimeOfDay('9a')).toBe(9 * 60);
  });

  test('midnight and noon land on the right side', () => {
    expect(parseTimeOfDay('12am')).toBe(0);
    expect(parseTimeOfDay('12pm')).toBe(12 * 60);
  });

  test('24-hour input is taken as written', () => {
    expect(parseTimeOfDay('14:00')).toBe(14 * 60);
    expect(parseTimeOfDay('23:59')).toBe(23 * 60 + 59);
  });

  test('an unqualified end before the start reads as the afternoon', () => {
    // "9 to 5" means what everyone thinks it means.
    expect(parseTimeOfDay('5', 9 * 60)).toBe(17 * 60);
    expect(parseTimeOfDay('1:30', 9 * 60)).toBe(13 * 60 + 30);
  });

  test('an explicit am is never overridden by that rule', () => {
    expect(parseTimeOfDay('5am', 9 * 60)).toBe(5 * 60);
  });

  test('an end already after the start is left alone', () => {
    expect(parseTimeOfDay('11', 9 * 60)).toBe(11 * 60);
  });

  test('rejects nonsense rather than guessing', () => {
    expect(parseTimeOfDay('')).toBeNull();
    expect(parseTimeOfDay('   ')).toBeNull();
    expect(parseTimeOfDay('lunch')).toBeNull();
    expect(parseTimeOfDay('25:00')).toBeNull();
    expect(parseTimeOfDay('9:75')).toBeNull();
    expect(parseTimeOfDay('13pm')).toBeNull();
    expect(parseTimeOfDay('99999')).toBeNull();
  });

  test('what it parses can be formatted back', () => {
    for (const text of ['9', '9:30', '1430', '12am', '7:05pm']) {
      const parsed = parseTimeOfDay(text);
      expect(parsed).not.toBeNull();
      expect(formatTimeOfDay(parsed as number)).toMatch(/^\d{1,2}:\d{2} [AP]M$/);
    }
  });
});

describe('meridiem as a separate control', () => {
  test('formatClock omits the meridiem', () => {
    expect(formatClock(9 * 60 + 30)).toBe('9:30');
    expect(formatClock(21 * 60 + 30)).toBe('9:30');
  });

  test('noon and midnight read as 12, not 0', () => {
    expect(formatClock(0)).toBe('12:00');
    expect(formatClock(12 * 60)).toBe('12:00');
  });

  test('isPm splits the day at noon', () => {
    expect(isPm(11 * 60 + 59)).toBe(false);
    expect(isPm(12 * 60)).toBe(true);
  });

  test('switching meridiem keeps the clock reading', () => {
    expect(formatClock(withMeridiem(9 * 60 + 30, true))).toBe('9:30');
    expect(withMeridiem(9 * 60 + 30, true)).toBe(21 * 60 + 30);
    expect(withMeridiem(21 * 60 + 30, false)).toBe(9 * 60 + 30);
  });

  test('repeated toggling cannot drift', () => {
    // Written as a swap rather than ±12h for exactly this reason.
    let t = 9 * 60 + 30;
    for (let i = 0; i < 6; i++) t = withMeridiem(t, !isPm(t));
    expect(t).toBe(9 * 60 + 30);
  });

  test('midnight and noon survive the swap', () => {
    expect(withMeridiem(0, true)).toBe(12 * 60);
    expect(withMeridiem(12 * 60, false)).toBe(0);
  });
});

test('24-hour format covers midnight, noon, and the end of the day', () => {
  expect(formatTimeOfDay(0, '24h')).toBe('00:00');
  expect(formatTimeOfDay(12 * 60, '24h')).toBe('12:00');
  expect(formatTimeOfDay(23 * 60 + 59, '24h')).toBe('23:59');
  expect(formatTimeOfDay(9 * 60 + 5, '24h')).toBe('09:05');
});
