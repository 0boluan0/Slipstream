import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  APP_TOP_LAYER_SELECTOR,
  hasActiveAppTopLayer,
  shouldHandleBackgroundEscape,
} from '../src/renderer/utils/modalOwnership.mjs';

const rootWithoutTopLayer = { querySelector: () => null };
const rootWithTopLayer = {
  querySelector: (selector) => selector === APP_TOP_LAYER_SELECTOR ? { dataset: { appTopLayer: 'quit' } } : null,
};

assert.equal(hasActiveAppTopLayer(rootWithoutTopLayer), false);
assert.equal(hasActiveAppTopLayer(rootWithTopLayer), true);
assert.equal(shouldHandleBackgroundEscape({ key: 'Escape' }, rootWithoutTopLayer), true);
assert.equal(shouldHandleBackgroundEscape({ key: 'Escape' }, rootWithTopLayer), false,
  'a background layer must yield Escape while an app-level decision is open');
assert.equal(shouldHandleBackgroundEscape({ key: 'Escape', defaultPrevented: true }, rootWithoutTopLayer), false);
assert.equal(shouldHandleBackgroundEscape({ key: 'Enter' }, rootWithoutTopLayer), false);

const appQuitSource = fs.readFileSync(
  new URL('../src/renderer/components/AppQuitDialog.jsx', import.meta.url),
  'utf8',
);
const appSource = fs.readFileSync(new URL('../src/renderer/App.jsx', import.meta.url), 'utf8');
const settingsSource = fs.readFileSync(
  new URL('../src/renderer/components/SettingsPanel.jsx', import.meta.url),
  'utf8',
);
const resetDialogSource = fs.readFileSync(
  new URL('../src/renderer/components/SettingsResetDialog.jsx', import.meta.url),
  'utf8',
);
const apiKeySource = fs.readFileSync(
  new URL('../src/renderer/components/ApiKeyInput.jsx', import.meta.url),
  'utf8',
);
const credentialRemovalSource = fs.readFileSync(
  new URL('../src/renderer/components/CredentialRemovalDialog.jsx', import.meta.url),
  'utf8',
);
const settingsTransitionSource = fs.readFileSync(
  new URL('../src/renderer/components/SettingsTransitionDialog.jsx', import.meta.url),
  'utf8',
);
const savedTermsSource = fs.readFileSync(
  new URL('../src/renderer/components/SavedTermsLibrary.jsx', import.meta.url),
  'utf8',
);
const lazyRecoverySource = fs.readFileSync(
  new URL('../src/renderer/components/LazyWorkspaceRecovery.jsx', import.meta.url),
  'utf8',
);
const startupRecoverySource = fs.readFileSync(
  new URL('../src/renderer/components/StartupRecovery.jsx', import.meta.url),
  'utf8',
);

assert.match(appQuitSource, /data-app-top-layer="quit"/,
  'the app quit decision must announce that it owns the app-level top layer');
assert.match(appQuitSource, /window\.addEventListener\('keydown', handleKeyDown, true\)/,
  'the top layer must own Escape even before focus moves into its dialog');
assert.match(appQuitSource, /event\.key === 'Escape'[\s\S]*?event\.stopImmediatePropagation\(\)/,
  'the top layer must consume Escape before it reaches another close handler');
assert.match(appQuitSource, /previousFocusRef\.current = document\.activeElement[\s\S]*?document\.contains\(previousFocus\)/,
  'closing the top layer must restore the exact surviving focus target');
assert.match(appQuitSource, /const previousInert = hiddenSiblings\.map[\s\S]*?node\.inert = previousInert\[index\]/,
  'closing the top layer must restore pre-existing inert state instead of always clearing it');
assert.match(settingsSource, /ref=\{settingsReturnButtonRef\}[\s\S]*?data-quit-return-focus/,
  'Settings must expose a stable safe fallback if its exact prior focus target no longer exists');
assert.match(appSource, /<SettingsPanel[\s\S]*?appDecisionBlocked=\{Boolean\(quitRequestId\)\}/,
  'Settings must know when an app-level decision owns the interaction surface');
assert.match(settingsSource, /captureRequestHandledRef\.current === captureRequest\.id[\s\S]*?\|\| appDecisionBlocked[\s\S]*?captureRequestHandledRef\.current = captureRequest\.id/,
  'shortcut captures must stay queued instead of changing the background behind an app decision');
assert.match(settingsSource, /resetInProgress: isResetting[\s\S]*?hasResetRecovery: Boolean\(resetError\)/,
  'a full data reset and its failed recovery must remain distinct quit-blocking states');
assert.match(resetDialogSource, /if \(hasActiveAppTopLayer\(document\)\) return;[\s\S]*?event\.key === 'Escape'/,
  'the reset dialog must yield both Escape and Tab before changing its background state');

const settingsOwnershipGuards = settingsSource.match(/shouldHandleBackgroundEscape\(event\)/g) || [];
assert.equal(settingsOwnershipGuards.length, 1,
  'only the Settings background close handler should use background Escape ownership');
assert.doesNotMatch(settingsSource, /handleRemovalEscape/,
  'translation credential removal must not retain its obsolete competing Escape handler');
assert.doesNotMatch(apiKeySource, /handleDeleteEscape|shouldHandleBackgroundEscape/,
  'direct credential removal must delegate keyboard ownership to the shared modal');
assert.match(
  credentialRemovalSource,
  /if \(!\['Escape', 'Tab'\]\.includes\(event\.key\)\) return;\s*if \(hasActiveAppTopLayer\(document\)\) return;/,
  'the shared credential modal must yield both Escape and Tab to the app top layer',
);
assert.match(
  settingsTransitionSource,
  /if \(!\['Escape', 'Tab'\]\.includes\(event\.key\)\) return;\s*if \(hasActiveAppTopLayer\(document\)\) return;/,
  'draft and connection transitions must yield both Escape and Tab to the app top layer',
);
assert.match(settingsTransitionSource, /window\.addEventListener\('focusin', handleFocusIn, true\)/,
  'draft and connection transitions must contain programmatic focus without competing with AppQuit');
assert.match(savedTermsSource,
  /const handleDialogKeyDown = \(event\) => \{\s*if \(topLayerOwnsInteraction\(\)\) return;[\s\S]*?event\.key === 'Escape'/,
  'the loaded Saved Terms drawer must yield Escape before changing its own modal state');
assert.match(lazyRecoverySource,
  /const handleKeyDown = \(event\) => \{\s*if \(topLayerOwnsInteraction\(\)\) return;[\s\S]*?event\.key === 'Escape'/,
  'Saved Terms loading and recovery must yield Escape before closing the background drawer');
assert.match(startupRecoverySource,
  /if \(!shouldHandleBackgroundEscape\(event\)\) return;[\s\S]*?event\.stopImmediatePropagation\(\)[\s\S]*?cancelRecoveryConfirmation\(\)/,
  'startup recovery must preserve its destructive confirmation beneath the app top layer');
for (const [name, source] of [
  ['loaded Saved Terms', savedTermsSource],
  ['Saved Terms loading/recovery', lazyRecoverySource],
]) {
  assert.match(source,
    /topLayerWasPresent[\s\S]*?MutationObserver[\s\S]*?attributeFilter: \['data-app-top-layer'\][\s\S]*?requestAnimationFrame/,
    `${name} must reacquire focus after the app-level top layer leaves`);
}

console.log('Modal ownership checks passed.');
