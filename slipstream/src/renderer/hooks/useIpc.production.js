import { useCallback } from 'react';

// The packaged renderer talks only to the narrow API exposed by preload.js.
// Demo data, browser previews, and failure injection live in useIpc.js and are
// selected by Vite only while serving the development renderer.
export function useIpc() {
  const invoke = useCallback((channel, ...args) => {
    if (window.api?.invoke) return window.api.invoke(channel, ...args);
    return Promise.reject(new Error('Electron IPC is unavailable outside the app.'));
  }, []);

  const on = useCallback((channel, callback) => {
    if (window.api?.on) return window.api.on(channel, callback);
    return () => {};
  }, []);

  return { invoke, on };
}
