import { EventDesignation } from '../domain/eventDesignation';
import React from 'react';
import { Text } from 'react-native';

/** In-memory links supplied by the workspace; rendering never scans files. */
export const LinkedFilePathsContext = React.createContext<Record<string, string | undefined>>({});

export const isPdfPath = (path?: string): boolean => Boolean(path && /\.pdf$/i.test(path));

/** Label for opening a linked file: a PDF opens in the reader, so it is not called a note. */
export const openLinkedFileLabel = (path?: string): string => (isPdfPath(path) ? 'Open PDF' : 'Open Note');

export const EventDesignationsContext = React.createContext<Record<string, EventDesignation>>({});

export function LinkedFileMarker({ item }: {
  item: { uid: string; recurringSeriesId?: string };
}): React.JSX.Element | null {
  const paths = React.useContext(LinkedFilePathsContext);
  const kinds = React.useContext(EventDesignationsContext);
  const identity = item.recurringSeriesId || item.uid;
  const path = paths[identity];
  const kind = kinds[identity];
  const pdf = isPdfPath(path);
  return <>
    {kind && kind !== 'none' && <Text allowFontScaling={false}
      accessibilityLabel={kind === 'class' ? 'Class' : 'Meeting'}>
      {kind === 'class' ? 'C ' : 'M '}
    </Text>}
    {path ? <Text allowFontScaling={false} accessibilityLabel={pdf ? 'Linked PDF' : 'Linked note'}
      style={{ fontWeight: 'bold' }}>{pdf ? '[PDF] ' : '[N] '}</Text> : null}
  </>;
}
