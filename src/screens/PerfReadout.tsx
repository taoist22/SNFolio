import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PerfSample, perfSamples, perfTracingEnabled, recordPerf } from '../domain/perfTrace';

/**
 * Refreshes the readout on a timer rather than on every measurement.
 *
 * Re-rendering per sample made the diagnostic drive the very work it was
 * measuring: a new timing re-rendered the screen, which rebuilt the month,
 * which recorded another timing. The samples are still collected as they
 * happen; only the display lags.
 */
function useSamples(): PerfSample[] {
  const [, bump] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => bump(value => value + 1), 2000);
    return () => clearInterval(timer);
  }, []);
  return perfSamples();
}

/**
 * Times how long a screen takes to reach the point where React has handed it
 * to the device to draw.
 *
 * `started` is taken while the screen renders and the effect runs after the
 * change is committed, so this covers building the view, not the e-ink refresh
 * that follows. A calculation time far below this means the cost is drawing.
 */
export function usePaintTiming(label: string, detail?: () => string): void {
  const started = Date.now();
  React.useEffect(() => {
    if (perfTracingEnabled()) recordPerf(label, Date.now() - started, detail?.());
    // Every commit of this screen is a fresh measurement.
  });
}

/** The recent timings, shown under the header while tracing is on. */
export function PerfReadout(): React.JSX.Element | null {
  const samples = useSamples();
  if (!perfTracingEnabled()) return null;
  return (
    <View style={styles.row}>
      <Text allowFontScaling={false} style={styles.title}>⏱ Timings (newest first)</Text>
      {samples.length === 0 && (
        <Text allowFontScaling={false} style={styles.line}>Open or change a screen to measure it.</Text>
      )}
      {samples.map((sample, index) => (
        <Text allowFontScaling={false} key={`${sample.label}-${index}`} style={styles.line} numberOfLines={1}>
          {`${sample.label}: ${sample.ms} ms${sample.detail ? ` · ${sample.detail}` : ''}`}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { borderWidth: 1, borderColor: '#000000', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 6, backgroundColor: '#ffffff' },
  title: { fontSize: 12, fontWeight: 'bold', color: '#000000' },
  line: { fontSize: 12, color: '#202020' },
});
