import { useCallback } from 'react';
import constants from '../../shared/constants';
import shortcutAccelerator from '../../shared/shortcut-accelerator.mjs';
import {
  PROCESSING_LOCATION_KINDS,
  processingLocationForSettings,
} from '../../shared/endpoint-location.mjs';
import {
  PREVIEW_ACTION_BRIEF,
  PREVIEW_CAPTURE,
  PREVIEW_SOURCE_TEXT,
  PREVIEW_TRANSLATION_BRIEF,
} from '../utils/previewData';
import { savedTermKey } from '../utils/savedTerms.mjs';

const { DEFAULTS, IPC_CHANNELS } = constants;
const { displayShortcutAccelerator } = shortcutAccelerator;
const demoMode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('demo')
  : null;
const demoConnectionCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('connection')
  : null;
const demoConnectionCancelCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('connectionCancel')
  : null;
const demoCaptureCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('capture')
  : null;
const demoSaveCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('save')
  : null;
const demoCredentialDeleteCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('credentialDelete')
  : null;
const demoResetCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('reset')
  : null;
const demoTermSaveCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('termSave')
  : null;
const demoTermDeleteCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('termDelete')
  : null;
const demoTermsCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('terms')
  : null;
const demoTermsLoadCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('termsLoad')
  : null;
const demoTermExportCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('termExport')
  : null;
const demoTermImportCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('termImport')
  : null;
const demoDiagnosticsCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('diagnostics')
  : null;
const demoClipboardWriteCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('clipboard')
  : null;
const demoExternalOpenCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('external')
  : null;
const demoClipboardReadCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('clipboardRead')
  : null;
const demoSettingsLoadCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('settings')
  : null;
const demoStartupRecoveryCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('startupRecovery')
  : null;
const demoRendererRecoveryCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('rendererRecovery')
  : null;
const demoRuntimeCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('runtime')
  : null;
const demoVerificationCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('verification')
  : null;
const demoProcessCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('process')
  : null;
const demoCancelCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('cancel')
  : null;
const demoQuitDelay = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('quit')
  : null;
const demoBackend = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('backend')
  : null;
const demoClipboardMonitoringCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('monitor')
  : null;
const demoClipboardMonitorEventsCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('monitorEvents')
  : null;
const demoActiveCaptureEventsCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('activeCapture')
  : null;
const demoShortcutCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('shortcut')
  : null;
const demoRunCode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('run')
  : null;
const isDemo = ['capture', 'result', 'setup'].includes(demoMode) || Boolean(demoSettingsLoadCode);
const isNativeUiFixture = import.meta.env.DEV
  && window.slipstreamUiFixture?.enabled === true
  && window.slipstreamUiFixture?.isolated === true;
const isCommandQSafeExitNativeFixture = isNativeUiFixture
  && demoMode === 'result'
  && demoTermsCode === 'sample'
  && demoQuitDelay === 'ipc'
  && demoRunCode === 'command-q-safe-exit-native'
  && typeof window.slipstreamUiFixtureQuit?.updateRisk === 'function'
  && typeof window.slipstreamUiFixtureQuit?.decide === 'function'
  && typeof window.slipstreamUiFixtureQuit?.onRequested === 'function';
const isCommandCommaSafeSettingsNativeFixture = isNativeUiFixture
  && demoMode === 'capture'
  && demoBackend === 'deepseek'
  && demoProcessCode === 'slow'
  && demoRunCode === 'command-comma-safe-settings-native'
  && typeof window.slipstreamUiFixtureSettingsMenu?.listenerReady === 'function'
  && typeof window.slipstreamUiFixtureSettingsMenu?.handled === 'function'
  && typeof window.slipstreamUiFixtureSettingsMenu?.onRequested === 'function';

if (isNativeUiFixture) {
  document.documentElement.dataset.uiFixture = 'native-isolated';
}
const DEMO_CONNECTION_RESULTS = Object.freeze({
  ok: { status: 'connected', code: 'ok' },
  unsupported: { status: 'inconclusive', code: 'unsupported' },
  unauthorized: { status: 'failed', code: 'unauthorized' },
  unreachable: { status: 'failed', code: 'unreachable' },
  timeout: { status: 'failed', code: 'timeout' },
  'model-not-found': { status: 'failed', code: 'model-not-found' },
  'structured-output-invalid': { status: 'failed', code: 'structured-output-invalid' },
  'generation-failed': { status: 'failed', code: 'generation-failed' },
});
const DEMO_RUNTIME_STATUSES = Object.freeze({
  'tray-unavailable': Object.freeze({
    trayAvailable: false,
    clipboardMonitoringDisabled: false,
    clipboardMonitoringDisablePersistFailed: false,
  }),
  'monitoring-disabled': Object.freeze({
    trayAvailable: true,
    clipboardMonitoringDisabled: true,
    clipboardMonitoringDisablePersistFailed: false,
  }),
  'monitoring-disable-persist-failed': Object.freeze({
    trayAvailable: true,
    clipboardMonitoringDisabled: false,
    clipboardMonitoringDisablePersistFailed: true,
  }),
  all: Object.freeze({
    trayAvailable: false,
    clipboardMonitoringDisabled: true,
    clipboardMonitoringDisablePersistFailed: true,
  }),
});
const DEMO_RUNTIME_READY = Object.freeze({
  trayAvailable: true,
  clipboardMonitoringDisabled: false,
  clipboardMonitoringDisablePersistFailed: false,
});
const demoRuntimeStatus = DEMO_RUNTIME_STATUSES[demoRuntimeCode] || DEMO_RUNTIME_READY;
const DEMO_PROCESS_FAILURES = Object.freeze({
  unauthorized: {
    errorCode: 'processing-unauthorized',
    error: 'DeepSeek 拒绝了当前凭据，请更新并验证 API Key。',
  },
  'model-not-found': {
    errorCode: 'model-not-found',
    error: '当前模型不可用，请选择并验证一个可用模型。',
  },
  unreachable: {
    errorCode: 'processing-unreachable',
    error: '暂时无法连接当前分析服务。',
  },
  'rate-limited': {
    errorCode: 'processing-rate-limited',
    error: '当前分析服务请求过多，请稍后重试。',
  },
  'service-unavailable': {
    errorCode: 'processing-service-unavailable',
    error: '当前分析服务暂时不可用。',
  },
});
const DEMO_LONG_CLIPBOARD_SEED = 'Important policy update. Read every section before acting. ';
const DEMO_MONITOR_SOURCE_TEXT = 'Your eVisa replaces the physical immigration document. Keep your UKVI account details up to date before you travel.';
const DEMO_MONITOR_WAITING_TEXT = 'Your landlord has asked for a share code by Friday. Check that the code is still valid before sending it.';
const DEMO_SCREENSHOT_WAITING_TEXT = 'Upload the signed tenancy declaration within five working days to keep your application active.';
const DEMO_FAILED_SOURCE_TEXT = 'Fixture source B: upload the signed tenancy declaration within five working days.';
const DEMO_FAILED_SOURCE_CAPTURE = Object.freeze({
  confidence: 0.91,
  blocks: Object.freeze([Object.freeze({
    id: 'fixture-source-b-block-1',
    text: DEMO_FAILED_SOURCE_TEXT,
    confidence: 0.91,
    boundingBox: Object.freeze({ x: 18, y: 24, width: 420, height: 36 }),
  })]),
});
const DEMO_LOW_CONFIDENCE_CAPTURE = Object.freeze({
  confidence: 0.34,
  blocks: Object.freeze(PREVIEW_CAPTURE.blocks.map((block) => Object.freeze({
    ...block,
    confidence: 0.34,
  }))),
});
const DEMO_LOW_CONFIDENCE_REVIEW = Object.freeze({
  required: true,
  sourceSha256: 'b046e19847bbcc3a6db88cbdc672d1acd78fd21f187a111672ca341a7fb22d07',
  reasons: Object.freeze(['low-overall-confidence', 'low-block-confidence']),
});
const DEMO_SAVED_TERMS = Object.freeze([Object.freeze({
  id: 1785142800000,
  createdAt: '2026-07-27T09:00:00.000Z',
  term: 'passport information page',
  explanation: '护照上包含姓名、照片、护照号码、出生日期等个人资料的页面。',
  evidence: 'passport information page',
  termKind: 'specialist_term',
  provenanceKind: 'original',
})]);
const DEMO_IMPORTED_TERMS = Object.freeze([
  Object.freeze({
    term: 'CAS',
    explanation: 'Confirmation of Acceptance for Studies，学校签发的留学录取确认编号。',
    termKind: 'other',
    provenanceKind: 'unknown',
  }),
  Object.freeze({
    term: 'passport information page',
    explanation: '护照中包含持有人身份资料、照片与护照号码的页面。',
    termKind: 'other',
    provenanceKind: 'unknown',
  }),
]);
let demoTerms = demoTermsCode === 'sample'
  ? DEMO_SAVED_TERMS.map((term) => ({ ...term }))
  : [];
