const { DEFAULTS, IPC_CHANNELS } = require('../shared/constants.cjs');

const CAPTURE_CHANNELS = new Set([
  IPC_CHANNELS.CLIPBOARD_TEXT_CHANGED,
  IPC_CHANNELS.SCREENSHOT_REQUESTED,
]);
const CLIPBOARD_SOURCES = new Set(['monitor', 'shortcut']);

function assertSenderId(senderId) {
  if (!Number.isSafeInteger(senderId) || senderId <= 0) {
    throw new TypeError('Capture ingress requires a valid renderer sender id');
  }
}

function trimDanglingHighSurrogate(text) {
  const finalCodeUnit = text.charCodeAt(text.length - 1);
  return finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff ? text.slice(0, -1) : text;
}

function normalizeClipboardPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('Clipboard capture payload must be an object');
  }
  if (!CLIPBOARD_SOURCES.has(payload.source)) {
    throw new TypeError('Clipboard capture source is invalid');
  }

  const sourceText = typeof payload.text === 'string' ? payload.text : '';
  const text = trimDanglingHighSurrogate(sourceText.slice(0, DEFAULTS.MAX_TEXT_LENGTH));
  const reportedLength = Number.isSafeInteger(payload.originalLength) && payload.originalLength >= 0
    ? payload.originalLength
    : sourceText.length;
  const originalLength = Math.max(reportedLength, sourceText.length);
  const truncated = payload.truncated === true || originalLength > text.length;
  const error = typeof payload.error === 'string' && payload.error.trim()
    ? payload.error.trim().slice(0, 200)
    : null;

  return Object.freeze({
    text,
    source: payload.source,
    truncated,
    originalLength,
    ...(error ? { error } : {}),
  });
}

function normalizeCaptureIngressEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new TypeError('Capture ingress event must be an object');
  }
  if (!CAPTURE_CHANNELS.has(event.channel)) {
    throw new TypeError('Capture ingress channel is invalid');
  }

  if (event.channel === IPC_CHANNELS.CLIPBOARD_TEXT_CHANGED) {
    return Object.freeze({
      channel: event.channel,
      payload: normalizeClipboardPayload(event.payload),
    });
  }

  if (
    !event.payload
    || typeof event.payload !== 'object'
    || Array.isArray(event.payload)
    || event.payload.source !== 'shortcut'
  ) {
    throw new TypeError('Screenshot capture payload is invalid');
  }
  return Object.freeze({
    channel: event.channel,
    payload: Object.freeze({ source: 'shortcut' }),
  });
}

function createCaptureIngressRegistry() {
  let activeSenderId = null;
  let ready = false;
  let pendingEvent = null;

  const tryDeliver = (senderId, event, deliver) => {
    if (typeof deliver !== 'function') {
      throw new TypeError('Capture ingress delivery callback is required');
    }
    try {
      return deliver(senderId, event) !== false;
    } catch {
      return false;
    }
  };

  return Object.freeze({
    begin(senderId) {
      assertSenderId(senderId);
      if (activeSenderId !== null && activeSenderId !== senderId) {
        // Captured text belongs to the renderer lifetime that received it.
        // Never move an in-memory capture across BrowserWindow senders.
        pendingEvent = null;
      }
      activeSenderId = senderId;
      ready = false;
      return true;
    },

    markNotReady(senderId) {
      assertSenderId(senderId);
      if (activeSenderId !== senderId) return false;
      ready = false;
      return true;
    },

    dispatch(senderId, event, deliver) {
      assertSenderId(senderId);
      if (activeSenderId !== senderId) {
        return Object.freeze({ delivered: false, queued: false });
      }
      const normalizedEvent = normalizeCaptureIngressEvent(event);
      if (!ready) {
        // This is intentionally a single in-memory slot: a burst during cold
        // start/reload cannot grow without bound or persist captured text.
        pendingEvent = normalizedEvent;
        return Object.freeze({ delivered: false, queued: true });
      }
      if (tryDeliver(senderId, normalizedEvent, deliver)) {
        return Object.freeze({ delivered: true, queued: false });
      }
      ready = false;
      pendingEvent = normalizedEvent;
      return Object.freeze({ delivered: false, queued: true });
    },

    markReady(senderId, deliver) {
      assertSenderId(senderId);
      if (activeSenderId !== senderId) {
        return Object.freeze({ ready: false, replayed: false });
      }
      ready = true;
      if (!pendingEvent) return Object.freeze({ ready: true, replayed: false });

      const event = pendingEvent;
      pendingEvent = null;
      if (tryDeliver(senderId, event, deliver)) {
        return Object.freeze({ ready: true, replayed: true });
      }
      ready = false;
      pendingEvent = event;
      return Object.freeze({ ready: false, replayed: false });
    },

    clear(senderId) {
      if (senderId !== undefined) {
        assertSenderId(senderId);
        if (activeSenderId !== senderId) return false;
      }
      activeSenderId = null;
      ready = false;
      pendingEvent = null;
      return true;
    },
  });
}

module.exports = {
  createCaptureIngressRegistry,
  normalizeCaptureIngressEvent,
};
