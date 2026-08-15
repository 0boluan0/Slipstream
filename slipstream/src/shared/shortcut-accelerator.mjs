// ESM mirror for the renderer; the main process uses the matching .cjs module.
const MODIFIER_ORDER = Object.freeze(['Command', 'Control', 'Alt', 'Shift']);
const MODIFIER_ALIASES = Object.freeze({
  alt: 'Alt',
  option: 'Alt',
  command: 'Command',
  cmd: 'Command',
  meta: 'Command',
  super: 'Command',
  commandorcontrol: 'Command',
  cmdorctrl: 'Command',
  control: 'Control',
  ctrl: 'Control',
  shift: 'Shift',
});
const KEY_ALIASES = Object.freeze({
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  arrowup: 'Up',
  backspace: 'Backspace',
  delete: 'Delete',
  down: 'Down',
  end: 'End',
  enter: 'Enter',
  escape: 'Escape',
  home: 'Home',
  insert: 'Insert',
  left: 'Left',
  pagedown: 'PageDown',
  pageup: 'PageUp',
  return: 'Enter',
  right: 'Right',
  space: 'Space',
  tab: 'Tab',
  up: 'Up',
});
const KEYBOARD_CODE_KEYS = Object.freeze({
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  Backspace: 'Backspace',
  Delete: 'Delete',
  End: 'End',
  Enter: 'Enter',
  Home: 'Home',
  Insert: 'Insert',
  PageDown: 'PageDown',
  PageUp: 'PageUp',
  Space: 'Space',
});
const MODIFIER_CODES = new Set([
  'AltLeft',
  'AltRight',
  'ControlLeft',
  'ControlRight',
  'MetaLeft',
  'MetaRight',
  'ShiftLeft',
  'ShiftRight',
]);

function normalizeKeyToken(token) {
  const text = String(token || '').trim();
  if (/^[a-z]$/i.test(text)) return text.toUpperCase();
  if (/^[0-9]$/.test(text)) return text;
  const functionMatch = /^f([1-9]|1\d|2[0-4])$/i.exec(text);
  if (functionMatch) return `F${functionMatch[1]}`;
  return KEY_ALIASES[text.toLowerCase()] || null;
}

export function analyzeShortcutAccelerator(value) {
  if (typeof value !== 'string') return { ok: false, reason: 'invalid-format' };
  const raw = value.trim();
  if (!raw || raw.length > 40) return { ok: false, reason: 'invalid-format' };
  const tokens = raw.split('+').map((token) => token.trim());
  if (tokens.some((token) => !token)) return { ok: false, reason: 'invalid-format' };

  const modifiers = new Set();
  let key = null;
  for (const token of tokens) {
    const modifier = MODIFIER_ALIASES[token.toLowerCase()];
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }
    const nextKey = normalizeKeyToken(token);
    if (!nextKey) return { ok: false, reason: 'unsupported-key' };
    if (key) return { ok: false, reason: 'multiple-keys' };
    key = nextKey;
  }

  if (!key) return { ok: false, reason: 'modifier-only' };
  const isFunctionKey = /^F(?:[1-9]|1\d|2[0-4])$/.test(key);
  const hasPrimaryModifier = ['Command', 'Control', 'Alt'].some((modifier) => modifiers.has(modifier));
  if (!isFunctionKey && !hasPrimaryModifier) return { ok: false, reason: 'unsafe-unmodified' };

  const orderedModifiers = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
  const accelerator = [...orderedModifiers, key].join('+');
  if (accelerator === 'Command+Q') {
    return { ok: false, reason: 'reserved-app-quit' };
  }
  return {
    ok: true,
    accelerator,
    key,
    modifiers: orderedModifiers,
  };
}

function keyboardKeyFromEvent(event) {
  const code = String(event?.code || '');
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(code)) return code;
  return KEYBOARD_CODE_KEYS[code] || normalizeKeyToken(event?.key);
}

export function acceleratorFromKeyboardEvent(event) {
  const code = String(event?.code || '');
  const key = String(event?.key || '');
  if (event?.isComposing || event?.repeat) return { ok: false, reason: 'ignored' };
  if (key === 'Escape') return { ok: false, reason: 'cancelled' };
  if (key === 'Tab') return { ok: false, reason: 'navigation' };
  if (MODIFIER_CODES.has(code) || ['Alt', 'Control', 'Meta', 'Shift'].includes(key)) {
    return { ok: false, reason: 'modifier-only', pending: true };
  }

  const capturedKey = keyboardKeyFromEvent(event);
  if (!capturedKey) return { ok: false, reason: 'unsupported-key' };
  const modifiers = [];
  if (event?.metaKey) modifiers.push('Command');
  if (event?.ctrlKey) modifiers.push('Control');
  if (event?.altKey) modifiers.push('Alt');
  if (event?.shiftKey) modifiers.push('Shift');
  return analyzeShortcutAccelerator([...modifiers, capturedKey].join('+'));
}

export function canonicalizeShortcutAccelerator(value) {
  const result = analyzeShortcutAccelerator(value);
  return result.ok ? result.accelerator : '';
}

export function shortcutDisplayParts(value) {
  const result = analyzeShortcutAccelerator(value);
  const source = result.ok ? result.accelerator : String(value || '').trim();
  return source.split('+').filter(Boolean).map((part) => part === 'Alt' ? 'Option' : part);
}

export function displayShortcutAccelerator(value) {
  return shortcutDisplayParts(value).join('+');
}

export function sameShortcutAccelerator(left, right) {
  const normalizedLeft = canonicalizeShortcutAccelerator(left);
  const normalizedRight = canonicalizeShortcutAccelerator(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export default {
  acceleratorFromKeyboardEvent,
  analyzeShortcutAccelerator,
  canonicalizeShortcutAccelerator,
  displayShortcutAccelerator,
  sameShortcutAccelerator,
  shortcutDisplayParts,
};