let demoSaveFailuresRemaining = demoRunCode === 'settings-prompt-draft-recovery-native'
  && demoSaveCode === 'prompt-twice'
  ? 2
  : ['once', 'credential-once'].includes(demoSaveCode) ? 1 : 0;
let demoCredentialDeleteFailuresRemaining = demoCredentialDeleteCode === 'once' ? 1 : 0;
let demoResetFailuresRemaining = demoResetCode === 'once' ? 1 : 0;
let demoTermSaveFailuresRemaining = demoTermSaveCode === 'once' ? 1 : 0;
let demoTermDeleteFailuresRemaining = demoTermDeleteCode === 'once' ? 1 : 0;
let demoTermsLoadFailuresRemaining = demoTermsLoadCode === 'fail-once' ? 1 : 0;
let demoTermsLoadInvalidResponsesRemaining = demoTermsLoadCode === 'invalid-once' ? 1 : 0;
let demoImportPreviewId = null;
let demoDiagnosticsRequests = 0;
let demoSettingsLoadRequests = 0;
let demoStartupRecoveryRequests = 0;
let demoProviderConnectionRequests = 0;
let demoClipboardConsequenceId = null;
let demoClipboardWriteRequests = 0;
let demoClipboardWriteFailuresRemaining = demoClipboardWriteCode === 'once' ? 1 : 0;
let demoNativeClipboardWriteStubs = 0;
let demoExternalOpenFailuresRemaining = demoExternalOpenCode === 'once' ? 1 : 0;
let demoCommandCommaProcessPending = null;
let demoCommandCommaCancelRequests = 0;
let demoCommandCommaCancelSuccesses = 0;
let demoCommandCommaCancelFailures = 0;
let demoCommandCommaEventSequence = 0;
const demoCommandCommaTimeline = [];
let demoVerificationPending = null;
let demoProviderConnectionPending = null;
let demoScreenshotPending = null;
let demoCaptureFailuresRemaining = demoCaptureCode === 'ocr-fail-once' ? 1 : 0;
const demoProcessFailureScenario = ['fail', 'once', 'replacement-source-once'].includes(demoProcessCode)
  ? 'service-unavailable'
  : demoProcessCode?.replace(/-once$/, '');
const demoProcessFailureIsPersistent = demoProcessCode === 'fail'
  || Boolean(DEMO_PROCESS_FAILURES[demoProcessCode]);
let demoProcessFailuresRemaining = demoProcessCode === 'once' || demoProcessCode?.endsWith('-once')
  ? 1
  : 0;
let demoCancelFailuresRemaining = demoCancelCode === 'once' ? 1 : 0;
let demoShortcutChangeFailuresRemaining = demoShortcutCode === 'change-conflict' ? 1 : 0;
let demoProcessRequests = 0;
const demoProcessPayloads = [];
let demoScreenshotCaptureRequests = 0;
let demoScreenshotShortcutEvents = 0;
let demoCredentialDeleteRequests = 0;
let demoCredentialDeleteSuccesses = 0;
let demoDeepseekCredentialWriteRequests = 0;
let demoDeepseekCredentialWriteSuccesses = 0;
let demoSettingsWriteRequests = 0;
let demoSettingsWriteSuccesses = 0;
let demoCustomPromptWriteRequests = 0;
let demoCustomPromptWriteSuccesses = 0;
let demoQuitListener = null;
let demoQuitTimer = null;
let demoPendingQuitRequestId = null;
let demoQuitRequestSequence = 0;
let demoQuitRequests = 0;
let demoQuitDecisionRequests = 0;
let demoQuitConfirmedDecisions = 0;
let demoResetQuitScheduled = false;
let demoUserDataResetTicket = null;
let demoUserDataResetTicketSequence = 0;
let demoTermsGetRequests = 0;
let demoTermsSaveRequests = 0;
let demoTermsDeleteRequests = 0;
let demoTermsImportPreviewRequests = 0;
let demoTermsImportCommitRequests = 0;
let demoTermsResetRequests = 0;

function exposeDemoRequestCounters() {
  if (!isDemo) return;
  document.documentElement.dataset.demoProcessRequests = String(demoProcessRequests);
  document.documentElement.dataset.demoProcessPayloads = JSON.stringify(demoProcessPayloads);
  document.documentElement.dataset.demoScreenshotCaptureRequests = String(demoScreenshotCaptureRequests);
  document.documentElement.dataset.demoScreenshotShortcutEvents = String(demoScreenshotShortcutEvents);
  document.documentElement.dataset.demoCredentialDeleteRequests = String(demoCredentialDeleteRequests);
  document.documentElement.dataset.demoCredentialDeleteSuccesses = String(demoCredentialDeleteSuccesses);
  document.documentElement.dataset.demoDeepseekCredentialWriteRequests = String(
    demoDeepseekCredentialWriteRequests,
  );
  document.documentElement.dataset.demoDeepseekCredentialWriteSuccesses = String(
    demoDeepseekCredentialWriteSuccesses,
  );
  document.documentElement.dataset.demoSettingsWriteRequests = String(
    demoSettingsWriteRequests,
  );
  document.documentElement.dataset.demoSettingsWriteSuccesses = String(
    demoSettingsWriteSuccesses,
  );
  document.documentElement.dataset.demoCustomPromptWriteRequests = String(
    demoCustomPromptWriteRequests,
  );
  document.documentElement.dataset.demoCustomPromptWriteSuccesses = String(
    demoCustomPromptWriteSuccesses,
  );
  document.documentElement.dataset.demoStartupRecoveryRequests = String(demoStartupRecoveryRequests);
  document.documentElement.dataset.demoProviderConnectionRequests = String(demoProviderConnectionRequests);
  document.documentElement.dataset.demoClipboardWriteRequests = String(demoClipboardWriteRequests);
  document.documentElement.dataset.demoNativeClipboardWriteStubs = String(demoNativeClipboardWriteStubs);
  document.documentElement.dataset.demoQuitRequests = String(demoQuitRequests);
  document.documentElement.dataset.demoQuitDecisionRequests = String(demoQuitDecisionRequests);
  document.documentElement.dataset.demoQuitConfirmedDecisions = String(demoQuitConfirmedDecisions);
  document.documentElement.dataset.demoTermsGetRequests = String(demoTermsGetRequests);
  document.documentElement.dataset.demoTermsSaveRequests = String(demoTermsSaveRequests);
  document.documentElement.dataset.demoTermsDeleteRequests = String(demoTermsDeleteRequests);
  document.documentElement.dataset.demoTermsImportPreviewRequests = String(
    demoTermsImportPreviewRequests,
  );
  document.documentElement.dataset.demoTermsImportCommitRequests = String(
    demoTermsImportCommitRequests,
  );
  document.documentElement.dataset.demoTermsResetRequests = String(demoTermsResetRequests);
  if (isCommandCommaSafeSettingsNativeFixture) {
    document.documentElement.dataset.demoCommandCommaCancelRequests = String(
      demoCommandCommaCancelRequests,
    );
    document.documentElement.dataset.demoCommandCommaCancelSuccesses = String(
      demoCommandCommaCancelSuccesses,
    );
    document.documentElement.dataset.demoCommandCommaCancelFailures = String(
      demoCommandCommaCancelFailures,
    );
    document.documentElement.dataset.demoCommandCommaTimeline = JSON.stringify(
      demoCommandCommaTimeline,
    );
  }
}

function recordCommandCommaEvent(event) {
  if (!isCommandCommaSafeSettingsNativeFixture) return;
  demoCommandCommaEventSequence += 1;
  demoCommandCommaTimeline.push(Object.freeze({
    sequence: demoCommandCommaEventSequence,
    event,
  }));
  exposeDemoRequestCounters();
}

function recordDemoProcessPayload(payload) {
  if (!isNativeUiFixture) return;
  const capture = payload?.capture && typeof payload.capture === 'object'
    ? {
        confidence: Number.isFinite(payload.capture.confidence) ? payload.capture.confidence : null,
        blocks: Array.isArray(payload.capture.blocks)
          ? payload.capture.blocks.map((block) => ({
              ...(block && typeof block === 'object' ? block : {}),
              ...(block?.boundingBox && typeof block.boundingBox === 'object'
                ? { boundingBox: { ...block.boundingBox } }
                : {}),
            }))
          : [],
      }
    : null;
  demoProcessPayloads.push({
    text: typeof payload?.text === 'string' ? payload.text : '',
    source: typeof payload?.source === 'string' ? payload.source : '',
    capture,
    ocrReview: payload?.ocrReview && typeof payload.ocrReview === 'object'
      ? {
          confirmed: payload.ocrReview.confirmed === true,
          sourceSha256: typeof payload.ocrReview.sourceSha256 === 'string'
            ? payload.ocrReview.sourceSha256
            : '',
          destinationSha256: typeof payload.ocrReview.destinationSha256 === 'string'
            ? payload.ocrReview.destinationSha256
            : '',
        }
      : null,
    truncated: payload?.truncated === true,
    originalLength: Number.isSafeInteger(payload?.originalLength)
      ? payload.originalLength
      : null,
  });
}

