import { useCallback } from 'react';

export function useIpc() {
  const invoke = useCallback((channel, ...args) => {
    return window.api.invoke(channel, ...args);
  }, []);

  const on = useCallback((channel, callback) => {
    return window.api.on(channel, callback);
  }, []);

  return { invoke, on };
}
