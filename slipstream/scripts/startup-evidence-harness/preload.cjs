'use strict';

const { contextBridge } = require('electron');

const PROTOCOL = 'SLIPSTREAM_STARTUP_EVIDENCE_HARNESS_V1';
const SCENARIOS = new Set([
  'startup-loading',
  'first-use-setup',
  'returning-capture',
]);
const scenario = process.env.SLIPSTREAM_STARTUP_EVIDENCE_SCENARIO;

if (!SCENARIOS.has(scenario)) {
  throw new Error('startup evidence scenario is invalid');
}

const baseSettings = Object.freeze({
  anthropicApiKey: '',
  openaiApiKey: '',
  deepseekApiKey: '',
  ollamaBaseUrl: 'http://localhost:11434',
  customEndpointUrl: '',
  customEndpointApiKey: '',
  hasAnthropicApiKey: false,
  hasOpenaiApiKey: false,
  hasDeepseekApiKey: false,
  hasCustomEndpointApiKey: false,
  activeBackend: 'free_translate',
  activeModel: 'google-translate',
  customPrompt: '',
  languageHint: 'en',
  windowWidth: 520,
  windowHeight: 680,
  windowX: null,
  windowY: null,
  startMinimized: false,
  clipboardMonitoring: false,
  verificationPolicy: 'ask',
  resultOrder: 'action-first',
  privacyNoticeSeen: true,
  clipboardShortcut: 'Alt+C',
  screenshotShortcut: 'Alt+Shift+S',
  setupMode: scenario === 'first-use-setup' ? 'unconfigured' : 'translation-only',
  runtimeStatus: Object.freeze({
    trayAvailable: true,
    clipboardMonitoringDisabled: false,
    clipboardMonitoringDisablePersistFailed: false,
  }),
});

const shortcutStatus = Object.freeze({
  allRegistered: true,
  clipboard: Object.freeze({
    accelerator: baseSettings.clipboardShortcut,
    registered: true,
    reason: null,
  }),
  screenshot: Object.freeze({
    accelerator: baseSettings.screenshotShortcut,
    registered: true,
    reason: null,
  }),
});

const allowedSubscriptions = new Set([
  'app:quit-requested',
  'clipboard:text-changed',
  'ocr:error',
  'screenshot:requested',
  'settings:loaded',
  'shortcut:status-changed',
]);
const invokeCounts = new Map();
const subscriptionCounts = new Map();
const unexpectedCalls = [];
let settingsRequestPending = false;

function increment(counts, channel) {
  counts.set(channel, (counts.get(channel) || 0) + 1);
}

function markUnexpected(channel, reason = 'not-allowed') {
  if (unexpectedCalls.length >= 20) return;
  unexpectedCalls.push(`${String(channel).slice(0, 80)}:${reason}`);
}

function validNoArguments(args) {
  return args.length === 0;
}

function validWindowMode(args) {
  return args.length === 1 && ['setup', 'capture', 'result'].includes(args[0]);
}

function validSessionRisk(args) {
  return args.length === 1
    && args[0]
    && typeof args[0] === 'object'
    && typeof args[0].hasRisk === 'boolean';
}

function validPendingStatus(args) {
  return args.length === 1
    && args[0]
    && typeof args[0] === 'object'
    && typeof args[0].pending === 'boolean'
    && Number.isInteger(args[0].count)
    && args[0].count >= 0;
}

async function invoke(channel, ...args) {
  increment(invokeCounts, channel);

  switch (channel) {
    case 'settings:get':
      if (validNoArguments(args)) {
        if (scenario === 'startup-loading') {
          settingsRequestPending = true;
          return new Promise(() => {});
        }
        return { ...baseSettings };
      }
      break;
    case 'shortcut:status-get':
      if (validNoArguments(args)) {
        return {
          ...shortcutStatus,
          clipboard: { ...shortcutStatus.clipboard },
          screenshot: { ...shortcutStatus.screenshot },
        };
      }
      break;
    case 'app:renderer-recovery-status-get':
      if (validNoArguments(args)) {
        return { recovered: false, clipboardResidueRisk: null };
      }
      break;
    case 'window:set-mode':
      if (validWindowMode(args)) return true;
      break;
    case 'app:session-risk-update':
      if (validSessionRisk(args)) return true;
      break;
    case 'terms:get':
      if (validNoArguments(args)) return [];
      break;
    case 'clipboard:pending-status':
      if (validPendingStatus(args)) return { status: 'recorded' };
      break;
    default:
      markUnexpected(channel);
      throw new Error('startup evidence adapter rejected a capability request');
  }

  markUnexpected(channel, 'invalid-arguments');
  throw new Error('startup evidence adapter rejected invalid arguments');
}

function on(channel, callback) {
  increment(subscriptionCounts, channel);
  if (!allowedSubscriptions.has(channel)) {
    markUnexpected(channel);
    return () => {};
  }
  if (typeof callback !== 'function') {
    markUnexpected(channel, 'invalid-callback');
    return () => {};
  }

  // This evidence-only fixed contract has no native event source.
  return () => {};
}

function countSnapshot(counts) {
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => (
    left.localeCompare(right)
  )));
}

contextBridge.exposeInMainWorld('api', Object.freeze({ invoke, on }));
contextBridge.exposeInMainWorld('slipstreamStartupEvidenceHarness', Object.freeze({
  protocol: PROTOCOL,
  getSummary: () => ({
    scenario,
    settingsRequestPending,
    invokeCounts: countSnapshot(invokeCounts),
    subscriptionCounts: countSnapshot(subscriptionCounts),
    unexpectedCalls: [...unexpectedCalls],
  }),
}));
