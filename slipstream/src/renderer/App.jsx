import React, { useEffect, useRef, useState } from 'react';
import FloatingPanel from './components/FloatingPanel';
import SetupGate from './components/SetupGate';
import SettingsPanel from './components/SettingsPanel';
import { useSettings } from './hooks/useSettings';
import { useIpc } from './hooks/useIpc';
import { isSetupComplete } from './utils/setupReadiness.mjs';
import constants from '../shared/constants';

const { IPC_CHANNELS } = constants;

export default function App() {
  const [view, setView] = useState('panel');
  const settingsController = useSettings();
  const { invoke } = useIpc();
  const setupWindowActiveRef = useRef(false);
  const setupComplete = isSetupComplete(settingsController.settings);

  const closeSettings = () => setView(setupComplete ? 'panel' : 'setup');

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && view === 'settings') {
        setView(setupComplete ? 'panel' : 'setup');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setupComplete, view]);

  useEffect(() => {
    if (settingsController.loading) return;
    if (!setupComplete && view !== 'settings') {
      setupWindowActiveRef.current = true;
      invoke(IPC_CHANNELS.WINDOW_SET_MODE, 'setup').catch(() => false);
      return;
    }
    if (setupComplete && setupWindowActiveRef.current) {
      setupWindowActiveRef.current = false;
      invoke(IPC_CHANNELS.WINDOW_SET_MODE, 'capture').catch(() => false);
    }
  }, [invoke, settingsController.loading, setupComplete, view]);

  const style = {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'transparent',
  };

  if (settingsController.loading) {
    return (
      <div style={style}>
        <SetupGate settingsController={settingsController} loading />
      </div>
    );
  }

  if (!setupComplete && view !== 'settings') {
    return (
      <div style={style}>
        <SetupGate
          settingsController={settingsController}
          onConfigureFull={() => setView('settings')}
        />
      </div>
    );
  }

  return (
    <div style={style}>
      <div
        hidden={view === 'settings'}
        aria-hidden={view === 'settings'}
        style={{ display: view === 'settings' ? 'none' : 'flex', flex: 1, minHeight: 0 }}
      >
        <FloatingPanel
          visible={view !== 'settings'}
          onOpenSettings={() => setView('settings')}
          settingsController={settingsController}
        />
      </div>
      {view === 'settings' && (
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <SettingsPanel
            onClose={closeSettings}
            onSetupComplete={() => setView('panel')}
            settingsController={settingsController}
          />
        </div>
      )}
    </div>
  );
}
