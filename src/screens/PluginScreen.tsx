import React from 'react';
import { AgendaScreen } from './AgendaScreen';

export function PluginScreen(): React.JSX.Element {
  const [revision, setRevision] = React.useState(0);
  const [notice, setNotice] = React.useState('');
  return <AgendaScreen
    key={revision}
    workspaceNotice={notice}
    // The panel stays loaded between uses, so a notice with no way out would
    // sit there for the rest of the session.
    onDismissNotice={() => setNotice('')}
    onWorkspaceRestored={message => {
      setNotice(message);
      setRevision(value => value + 1);
    }} />;
}
