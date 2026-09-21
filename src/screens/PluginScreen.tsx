import React from 'react';
import { AgendaScreen } from './AgendaScreen';

export function PluginScreen(): React.JSX.Element {
  const [revision, setRevision] = React.useState(0);
  const [notice, setNotice] = React.useState('');
  return <AgendaScreen key={revision} workspaceNotice={notice} onWorkspaceRestored={message => {
    setNotice(message);
    setRevision(value => value + 1);
  }} />;
}
