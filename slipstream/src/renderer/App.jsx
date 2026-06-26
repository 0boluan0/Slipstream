import React, { useState } from 'react';
import FloatingPanel from './components/FloatingPanel';
import SettingsPanel from './components/SettingsPanel';

export default function App() {
  const [view, setView] = useState('panel');

  const style = {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'transparent',
  };

  if (view === 'settings') {
    return (
      <div style={style}>
        <SettingsPanel onClose={() => setView('panel')} />
      </div>
    );
  }

  return (
    <div style={style}>
      <FloatingPanel onOpenSettings={() => setView('settings')} />
    </div>
  );
}
