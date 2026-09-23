import { CalendarEvent } from './types';
import { eventsOnDay, expandEventsByDay } from './icsParser';

export interface MonthGridCell {
  date: Date;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  eventCount: number;
  events: CalendarEvent[];
}

/**
 * Grids already built for one array of events.
 *
 * Paging back to a month meant building it again, which measured 560–1,050 ms
 * on device for a busy calendar. A new array of events (any sync, edit or
 * filter change) drops the whole cache with it.
 */
const gridCache = new WeakMap<CalendarEvent[], Map<string, MonthGridCell[][]>>();
const MAX_CACHED_MONTHS = 12;

/** generateMonthGrid, reusing a month already built for the same events. */
export function monthGridFor(
  year: number,
  month: number,
  allEvents: CalendarEvent[],
  today = new Date(),
  weekStartsOn: number = 0,
): MonthGridCell[][] {
  let months = gridCache.get(allEvents);
  if (!months) {
    months = new Map();
    gridCache.set(allEvents, months);
  }
  // Today's date is part of the key: a grid built yesterday marks the wrong cell.
  const key = `${year}|${month}|${weekStartsOn}|${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  const cached = months.get(key);
  if (cached) return cached;
  const grid = generateMonthGrid(year, month, allEvents, today, weekStartsOn);
  months.set(key, grid);
  if (months.size > MAX_CACHED_MONTHS) months.delete(months.keys().next().value as string);
  return grid;
}

export function generateMonthGrid(
  year: number,
  month: number, // 0-indexed (0=Jan, 11=Dec)
  allEvents: CalendarEvent[],
  today = new Date(),
  weekStartsOn: number = 0
): MonthGridCell[][] {
  const firstDayOfMonth = new Date(year, month, 1);
  const startingDayOfWeek = (firstDayOfMonth.getDay() - weekStartsOn + 7) % 7;

  const startDate = new Date(year, month, 1 - startingDayOfWeek);

  const grid: MonthGridCell[][] = [];
  let currentPointer = new Date(startDate);

  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth();
  const todayDate = today.getDate();

  // One pass over the events for the whole grid: asking each of the 42 cells
  // separately visited every event 42 times, which dominated a busy calendar.
  const lastCell = new Date(currentPointer);
  lastCell.setDate(lastCell.getDate() + 41);
  const byDay = expandEventsByDay(allEvents, currentPointer, lastCell);

  for (let week = 0; week < 6; week++) {
    const weekRow: MonthGridCell[] = [];
    for (let day = 0; day < 7; day++) {
      const cellDate = new Date(currentPointer);
      const isCurrentMonth = cellDate.getMonth() === month;
      const isToday =
        cellDate.getFullYear() === todayYear &&
        cellDate.getMonth() === todayMonth &&
        cellDate.getDate() === todayDate;

      const dayEvents = eventsOnDay(byDay, cellDate);

      weekRow.push({
        date: cellDate,
        dayNumber: cellDate.getDate(),
        isCurrentMonth,
        isToday,
        eventCount: dayEvents.length,
        events: dayEvents,
      });

      currentPointer.setDate(currentPointer.getDate() + 1);
    }
    grid.push(weekRow);

    // Stop if 5 weeks rendered and we reached next month
    if (week >= 4 && currentPointer.getMonth() !== month) {
      break;
    }
  }

  return grid;
}

export interface CellRowAllocation {
  events: number;
  tasks: number;
  hiddenEvents: number;
  hiddenTasks: number;
  /** Whether a "+N more" line is drawn — it occupies a row of the budget. */
  moreEventsLine: boolean;
  moreTasksLine: boolean;
}

/**
 * Decides how many event and task lines a month cell can show.
 *
 * Row counts used to be fixed constants, which only ever suited one device.
 * The Manta and Nomad differ three ways at once — cell height 140dp vs 123dp,
 * width 146dp vs 107dp, and a fontScale of 0.85 vs 1.0 that renders the same
 * declared size 18% larger on the Nomad. Seven rows fitted the Manta purely
 * because its text was being shrunk; on the Nomad it overflowed and, because
 * the cell uses minHeight, stretched the whole week taller.
 *
 * So the budget comes from the measured cell instead. Events are capped so a
 * busy morning cannot crowd out every task, but any budget they do not use
 * passes to tasks — a day with one event and five tasks shows 1 and 4 rather
 * than wasting event slots.
 *
 * Items can be hidden without an overflow line being drawn: when the budget is
 * exhausted there is nowhere to put one, and drawing it anyway is what pushed
 * the cell past its height.
 */
export function allocateCellRows(
  eventCount: number,
  taskCount: number,
  budget: number,
  eventCap: number
): CellRowAllocation {
  const usable = Math.max(0, budget);

  const fit = (count: number, room: number) => {
    let shown = Math.min(count, room);
    let hidden = count - shown;
    // The overflow line needs a row of its own; give up one item to make room.
    if (hidden > 0 && shown + 1 > room) shown = Math.max(0, room - 1);
    hidden = count - shown;
    const line = hidden > 0 && shown + 1 <= room;
    return { shown, hidden, line };
  };

  const ev = fit(Math.min(eventCount, eventCap), usable);
  // Events beyond the cap are hidden regardless of how much room there is.
  const hiddenEvents = eventCount - ev.shown;
  const eventsLine = hiddenEvents > 0 && ev.shown + 1 <= usable;

  const remaining = Math.max(0, usable - ev.shown - (eventsLine ? 1 : 0));
  const tk = fit(taskCount, remaining);

  return {
    events: ev.shown,
    tasks: tk.shown,
    hiddenEvents,
    hiddenTasks: tk.hidden,
    moreEventsLine: eventsLine,
    moreTasksLine: tk.line,
  };
}
