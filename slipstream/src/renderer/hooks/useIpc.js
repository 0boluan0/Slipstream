import { useCallback } from 'react';
import constants from '../../shared/constants';
import { PREVIEW_ACTION_BRIEF, PREVIEW_CAPTURE, PREVIEW_SOURCE_TEXT } from '../utils/previewData';

const { DEFAULTS, IPC_CHANNELS } = constants;
const isResultDemo = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('demo') === 'result';
let demoTerms = [];

function invokeDemo(channel, ...args) {
  switch (channel) {
    case IPC_CHANNELS.SETTINGS_GET:
      return Promise.resolve({
        activeBackend: 'ollama',
        activeModel: 'qwen2.5',
        languageHint: DEFAULTS.LANGUAGE,
        clipboardMonitoring: false,
        verificationPolicy: 'ask',
        resultOrder: 'action-first',
        privacyNoticeSeen: true,
        clipboardShortcut: 'Alt+C',
        screenshotShortcut: 'F2',
      });
    case IPC_CHANNELS.SETTINGS_SET:
    case IPC_CHANNELS.WINDOW_SET_MODE:
    case IPC_CHANNELS.LLM_CANCEL:
    case IPC_CHANNELS.WINDOW_HIDE:
    case IPC_CHANNELS.EXTERNAL_OPEN:
    case IPC_CHANNELS.USER_DATA_CLEAR:
      return Promise.resolve(true);
    case IPC_CHANNELS.TERMS_GET:
      return Promise.resolve(demoTerms);
    case IPC_CHANNELS.TERMS_SAVE: {
      const payload = args[0] || {};
      const saved = { ...payload, id: `preview-term-${Date.now()}` };
      demoTerms = [saved, ...demoTerms];
      return Promise.resolve(saved);
    }
    case IPC_CHANNELS.TERMS_DELETE:
      demoTerms = demoTerms.filter((item) => item.id !== args[0]);
      return Promise.resolve(true);
    case IPC_CHANNELS.CLIPBOARD_READ:
      return Promise.resolve(PREVIEW_SOURCE_TEXT);
    case IPC_CHANNELS.CLIPBOARD_WRITE:
      return navigator.clipboard?.writeText(args[0] || '').catch(() => true) || Promise.resolve(true);
    case IPC_CHANNELS.SCREENSHOT_CAPTURE:
      return Promise.resolve({ success: true, text: PREVIEW_SOURCE_TEXT, ...PREVIEW_CAPTURE });
    case IPC_CHANNELS.LLM_PROCESS:
      return new Promise((resolve) => {
        window.setTimeout(() => resolve({
          success: true,
          brief: PREVIEW_ACTION_BRIEF,
          processingTimeMs: 6800,
        }), args[0]?.verificationApproved ? 500 : 2600);
      });
    default:
      return Promise.resolve(null);
  }
}

export function useIpc() {
  const invoke = useCallback((channel, ...args) => {
    if (window.api?.invoke) return window.api.invoke(channel, ...args);
    if (isResultDemo) return invokeDemo(channel, ...args);
    return Promise.reject(new Error('Electron IPC is unavailable outside the app.'));
  }, []);

  const on = useCallback((channel, callback) => {
    if (window.api?.on) return window.api.on(channel, callback);
    if (isResultDemo) return () => {};
    return () => {};
  }, []);

  return { invoke, on };
}
