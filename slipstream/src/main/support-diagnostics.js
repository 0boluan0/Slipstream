const { displayShortcutAccelerator } = require('../shared/shortcut-accelerator.cjs');
const { DEFAULTS } = require('../shared/constants.cjs');
const {
  PROCESSING_LOCATION_KINDS,
  processingLocationForSettings,
} = require('../shared/endpoint-location.cjs');
const { describeBuildIdentity } = require('./build-identity');

const ALLOWED_SCREEN_RECORDING_STATUSES = new Set([
  'granted',
  'denied',
  'restricted',
  'not-determined',
  'unknown',
]);

const MODE_LABELS = Object.freeze({
  full: '完整分析',
  'translation-only': '基础翻译',
  unconfigured: '尚未完成配置',
});

const BACKEND_LABELS = Object.freeze({
  free_translate: '基础翻译 · Google / MyMemory',
  ollama: '本机 · Ollama',
  anthropic: '在线 · Anthropic',
  openai: '在线 · OpenAI',
  deepseek: '在线 · DeepSeek',
});

const CUSTOM_BACKEND_LABELS = Object.freeze({
  [PROCESSING_LOCATION_KINDS.LOCAL_LOOPBACK]: '本机兼容服务 · 回环',
  [PROCESSING_LOCATION_KINDS.ONLINE]: '在线 · 自定义服务',
  [PROCESSING_LOCATION_KINDS.UNKNOWN]: '位置未确认 · 自定义服务',
});

const SCREEN_RECORDING_LABELS = Object.freeze({
  granted: '已允许',
  denied: '未允许',
  restricted: '受系统限制',
  'not-determined': '尚未决定',
  unknown: '无法确认',
});

const VERIFICATION_LABELS = Object.freeze({
  ask: '每次询问',
  'official-auto': '自动查找',
  'local-only': '仅本地',
});

const MODEL_MARKER_MAX_LENGTH = 80;
const MODEL_MARKER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._+:/-]*[A-Za-z0-9])?$/u;
const MODEL_MARKER_SENSITIVE_PATTERN = /(?:^|[._+:/-])(?:api[-_.]?key|authorization|bearer|credential|password|secret|token)(?:$|[._+:/-])|^(?:sk|pk|rk|xox[baprs]|gh[pousr]|glpat|AIza)[-_]/iu;
const MODEL_MARKER_ADDRESS_PATTERN = /(?:[a-z][a-z\d+.-]*:\/\/|www\.|localhost|(?:\d{1,3}\.){3}\d{1,3}|(?:^|\/)[A-Za-z\d-]+(?:\.[A-Za-z\d-]+)*\.[A-Za-z]{2,}(?=[:/]|$))/iu;
const MODEL_MARKER_OPAQUE_PATTERN = /[A-Za-z\d_]{32,}/u;
const REDACTED_MODEL_LABEL = '模型名称未披露';

function safeText(value, fallback, maxChars = 100) {
  if (typeof value !== 'string') return fallback;
  const normalized = [...value]
    .map((character) => {
      const code = character.codePointAt(0);
      return code < 32 || (code >= 127 && code <= 159) ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized ? normalized.slice(0, maxChars) : fallback;
}

function safeCount(value, max = 50) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, max) : 0;
}

function safeModelMarker(value) {
  if (typeof value !== 'string') return null;
  const marker = value.trim();
  if (
    !marker
    || marker.length > MODEL_MARKER_MAX_LENGTH
    || !MODEL_MARKER_PATTERN.test(marker)
    || MODEL_MARKER_SENSITIVE_PATTERN.test(marker)
    || MODEL_MARKER_ADDRESS_PATTERN.test(marker)
    || MODEL_MARKER_OPAQUE_PATTERN.test(marker)
  ) {
    return null;
  }
  return marker;
}

function describeAnalysisBackend(settings, backend) {
  const processingLocation = processingLocationForSettings({
    ...settings,
    activeBackend: backend,
  });
  if (backend === 'custom') {
    return {
      backendLabel: CUSTOM_BACKEND_LABELS[processingLocation],
      processingLocation,
    };
  }

  if (backend === 'ollama') {
    return {
      backendLabel: processingLocation === PROCESSING_LOCATION_KINDS.LOCAL
        ? BACKEND_LABELS.ollama
        : '位置未确认 · Ollama',
      processingLocation,
    };
  }

  return {
    backendLabel: BACKEND_LABELS[backend],
    processingLocation,
  };
}

