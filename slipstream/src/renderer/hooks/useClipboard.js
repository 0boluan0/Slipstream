import { useState, useCallback, useEffect } from 'react';
import { useIpc } from './useIpc';
import { IPC_CHANNELS } from '../../shared/constants';

export function useClipboard() {
  const [clipboardText, setClipboardText] = useState('');
  const { on } = useIpc();

  useEffect(() => {
    const unsubscribe = on(IPC_CHANNELS.CLIPBOARD_TEXT_CHANGED, (text) => {
      setClipboardText(text);
    });
    return unsubscribe;
  }, [on]);

  const clearClipboard = useCallback(() => {
    setClipboardText('');
  }, []);

  return { clipboardText, clearClipboard };
}
