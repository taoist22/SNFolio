/**
 * On-device timings, for finding where a slow screen actually spends its time.
 *
 * Measurements on a developer machine cover only the calculation; on e-ink the
 * drawing is often the larger cost, and nothing in the plugin could show that.
 * This records a few recent samples and lets a readout subscribe to them.
 *
 * Off unless the user turns it on in Help & Setup, and recording is a couple
 * of Date.now() calls, so it cannot itself be what makes a screen slow.
 */
export interface PerfSample {
  /** What was measured, e.g. "month build". */
  label: string;
  ms: number;
  /** Size of the work, e.g. "1100 events · 42 cells". */
  detail?: string;
}

const MAX_SAMPLES = 6;
/** Kept for the saved log, so a session's measurements need not be read off the screen. */
const MAX_HISTORY = 400;
let samples: PerfSample[] = [];
let history: Array<PerfSample & { at: number }> = [];
let enabled = false;
const listeners = new Set<() => void>();

export function setPerfTracing(on: boolean): void {
  enabled = on;
  if (!on) samples = [];
  listeners.forEach(listener => listener());
}

/** Everything measured since tracing was switched on, oldest first. */
export const perfHistory = (): Array<PerfSample & { at: number }> => history;

export function clearPerfHistory(): void {
  history = [];
}

/** The saved log: one line per measurement, newest last. */
export function perfLogText(header: string[] = []): string {
  const lines = [
    'SNFolio screen timings',
    ...header,
    `Saved: ${new Date().toISOString()}`,
    `Measurements: ${history.length}`,
    '',
    'time\tscreen\tms\tdetail',
    ...history.map(sample =>
      `${new Date(sample.at).toISOString().slice(11, 19)}\t${sample.label}\t${sample.ms}\t${sample.detail || ''}`),
  ];
  return `${lines.join('\n')}\n`;
}

export const perfTracingEnabled = (): boolean => enabled;

export function recordPerf(label: string, ms: number, detail?: string): void {
  if (!enabled) return;
  const sample = { label, ms: Math.round(ms), detail };
  samples = [sample, ...samples].slice(0, MAX_SAMPLES);
  history = [...history, { ...sample, at: Date.now() }].slice(-MAX_HISTORY);
  listeners.forEach(listener => listener());
}

/** Times `run` and records it. Returns whatever `run` returns. */
export function timePerf<T>(label: string, run: () => T, detail?: () => string): T {
  if (!enabled) return run();
  const started = Date.now();
  const value = run();
  recordPerf(label, Date.now() - started, detail?.());
  return value;
}

export const perfSamples = (): PerfSample[] => samples;

export function subscribePerf(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