function createSupportDiagnostics(input = {}) {
  const settings = input.settings && typeof input.settings === 'object' ? input.settings : {};
  const appVersion = safeText(input.appVersion, '未知', 40);
  const systemVersion = safeText(input.systemVersion, '未知', 80);
  const arch = ['arm64', 'x64'].includes(input.arch) ? input.arch : 'unknown';
  const architectureLabel = arch === 'arm64'
    ? 'Apple 芯片（arm64）'
    : arch === 'x64'
      ? 'Intel（x64）'
      : '未知架构';
  const screenRecordingStatus = ALLOWED_SCREEN_RECORDING_STATUSES.has(input.screenRecordingStatus)
    ? input.screenRecordingStatus
    : 'unknown';
  const setupMode = Object.hasOwn(MODE_LABELS, settings.setupMode) ? settings.setupMode : 'unconfigured';
  const backend = settings.activeBackend === 'custom' || Object.hasOwn(BACKEND_LABELS, settings.activeBackend)
    ? settings.activeBackend
    : 'free_translate';
  const suppliedModel = typeof settings.activeModel === 'string' && settings.activeModel.trim();
  const model = safeModelMarker(settings.activeModel)
    || (suppliedModel ? REDACTED_MODEL_LABEL : '未选择');
  const verificationPolicy = Object.hasOwn(VERIFICATION_LABELS, settings.verificationPolicy)
    ? settings.verificationPolicy
    : 'ask';
  const clipboardShortcut = safeText(settings.clipboardShortcut, DEFAULTS.CLIPBOARD_SHORTCUT, 40);
  const screenshotShortcut = safeText(settings.screenshotShortcut, DEFAULTS.SCREENSHOT_SHORTCUT, 40);
  const shortcutRegistrationStatus = input.shortcutRegistrationStatus
    && typeof input.shortcutRegistrationStatus === 'object'
    ? input.shortcutRegistrationStatus
    : {};
  const clipboardRegistered = typeof shortcutRegistrationStatus.clipboard?.registered === 'boolean'
    ? shortcutRegistrationStatus.clipboard.registered
    : null;
  const screenshotRegistered = typeof shortcutRegistrationStatus.screenshot?.registered === 'boolean'
    ? shortcutRegistrationStatus.screenshot.registered
    : null;
  const savedTermCount = safeCount(input.savedTermCount);
  const generatedAt = typeof input.generatedAt === 'string' && !Number.isNaN(Date.parse(input.generatedAt))
    ? new Date(input.generatedAt).toISOString()
    : new Date().toISOString();
  const buildDescription = describeBuildIdentity(input.buildIdentity);
  const buildKind = buildDescription.label;
  const { backendLabel, processingLocation } = describeAnalysisBackend(settings, backend);
  const analysisLabel = `${backendLabel}${model !== '未选择' ? ` · ${model}` : ''}`;

  const diagnostics = {
    appVersion,
    buildIdentity: buildDescription.identity,
    buildKind,
    buildTrust: buildDescription.detail,
    isPublicDistribution: buildDescription.isPublicDistribution,
    system: {
      name: 'macOS',
      version: systemVersion,
      arch,
      architectureLabel,
    },
    screenRecording: {
      status: screenRecordingStatus,
      label: SCREEN_RECORDING_LABELS[screenRecordingStatus],
    },
    mode: {
      value: setupMode,
      label: MODE_LABELS[setupMode],
    },
    analysis: {
      backend,
      label: analysisLabel,
      model,
      processingLocation,
    },
    clipboardMonitoring: Boolean(settings.clipboardMonitoring),
    verification: {
      value: verificationPolicy,
      label: VERIFICATION_LABELS[verificationPolicy],
    },
    shortcuts: {
      clipboard: clipboardShortcut,
      screenshot: screenshotShortcut,
      clipboardRegistered,
      screenshotRegistered,
    },
    savedTermCount,
    generatedAt,
    privacy: {
      includesCredentials: false,
      includesServiceAddresses: false,
      includesSourceText: false,
      includesTermContent: false,
      includesClipboardContent: false,
      automaticallySent: false,
    },
  };

  diagnostics.summaryText = [
    `Slipstream ${appVersion}`,
    `构建：${buildKind}`,
    `构建信任：${buildDescription.detail}`,
    `系统：macOS ${systemVersion} · ${architectureLabel}`,
    `功能模式：${diagnostics.mode.label}`,
    `分析方式：${analysisLabel}`,
    `屏幕录制权限：${diagnostics.screenRecording.label}`,
    `剪贴板自动检测：${diagnostics.clipboardMonitoring ? '开启' : '关闭'}`,
    `官方来源核验：${diagnostics.verification.label}`,
    `快捷键：剪贴板 ${displayShortcutAccelerator(clipboardShortcut)}（${clipboardRegistered === true ? '已启用' : clipboardRegistered === false ? '不可用' : '未确认'}） · 截图 ${displayShortcutAccelerator(screenshotShortcut)}（${screenshotRegistered === true ? '已启用' : screenshotRegistered === false ? '不可用' : '未确认'}）`,
    `已保存术语：${savedTermCount} 条（不包含术语内容）`,
    `生成时间：${generatedAt}`,
    '隐私边界：不包含 API Key、服务地址、原文、术语内容或剪贴板内容；不会自动发送。',
  ].join('\n');

  return diagnostics;
}

module.exports = {
  createSupportDiagnostics,
};