exposeDemoRequestCounters();
const DEMO_RESET_SETTINGS = Object.freeze({
  setupMode: 'unconfigured',
  activeBackend: 'free_translate',
  activeModel: 'google-translate',
  ollamaBaseUrl: 'http://localhost:11434',
  customEndpointUrl: '',
  languageHint: DEFAULTS.LANGUAGE,
  clipboardMonitoring: false,
  verificationPolicy: 'ask',
  resultOrder: 'action-first',
  privacyNoticeSeen: false,
  clipboardShortcut: DEFAULTS.CLIPBOARD_SHORTCUT,
  screenshotShortcut: DEFAULTS.SCREENSHOT_SHORTCUT,
  runtimeStatus: { ...demoRuntimeStatus },
});
let demoSettings = demoMode === 'setup'
  ? {
      setupMode: 'unconfigured',
      activeBackend: 'free_translate',
      activeModel: 'google-translate',
      ollamaBaseUrl: 'http://localhost:11434',
      customEndpointUrl: '',
      languageHint: DEFAULTS.LANGUAGE,
      clipboardMonitoring: false,
      verificationPolicy: 'ask',
      resultOrder: 'action-first',
      privacyNoticeSeen: false,
      clipboardShortcut: DEFAULTS.CLIPBOARD_SHORTCUT,
      screenshotShortcut: DEFAULTS.SCREENSHOT_SHORTCUT,
      runtimeStatus: { ...demoRuntimeStatus },
    }
  : {
      setupMode: 'full',
      activeBackend: 'ollama',
      activeModel: 'qwen2.5',
      ollamaBaseUrl: 'http://localhost:11434',
      customEndpointUrl: '',
      languageHint: DEFAULTS.LANGUAGE,
      clipboardMonitoring: false,
      verificationPolicy: 'ask',
      resultOrder: 'action-first',
      privacyNoticeSeen: true,
      clipboardShortcut: DEFAULTS.CLIPBOARD_SHORTCUT,
      screenshotShortcut: DEFAULTS.SCREENSHOT_SHORTCUT,
      runtimeStatus: { ...demoRuntimeStatus },
    };

if (demoMode !== 'setup' && demoBackend === 'free_translate') {
  demoSettings = {
    ...demoSettings,
    setupMode: 'translation-only',
    activeBackend: 'free_translate',
    activeModel: 'google-translate',
  };
} else if (demoMode !== 'setup' && ['openai', 'anthropic', 'deepseek', 'ollama'].includes(demoBackend)) {
  const model = {
    anthropic: 'claude-sonnet-4-6',
    deepseek: 'deepseek-v4-flash',
    ollama: 'qwen2.5',
    openai: 'gpt-4o',
  }[demoBackend];
  const credentialFlag = {
    anthropic: 'hasAnthropicApiKey',
    deepseek: 'hasDeepseekApiKey',
    openai: 'hasOpenaiApiKey',
  }[demoBackend];
  demoSettings = {
    ...demoSettings,
    activeBackend: demoBackend,
    activeModel: model,
    ...(credentialFlag ? { [credentialFlag]: true } : {}),
  };
} else if (demoMode !== 'setup' && ['custom-local', 'custom-online'].includes(demoBackend)) {
  demoSettings = {
    ...demoSettings,
    activeBackend: 'custom',
    activeModel: 'custom-demo-model',
    customEndpointUrl: demoBackend === 'custom-local'
      ? 'http://127.0.0.1:8000/v1'
      : 'https://api.example.invalid/v1',
    hasCustomEndpointApiKey: demoBackend === 'custom-online',
  };
}

if (demoMode !== 'setup' && demoClipboardMonitoringCode === 'on') {
  demoSettings = {
    ...demoSettings,
    clipboardMonitoring: true,
  };
}

if (demoRunCode === 'settings-prompt-draft-recovery-native') {
  demoSettings = {
    ...demoSettings,
    setupMode: 'unconfigured',
    customPrompt: 'Fixture persisted prompt S: keep {{text}} and {{languageHint}}.',
  };
}

let demoShortcutStatus = {
  allRegistered: !['clipboard-conflict', 'screenshot-conflict', 'both-conflict']
    .includes(demoShortcutCode),
  clipboard: {
    accelerator: demoSettings.clipboardShortcut,
    registered: !['clipboard-conflict', 'both-conflict'].includes(demoShortcutCode),
    reason: ['clipboard-conflict', 'both-conflict'].includes(demoShortcutCode) ? 'conflict' : null,
  },
  screenshot: {
    accelerator: demoSettings.screenshotShortcut,
    registered: !['screenshot-conflict', 'both-conflict'].includes(demoShortcutCode),
    reason: ['screenshot-conflict', 'both-conflict'].includes(demoShortcutCode) ? 'conflict' : null,
  },
};

function refreshDemoShortcutStatus() {
  demoShortcutStatus = {
    allRegistered: true,
    clipboard: {
      accelerator: demoSettings.clipboardShortcut,
      registered: true,
      reason: null,
    },
    screenshot: {
      accelerator: demoSettings.screenshotShortcut,
      registered: true,
      reason: null,
    },
  };
}

function emitDemoQuitRequest(source) {
  if (!demoQuitListener || demoPendingQuitRequestId) return false;
  demoQuitRequestSequence += 1;
  const requestId = `preview-quit-${source}-${demoQuitRequestSequence}`;
  demoPendingQuitRequestId = requestId;
  demoQuitRequests += 1;
  exposeDemoRequestCounters();
  demoQuitListener({ requestId });
  return true;
}

function scheduleDemoResetQuitRequest() {
  if (demoQuitDelay !== 'reset' || demoResetQuitScheduled) return;
  demoResetQuitScheduled = true;
  demoQuitTimer = window.setTimeout(() => {
    demoQuitTimer = null;
    emitDemoQuitRequest('reset');
  }, 300);
}

function getLiveDemoUserDataResetTicket() {
  if (!demoUserDataResetTicket) return null;
  if (demoUserDataResetTicket.expiresAt > Date.now()) return demoUserDataResetTicket;
  demoUserDataResetTicket = null;
  return null;
}

function prepareDemoUserDataReset(payload) {
  if (!payload || typeof payload !== 'object') return { status: 'invalid' };
  if (getLiveDemoUserDataResetTicket()) return { status: 'busy' };
  const currentConsequence = demoClipboardConsequenceId
    ? { id: demoClipboardConsequenceId }
    : null;
  const validNone = payload.clipboardMode === 'none'
    && payload.clipboardConsequenceId === null;
  const validPreserve = payload.clipboardMode === 'preserve'
    && typeof payload.clipboardConsequenceId === 'string'
    && payload.clipboardConsequenceId.length > 0
    && payload.clipboardConsequenceId.length <= 100;
  if (!validNone && !validPreserve) return { status: 'invalid' };
  if (
    (currentConsequence && (!validPreserve
      || payload.clipboardConsequenceId !== currentConsequence.id))
    || (!currentConsequence && !validNone)
  ) {
    return {
      status: 'clipboard-consequence-mismatch',
      clipboardConsequence: currentConsequence,
    };
  }

  demoUserDataResetTicketSequence += 1;
  const ticket = `demo-user-data-reset-ticket-${Date.now()}-${demoUserDataResetTicketSequence}`;
  demoUserDataResetTicket = {
    ticket,
    consequenceId: currentConsequence?.id || null,
    expiresAt: Date.now() + 30_000,
  };
  return {
    status: 'prepared',
    ticket,
    clipboardStatus: currentConsequence ? 'retained' : 'not-applicable',
    expiresAt: demoUserDataResetTicket.expiresAt,
  };
}

