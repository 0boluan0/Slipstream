import shortcutAccelerator from '../../shared/shortcut-accelerator.mjs';
import constants from '../../shared/constants.js';

const { displayShortcutAccelerator } = shortcutAccelerator;
const { DEFAULTS } = constants;

const SHORTCUT_KINDS = Object.freeze(['clipboard', 'screenshot']);

const SHORTCUT_DEFAULTS = Object.freeze({
  clipboard: DEFAULTS.CLIPBOARD_SHORTCUT,
  screenshot: DEFAULTS.SCREENSHOT_SHORTCUT,
});

const SHORTCUT_LABELS = Object.freeze({
  clipboard: '剪贴板解释',
  screenshot: '截图 OCR',
});

function safeAccelerator(value, fallback) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 40)
    : fallback;
}

export function isBareFunctionKeyShortcut(value) {
  return /^F(?:[1-9]|1\d|2[0-4])$/i.test(String(value || '').trim());
}

export function normalizeShortcutStatus(payload, settings = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const normalized = {};
  for (const kind of SHORTCUT_KINDS) {
    const item = source[kind] && typeof source[kind] === 'object' ? source[kind] : {};
    const settingKey = kind === 'clipboard' ? 'clipboardShortcut' : 'screenshotShortcut';
    normalized[kind] = {
      accelerator: safeAccelerator(
        item.accelerator,
        safeAccelerator(settings[settingKey], SHORTCUT_DEFAULTS[kind]),
      ),
      registered: typeof item.registered === 'boolean' ? item.registered : null,
      reason: ['conflict', 'invalid', 'reserved'].includes(item.reason) ? item.reason : null,
    };
  }
  normalized.allRegistered = SHORTCUT_KINDS.every((kind) => (
    normalized[kind].registered === true
  ));
  normalized.hasKnownFailure = SHORTCUT_KINDS.some((kind) => (
    normalized[kind].registered === false
  ));
  normalized.hasUsabilityCaution = SHORTCUT_KINDS.some((kind) => (
    isBareFunctionKeyShortcut(normalized[kind].accelerator)
  ));
  return normalized;
}

export function shortcutStatusForKind(status, kind) {
  const item = status?.[kind] || {};
  const registered = typeof item.registered === 'boolean' ? item.registered : null;
  const accelerator = safeAccelerator(item.accelerator, SHORTCUT_DEFAULTS[kind]);
  const displayAccelerator = displayShortcutAccelerator(accelerator);
  const reason = ['conflict', 'invalid', 'reserved'].includes(item.reason) ? item.reason : null;
  const requiresFunctionModifier = isBareFunctionKeyShortcut(accelerator);
  const recommendedAccelerator = SHORTCUT_DEFAULTS[kind];
  const recommendedDisplay = displayShortcutAccelerator(recommendedAccelerator);
  return {
    kind,
    label: SHORTCUT_LABELS[kind],
    accelerator,
    displayAccelerator,
    registered,
    reason,
    requiresFunctionModifier,
    recommendedAccelerator,
    state: registered === true
      ? requiresFunctionModifier ? 'caution' : 'ready'
      : registered === false ? 'unavailable' : 'checking',
    title: registered === true
      ? requiresFunctionModifier
        ? `${displayAccelerator} 已启用，可能需要 Fn/Globe`
        : `${displayAccelerator} 已启用`
      : registered === false
        ? reason === 'reserved'
          ? `${displayAccelerator} 已保留用于安全退出`
          : reason === 'invalid'
            ? `${displayAccelerator} 格式无效`
            : `${displayAccelerator} 暂时不可用`
        : `正在确认 ${displayAccelerator}`,
    detail: registered === true
      ? requiresFunctionModifier
        ? `多数 Apple 键盘需按住 Fn/Globe 再按 ${displayAccelerator}。建议改用 ${recommendedDisplay}，无需依赖功能键模式。`
        : `macOS 已注册${SHORTCUT_LABELS[kind]}快捷键。`
      : registered === false
        ? reason === 'reserved'
          ? 'Command+Q 专门用于经过风险确认的安全退出；请为捕获功能选择其他组合。'
          : reason === 'invalid'
            ? '这个组合不是可用的 macOS 快捷键；界面里的对应按钮仍然可用。'
            : '可能与其他应用或 macOS 的全局快捷键冲突；界面里的对应按钮仍然可用。'
        : '正在读取 macOS 的实际注册结果。',
  };
}

export function describeShortcutReadiness(status) {
  const unavailable = SHORTCUT_KINDS
    .map((kind) => shortcutStatusForKind(status, kind))
    .filter((item) => item.registered === false);
  if (unavailable.length === 0) {
    const cautions = SHORTCUT_KINDS
      .map((kind) => shortcutStatusForKind(status, kind))
      .filter((item) => item.requiresFunctionModifier && item.registered === true);
    if (cautions.length === 0) return null;
    const accelerators = cautions.map((item) => item.displayAccelerator).join('、');
    return {
      title: `${accelerators} 在 Apple 键盘上可能需要 Fn/Globe`,
      detail: '快捷键已注册，但多数 Apple 键盘不会把顶排按键直接作为功能键发送。可在设置中改为推荐组合。',
      unavailable: [],
      cautions,
    };
  }
  const accelerators = unavailable.map((item) => item.displayAccelerator).join('、');
  const hasReserved = unavailable.some((item) => item.reason === 'reserved');
  const hasInvalid = unavailable.some((item) => item.reason === 'invalid');
  return {
    title: unavailable.length === 2
      ? '两个全局快捷键暂时不可用'
      : `${unavailable[0].label}快捷键暂时不可用`,
    detail: hasReserved
      ? 'Command+Q 专门用于经过风险确认的安全退出。请在设置中为捕获功能选择其他组合；界面按钮仍然可用。'
      : hasInvalid
        ? `${accelerators} 不是可用的快捷键格式。你仍可使用界面里的读取剪贴板和框选截图按钮。`
        : `${accelerators} 没有在 macOS 注册，可能已被其他应用或系统占用。你仍可使用界面里的读取剪贴板和框选截图按钮。`,
    unavailable,
  };
}

export function shortcutFailureCode(error) {
  const message = String(error?.code || error?.message || '');
  if (message.includes('shortcut-restore-failed')) return 'shortcut-restore-failed';
  if (message.includes('shortcut-duplicate')) return 'shortcut-duplicate';
  if (message.includes('shortcut-invalid')) return 'shortcut-invalid';
  if (message.includes('shortcut-conflict')) return 'shortcut-conflict';
  return null;
}
