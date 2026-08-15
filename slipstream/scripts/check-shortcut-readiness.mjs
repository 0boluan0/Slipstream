import assert from 'node:assert/strict';
import fs from 'node:fs';
import shortcutAccelerator from '../src/shared/shortcut-accelerator.cjs';
import shortcutAcceleratorEsm from '../src/shared/shortcut-accelerator.mjs';
import constantsCjs from '../src/shared/constants.cjs';
import {
  describeShortcutReadiness,
  isBareFunctionKeyShortcut,
  normalizeShortcutStatus,
  shortcutFailureCode,
  shortcutStatusForKind,
} from '../src/renderer/utils/shortcutReadiness.mjs';

const {
  acceleratorFromKeyboardEvent,
  analyzeShortcutAccelerator,
  displayShortcutAccelerator,
  sameShortcutAccelerator,
} = shortcutAccelerator;
const { DEFAULTS } = constantsCjs;

assert.equal(DEFAULTS.CLIPBOARD_SHORTCUT, 'Alt+C');
assert.equal(DEFAULTS.SCREENSHOT_SHORTCUT, 'Alt+Shift+S');
assert.equal(isBareFunctionKeyShortcut(DEFAULTS.SCREENSHOT_SHORTCUT), false);
assert.match(DEFAULTS.SCREENSHOT_SHORTCUT, /(?:^|\+)(?:Alt|Command|Control)(?:\+|$)/);

assert.equal(analyzeShortcutAccelerator('Option+Shift+c').accelerator, 'Alt+Shift+C');
assert.equal(analyzeShortcutAccelerator('F24').accelerator, 'F24');
assert.equal(analyzeShortcutAccelerator('Option').reason, 'modifier-only');
assert.equal(analyzeShortcutAccelerator('C').reason, 'unsafe-unmodified');
assert.equal(analyzeShortcutAccelerator('F25').reason, 'unsupported-key');
assert.equal(analyzeShortcutAccelerator('Command+Q').reason, 'reserved-app-quit');
assert.equal(analyzeShortcutAccelerator('CommandOrControl+Q').reason, 'reserved-app-quit');
assert.equal(displayShortcutAccelerator('Alt+Shift+C'), 'Option+Shift+C');
assert.equal(sameShortcutAccelerator('Option+C', 'Alt+C'), true);
assert.equal(acceleratorFromKeyboardEvent({
  code: 'KeyC',
  key: 'c',
  altKey: true,
}).accelerator, 'Alt+C');
assert.equal(acceleratorFromKeyboardEvent({ code: 'F2', key: 'F2' }).accelerator, 'F2');
assert.equal(acceleratorFromKeyboardEvent({ code: 'KeyC', key: 'c' }).reason, 'unsafe-unmodified');
assert.equal(acceleratorFromKeyboardEvent({ code: 'AltLeft', key: 'Alt', altKey: true }).reason, 'modifier-only');
assert.equal(acceleratorFromKeyboardEvent({ code: 'Escape', key: 'Escape' }).reason, 'cancelled');
assert.equal(acceleratorFromKeyboardEvent({
  code: 'KeyQ',
  key: 'q',
  metaKey: true,
}).reason, 'reserved-app-quit');

for (const value of [
  'Option+Shift+c',
  'Command+1',
  'Command+Q',
  'CommandOrControl+Q',
  'F24',
  'Option',
  'C',
  'F25',
  'Alt+Left',
]) {
  assert.deepEqual(
    shortcutAcceleratorEsm.analyzeShortcutAccelerator(value),
    analyzeShortcutAccelerator(value),
    `renderer and main accelerator rules diverged for ${value}`,
  );
  assert.equal(
    shortcutAcceleratorEsm.displayShortcutAccelerator(value),
    displayShortcutAccelerator(value),
    `renderer and main shortcut labels diverged for ${value}`,
  );
}