function createDemoDiagnostics() {
  const screenRecordingStatus = demoDiagnosticsCode === 'denied' ? 'denied' : 'granted';
  const screenRecordingLabel = screenRecordingStatus === 'denied' ? '未允许' : '已允许';
  const backendLabels = {
    free_translate: '基础翻译 · Google / MyMemory',
    ollama: '本机 · Ollama',
    anthropic: '在线 · Anthropic',
    openai: '在线 · OpenAI',
    deepseek: '在线 · DeepSeek',
  };
  const modeLabels = {
    full: '完整分析',
    'translation-only': '基础翻译',
    unconfigured: '尚未完成配置',
  };
  const verificationLabels = {
    ask: '每次询问',
    'official-auto': '自动查找',
    'local-only': '仅本地',
  };
  const generatedAt = '2026-07-27T12:00:00.000Z';
  const processingLocation = processingLocationForSettings(demoSettings);
  const customBackendLabel = processingLocation === PROCESSING_LOCATION_KINDS.LOCAL_LOOPBACK
    ? '本机兼容服务 · 回环'
    : processingLocation === PROCESSING_LOCATION_KINDS.ONLINE
      ? '在线 · 自定义服务'
      : '位置未确认 · 自定义服务';
  const analysisLabel = `${demoSettings.activeBackend === 'custom'
    ? customBackendLabel
    : backendLabels[demoSettings.activeBackend]} · ${demoSettings.activeModel}`;
  const summaryText = [
    'Slipstream 1.0.0',
    '构建：源码预览',
    '构建信任：从源码运行的开发预览，不是安装包或公开发布版本。',
    '系统：macOS 26.0 · Apple 芯片（arm64）',
    `功能模式：${modeLabels[demoSettings.setupMode]}`,
    `分析方式：${analysisLabel}`,
    `屏幕录制权限：${screenRecordingLabel}`,
    `剪贴板自动检测：${demoSettings.clipboardMonitoring ? '开启' : '关闭'}`,
    `官方来源核验：${verificationLabels[demoSettings.verificationPolicy]}`,
    `快捷键：剪贴板 ${displayShortcutAccelerator(demoSettings.clipboardShortcut)}（${demoShortcutStatus.clipboard.registered ? '已启用' : '不可用'}） · 截图 ${displayShortcutAccelerator(demoSettings.screenshotShortcut)}（${demoShortcutStatus.screenshot.registered ? '已启用' : '不可用'}）`,
    `已保存术语：${demoTerms.length} 条（不包含术语内容）`,
    `生成时间：${generatedAt}`,
    '隐私边界：不包含 API Key、服务地址、原文、术语内容或剪贴板内容；不会自动发送。',
  ].join('\n');
  return {
    appVersion: '1.0.0',
    buildIdentity: 'development',
    buildKind: '源码预览',
    buildTrust: '从源码运行的开发预览，不是安装包或公开发布版本。',
    isPublicDistribution: false,
    system: { name: 'macOS', version: '26.0', arch: 'arm64', architectureLabel: 'Apple 芯片（arm64）' },
    screenRecording: { status: screenRecordingStatus, label: screenRecordingLabel },
    mode: { value: demoSettings.setupMode, label: modeLabels[demoSettings.setupMode] },
    analysis: {
      backend: demoSettings.activeBackend,
      label: analysisLabel,
      model: demoSettings.activeModel,
      processingLocation,
    },
    clipboardMonitoring: demoSettings.clipboardMonitoring,
    verification: {
      value: demoSettings.verificationPolicy,
      label: verificationLabels[demoSettings.verificationPolicy],
    },
    shortcuts: {
      clipboard: demoSettings.clipboardShortcut,
      screenshot: demoSettings.screenshotShortcut,
      clipboardRegistered: demoShortcutStatus.clipboard.registered,
      screenshotRegistered: demoShortcutStatus.screenshot.registered,
    },
    savedTermCount: demoTerms.length,
    generatedAt,
    privacy: {
      includesCredentials: false,
      includesServiceAddresses: false,
      includesSourceText: false,
      includesTermContent: false,
      includesClipboardContent: false,
      automaticallySent: false,
    },
    summaryText,
  };
}

