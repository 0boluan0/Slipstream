import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readProjectFile = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const dialogSource = readProjectFile('src/renderer/components/CredentialRemovalDialog.jsx');
const settingsSource = readProjectFile('src/renderer/components/SettingsPanel.jsx');
const apiKeySource = readProjectFile('src/renderer/components/ApiKeyInput.jsx');
const stylesSource = readProjectFile('src/renderer/components/SettingsPanel.css');
const ipcSource = readProjectFile('src/renderer/hooks/useIpc.js');
const packageJson = JSON.parse(readProjectFile('package.json'));

assert.match(settingsSource, /import CredentialRemovalDialog from '\.\/CredentialRemovalDialog'/);
assert.match(apiKeySource, /import CredentialRemovalDialog from '\.\/CredentialRemovalDialog'/);
assert.match(
  settingsSource,
  /<\/div>\s*\{confirmReset[\s\S]*?\n[ ]{6}\{confirmCredentialRemoval && \(\s*<CredentialRemovalDialog/,
  'translation-fallback removal must render as a direct Settings panel child, outside scroll content',
);
assert.match(apiKeySource, /createPortal\([\s\S]*?<CredentialRemovalDialog/,
  'direct saved-key deletion must use the shared removal dialog');
assert.match(apiKeySource, /closest\('\.settings-panel'\)/,
  'the direct-delete portal must target the Settings panel rather than escaping its modal boundary');
assert.doesNotMatch(apiKeySource, /setting-delete-confirmation|role="group"[^>]*确认删除/,
  'the obsolete inline direct-delete confirmation must be removed');
assert.doesNotMatch(settingsSource, /translation-fallback__remove-confirmation/,
  'the obsolete inline delete-and-switch confirmation must be removed');
assert.match(dialogSource, /id: providedId[\s\S]*?const dialogId = providedId \|\|/,
  'dialog triggers must be able to reference the rendered alertdialog with aria-controls');
assert.match(apiKeySource, /aria-controls=\{confirmDelete \? deleteDialogId : undefined\}/);
assert.match(settingsSource, /aria-controls=\{confirmCredentialRemoval[\s\S]*?translation-fallback-credential-removal-dialog/);
assert.match(apiKeySource, /error=\{deleteError\}[\s\S]*?onConfirm=\{handleDelete\}[\s\S]*?returnFocusRef=\{deleteTriggerRef\}/,
  'direct deletion must retain its failure in the modal and return idle dismissal to its exact trigger');
assert.match(
  apiKeySource,
  /const handleDelete = async[\s\S]*?setConfirmDelete\(false\)[\s\S]*?requestAnimationFrame[\s\S]*?requestAnimationFrame[\s\S]*?inputRef\.current\?\.focus[\s\S]*?return true;[\s\S]*?setDeleteError[\s\S]*?return false;/,
  'direct deletion must return an explicit transaction result and focus the surviving input only after success',
);
assert.match(
  settingsSource,
  /<CredentialRemovalDialog[\s\S]*?confirmLabel="删除凭据并继续"[\s\S]*?onConfirm=\{\(\) => \{[\s\S]*?requestTranslationFallback\(true,[\s\S]*?return true;[\s\S]*?returnFocusRef=\{translationFallbackRemoveRef\}/,
  'delete-and-switch must use the same modal and retain the exact initiating control for safe cancellation',
);
assert.match(apiKeySource, /onDeleteFailureDismiss,/,
  'the credential editor must accept a scoped recovery-discard callback');
assert.match(
  apiKeySource,
  /onCancel=\{\(\) => \{[\s\S]*?if \(isDeleting\) return;\s*if \(deleteError\) onDeleteFailureDismiss\?\.\(\);\s*setDeleteError\(''\);\s*setConfirmDelete\(false\);/,
  'cancel and Escape after failure must discard queued writes before clearing and closing the dialog',
);
assert.match(
  settingsSource,
  /onDelete=\{\(\) => handleCredentialDelete\(\s*CREDENTIAL_SETTING_BY_BACKEND\[settings\.activeBackend\],[\s\S]*?onDeleteFailureDismiss=\{\(\) => discardFailedSettings\(\[\s*'setupMode',\s*CREDENTIAL_SETTING_BY_BACKEND\[settings\.activeBackend\],[\s\S]*?\.filter\(Boolean\)\)\}/,
  'the primary editor must discard only its paused mode and matching credential recovery writes',
);
assert.match(
  settingsSource,
  /onDelete=\{\(\) => handleCredentialDelete\('customEndpointApiKey'\)\}\s*onDeleteFailureDismiss=\{\(\) => discardFailedSettings\(\[\s*'setupMode',\s*'customEndpointApiKey',\s*\]\)\}/,
  'the custom API-key editor must discard only its own failed deletion transaction',
);

assert.match(
  ipcSource,
  /const demoCredentialDeleteCode = import\.meta\.env\.DEV[\s\S]*?get\('credentialDelete'\)/,
  'the browser fixture must expose credentialDelete=once|slow|fail scenarios',
);
assert.match(ipcSource, /demoCredentialDeleteFailuresRemaining = demoCredentialDeleteCode === 'once' \? 1 : 0/);
assert.match(
  ipcSource,
  /const credentialDeletion = \[\s*'anthropicApiKey',\s*'openaiApiKey',\s*'deepseekApiKey',\s*'customEndpointApiKey',\s*\]\.includes\(key\) && value === ''/,
  'only exact blank writes to secret credential settings may count as fixture deletions',
);
assert.match(
  ipcSource,
  /if \(credentialDeletion\) \{\s*demoCredentialDeleteRequests \+= 1;\s*exposeDemoRequestCounters\(\);[\s\S]*?demoCredentialDeleteCode === 'fail' \|\| demoCredentialDeleteFailuresRemaining > 0[\s\S]*?Promise\.reject\(new Error\('Previewed credential deletion failure'\)\)/,
  'once/fail must reject the credential write itself after recording the attempt',
);
assert.match(
  ipcSource,
  /if \(demoCredentialDeleteCode === 'slow'\) \{[\s\S]*?window\.setTimeout\(\(\) => \{\s*demoSettings = \{[\s\S]*?\[key\]: value,[\s\S]*?\};\s*demoCredentialDeleteSuccesses \+= 1;[\s\S]*?\}, 3000\)/,
  'slow must delay only the credential write and count success after persistence',
);
const credentialSuccessIncrements = ipcSource.match(/demoCredentialDeleteSuccesses \+= 1/g) || [];
assert.equal(credentialSuccessIncrements.length, 3,
  'every normal or slow settings persistence path must have one credential-success counter');
assert.match(
  ipcSource,
  /demoSettings = \{[\s\S]*?\[key\]: value,[\s\S]*?\};\s*if \(deepseekCredentialWrite\) \{[\s\S]*?\}\s*if \(credentialDeletion\) \{\s*demoCredentialDeleteSuccesses \+= 1;/,
  'ordinary fixture success must be recorded only after the settings value persists',
);
assert.match(
  ipcSource,
  /dataset\.demoCredentialDeleteRequests = String\(demoCredentialDeleteRequests\)[\s\S]*?dataset\.demoCredentialDeleteSuccesses = String\(demoCredentialDeleteSuccesses\)/,
  'browser-visible datasets must distinguish deletion attempts from persisted successes',
);

assert.match(dialogSource, /role="alertdialog"/);
assert.match(dialogSource, /aria-modal="true"/);
assert.match(dialogSource, /aria-busy=\{busy\}/);
assert.match(dialogSource, /aria-errormessage=\{error \? errorId : undefined\}/);
assert.match(dialogSource, /tabIndex=\{-1\}/);
assert.match(
  dialogSource,
  /const siblingState =[\s\S]*?inert: node\.inert[\s\S]*?ariaHidden: node\.getAttribute\('aria-hidden'\)/,
  'the dialog must snapshot every sibling\'s exact inert and aria-hidden state',
);
assert.match(
  dialogSource,
  /node\.inert = inert[\s\S]*?ariaHidden === null[\s\S]*?node\.setAttribute\('aria-hidden', ariaHidden\)/,
  'closing the dialog must restore exact sibling state',
);

assert.match(dialogSource, /window\.addEventListener\('keydown', handleKeyDown, true\)/,
  'Tab and Escape must be owned from a stable capture-phase listener');
assert.match(dialogSource, /window\.addEventListener\('focusin', handleFocusIn, true\)/,
  'programmatic focus must not escape into the isolated Settings background');
assert.match(
  dialogSource,
  /if \(!\['Escape', 'Tab'\]\.includes\(event\.key\)\) return;\s*if \(hasActiveAppTopLayer\(document\)\) return;/,
  'both dialog keys must yield while the app-level top layer owns interaction',
);
assert.match(
  dialogSource,
  /event\.key === 'Escape'[\s\S]*?event\.stopImmediatePropagation\(\)[\s\S]*?if \(!busyRef\.current\) cancelRef\.current/,
  'Escape must be consumed while busy and cancel only while idle',
);
assert.match(dialogSource, /enabledControls\.length === 0[\s\S]*?dialog\.focus/,
  'Tab with no enabled action must retain focus on the busy dialog root');
assert.match(
  dialogSource,
  /!dialog\.contains\(activeElement\)[\s\S]*?event\.shiftKey \? last : first[\s\S]*?activeElement === first[\s\S]*?last\.focus[\s\S]*?activeElement === last[\s\S]*?first\.focus/,
  'Tab must recover outside focus and wrap in both directions',
);
assert.match(
  dialogSource,
  /!dialog \|\| dialog\.contains\(event\.target\) \|\| hasActiveAppTopLayer\(document\)[\s\S]*?focusInsideDialog\(false\)/,
  'focus containment must also yield to the app-level top layer',
);
assert.match(
  dialogSource,
  /const target = busyRef\.current \? dialog : safeButtonRef\.current;\s*target\?\.focus\(\{ preventScroll: true \}\)/,
  'initial focus must prefer the safe action and use the dialog root only while busy',
);

assert.match(
  dialogSource,
  /const beginConfirmation = \(\) => \{\s*if \(busyRef\.current\) return;[\s\S]*?busyRef\.current = true;[\s\S]*?restoreFocusRef\.current = false;[\s\S]*?dialogRef\.current\?\.focus/,
  'the destructive action must synchronously lock re-entry, dismissal, and focus before React commits',
);
assert.match(dialogSource, /onClick=\{beginConfirmation\}[\s\S]*?disabled=\{busy\}/,
  'the destructive control must use the synchronous lock and stay disabled while pending');
assert.match(dialogSource, /className="credential-removal-cancel"[\s\S]*?disabled=\{busy\}/,
  'the safe action must not dismiss an in-flight deletion');
assert.match(dialogSource, /role="alert"\s*tabIndex=\{-1\}/,
  'a failed deletion must expose a programmatically focusable alert');
assert.match(dialogSource, /new MutationObserver[\s\S]*?data-app-top-layer[\s\S]*?disconnect\(\)/,
  'failure focus must wait for an overlapping app top layer and clean up its observer');
assert.match(
  dialogSource,
  /thirdFrame[\s\S]*?hasActiveAppTopLayer\(document\)[\s\S]*?errorRef\.current\?\.focus/,
  'failure focus must settle on the recovery message after competing focus restoration',
);

assert.match(
  dialogSource,
  /previousFocusRef\.current = returnFocusRefRef\.current\?\.current \|\| document\.activeElement/,
  'the exact initiating control must be captured before isolation changes focusability',
);
assert.match(
  dialogSource,
  /if \(!restoreFocusRef\.current\) return;[\s\S]*?requestAnimationFrame[\s\S]*?requestAnimationFrame/,
  'idle close must wait for the settled render while successful navigation skips stale restoration',
);
assert.match(
  dialogSource,
  /canRestoreFocus\(previousFocus\)[\s\S]*?canRestoreFocus\(trigger\)[\s\S]*?canRestoreFocus\(fallback\)/,
  'return focus must prefer the exact surviving opener, then its live trigger, then a safe Settings return',
);
assert.match(dialogSource, /className="credential-removal-backdrop"/);
assert.doesNotMatch(
  dialogSource.match(/<div ref=\{backdropRef\}[\s\S]*?>/)?.[0] || '',
  /onClick=/,
  'clicking the backdrop must not dismiss a destructive decision',
);

assert.match(
  stylesSource,
  /\.credential-removal-backdrop\s*\{[\s\S]*?z-index:\s*55;/,
  'credential removal must sit above draft guards and below full reset and app quit layers',
);
assert.match(
  stylesSource,
  /@media \(max-width: 620px\)[\s\S]*?\.credential-removal-dialog[\s\S]*?\.credential-removal-actions[\s\S]*?flex-direction: column/,
  'credential-removal actions must stack inside the narrow Settings layout',
);
assert.match(
  stylesSource,
  /@media \(max-width: 620px\)[\s\S]*?\.credential-removal-actions[\s\S]*?button[\s\S]*?width:\s*100%/,
  'narrow credential-removal actions must remain full-width targets',
);

assert.equal(
  packageJson.scripts['check:credential-removal-dialog'],
  'node scripts/check-credential-removal-dialog.mjs',
);
assert.match(packageJson.scripts.test, /npm run check:credential-removal-dialog/,
  'the default test chain must run the credential-removal contract');

console.log('Credential removal dialog checks passed.');