const healthy = normalizeShortcutStatus({
  allRegistered: true,
  clipboard: { accelerator: DEFAULTS.CLIPBOARD_SHORTCUT, registered: true },
  screenshot: { accelerator: DEFAULTS.SCREENSHOT_SHORTCUT, registered: true },
});
assert.equal(healthy.allRegistered, true);
assert.equal(healthy.hasKnownFailure, false);
assert.equal(describeShortcutReadiness(healthy), null);
assert.equal(shortcutStatusForKind(healthy, 'clipboard').title, 'Option+C 已启用');

const legacyFunctionKey = normalizeShortcutStatus({
  allRegistered: true,
  clipboard: { accelerator: DEFAULTS.CLIPBOARD_SHORTCUT, registered: true },
  screenshot: { accelerator: 'F2', registered: true },
});
const legacyScreenshot = shortcutStatusForKind(legacyFunctionKey, 'screenshot');
assert.equal(legacyScreenshot.accelerator, 'F2');
assert.equal(legacyScreenshot.registered, true);
assert.equal(legacyScreenshot.requiresFunctionModifier, true);
assert.equal(legacyScreenshot.recommendedAccelerator, DEFAULTS.SCREENSHOT_SHORTCUT);
assert.match(legacyScreenshot.title, /Fn\/Globe/);
assert.match(legacyScreenshot.detail, /多数 Apple 键盘/);
assert.match(describeShortcutReadiness(legacyFunctionKey).detail, /推荐组合/);

const clipboardConflict = normalizeShortcutStatus({
  allRegistered: false,
  clipboard: { accelerator: 'Alt+C', registered: false },
  screenshot: { accelerator: 'F2', registered: true },
});
assert.equal(clipboardConflict.allRegistered, false);
assert.equal(clipboardConflict.hasKnownFailure, true);
assert.match(describeShortcutReadiness(clipboardConflict).title, /剪贴板解释/);
assert.match(describeShortcutReadiness(clipboardConflict).detail, /你仍可使用界面里的读取剪贴板和框选截图按钮/);
assert.equal(shortcutFailureCode(new Error('shortcut-conflict:clipboardShortcut')), 'shortcut-conflict');
assert.equal(shortcutFailureCode(new Error('shortcut-duplicate:screenshotShortcut')), 'shortcut-duplicate');
assert.equal(shortcutFailureCode(new Error('shortcut-invalid:modifier-only')), 'shortcut-invalid');
assert.equal(shortcutFailureCode({ code: 'shortcut-restore-failed' }), 'shortcut-restore-failed');
assert.equal(shortcutFailureCode(new Error('settings-save-failed')), null);

const reservedQuitShortcut = normalizeShortcutStatus({
  allRegistered: false,
  clipboard: { accelerator: 'Command+Q', registered: false, reason: 'reserved' },
  screenshot: { accelerator: DEFAULTS.SCREENSHOT_SHORTCUT, registered: true },
});
assert.match(shortcutStatusForKind(reservedQuitShortcut, 'clipboard').title, /安全退出/u);
assert.match(shortcutStatusForKind(reservedQuitShortcut, 'clipboard').detail, /Command\+Q/u);
assert.match(describeShortcutReadiness(reservedQuitShortcut).detail, /安全退出/u);

const unknown = normalizeShortcutStatus(null, {
  clipboardShortcut: 'Alt+Shift+C',
  screenshotShortcut: 'F3',
});
assert.equal(unknown.clipboard.registered, null);
assert.equal(unknown.clipboard.accelerator, 'Alt+Shift+C');
assert.equal(shortcutStatusForKind(unknown, 'screenshot').state, 'checking');