function invokeDemo(channel, ...args) {
  switch (channel) {
    case IPC_CHANNELS.SETTINGS_GET:
      demoSettingsLoadRequests += 1;
      if (demoSettingsLoadCode === 'corrupt-json') {
        return Promise.resolve({ startupBlocked: true, reason: 'corrupt-json' });
      }
      if (demoSettingsLoadCode === 'fail') {
        return Promise.reject(new Error('Previewed settings read failure'));
      }
      if (demoSettingsLoadCode === 'invalid') return Promise.resolve({});
      if (demoSettingsLoadCode === 'timeout') return new Promise(() => {});
      if (demoSettingsLoadCode === 'once' && demoSettingsLoadRequests <= 2) {
        return Promise.reject(new Error('Previewed one-time settings read failure'));
      }
      if (demoSettingsLoadCode === 'timeout-once' && demoSettingsLoadRequests <= 2) {
        return new Promise(() => {});
      }
      return Promise.resolve({ ...demoSettings });
    case IPC_CHANNELS.SETTINGS_RECOVERY_RESET:
      demoStartupRecoveryRequests += 1;
      exposeDemoRequestCounters();
      if (demoStartupRecoveryCode !== 'archive-success') {
        return Promise.resolve({ status: 'failed', reason: 'unavailable' });
      }
      return new Promise((resolve) => {
        window.setTimeout(() => {
          demoTerms = [];
          demoSettings = {
            ...DEMO_RESET_SETTINGS,
            runtimeStatus: { ...demoRuntimeStatus },
          };
          refreshDemoShortcutStatus();
          resolve({
            status: 'recovered',
            settings: { ...demoSettings },
            recovery: {
              backupCreated: true,
              backupFileName: 'slipstream-settings.corrupt-20260728.json',
            },
          });
        }, 250);
      });
    case IPC_CHANNELS.SHORTCUT_STATUS_GET:
      return Promise.resolve({
        ...demoShortcutStatus,
        clipboard: { ...demoShortcutStatus.clipboard },
        screenshot: { ...demoShortcutStatus.screenshot },
      });
    case IPC_CHANNELS.SUPPORT_DIAGNOSTICS_GET:
      demoDiagnosticsRequests += 1;
      if (
        demoDiagnosticsCode === 'fail'
        || (demoDiagnosticsCode === 'refresh-fail' && demoDiagnosticsRequests > 2)
      ) {
        return Promise.reject(new Error('Previewed diagnostics read failure'));
      }
      return Promise.resolve(createDemoDiagnostics());
    case IPC_CHANNELS.SETTINGS_SET: {
      const [key, value] = args;
      const customPromptWrite = key === 'customPrompt' && typeof value === 'string';
      demoSettingsWriteRequests += 1;
      if (customPromptWrite) demoCustomPromptWriteRequests += 1;
      exposeDemoRequestCounters();
      const deepseekCredentialWrite = key === 'deepseekApiKey'
        && typeof value === 'string'
        && value.length > 0;
      if (deepseekCredentialWrite) {
        demoDeepseekCredentialWriteRequests += 1;
        exposeDemoRequestCounters();
      }
      const previousCustomEndpointUrl = demoSettings.customEndpointUrl || '';
      const previousCustomEndpointOrigin = previousCustomEndpointUrl
        ? new URL(previousCustomEndpointUrl).origin
        : '';
      const nextCustomEndpointOrigin = key === 'customEndpointUrl' && value
        ? new URL(value).origin
        : previousCustomEndpointOrigin;
      const customEndpointApiKeyCleared = key === 'customEndpointUrl'
        && previousCustomEndpointOrigin !== nextCustomEndpointOrigin;
      const savedResponse = { status: 'saved', key, customEndpointApiKeyCleared };
      const shortcutSetting = key === 'clipboardShortcut' || key === 'screenshotShortcut';
      const credentialDeletion = [
        'anthropicApiKey',
        'openaiApiKey',
        'deepseekApiKey',
        'customEndpointApiKey',
      ].includes(key) && value === '';
      if (shortcutSetting && demoShortcutChangeFailuresRemaining > 0) {
        demoShortcutChangeFailuresRemaining -= 1;
        return Promise.reject(new Error(`shortcut-conflict:${key}`));
      }
      if (
        demoSaveFailuresRemaining > 0
        && (demoSaveCode !== 'credential-once' || deepseekCredentialWrite)
      ) {
        demoSaveFailuresRemaining -= 1;
        return Promise.reject(new Error('Previewed settings write failure'));
      }
      if (credentialDeletion) {
        demoCredentialDeleteRequests += 1;
        exposeDemoRequestCounters();
        if (demoCredentialDeleteCode === 'fail' || demoCredentialDeleteFailuresRemaining > 0) {
          demoCredentialDeleteFailuresRemaining = Math.max(0, demoCredentialDeleteFailuresRemaining - 1);
          return Promise.reject(new Error('Previewed credential deletion failure'));
        }
        if (demoCredentialDeleteCode === 'slow') {
          return new Promise((resolve) => {
            window.setTimeout(() => {
              demoSettings = {
                ...demoSettings,
                [key]: value,
                ...(customEndpointApiKeyCleared ? { hasCustomEndpointApiKey: false } : {}),
              };
              demoCredentialDeleteSuccesses += 1;
              demoSettingsWriteSuccesses += 1;
              exposeDemoRequestCounters();
              resolve(savedResponse);
            }, 3000);
          });
        }
      }
      if (demoSaveCode === 'slow') {
        return new Promise((resolve) => {
          window.setTimeout(() => {
            demoSettings = {
              ...demoSettings,
              [key]: value,
              ...(customEndpointApiKeyCleared ? { hasCustomEndpointApiKey: false } : {}),
            };
            if (deepseekCredentialWrite) {
              demoDeepseekCredentialWriteSuccesses += 1;
              exposeDemoRequestCounters();
            }
            if (credentialDeletion) {
              demoCredentialDeleteSuccesses += 1;
              exposeDemoRequestCounters();
            }
            if (shortcutSetting) refreshDemoShortcutStatus();
            demoSettingsWriteSuccesses += 1;
            if (customPromptWrite) demoCustomPromptWriteSuccesses += 1;
            exposeDemoRequestCounters();
            resolve(savedResponse);
          }, 3000);
        });
      }
      demoSettings = {
        ...demoSettings,
        [key]: value,
        ...(customEndpointApiKeyCleared ? { hasCustomEndpointApiKey: false } : {}),
      };
      if (deepseekCredentialWrite) {
        demoDeepseekCredentialWriteSuccesses += 1;
        exposeDemoRequestCounters();
      }
      if (credentialDeletion) {
        demoCredentialDeleteSuccesses += 1;
        exposeDemoRequestCounters();
      }
      if (shortcutSetting) refreshDemoShortcutStatus();
      demoSettingsWriteSuccesses += 1;
      if (customPromptWrite) demoCustomPromptWriteSuccesses += 1;
      exposeDemoRequestCounters();
      return Promise.resolve(savedResponse);
    }
    case IPC_CHANNELS.WINDOW_SET_MODE:
    case IPC_CHANNELS.WINDOW_HIDE:
    case IPC_CHANNELS.APP_SESSION_RISK_UPDATE:
    case IPC_CHANNELS.SYSTEM_OPEN_SCREEN_RECORDING_SETTINGS:
      return Promise.resolve(true);
    case IPC_CHANNELS.EXTERNAL_OPEN:
      if (demoExternalOpenCode === 'fail' || demoExternalOpenFailuresRemaining > 0) {
        demoExternalOpenFailuresRemaining = Math.max(0, demoExternalOpenFailuresRemaining - 1);
        return Promise.reject(new Error('Previewed external open failure'));
      }
      if (demoExternalOpenCode === 'slow') {
        return new Promise((resolve) => window.setTimeout(() => resolve(true), 1200));
      }
      return Promise.resolve(true);
    case IPC_CHANNELS.APP_RENDERER_RECOVERY_STATUS_GET:
      if (
        isNativeUiFixture
        && demoRendererRecoveryCode === 'clipboard-residue'
        && typeof window.slipstreamUiFixtureRecovery?.getStatus === 'function'
      ) {
        return window.slipstreamUiFixtureRecovery.getStatus();
      }
      return Promise.resolve({ recovered: false, clipboardResidueRisk: null });
    case IPC_CHANNELS.USER_DATA_RESET_PREPARE:
      return Promise.resolve(prepareDemoUserDataReset(args[0]));
    case IPC_CHANNELS.USER_DATA_RESET_ABORT: {
      const authorization = getLiveDemoUserDataResetTicket();
      if (!authorization || args[0]?.ticket !== authorization.ticket) {
        return Promise.resolve({ status: 'invalid-ticket' });
      }
      demoUserDataResetTicket = null;
      return Promise.resolve({ status: 'aborted' });
    }
    case IPC_CHANNELS.APP_CLIPBOARD_RESIDUE_RISK_ACK:
      if (getLiveDemoUserDataResetTicket()) {
        return Promise.reject(new Error('Previewed user-data reset is pending'));
      }
      if (
        isNativeUiFixture
        && demoRendererRecoveryCode === 'clipboard-residue'
        && typeof window.slipstreamUiFixtureRecovery?.acknowledge === 'function'
      ) {
        return window.slipstreamUiFixtureRecovery.acknowledge(args[0]);
      }
      if (args[0]?.id && args[0].id === demoClipboardConsequenceId) {
        demoClipboardConsequenceId = null;
        return Promise.resolve({ status: 'acknowledged' });
      }
      return Promise.resolve({ status: 'invalid' });
    case IPC_CHANNELS.APP_QUIT_DECISION: {
      demoQuitDecisionRequests += 1;
      exposeDemoRequestCounters();
      const payload = args[0];
      if (!demoPendingQuitRequestId || payload?.requestId !== demoPendingQuitRequestId) {
        return Promise.resolve({ status: 'invalid' });
      }
      if (
        payload?.confirmed === true
        && demoClipboardConsequenceId
        && payload.clipboardConsequenceId !== demoClipboardConsequenceId
      ) {
        return Promise.resolve({
          status: 'clipboard-consequence-unconfirmed',
          clipboardConsequence: { id: demoClipboardConsequenceId },
        });
      }
      demoPendingQuitRequestId = null;
      if (payload.confirmed) {
        demoClipboardConsequenceId = null;
        demoQuitConfirmedDecisions += 1;
        exposeDemoRequestCounters();
      }
      return Promise.resolve({ status: payload.confirmed ? 'preview-confirmed' : 'cancelled' });
    }
    case IPC_CHANNELS.PROVIDER_CONNECTION_CANCEL:
      if (!demoProviderConnectionPending) return Promise.resolve({ status: 'not-running' });
      if (demoConnectionCancelCode === 'fail') {
        return new Promise((resolve) => {
          window.setTimeout(() => resolve({ status: 'still-running' }), 650);
        });
      }
      window.clearTimeout(demoProviderConnectionPending.timer);
      demoProviderConnectionPending.resolve({ status: 'failed', code: 'cancelled' });
      demoProviderConnectionPending = null;
      return Promise.resolve({ status: 'cancelled' });
    case IPC_CHANNELS.LLM_CANCEL:
      if (isCommandCommaSafeSettingsNativeFixture) {
        if (args[0]?.discardResult === true) {
          recordCommandCommaEvent('discard-result-cancel-ignored');
          return Promise.resolve(true);
        }
        demoCommandCommaCancelRequests += 1;
        const cancelRequest = demoCommandCommaCancelRequests;
        const failureDelay = cancelRequest === 2 ? 1200 : cancelRequest === 4 ? 350 : null;
        recordCommandCommaEvent(`cancel-${cancelRequest}-started`);
        exposeDemoRequestCounters();
        return new Promise((resolve, reject) => {
          window.setTimeout(() => {
            if (failureDelay !== null) {
              demoCommandCommaCancelFailures += 1;
              recordCommandCommaEvent(`cancel-${cancelRequest}-failed`);
              reject(new Error('Previewed Command+, cancellation failure'));
              return;
            }
            if (demoCommandCommaProcessPending) {
              const pending = demoCommandCommaProcessPending;
              demoCommandCommaProcessPending = null;
              window.clearTimeout(pending.timer);
              recordCommandCommaEvent(`process-${pending.requestNumber}-cancelled`);
              pending.resolve({ success: false, cancelled: true });
            }
            demoCommandCommaCancelSuccesses += 1;
            recordCommandCommaEvent(`cancel-${cancelRequest}-succeeded`);
            resolve(true);
          }, failureDelay ?? 0);
        });
      }
      return new Promise((resolve, reject) => {
        const shouldStayRunning = demoCancelCode === 'still-running';
        const shouldFail = demoCancelCode === 'fail' || demoCancelFailuresRemaining > 0;
        if (demoCancelFailuresRemaining > 0) demoCancelFailuresRemaining -= 1;
        const delay = demoCancelCode === 'complete' ? 3000 : (shouldFail || shouldStayRunning) ? 650 : 0;
        window.setTimeout(() => {
          if (shouldStayRunning) {
            resolve(false);
            return;
          }
          if (shouldFail) {
            reject(new Error('Previewed processing cancellation failure'));
            return;
          }
          if (isCommandCommaSafeSettingsNativeFixture && demoCommandCommaProcessPending) {
            const pending = demoCommandCommaProcessPending;
            demoCommandCommaProcessPending = null;
            window.clearTimeout(pending.timer);
            pending.resolve({ success: false, cancelled: true });
          }
          if (demoVerificationPending) {
            const pending = demoVerificationPending;
            demoVerificationPending = null;
            window.clearTimeout(pending.timer);
            pending.resolve({
              success: false,
              cancelled: true,
              errorCode: 'verification-cancelled',
              error: '官方来源核验已取消。',
              retryApprovalId: 'a'.repeat(64),
            });
          }
          if (demoScreenshotPending) {
            const pending = demoScreenshotPending;
            demoScreenshotPending = null;
            window.clearTimeout(pending.timer);
            pending.resolve({ success: false, cancelled: true });
          }
          resolve(true);
        }, delay);
      });
    case IPC_CHANNELS.USER_DATA_CLEAR: {
      demoTermsResetRequests += 1;
      exposeDemoRequestCounters();
      const resetPayload = args[0] || {};
      const authorization = getLiveDemoUserDataResetTicket();
      if (!authorization || resetPayload.ticket !== authorization.ticket) {
        return Promise.resolve({ status: 'invalid-ticket' });
      }
      demoUserDataResetTicket = null;
      if (authorization.consequenceId !== demoClipboardConsequenceId) {
        return Promise.resolve({
          status: 'clipboard-consequence-changed',
          clipboardConsequence: demoClipboardConsequenceId
            ? { id: demoClipboardConsequenceId }
            : null,
        });
      }
      scheduleDemoResetQuitRequest();
      if (demoResetFailuresRemaining > 0) {
        demoResetFailuresRemaining -= 1;
        return new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error('Previewed data reset failure')), 1200);
        });
      }
      if (demoResetCode === 'slow') {
        return new Promise((resolve) => {
          window.setTimeout(() => {
            demoTerms = [];
            demoSettings = { ...DEMO_RESET_SETTINGS };
            demoClipboardConsequenceId = null;
            refreshDemoShortcutStatus();
            resolve({
              status: 'cleared',
              settings: { ...demoSettings },
              clipboardStatus: authorization.consequenceId ? 'retained' : 'not-applicable',
            });
          }, 5000);
        });
      }
      demoTerms = [];
      demoSettings = { ...DEMO_RESET_SETTINGS };
      demoClipboardConsequenceId = null;
      refreshDemoShortcutStatus();
      return Promise.resolve({
        status: 'cleared',
        settings: { ...demoSettings },
        clipboardStatus: authorization.consequenceId ? 'retained' : 'not-applicable',
      });
    }
    case IPC_CHANNELS.TERMS_GET: {
      demoTermsGetRequests += 1;
      exposeDemoRequestCounters();
      const snapshot = demoTerms.map((term) => ({ ...term }));
      if (
        demoTermsLoadCode === 'fail'
        || (demoTermsLoadCode === 'fail-after-first' && demoTermsGetRequests > 1)
        || demoTermsLoadFailuresRemaining > 0
      ) {
        demoTermsLoadFailuresRemaining = Math.max(0, demoTermsLoadFailuresRemaining - 1);
        return Promise.reject(new Error('Previewed saved terms read failure'));
      }
      if (demoTermsLoadCode === 'invalid' || demoTermsLoadInvalidResponsesRemaining > 0) {
        demoTermsLoadInvalidResponsesRemaining = Math.max(
          0,
          demoTermsLoadInvalidResponsesRemaining - 1,
        );
        return Promise.resolve({ status: 'invalid-saved-terms' });
      }
      if (demoTermsLoadCode === 'slow') {
        return new Promise((resolve) => {
          window.setTimeout(() => resolve(snapshot), 1200);
        });
      }
      return Promise.resolve(snapshot);
    }
    case IPC_CHANNELS.TERMS_SAVE: {
      demoTermsSaveRequests += 1;
      exposeDemoRequestCounters();
      const payload = args[0] || {};
      if (demoTermSaveFailuresRemaining > 0) {
        demoTermSaveFailuresRemaining -= 1;
        return new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error('Previewed term save failure')), 650);
        });
      }
      const key = savedTermKey(payload.term);
      const existing = demoTerms.find((item) => savedTermKey(item) === key);
      const saved = {
        id: payload.id ?? existing?.id ?? Date.now(),
        createdAt: payload.createdAt ?? existing?.createdAt ?? new Date().toISOString(),
        term: payload.term,
        explanation: payload.definition ?? payload.explanation ?? '',
        evidence: payload.evidence ?? '',
        termKind: payload.termKind ?? existing?.termKind ?? 'other',
        provenanceKind: payload.provenanceKind ?? existing?.provenanceKind ?? 'unknown',
      };
      demoTerms = [saved, ...demoTerms.filter((item) => (
        item.id !== saved.id && savedTermKey(item) !== key
      ))];
      return Promise.resolve(saved);
    }
    case IPC_CHANNELS.TERMS_DELETE:
      demoTermsDeleteRequests += 1;
      exposeDemoRequestCounters();
      if (demoTermDeleteFailuresRemaining > 0) {
        demoTermDeleteFailuresRemaining -= 1;
        return new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error('Previewed term delete failure')), 650);
        });
      }
      demoTerms = demoTerms.filter((item) => item.id !== args[0]);
      return Promise.resolve(true);
    case IPC_CHANNELS.TERMS_EXPORT:
      if (demoTermExportCode === 'cancel') return Promise.resolve({ status: 'cancelled' });
      if (demoTermExportCode === 'fail') {
        return Promise.resolve({ status: 'failed', code: 'write-failed' });
      }
      return Promise.resolve({
        status: demoTerms.length ? 'saved' : 'failed',
        code: demoTerms.length ? undefined : 'no-terms',
        count: demoTerms.length,
        fileName: 'Slipstream-terms-2026-07-27.json',
      });
    case IPC_CHANNELS.TERMS_IMPORT_PREVIEW: {
      demoTermsImportPreviewRequests += 1;
      exposeDemoRequestCounters();
      if (demoTermImportCode === 'cancel') return Promise.resolve({ status: 'cancelled' });
      if (demoTermImportCode === 'invalid') {
        return Promise.resolve({ status: 'failed', code: 'unsupported-format' });
      }
      const existingKeys = new Map(demoTerms.map((term) => [savedTermKey(term), term]));
      const newCount = DEMO_IMPORTED_TERMS.filter((term) => !existingKeys.has(savedTermKey(term))).length;
      const updatedCount = DEMO_IMPORTED_TERMS.filter((term) => {
        const existing = existingKeys.get(savedTermKey(term));
        return existing
          && existing.provenanceKind === 'unknown'
          && (existing.explanation !== term.explanation
            || existing.termKind !== term.termKind
            || existing.provenanceKind !== term.provenanceKind);
      }).length;
      demoImportPreviewId = 'preview-term-import';
      return Promise.resolve({
        status: 'ready',
        previewId: demoImportPreviewId,
        fileName: 'Slipstream-terms-backup.json',
        examples: DEMO_IMPORTED_TERMS.map((term) => term.term),
        planTerms: DEMO_IMPORTED_TERMS.map((term) => ({ ...term })),
        summary: {
          existingCount: demoTerms.length,
          incomingCount: DEMO_IMPORTED_TERMS.length,
          newCount,
          updatedCount,
          unchangedCount: DEMO_IMPORTED_TERMS.length - newCount - updatedCount,
          capacitySkippedCount: 0,
          totalAfter: demoTerms.length + newCount,
          invalidCount: 1,
          duplicateCount: 1,
          ignoredEvidenceCount: 1,
          downgradedProvenanceCount: 1,
        },
      });
    }
    case IPC_CHANNELS.TERMS_IMPORT_COMMIT: {
      demoTermsImportCommitRequests += 1;
      exposeDemoRequestCounters();
      if (demoTermImportCode === 'commit-fail') {
        demoImportPreviewId = null;
        return Promise.resolve({ status: 'failed', code: 'commit-failed' });
      }
      if (!demoImportPreviewId || args[0] !== demoImportPreviewId) {
        return Promise.resolve({ status: 'failed', code: 'preview-expired' });
      }
      demoImportPreviewId = null;
      const existingCount = demoTerms.length;
      let newCount = 0;
      let updatedCount = 0;
      for (const incoming of DEMO_IMPORTED_TERMS) {
        const key = savedTermKey(incoming);
        const existing = demoTerms.find((term) => savedTermKey(term) === key);
        if (existing) {
          if (existing.provenanceKind === 'unknown'
            && (existing.explanation !== incoming.explanation
              || existing.termKind !== incoming.termKind
              || existing.provenanceKind !== incoming.provenanceKind)) {
            existing.explanation = incoming.explanation;
            existing.termKind = incoming.termKind;
            existing.provenanceKind = incoming.provenanceKind;
            updatedCount += 1;
          }
        } else {
          demoTerms.unshift({
            id: Date.now() + newCount,
            createdAt: new Date().toISOString(),
            term: incoming.term,
            explanation: incoming.explanation,
            evidence: '',
            termKind: incoming.termKind,
            provenanceKind: incoming.provenanceKind,
          });
          newCount += 1;
        }
      }
      return Promise.resolve({
        status: 'imported',
        fileName: 'Slipstream-terms-backup.json',
        savedTerms: demoTerms.map((term) => ({ ...term })),
        summary: {
          existingCount,
          incomingCount: DEMO_IMPORTED_TERMS.length,
          newCount,
          updatedCount,
          unchangedCount: DEMO_IMPORTED_TERMS.length - newCount - updatedCount,
          capacitySkippedCount: 0,
          totalAfter: demoTerms.length,
          invalidCount: 1,
          duplicateCount: 1,
          ignoredEvidenceCount: 1,
          downgradedProvenanceCount: 1,
        },
      });
    }
    case IPC_CHANNELS.CLIPBOARD_READ:
      if (demoClipboardReadCode === 'long') {
        const originalLength = DEFAULTS.MAX_TEXT_LENGTH + 137;
        return Promise.resolve({
          text: DEMO_LONG_CLIPBOARD_SEED
            .repeat(Math.ceil(DEFAULTS.MAX_TEXT_LENGTH / DEMO_LONG_CLIPBOARD_SEED.length))
            .slice(0, DEFAULTS.MAX_TEXT_LENGTH),
          truncated: true,
          originalLength,
        });
      }
      return Promise.resolve(PREVIEW_SOURCE_TEXT);
    case IPC_CHANNELS.CLIPBOARD_WRITE:
      if (getLiveDemoUserDataResetTicket()) {
        return Promise.reject(new Error('Previewed user-data reset is pending'));
      }
      demoClipboardWriteRequests += 1;
      exposeDemoRequestCounters();
      if (demoClipboardWriteCode === 'fail' || demoClipboardWriteFailuresRemaining > 0) {
        if (demoClipboardWriteFailuresRemaining > 0) demoClipboardWriteFailuresRemaining -= 1;
        return Promise.reject(new Error('Previewed clipboard write failure'));
      }
      return (demoClipboardWriteCode === 'write-slow'
        ? new Promise((resolve) => window.setTimeout(resolve, 2500))
        : Promise.resolve())
        .then(() => {
          if (isNativeUiFixture) {
            demoNativeClipboardWriteStubs += 1;
            exposeDemoRequestCounters();
            return true;
          }
          return navigator.clipboard?.writeText(args[0] || '').catch(() => true) || true;
        })
        .then(() => {
          demoClipboardConsequenceId = `demo-consequence-${Date.now()}-${demoClipboardWriteRequests}`;
          return {
            success: true,
            consequenceId: demoClipboardConsequenceId,
          };
        });
    case IPC_CHANNELS.SCREENSHOT_CAPTURE: {
      demoScreenshotCaptureRequests += 1;
      exposeDemoRequestCounters();
      if (demoCaptureCode === 'permission-denied') {
        return Promise.resolve({
          success: false,
          errorCode: 'screenshot-permission-denied',
          error: '无法读取屏幕。请到“系统设置 → 隐私与安全性 → 屏幕录制”允许 Slipstream，然后重试。',
        });
      }
      const successResponse = demoProcessCode === 'replacement-source-once'
        ? {
          success: true,
          text: DEMO_FAILED_SOURCE_TEXT,
          ...DEMO_FAILED_SOURCE_CAPTURE,
          truncated: false,
          originalLength: DEMO_FAILED_SOURCE_TEXT.length,
        }
        : {
          success: true,
          text: ['screenshot', 'settings-screenshot', 'foreground-screenshot', 'reply-screenshot'].includes(demoActiveCaptureEventsCode)
            ? DEMO_SCREENSHOT_WAITING_TEXT
            : PREVIEW_SOURCE_TEXT,
          ...(demoCaptureCode === 'low-confidence'
            ? DEMO_LOW_CONFIDENCE_CAPTURE
            : PREVIEW_CAPTURE),
          ...(demoCaptureCode === 'low-confidence'
            ? { ocrReview: DEMO_LOW_CONFIDENCE_REVIEW }
            : {}),
        };
      const shouldFailOcr = demoCaptureCode === 'ocr-fail'
        || demoCaptureFailuresRemaining > 0;
      if (demoCaptureFailuresRemaining > 0) demoCaptureFailuresRemaining -= 1;
      const response = shouldFailOcr
        ? {
          success: false,
          errorCode: 'screenshot-ocr-failed',
          error: '截图已完成，但文字识别失败。请重新框选清晰文字。',
        }
        : successResponse;
      const delay = demoCaptureCode === 'slow' ? 30000 : shouldFailOcr ? 1200 : 0;
      if (!delay) return Promise.resolve(response);
      return new Promise((resolve) => {
        const pending = { resolve, timer: null };
        pending.timer = window.setTimeout(() => {
          if (demoScreenshotPending === pending) demoScreenshotPending = null;
          resolve(response);
        }, delay);
        demoScreenshotPending = pending;
      });
    }
    case IPC_CHANNELS.PROVIDER_CONNECTION_TEST:
      demoProviderConnectionRequests += 1;
      exposeDemoRequestCounters();
      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          demoProviderConnectionPending = null;
          const resultCode = demoConnectionCode === 'unreachable-once'
            ? demoProviderConnectionRequests === 1 ? 'unreachable' : 'ok'
            : demoConnectionCode;
          resolve({
            ...(DEMO_CONNECTION_RESULTS[resultCode] || DEMO_CONNECTION_RESULTS.ok),
            processingLocation: processingLocationForSettings(demoSettings),
          });
        }, demoConnectionCode === 'slow' ? 30000 : demoConnectionCode === 'race' ? 3000 : 450);
        demoProviderConnectionPending = { resolve, timer };
      });
    case IPC_CHANNELS.LLM_PROCESS:
      demoProcessRequests += 1;
      if (isCommandCommaSafeSettingsNativeFixture) {
        recordCommandCommaEvent(`process-${demoProcessRequests}-started`);
      }
      recordDemoProcessPayload(args[0]);
      exposeDemoRequestCounters();
      return new Promise((resolve) => {
        const commandCommaDelay = isCommandCommaSafeSettingsNativeFixture
          ? ({
              1: 30000,
              2: 600,
              3: 500,
              4: 30000,
              5: 2500,
              6: 30000,
            })[demoProcessRequests] ?? 30000
          : null;
        const delay = commandCommaDelay ?? (args[0]?.verificationApproved
          ? 500
          : isCommandCommaSafeSettingsNativeFixture && demoProcessRequests === 2
            ? 600
            : (
              demoProcessCode === 'slow'
              || (demoProcessCode === 'second-slow' && demoProcessRequests > 1)
              || demoCancelCode === 'once'
            ) ? 30000 : 2600);
        const pending = {
          resolve,
          timer: null,
          requestNumber: demoProcessRequests,
        };
        pending.timer = window.setTimeout(() => {
          if (demoCommandCommaProcessPending === pending) {
            demoCommandCommaProcessPending = null;
          }
          if (isCommandCommaSafeSettingsNativeFixture && pending.requestNumber === 5) {
            recordCommandCommaEvent('process-5-failed');
            resolve({
              success: false,
              ...DEMO_PROCESS_FAILURES['service-unavailable'],
            });
            return;
          }
          const demoFailure = DEMO_PROCESS_FAILURES[demoProcessFailureScenario];
          if (demoFailure && (demoProcessFailureIsPersistent || demoProcessFailuresRemaining > 0)) {
            demoProcessFailuresRemaining = Math.max(0, demoProcessFailuresRemaining - 1);
            resolve({
              success: false,
              ...demoFailure,
            });
            return;
          }
          const translationOnly = demoSettings.activeBackend === 'free_translate';
          const processingLocation = processingLocationForSettings(demoSettings);
          if (isCommandCommaSafeSettingsNativeFixture) {
            recordCommandCommaEvent(`process-${pending.requestNumber}-succeeded`);
          }
          resolve({
            success: true,
            brief: translationOnly ? PREVIEW_TRANSLATION_BRIEF : {
              ...PREVIEW_ACTION_BRIEF,
              analysisProvenance: {
                ...PREVIEW_ACTION_BRIEF.analysisProvenance,
                provider: demoSettings.activeBackend,
                model: demoSettings.activeModel,
                processingLocation,
              },
            },
            verificationSummary: {
              policy: 'ask',
              fetchAttempted: false,
              requestedCount: translationOnly ? 0 : 1,
              verifiedCount: 0,
              ...(translationOnly ? {} : { approvalId: 'a'.repeat(64) }),
            },
            processingLocation,
            processingTimeMs: translationOnly ? 1800 : 6800,
          });
        }, delay);
        if (isCommandCommaSafeSettingsNativeFixture) {
          demoCommandCommaProcessPending = pending;
        }
      });
    case IPC_CHANNELS.VERIFICATION_RUN:
      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          demoVerificationPending = null;
          if (demoVerificationCode === 'failed') {
            resolve({
              success: false,
              errorCode: 'verification-failed',
              error: '官方来源核验失败，请稍后重试。',
              retryApprovalId: 'a'.repeat(64),
            });
            return;
          }
          const submittedBrief = args[0]?.brief || PREVIEW_ACTION_BRIEF;
          const retrievedBrief = {
            ...submittedBrief,
            verifications: submittedBrief.verifications.map((verification, index) => (index === 0 ? {
              ...verification,
              status: 'retrieved',
              retrievals: [{
                url: 'https://www.gov.uk/view-prove-immigration-status',
                publisher: 'GOV.UK',
                retrievedAt: '2026-07-23T09:00:00.000Z',
                excerpt: 'Use this service to view and prove your immigration status and get a share code.',
              }],
            } : verification)),
          };
          resolve({
            success: true,
            brief: retrievedBrief,
            verificationSummary: {
              policy: 'ask',
              fetchAttempted: true,
              requestedCount: 1,
              verifiedCount: 0,
              approvalId: 'a'.repeat(64),
            },
            retryApprovalId: 'a'.repeat(64),
            processingTimeMs: demoVerificationCode === 'slow' ? 30000 : 520,
          });
        }, demoVerificationCode === 'slow' ? 30000 : 500);
        demoVerificationPending = { resolve, timer };
      });
    default:
      return Promise.resolve(null);
  }
}

