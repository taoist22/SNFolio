import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { calendarStorage } from '../storage/calendarStorage';

export const PLANNER_SECTIONS = [
  ['schedule', 'Schedule'], ['journal', 'Journal'], ['focus', 'Focus'],
  ['tasks', 'Tasks'], ['projects', 'Projects'], ['tomorrow', 'Tomorrow'],
] as const;
const WEEKLY_SECTIONS = [['projects', 'Projects'], ['deadlines', 'Deadlines'], ['journal', 'Journals']] as const;
type SectionId = typeof PLANNER_SECTIONS[number][0] | 'deadlines';
interface SectionContext {
  expanded: Partial<Record<SectionId, boolean>>;
  toggle: (id: SectionId) => void;
  register: (id: SectionId, node: View | null) => void;
}
const Context = createContext<SectionContext | null>(null);

export function DayPlannerSections({ enabled, children, weekly = false, header }: { enabled: boolean; children: React.ReactNode; weekly?: boolean; header?: React.ReactNode }): React.JSX.Element {
  const [expanded, setExpanded] = useState<Partial<Record<SectionId, boolean>>>(() => (weekly ? calendarStorage.getSettings().nomadWeeklySections : calendarStorage.getSettings().nomadPlannerSections) || {});
  useEffect(() => {
    if (enabled) setExpanded((weekly ? calendarStorage.getSettings().nomadWeeklySections : calendarStorage.getSettings().nomadPlannerSections) || {});
  }, [enabled, weekly]);
  const scroll = useRef<ScrollView>(null);
  const content = useRef<View>(null);
  const sections = useRef<Partial<Record<SectionId, View>>>({});
  const [target, setTarget] = useState<SectionId | null>(null);
  const save = (next: Partial<Record<SectionId, boolean>>) => {
    setExpanded(next);
    calendarStorage.updateSettings(weekly ? { nomadWeeklySections: next } : { nomadPlannerSections: next });
  };
  useEffect(() => {
    if (!target || !enabled) return;
    const frame = requestAnimationFrame(() => {
      const node = sections.current[target];
      if (node && content.current) {
        node.measureLayout(content.current, (_x, y) => {
          scroll.current?.scrollTo({ y, animated: false });
          setTarget(null);
        }, () => setTarget(null));
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [target, expanded, enabled]);

  if (!enabled) return <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">{header}{children}</ScrollView>;
  return (
    <Context.Provider value={{ expanded, toggle: id => save({ ...expanded, [id]: !expanded[id] }), register: (id, node) => {
      if (node) sections.current[id] = node;
      else delete sections.current[id];
    } }}>
      <View style={styles.body}>
        {header}
        <View style={styles.shortcuts}>
          {(weekly ? WEEKLY_SECTIONS : PLANNER_SECTIONS).map(([id, label]) => (
            <TouchableOpacity key={id} accessibilityRole="button" accessibilityLabel={`Go to ${label}`} style={styles.shortcut} onPress={() => {
              save({ ...expanded, [id]: true });
              setTarget(id);
            }}>
              <Text allowFontScaling={false} style={styles.shortcutText}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <ScrollView ref={scroll} style={styles.body} keyboardShouldPersistTaps="handled">
          <View ref={content} collapsable={false}>{children}</View>
        </ScrollView>
      </View>
    </Context.Provider>
  );
}

export function PlannerSection({ id, title, summary, children }: { id: SectionId; title: string; summary: string; children: React.ReactNode }): React.JSX.Element {
  const context = useContext(Context);
  if (!context) return <>{children}</>;
  const open = Boolean(context.expanded[id]);
  return (
    <View ref={node => context.register(id, node)} collapsable={false} style={styles.section}>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => context.toggle(id)} style={styles.heading}>
        <Text allowFontScaling={false} style={styles.title}>{open ? '▾' : '▸'} {title}</Text>
        <Text allowFontScaling={false} style={styles.summary} numberOfLines={2}>{summary}</Text>
      </TouchableOpacity>
      {open && children}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  shortcuts: { flexDirection: 'row', flexWrap: 'wrap', paddingBottom: 6 },
  shortcut: { borderWidth: 2, borderColor: '#000', paddingHorizontal: 10, minHeight: 40, justifyContent: 'center', marginRight: 5, marginBottom: 5, backgroundColor: '#fff' },
  shortcutText: { fontSize: 12, color: '#000', fontWeight: 'bold' },
  section: { marginBottom: 8 },
  heading: { borderWidth: 2, borderColor: '#000', backgroundColor: '#fff', padding: 10, minHeight: 48 },
  title: { fontSize: 15, color: '#000', fontWeight: 'bold' },
  summary: { fontSize: 12, color: '#000', marginTop: 4 },
});
