import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dialogSource = fs.readFileSync(
  path.join(root, 'src/renderer/components/SettingsResetDialog.jsx'),
  'utf8',
);
const settingsSource = fs.readFileSync(
  path.join(root, 'src/renderer/components/SettingsPanel.jsx'),
  'utf8',
);
const stylesSource = fs.readFileSync(
  path.join(root, 'src/renderer/components/SettingsPanel.css'),
  'utf8',
);

assert.match(settingsSource, /import SettingsResetDialog from '\.\/SettingsResetDialog'/);
assert.match(settingsSource, /ref=\{resetTriggerRef\}[\s\S]*?aria-expanded=\{confirmReset\}/,
  'the reset trigger must stay mounted while its separate dialog is open');
assert.match(settingsSource, /<\/div>\s*\{confirmReset && \(\s*<SettingsResetDialog/,
  'the reset backdrop must render as a direct Settings panel child, outside scroll content');
assert.doesNotMatch(settingsSource, /resetConfirmationRef|resetCancelButtonRef|settings-reset-confirmation/,
  'the obsolete inline reset alert and its focus effects must be removed');

assert.match(dialogSource, /role="alertdialog"/);
assert.match(dialogSource, /aria-modal="true"/);
assert.match(dialogSource, /tabIndex=\{-1\}/);
assert.match(dialogSource, /const siblingState =[\s\S]*?inert: node\.inert[\s\S]*?ariaHidden: node\.getAttribute\('aria-hidden'\)/,
  'the modal must snapshot exact sibling inert and aria-hidden state');
assert.match(dialogSource, /node\.inert = inert[\s\S]*?ariaHidden === null[\s\S]*?node\.setAttribute\('aria-hidden', ariaHidden\)/,
  'the modal must restore exact sibling state');

assert.match(dialogSource, /window\.addEventListener\('keydown', handleKeyDown, true\)/,
  'the reset dialog must own keyboard events from a stable window capture listener');
assert.match(dialogSource, /if \(!\['Escape', 'Tab'\]\.includes\(event\.key\)\) return;\s*if \(hasActiveAppTopLayer\(document\)\) return;/,
  'Escape and Tab must yield to the app-level top layer');
assert.match(dialogSource, /event\.key === 'Escape'[\s\S]*?stopImmediatePropagation\(\)[\s\S]*?if \(!busyRef\.current\) cancelRef\.current/,
  'Escape must be consumed while busy and close only while idle');
assert.match(dialogSource, /enabledButtons\.length === 0[\s\S]*?dialog\.focus/,
  'Tab with no enabled actions must keep focus on the dialog root');
assert.match(dialogSource, /!dialog\.contains\(activeElement\)[\s\S]*?event\.shiftKey \? last : first/,
  'Tab from outside the dialog must be brought back into the trap');
assert.match(dialogSource, /safeButtonRef\.current[\s\S]*?focus\(\{ preventScroll: true \}\)/,
  'initial focus must prefer the safe cancel action');

assert.match(dialogSource, /busyRef\.current = true;[\s\S]*?restoreFocusRef\.current = false;[\s\S]*?dialogRef\.current\?\.focus/,
  'the destructive action must synchronously lock busy state and focus the dialog root');
assert.match(dialogSource, /role="alert"\s*tabIndex=\{-1\}/,
  'reset failure copy must be a programmatically focusable alert');
assert.match(dialogSource, /const dangerAriaLabel =[\s\S]*?: error[\s\S]*?\? retryLabel[\s\S]*?aria-label=\{dangerAriaLabel\}/,
  'retry actions must expose the same recovery meaning in their accessible name');
assert.equal((dialogSource.match(/beginReset\('preserve'\)/g) || []).length, 1,
  'the dialog must expose exactly one destructive preserve-and-reset action');
assert.match(dialogSource, /保留系统剪贴板内容后清除全部应用内数据/,
  'the destructive accessible name must state that clipboard contents are retained');
assert.match(settingsSource, /preserveLabel="保留剪贴板内容后清除"/,
  'the visible destructive action must state preserve-only behavior');
assert.match(settingsSource,
  /\? '保留剪贴板内容后重试剩余清除'[\s\S]*?: '保留剪贴板内容后重试清除'/,
  'retry actions must keep the preserve-only decision explicit');
assert.match(settingsSource,
  /nextFullDataResetSessionCleared\([\s\S]*?setResetSessionAlreadyCleared\(nextSessionAlreadyCleared\)/,
  'the irreversible session-cleared phase must accumulate across retries');
const resetHandlerStart = settingsSource.indexOf('const handleReset = useCallback');
const resetHandlerEnd = settingsSource.indexOf('\n\n  const containerStyle', resetHandlerStart);
assert.doesNotMatch(
  settingsSource.slice(resetHandlerStart, resetHandlerEnd),
  /setResetSessionAlreadyCleared\(false\)[\s\S]*?try \{/,
  'starting a retry must not erase an earlier partial-clear phase',
);
assert.match(dialogSource, /确认保留剪贴板内容后清除全部应用内数据/,
  'the dialog title must not imply an automatic clipboard-clear path');
assert.match(dialogSource, /sessionAlreadyCleared[\s\S]*?正在重试剩余清除/,
  'busy retry copy must not claim the already-cleared session is being cleared again');
assert.doesNotMatch(dialogSource, /beginReset\('clear'\)|clearLabel|pendingMode|guardedClipboardChoice|residuePreserveOnly/,
  'the retired clipboard-clear decision must not remain in the dialog');
assert.match(dialogSource, /new MutationObserver[\s\S]*?data-app-top-layer[\s\S]*?disconnect\(\)/,
  'failure focus must wait for an overlapping app top layer to leave and clean up its observer');
assert.match(dialogSource, /thirdFrame[\s\S]*?hasActiveAppTopLayer\(document\)[\s\S]*?errorRef\.current\?\.focus/,
  'failure focus must settle after the app quit dialog completes its own focus restoration');

assert.match(dialogSource, /if \(!restoreFocusRef\.current\) return;[\s\S]*?requestAnimationFrame[\s\S]*?requestAnimationFrame/,
  'successful reset must skip Settings focus restoration and idle close must use double RAF');
assert.match(dialogSource, /previousFocusRef\.current = returnFocusRefRef\.current\?\.current \|\| document\.activeElement/,
  'the opener must be captured before its mounted trigger becomes disabled behind the modal');
assert.match(dialogSource, /canRestoreFocus\(previousFocus\)[\s\S]*?canRestoreFocus\(trigger\)[\s\S]*?canRestoreFocus\(fallback\)/,
  'idle close must restore the usable opener, then the mounted trigger, then Settings return');
assert.match(dialogSource, /className="settings-reset-backdrop"/);
assert.doesNotMatch(
  dialogSource.match(/<div ref=\{backdropRef\}[\s\S]*?>/)?.[0] || '',
  /onClick=/,
  'clicking the reset backdrop must not dismiss a destructive decision',
);

assert.match(stylesSource, /\.settings-reset-backdrop\s*\{[\s\S]*?z-index:\s*60;/,
  'the reset layer must sit above Settings content and below the app quit layer');
assert.match(stylesSource, /@media \(max-width: 620px\)[\s\S]*?\.settings-reset-dialog[\s\S]*?\.settings-reset-actions[\s\S]*?flex-direction: column/,
  'reset actions must become full-width stacked controls on narrow windows');

console.log('Settings reset dialog checks passed.');