export function useIpc() {
  const invoke = useCallback((channel, ...args) => {
    if (isCommandQSafeExitNativeFixture) {
      if (channel === IPC_CHANNELS.APP_QUIT_LISTENER_READY) {
        return window.slipstreamUiFixtureQuit.listenerReady();
      }
      if (channel === IPC_CHANNELS.APP_SESSION_RISK_UPDATE) {
        return window.slipstreamUiFixtureQuit.updateRisk(args[0]);
      }
      if (channel === IPC_CHANNELS.APP_QUIT_DECISION) {
        return window.slipstreamUiFixtureQuit.decide(args[0]);
      }
    }
    if (isCommandCommaSafeSettingsNativeFixture) {
      if (channel === IPC_CHANNELS.APP_SETTINGS_LISTENER_READY) {
        return window.slipstreamUiFixtureSettingsMenu.listenerReady();
      }
      if (channel === IPC_CHANNELS.APP_SETTINGS_REQUEST_HANDLED) {
        return window.slipstreamUiFixtureSettingsMenu.handled(args[0]);
      }
    }
    if (isNativeUiFixture && isDemo) return invokeDemo(channel, ...args);
    if (window.api?.invoke) return window.api.invoke(channel, ...args);
    if (isDemo) return invokeDemo(channel, ...args);
    return Promise.reject(new Error('Electron IPC is unavailable outside the app.'));
  }, []);

  const on = useCallback((channel, callback) => {
    if (isCommandQSafeExitNativeFixture && channel === IPC_CHANNELS.APP_QUIT_REQUESTED) {
      return window.slipstreamUiFixtureQuit.onRequested(callback);
    }
    if (
      isCommandCommaSafeSettingsNativeFixture
      && channel === IPC_CHANNELS.APP_SETTINGS_REQUESTED
    ) {
      return window.slipstreamUiFixtureSettingsMenu.onRequested(callback);
    }
    if (!isNativeUiFixture && window.api?.on) return window.api.on(channel, callback);
    if (isDemo && channel === IPC_CHANNELS.SHORTCUT_STATUS_CHANGED) {
      const timer = window.setTimeout(() => callback({
        ...demoShortcutStatus,
        clipboard: { ...demoShortcutStatus.clipboard },
        screenshot: { ...demoShortcutStatus.screenshot },
      }), 0);
      return () => window.clearTimeout(timer);
    }
    if (
      isDemo
      && channel === IPC_CHANNELS.CLIPBOARD_TEXT_CHANGED
      && demoActiveCaptureEventsCode
      && demoActiveCaptureEventsCode !== 'verification-screenshot'
      && demoActiveCaptureEventsCode !== 'settings-screenshot'
      && demoActiveCaptureEventsCode !== 'foreground-screenshot'
      && demoActiveCaptureEventsCode !== 'setup-screenshot'
      && demoActiveCaptureEventsCode !== 'reply-screenshot'
      && demoActiveCaptureEventsCode !== 'fixture-screenshot'
    ) {
      const eventPlan = demoActiveCaptureEventsCode === 'source-edit-transition'
        ? [{ delay: 450, text: DEMO_MONITOR_SOURCE_TEXT }]
        : demoActiveCaptureEventsCode === 'setup-clipboard'
          ? [{ delay: 450, text: DEMO_MONITOR_WAITING_TEXT }]
        : demoActiveCaptureEventsCode === 'setup-empty'
          ? [{ delay: 450, text: '', error: 'clipboard-empty' }]
          : demoActiveCaptureEventsCode === 'reply-clipboard'
            ? [
                { delay: 15000, text: DEMO_MONITOR_WAITING_TEXT },
                { delay: 16000, text: `${DEMO_MONITOR_WAITING_TEXT} Reply with the reference number.` },
              ]
          : demoActiveCaptureEventsCode === 'settings-clipboard'
        ? [{ delay: 2600, text: DEMO_MONITOR_WAITING_TEXT }]
        : demoActiveCaptureEventsCode === 'settings-clipboard-error'
          ? [{ delay: 2600, text: '', error: 'clipboard-empty' }]
          : demoActiveCaptureEventsCode === 'foreground-clipboard'
            ? [{ delay: 20000, text: DEMO_MONITOR_WAITING_TEXT }]
        : [
            { delay: 450, text: DEMO_MONITOR_SOURCE_TEXT },
            ...(demoActiveCaptureEventsCode === 'clipboard'
              ? [{ delay: 1450, text: DEMO_MONITOR_WAITING_TEXT }]
              : []),
          ];
      const timers = eventPlan.map(({ delay, text, error }) => window.setTimeout(() => callback({
        text,
        error,
        truncated: false,
        originalLength: text.length,
        source: 'shortcut',
      }), delay));
      return () => timers.forEach((timer) => window.clearTimeout(timer));
    }
    if (
      isDemo
      && channel === IPC_CHANNELS.SCREENSHOT_REQUESTED
      && ['screenshot', 'verification-screenshot', 'settings-screenshot', 'foreground-screenshot', 'setup-screenshot', 'reply-screenshot']
        .includes(demoActiveCaptureEventsCode)
    ) {
      const timer = window.setTimeout(
        () => callback({ source: 'shortcut' }),
        demoActiveCaptureEventsCode === 'verification-screenshot'
          ? 5000
          : demoActiveCaptureEventsCode === 'settings-screenshot'
            ? 2600
            : demoActiveCaptureEventsCode === 'foreground-screenshot'
              ? 3000
              : demoActiveCaptureEventsCode === 'reply-screenshot'
                ? 15000
              : demoActiveCaptureEventsCode === 'setup-screenshot' ? 450 : 1450,
      );
      return () => window.clearTimeout(timer);
    }
    if (
      isDemo
      && channel === IPC_CHANNELS.SCREENSHOT_REQUESTED
      && demoRunCode === 'settings-stylesheet-collision-native'
      && demoActiveCaptureEventsCode === 'fixture-screenshot'
    ) {
      const requestFixtureScreenshot = () => {
        demoScreenshotShortcutEvents += 1;
        exposeDemoRequestCounters();
        callback({ source: 'shortcut' });
      };
      window.addEventListener('slipstream:fixture-screenshot-request', requestFixtureScreenshot);
      return () => {
        window.removeEventListener('slipstream:fixture-screenshot-request', requestFixtureScreenshot);
      };
    }
    if (isDemo && channel === IPC_CHANNELS.CLIPBOARD_TEXT_CHANGED && demoClipboardMonitorEventsCode) {
      const eventPlan = demoClipboardMonitorEventsCode === 'after-result'
        ? [
            { delay: 450, text: DEMO_MONITOR_SOURCE_TEXT },
            { delay: 4700, text: DEMO_MONITOR_WAITING_TEXT },
          ]
        : [
            { delay: 450, text: DEMO_MONITOR_SOURCE_TEXT },
            { delay: 1450, text: DEMO_MONITOR_WAITING_TEXT },
          ];
      const timers = eventPlan.map(({ delay, text }) => window.setTimeout(() => callback({
        text,
        truncated: false,
        originalLength: text.length,
        source: 'monitor',
      }), delay));
      return () => timers.forEach((timer) => window.clearTimeout(timer));
    }
    if (isDemo && channel === IPC_CHANNELS.APP_QUIT_REQUESTED && demoQuitDelay) {
      demoQuitListener = callback;
      if (demoQuitDelay === 'reset' || demoQuitDelay === 'clipboard-clear') {
        return () => {
          if (demoQuitListener === callback) demoQuitListener = null;
          if (demoQuitTimer !== null) {
            window.clearTimeout(demoQuitTimer);
            demoQuitTimer = null;
            if (demoQuitDelay === 'reset') demoResetQuitScheduled = false;
          }
        };
      }
      if (demoQuitDelay === 'fixture') {
        const requestFixtureQuit = () => emitDemoQuitRequest('fixture');
        window.addEventListener('slipstream:fixture-quit-request', requestFixtureQuit);
        return () => {
          window.removeEventListener('slipstream:fixture-quit-request', requestFixtureQuit);
          if (demoQuitListener === callback) demoQuitListener = null;
        };
      }
      const requestedDelay = Number.parseInt(demoQuitDelay, 10);
      const delay = Number.isFinite(requestedDelay)
        ? Math.min(Math.max(requestedDelay, 250), 30000)
        : 1200;
      demoQuitTimer = window.setTimeout(() => {
        demoQuitTimer = null;
        emitDemoQuitRequest('timer');
      }, delay);
      return () => {
        if (demoQuitListener === callback) demoQuitListener = null;
        if (demoQuitTimer !== null) {
          window.clearTimeout(demoQuitTimer);
          demoQuitTimer = null;
        }
      };
    }
    if (isDemo) return () => {};
    return () => {};
  }, []);

  return { invoke, on };
}
