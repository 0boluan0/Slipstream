import { useState, useCallback, useEffect } from 'react';
import { useIpc } from './useIpc';
import constants from '../../shared/constants';
import { normalizeClipboardPayload } from './clipboardPayload.mjs';

const { IPC_CHANNELS } = constants;

export function useClipboard() {
  const [clipboardEvent, setClipboardEvent] = useState(normalizeClipboardPayload(''));
  const { on } = useIpc();

  useEffect(() => {
    const unsubscribe = on(IPC_CHANNELS.CLIPBOARD_TEXT_CHANGED, (payload) => {
      setClipboardEvent(normalizeClipboardPayload(payload));
    });
    return unsubscribe;
  }, [on]);

  const clearClipboard = useCallback(() => {
    setClipboardEvent(normalizeClipboardPayload(''));
  }, []);

  return { clipboardEvent, clearClipboard };
}
