import React, { useEffect, useState } from 'react';
import FloatingPanel from './components/FloatingPanel';
import SettingsPanel from './components/SettingsPanel';
import { useSettings } from './hooks/useSettings';

export default function App() {
  const [view, setView] = useState('panel');
  const settingsController = useSettings();

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && view === 'settings') setView('panel');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [view]);

  const style = {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'transparent',
  };

  return (
    <div style={style}>
      <div style={{ display: view === 'settings' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
        <SettingsPanel onClose={() => setView('panel')} settingsController={settingsController} />
      </div>
      <div style={{ display: view === 'panel' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
        <FloatingPanel onOpenSettings={() => setView('settings')} settingsController={settingsController} />
      </div>
    </div>
  );
}