const constants = fs.readFileSync(new URL('../src/shared/constants.cjs', import.meta.url), 'utf8');
const rendererConstants = fs.readFileSync(new URL('../src/shared/constants.js', import.meta.url), 'utf8');
const preload = fs.readFileSync(new URL('../preload.js', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../src/main/main.js', import.meta.url), 'utf8');
const settingsHook = fs.readFileSync(new URL('../src/renderer/hooks/useSettings.js', import.meta.url), 'utf8');
const settingsPanel = fs.readFileSync(new URL('../src/renderer/components/SettingsPanel.jsx', import.meta.url), 'utf8');
const floatingPanel = fs.readFileSync(new URL('../src/renderer/components/FloatingPanel.jsx', import.meta.url), 'utf8');
const diagnostics = fs.readFileSync(new URL('../src/main/support-diagnostics.js', import.meta.url), 'utf8');

assert.match(constants, /shortcut:status-get/);
assert.match(constants, /shortcut:status-changed/);
assert.match(rendererConstants, /CLIPBOARD_SHORTCUT:\s*'Alt\+C'/);
assert.match(rendererConstants, /SCREENSHOT_SHORTCUT:\s*'Alt\+Shift\+S'/);
assert.match(preload, /shortcut:status-get/);
assert.match(preload, /shortcut:status-changed/);
assert.match(main, /registerConfiguredShortcuts/);
assert.match(main, /candidateStatus\.allRegistered/);
assert.match(main, /shortcut-conflict/);
assert.match(main, /shortcut-duplicate/);
assert.match(main, /shortcut-restore-failed/);
assert.match(main, /SHORTCUT_STATUS_CHANGED/);
assert.match(main, /shortcutRegistrationStatus/);
assert.match(settingsHook, /refreshShortcutStatus/);
assert.match(settingsHook, /shortcutFailureCode\(error\)/);
assert.match(settingsPanel, /直接按下新组合/);
assert.match(settingsPanel, /acceleratorFromKeyboardEvent\(event\)/);
assert.match(settingsPanel, /请按下不同组合/);
assert.match(settingsPanel, /aria-pressed=/);
assert.match(settingsPanel, /重新尝试/);
assert.match(settingsPanel, /改为推荐组合/);
assert.match(settingsPanel, /'screenshotShortcut',\s*DEFAULTS\.SCREENSHOT_SHORTCUT/);
assert.match(settingsPanel, /多数 Apple 键盘需同时按 Fn\/Globe/);
assert.match(settingsPanel, /Command\+Q 专门用于经过风险确认的安全退出/);
assert.doesNotMatch(settingsPanel, /F1–F24 可单独使用/);
assert.match(settingsPanel, /可能已被其他应用或 macOS 占用/);
assert.match(settingsPanel, /aria-describedby="shortcut-recorder-instructions clipboard-shortcut-status"/);
assert.doesNotMatch(settingsPanel, /onChange=\{\(e\) => \{\s*setShortcutDrafts/);
assert.match(floatingPanel, /describeShortcutReadiness\(shortcutStatus\)/);
assert.match(floatingPanel, /修改快捷键/);
assert.match(diagnostics, /clipboardRegistered/);
assert.match(diagnostics, /不可用/);

const store = fs.readFileSync(new URL('../src/main/store.js', import.meta.url), 'utf8');
const globalShortcut = fs.readFileSync(new URL('../src/main/global-shortcut.js', import.meta.url), 'utf8');
const rendererIpc = fs.readFileSync(new URL('../src/renderer/hooks/useIpc.js', import.meta.url), 'utf8');
assert.match(store, /default: DEFAULTS\.SCREENSHOT_SHORTCUT/);
assert.match(globalShortcut, /settings\.screenshotShortcut \|\| DEFAULTS\.SCREENSHOT_SHORTCUT/);
assert.match(rendererIpc, /screenshotShortcut: DEFAULTS\.SCREENSHOT_SHORTCUT/);
assert.match(diagnostics, /settings\.screenshotShortcut, DEFAULTS\.SCREENSHOT_SHORTCUT/);

console.log('Shortcut readiness checks passed.');
