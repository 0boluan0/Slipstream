const { DEFAULTS, LANGUAGES, LLM_BACKENDS } = require('../shared/constants.cjs');
const net = require('net');

const BACKENDS = new Set(Object.values(LLM_BACKENDS));
const LANGUAGE_HINTS = new Set(Object.values(LANGUAGES));
const BOOLEAN_SETTINGS = new Set(['startMinimized', 'clipboardMonitoring', 'privacyNoticeSeen']);
const SECRET_SETTINGS = new Set(['anthropicApiKey', 'openaiApiKey', 'deepseekApiKey', 'customEndpointApiKey']);
const TEXT_SETTINGS = new Set(['activeModel', 'customPrompt', 'clipboardShortcut', 'screenshotShortcut']);
const URL_SETTINGS = new Set(['ollamaBaseUrl', 'customEndpointUrl']);
const NUMBER_SETTINGS = new Set(['windowWidth', 'windowHeight', 'windowX', 'windowY']);
const VERIFICATION_POLICIES = new Set(['local-only', 'ask', 'official-auto']);
const RESULT_ORDERS = new Set(['action-first', 'translation-first']);

function validateShortcut(value) {
  const shortcut = value.trim();
  if (!shortcut || shortcut.length > 100 || /(^|\+)\s*($|\+)/.test(shortcut)) {
    throw new Error('请输入有效的快捷键');
  }
  return shortcut;
}

function validateEndpointUrl(value) {
  if (value === '') return value;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('请输入有效的服务地址');
  }
  const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
    throw new Error('远程服务地址必须使用 HTTPS');
  }
  return value.replace(/\/$/, '');
}

function validateSetting(key, value) {
  if (BOOLEAN_SETTINGS.has(key)) {
    if (typeof value !== 'boolean') throw new Error('设置值类型错误');
  } else if (SECRET_SETTINGS.has(key)) {
    if (typeof value !== 'string' || value.length > 20000) throw new Error('凭据格式错误');
  } else if (URL_SETTINGS.has(key)) {
    if (typeof value !== 'string' || value.length > 2048) throw new Error('服务地址格式错误');
    value = validateEndpointUrl(value.trim());
  } else if (TEXT_SETTINGS.has(key)) {
    if (typeof value !== 'string' || value.length > 20000) throw new Error('设置文本过长');
    if (key === 'clipboardShortcut' || key === 'screenshotShortcut') value = validateShortcut(value);
  } else if (NUMBER_SETTINGS.has(key)) {
    if (value !== null && (!Number.isFinite(value) || Math.abs(value) > 100000)) throw new Error('设置数值无效');
  } else if (key === 'activeBackend') {
    if (!BACKENDS.has(value)) throw new Error('不支持的模型后端');
  } else if (key === 'languageHint') {
    if (!LANGUAGE_HINTS.has(value)) throw new Error('不支持的语言方向');
  } else if (key === 'verificationPolicy') {
    if (!VERIFICATION_POLICIES.has(value)) throw new Error('不支持的联网核验策略');
  } else if (key === 'resultOrder') {
    if (!RESULT_ORDERS.has(value)) throw new Error('不支持的结果排列方式');
  } else {
    throw new Error(`不允许修改设置：${key}`);
  }
  return [key, value];
}

function validateProcessOptions(options) {
  if (!options || typeof options.text !== 'string' || !options.text.trim()) {
    throw new Error('请输入要处理的文字');
  }
  if (options.text.length > DEFAULTS.MAX_TEXT_LENGTH) {
    throw new Error(`文本不能超过 ${DEFAULTS.MAX_TEXT_LENGTH} 个字符`);
  }
  const source = ['manual', 'monitor', 'shortcut', 'ocr'].includes(options.source) ? options.source : 'manual';
  const capture = normalizeCaptureMetadata(options.capture);
  const verificationApproved = options.verificationApproved === true;
  return { text: options.text, source, capture, verificationApproved };
}

function normalizeCaptureMetadata(capture) {
  if (!capture || typeof capture !== 'object') return null;
  const confidence = Number.isFinite(capture.confidence)
    ? Math.min(Math.max(capture.confidence, 0), 1)
    : null;
  const blocks = Array.isArray(capture.blocks)
    ? capture.blocks.slice(0, 500).map((block, index) => {
      const text = typeof block?.text === 'string' ? block.text.slice(0, 2000) : '';
      const rawBox = block?.boundingBox || block?.bbox;
      const bbox = Array.isArray(rawBox)
        ? rawBox.slice(0, 4).map((value) => Number.isFinite(value) ? value : 0)
        : rawBox && typeof rawBox === 'object'
          ? ['x', 'y', 'w', 'h'].map((key) => Number.isFinite(rawBox[key]) ? rawBox[key] : 0)
          : null;
      const blockConfidence = Number.isFinite(block?.confidence)
        ? Math.min(Math.max(block.confidence, 0), 1)
        : null;
      return { id: `ocr-${index + 1}`, text, bbox, confidence: blockConfidence };
    }).filter((block) => block.text)
    : [];
  return { confidence, blocks };
}

function isPrivateHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!normalized || normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) return true;
  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) {
    const [a, b] = normalized.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (ipVersion === 6) {
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') ||
      normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
      normalized.startsWith('fea') || normalized.startsWith('feb');
  }
  return false;
}

function validateExternalUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('链接无效');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('链接无效');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || isPrivateHostname(parsed.hostname)) {
    throw new Error('只能打开安全的公开 HTTPS 链接');
  }
  return parsed.toString();
}

function isTrustedRendererUrl(url, isDev) {
  try {
    const parsed = new URL(url);
    if (isDev) {
      return parsed.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(parsed.hostname) &&
        parsed.port === '5173';
    }
    return parsed.protocol === 'file:' && parsed.pathname.endsWith('/dist/renderer/index.html');
  } catch {
    return false;
  }
}

module.exports = {
  isTrustedRendererUrl,
  validateEndpointUrl,
  validateProcessOptions,
  validateExternalUrl,
  validateSetting,
  validateShortcut,
};
