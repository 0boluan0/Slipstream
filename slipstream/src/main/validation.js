const { DEFAULTS, LANGUAGES, LLM_BACKENDS } = require('../shared/constants.cjs');
const net = require('net');
const { assertSafeHostname } = require('./verification/url-safety');

const BACKENDS = new Set(Object.values(LLM_BACKENDS));
const LANGUAGE_HINTS = new Set(Object.values(LANGUAGES));
const BOOLEAN_SETTINGS = new Set(['startMinimized', 'clipboardMonitoring', 'privacyNoticeSeen']);
const SECRET_SETTINGS = new Set(['anthropicApiKey', 'openaiApiKey', 'deepseekApiKey', 'customEndpointApiKey']);
const TEXT_SETTINGS = new Set(['activeModel', 'customPrompt', 'clipboardShortcut', 'screenshotShortcut']);
const URL_SETTINGS = new Set(['ollamaBaseUrl', 'customEndpointUrl']);
const NUMBER_SETTINGS = new Set(['windowWidth', 'windowHeight', 'windowX', 'windowY']);
const VERIFICATION_POLICIES = new Set(['local-only', 'ask', 'official-auto']);
const RESULT_ORDERS = new Set(['action-first', 'translation-first']);
const SETUP_MODES = new Set(['unconfigured', 'full', 'translation-only']);

function validateShortcut(value) {
  const shortcut = value.trim();
  if (!shortcut || shortcut.length > 100 || /(^|\+)\s*($|\+)/.test(shortcut)) {
    throw new Error('请输入有效的快捷键');
  }
  return shortcut;
}

function validateEndpointUrl(value) {
  if (value === '') return value;
  if (typeof value !== 'string') throw new Error('请输入有效的服务地址');
  const candidate = value.trim();
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('请输入有效的服务地址');
  }
  if (parsed.username || parsed.password || candidate.includes('?') || candidate.includes('#')) {
    throw new Error('服务地址不能包含凭据、查询参数或片段');
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  if (parsed.protocol === 'http:') {
    if (!isLoopback) throw new Error('远程服务地址必须使用 HTTPS');
    if (hostname === 'localhost') parsed.hostname = '127.0.0.1';
  } else if (parsed.protocol === 'https:') {
    if (parsed.port || net.isIP(hostname.replace(/^\[|\]$/g, ''))) {
      throw new Error('HTTPS 服务必须使用公开域名和默认端口');
    }
    try {
      assertSafeHostname(hostname);
    } catch {
      throw new Error('HTTPS 服务必须使用公开域名和默认端口');
    }
  } else {
    throw new Error('远程服务地址必须使用 HTTPS');
  }

  const pathname = parsed.pathname === '/'
    ? ''
    : parsed.pathname.replace(/\/+$/, '');
  if (/\/(?:models|chat\/completions|api\/(?:tags|generate))$/i.test(pathname)) {
    throw new Error('请输入服务根地址，不要填写具体的模型或生成接口');
  }
  return `${parsed.origin}${pathname}`;
}

function validateProviderConnectionTestOptions(options) {
  if (options === undefined) return {};
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).length) {
    throw new Error('连接测试不接受内容或连接参数');
  }
  return {};
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
    if (!LANGUAGE_HINTS.has(value) || value !== 'en') throw new Error('当前版本仅支持英文到中文');
  } else if (key === 'setupMode') {
    if (!SETUP_MODES.has(value)) throw new Error('不支持的功能模式');
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
  const truncated = options.truncated === true;
  const requestedOriginalLength = Number.isSafeInteger(options.originalLength)
    ? options.originalLength
    : options.text.length;
  const originalLength = Math.max(options.text.length, requestedOriginalLength);
  if (truncated && originalLength <= options.text.length) {
    throw new Error('截断文本必须提供大于保留长度的原始长度');
  }
  return { text: options.text, source, capture, truncated, originalLength, verificationApproved };
}

function validateVerificationOptions(options) {
  if (!options || typeof options.sourceText !== 'string' || !options.sourceText.trim()) {
    throw new Error('缺少待核验结果对应的原文');
  }
  if (options.sourceText.length > DEFAULTS.MAX_TEXT_LENGTH) {
    throw new Error(`核验原文不能超过 ${DEFAULTS.MAX_TEXT_LENGTH} 个字符`);
  }
  if (!/^[a-f0-9]{64}$/.test(options.approvalId || '')) {
    throw new Error('官方核验批准标识无效');
  }
  if (!options.brief || typeof options.brief !== 'object' || Array.isArray(options.brief)) {
    throw new Error('缺少待核验的结构化结果');
  }
  let serialized;
  try {
    serialized = JSON.stringify(options.brief);
  } catch {
    throw new Error('待核验结果无法序列化');
  }
  if (!serialized || serialized.length > 1_000_000) {
    throw new Error('待核验结果超出大小限制');
  }
  return {
    sourceText: options.sourceText,
    brief: JSON.parse(serialized),
    approvalId: options.approvalId,
  };
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
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== '443') ||
    !parsed.hostname.includes('.') ||
    isPrivateHostname(parsed.hostname)
  ) {
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
  validateProviderConnectionTestOptions,
  validateVerificationOptions,
  validateExternalUrl,
  validateSetting,
  validateShortcut,
};
