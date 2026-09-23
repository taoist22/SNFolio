import { clearPerfHistory, perfHistory, perfLogText, perfSamples, perfTracingEnabled, recordPerf, setPerfTracing, subscribePerf, timePerf } from './perfTrace';

afterEach(() => setPerfTracing(false));

test('nothing is recorded, and no work is added, while tracing is off', () => {
  setPerfTracing(false);
  expect(perfTracingEnabled()).toBe(false);
  let ran = 0;
  expect(timePerf('build', () => { ran++; return 42; })).toBe(42);
  recordPerf('draw', 120);
  expect(ran).toBe(1);
  expect(perfSamples()).toEqual([]);
});

test('samples are kept newest first, capped, and listeners are told', () => {
  setPerfTracing(true);
  let notified = 0;
  const stop = subscribePerf(() => { notified++; });
  for (let index = 0; index < 8; index++) recordPerf(`sample ${index}`, index * 10, `${index} events`);
  const samples = perfSamples();
  expect(samples).toHaveLength(6);
  expect(samples[0]).toEqual({ label: 'sample 7', ms: 70, detail: '7 events' });
  expect(notified).toBe(8);
  stop();
  recordPerf('after unsubscribe', 5);
  expect(notified).toBe(8);
  expect(perfSamples()[0].label).toBe('after unsubscribe');
});

test('timePerf returns the value and records how long it took', () => {
  setPerfTracing(true);
  const value = timePerf('build', () => 'done', () => '1100 events');
  expect(value).toBe('done');
  expect(perfSamples()[0]).toMatchObject({ label: 'build', detail: '1100 events' });
  expect(perfSamples()[0].ms).toBeGreaterThanOrEqual(0);
});

test('switching tracing off clears what was collected', () => {
  setPerfTracing(true);
  recordPerf('build', 10);
  expect(perfSamples()).toHaveLength(1);
  setPerfTracing(false);
  expect(perfSamples()).toEqual([]);
});

test('the saved log lists every measurement of the session with its context', () => {
  setPerfTracing(true);
  clearPerfHistory();
  recordPerf('month build', 42, '1100 events');
  recordPerf('month draw', 860, '312 shown');
  const text = perfLogText(['Screen: 1404x1872', 'Events loaded: 1100']);
  expect(text).toContain('SNFolio screen timings');
  expect(text).toContain('Screen: 1404x1872');
  expect(text).toContain('Measurements: 2');
  expect(text).toContain('month build\t42\t1100 events');
  expect(text).toContain('month draw\t860\t312 shown');
  // The readout keeps six, the log keeps the lot.
  for (let index = 0; index < 20; index++) recordPerf('day build', index);
  expect(perfHistory()).toHaveLength(22);
  expect(perfSamples()).toHaveLength(6);
  clearPerfHistory();
  expect(perfHistory()).toEqual([]);
});
