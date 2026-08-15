import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  connectionDraftKindsForRetriedSettings,
  credentialDraftAfterSavedStateChange,
  settingsExitOwner,
  settingsKeysForDiscardedConnectionDrafts,
  settingsKeysForDiscardedDrafts,
} from '../src/renderer/utils/settingsDraftGuard.mjs';
import {
  createFailedSaveOperation,
  removeFailedSaveOperationKeys,
} from '../src/renderer/utils/failedSettingsRetry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readProjectFile = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const dialogSource = readProjectFile('src/renderer/components/SettingsTransitionDialog.jsx');
const settingsSource = readProjectFile('src/renderer/components/SettingsPanel.jsx');
const apiKeySource = readProjectFile('src/renderer/components/ApiKeyInput.jsx');
const modelSource = readProjectFile('src/renderer/components/ModelSelector.jsx');
const promptSource = readProjectFile('src/renderer/components/PromptEditor.jsx');
const settingsHookSource = readProjectFile('src/renderer/hooks/useSettings.js');
const stylesSource = readProjectFile('src/renderer/components/SettingsPanel.css');
const fixtureMainSource = readProjectFile('scripts/ui-fixture-main.js');
const nativeRuntimeSource = readProjectFile('scripts/check-electron-ui-fixture-runtime.js');
const packageJson = JSON.parse(readProjectFile('package.json'));

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  return start >= 0 && end > start ? source.slice(start, end) : '';
}

// P1 regression contracts: these checks intentionally bind the user-visible
// transaction, not just the presence of the underlying state variables.
const promptSafetyContractFailures = [];
const fullEnableButtonSource = sourceBetween(
  settingsSource,
  'className="full-analysis-enable-button"',
  '</button>',
);
const fullModeDraftIntent = fullEnableButtonSource.match(
  /onClick=\{\(event\) => requestDraftExitIntent\(\{\s*kind: '([^']+)',\s*value: SETUP_MODES\.FULL,?\s*\}, event\.currentTarget\)\}/,
);
const performDraftExitSource = sourceBetween(
  settingsSource,
  'const performDraftExitIntent = useCallback',
  'const requestConnectionExitIntent = useCallback',
);
const escapedModeIntentKind = fullModeDraftIntent?.[1]
  ?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fullModeIntentHandled = Boolean(
  escapedModeIntentKind
  && new RegExp(
    `intent\\.kind === '${escapedModeIntentKind}'[\\s\\S]*?(?:activateMode|applyMode|completeMode)\\(intent\\.value`,
  ).test(performDraftExitSource),
);
if (!fullModeDraftIntent || !fullModeIntentHandled) {
  promptSafetyContractFailures.push(
    'full-analysis activation must enter requestDraftExitIntent with its opener and resume that exact mode only after the shared draft decision',
  );
}

const promptDraftHandler = settingsSource.match(
  /const (\w*[Pp]rompt\w*Draft\w*) = useCallback\(\(dirty\) => \{([\s\S]{0,900}?)\}\s*,\s*\[[^\]]*discardFailedSettings[^\]]*\]\)/,
);
const promptDraftHandlerBody = promptDraftHandler?.[2] || '';
const promptDraftHandlerOwnsState = /setHasUnsavedPromptDraft\(dirty\)/.test(promptDraftHandlerBody);
const promptDraftHandlerRevokesFailure = /if \(!dirty\)[\s\S]{0,180}?discardFailedSettings\(\['customPrompt'\]\)/
  .test(promptDraftHandlerBody);
const promptEditorUsesHandler = Boolean(
  promptDraftHandler?.[1]
  && new RegExp(`onDraftStateChange=\\{${promptDraftHandler[1]}\\}`).test(settingsSource),
);
if (!promptDraftHandlerOwnsState || !promptDraftHandlerRevokesFailure || !promptEditorUsesHandler) {
  promptSafetyContractFailures.push(
    'returning the prompt draft to its persisted value must revoke customPrompt from failedSaveOperation before any global retry can restore the abandoned value',
  );
}

const retryFocusSource = sourceBetween(
  settingsSource,
  "saveRetryReceipt?.status !== 'saved'",
  '}, [isRetryingSave, saveRetryReceipt, settingsSaving]);',
);
const openedPromptDetails = retryFocusSource.match(
  /(?:\.open\s*=\s*true|setAttribute\(['"]open['"])/g,
) || [];
if (
  !/promptRetry/.test(retryFocusSource)
  || !/secondary-settings__advanced/.test(retryFocusSource)
  || openedPromptDetails.length < 2
  || retryFocusSource.indexOf('secondary-settings__advanced')
    > retryFocusSource.indexOf("querySelector('#custom-prompt-input:not(:disabled)')")
) {
  promptSafetyContractFailures.push(
    'a successful prompt retry must open both enclosing details before focusing the textarea, so collapsed advanced settings cannot swallow focus',
  );
}

assert.deepEqual(
  promptSafetyContractFailures,
  [],
  'advanced-instructions drafts must remain recoverable across setup completion, revert, and retry focus',
);

assert.equal(settingsExitOwner(), 'perform');
assert.equal(settingsExitOwner({ hasUnsavedConnectionDraft: true }), 'draft');
assert.equal(settingsExitOwner({ hasUnsavedPromptDraft: true }), 'draft',
  'an advanced-instructions draft must own every Settings exit before navigation can continue');
assert.equal(settingsExitOwner({ isTestingConnection: true }), 'connection');
assert.equal(
  settingsExitOwner({ hasUnsavedConnectionDraft: true, isTestingConnection: true }),
  'draft',
  'a combined draft + validation state must resolve the draft before the network task',
);
assert.equal(
  settingsExitOwner({ hasUnsavedConnectionDraft: false, isTestingConnection: true }),
  'connection',
  'after resolving the draft, the same intent must re-enter the validation guard',
);

const retainedCustomKeyDraft = credentialDraftAfterSavedStateChange({
  backend: 'custom_api_key',
  previousBackend: 'custom_api_key',
  previousIsSaved: true,
  isSaved: false,
  draft: 'replacement-key-not-a-real-secret',
});
assert.deepEqual(retainedCustomKeyDraft, {
  savedCredentialRemoved: true,
  hasUnsavedReplacement: true,
}, 'revoking the old-origin credential must retain a visible replacement as unsaved');
assert.deepEqual(
  credentialDraftAfterSavedStateChange({
    backend: 'custom_api_key',
    previousBackend: 'custom_api_key',
    previousIsSaved: true,
    isSaved: false,
    draft: '   ',
  }),
  { savedCredentialRemoved: true, hasUnsavedReplacement: false },
  'an empty editor has no replacement draft to protect after authoritative removal',
);
assert.equal(
  credentialDraftAfterSavedStateChange({
    backend: 'custom_api_key',
    previousBackend: 'custom_api_key',
    previousIsSaved: false,
    isSaved: false,
    draft: 'replacement-key-not-a-real-secret',
  }).savedCredentialRemoved,
  false,
  'ordinary typing without an authoritative saved-state transition is not a removal event',
);

const customDraftsAfterEndpointSave = new Set(['primary', 'custom-key']);
customDraftsAfterEndpointSave.delete('primary');
if (retainedCustomKeyDraft.hasUnsavedReplacement) customDraftsAfterEndpointSave.add('custom-key');
for (const exitIntent of ['return', 'backend-switch', 'capture-shortcut']) {
  assert.equal(
    settingsExitOwner({ hasUnsavedConnectionDraft: customDraftsAfterEndpointSave.size > 0 }),
    'draft',
    `saving a new endpoint origin must still guard ${exitIntent} while its replacement key is visible`,
  );
}

assert.deepEqual(
  settingsKeysForDiscardedConnectionDrafts(['primary'], 'deepseek'),
  ['setupMode', 'deepseekApiKey'],
  'discarding a failed DeepSeek credential draft must revoke both its write and a preceding full-mode pause',
);
assert.deepEqual(
  settingsKeysForDiscardedConnectionDrafts(['primary', 'custom-key', 'model'], 'custom'),
  ['setupMode', 'customEndpointUrl', 'customEndpointApiKey', 'activeModel'],
  'every discarded custom-provider editor must revoke its own failed write',
);
assert.deepEqual(
  settingsKeysForDiscardedConnectionDrafts(['primary', 'model'], 'ollama'),
  ['setupMode', 'ollamaBaseUrl', 'activeModel'],
);
assert.deepEqual(
  settingsKeysForDiscardedConnectionDrafts([], 'deepseek'),
  [],
  'leaving Settings without an abandoned connection draft must not revoke unrelated failed saves',
);
assert.deepEqual(
  settingsKeysForDiscardedDrafts({
    connectionDraftKinds: [],
    backend: 'deepseek',
    hasPromptDraft: true,
  }),
  ['customPrompt'],
  'discarding only the prompt draft must revoke only its queued failed write',
);
assert.deepEqual(
  settingsKeysForDiscardedDrafts({
    connectionDraftKinds: ['primary'],
    backend: 'deepseek',
    hasPromptDraft: true,
  }),
  ['setupMode', 'deepseekApiKey', 'customPrompt'],
  'a combined discard must cover both connection and prompt persistence without duplicates',
);
assert.deepEqual(
  connectionDraftKindsForRetriedSettings(
    ['setupMode', 'deepseekApiKey', 'activeModel'],
    'deepseek',
  ),
  ['primary', 'model'],
  'a retry receipt must reconcile only the current connection editors whose writes succeeded',
);
assert.deepEqual(
  connectionDraftKindsForRetriedSettings(
    ['customEndpointApiKey'],
    'custom',
  ),
  ['custom-key'],
  'a custom API key receipt must not erase an unrelated endpoint or model draft',
);
assert.deepEqual(
  connectionDraftKindsForRetriedSettings(['deepseekApiKey'], 'openai'),
  [],
  'a stale provider receipt must not reconcile the editor for a different provider',
);
const abandonedCredentialWrite = createFailedSaveOperation([
  ['deepseekApiKey', 'fixture-not-a-real-secret'],
], 3);
assert.equal(
  removeFailedSaveOperationKeys(
    abandonedCredentialWrite,
    settingsKeysForDiscardedConnectionDrafts(['primary'], 'deepseek'),
  ),
  null,
  'the generic retry queue must retain no credential write after the user discards that editor',
);
const abandonedPromptWrite = createFailedSaveOperation([
  ['customPrompt', 'fixture advanced instructions'],
], 4);
assert.equal(
  removeFailedSaveOperationKeys(
    abandonedPromptWrite,
    settingsKeysForDiscardedDrafts({ hasPromptDraft: true }),
  ),
  null,
  'explicitly discarding the prompt must leave no hidden retry that can restore it later',
);

assert.match(dialogSource, /const dialogId = providedId \|\| `settings-transition-\$\{generatedId\}`/,
  'callers must be able to provide a stable dialog id while isolated uses remain collision-safe');
assert.match(dialogSource, /role="alertdialog"/);
assert.match(dialogSource, /aria-modal="true"/);
assert.match(dialogSource, /aria-labelledby=\{titleId\}/);
assert.match(dialogSource, /aria-describedby=\{describedBy\}/);
assert.doesNotMatch(dialogSource, /aria-errormessage=/,
  'a non-form alertdialog must describe its error instead of exposing aria-errormessage');
assert.match(
  dialogSource,
  /const describedBy = \[[\s\S]*?description \? descriptionId : ''[\s\S]*?notice \? noticeId : ''[\s\S]*?error \? errorId : ''[\s\S]*?\.filter\(Boolean\)/,
  'the alertdialog accessible description must always include a rendered error',
);
assert.match(dialogSource, /aria-busy=\{busy\}/);
assert.match(dialogSource, /data-status=\{status\}/);
assert.match(dialogSource, /tabIndex=\{-1\}/);

assert.match(
  dialogSource,
  /const siblingState =[^;]+?[\s\S]*?inert: node\.inert[\s\S]*?ariaHidden: node\.getAttribute\('aria-hidden'\)/,
  'the transition layer must snapshot every sibling\'s exact inert and aria-hidden state',
);
assert.match(
  dialogSource,
  /siblingState\.forEach\(\(\{ node, inert, ariaHidden \}\)[\s\S]*?node\.inert = inert[\s\S]*?ariaHidden === null[\s\S]*?node\.setAttribute\('aria-hidden', ariaHidden\)/,
  'closing the layer must restore exact sibling state rather than blindly making content interactive',
);

assert.match(dialogSource, /window\.addEventListener\('keydown', handleKeyDown, true\)/,
  'Escape and Tab must be owned by a stable capture-phase listener');
assert.match(dialogSource, /window\.addEventListener\('focusin', handleFocusIn, true\)/,
  'programmatic focus must be contained as well as keyboard focus');
assert.match(
  dialogSource,
  /function focusAndReveal\(target\) \{\s*if \(!target\) return;\s*target\.focus\(\{ preventScroll: true \}\);\s*if \(document\.activeElement !== target\) return;\s*target\.scrollIntoView\(\{\s*behavior: 'auto',\s*block: 'nearest',\s*inline: 'nearest',\s*\}\);\s*\}/,
  'internal dialog focus must first claim the target without implicit scrolling, then reveal only the active target in the nearest scrollport',
);
assert.equal(
  (dialogSource.match(/scrollIntoView\(/g) || []).length,
  1,
  'scroll revealing must stay centralized in the focusAndReveal helper',
);
assert.doesNotMatch(
  dialogSource,
  /(?:directionalAction|first|last)\.focus\(\{ preventScroll: true \}\)/,
  'dialog actions must not bypass focusAndReveal',
);
assert.match(
  dialogSource,
  /if \(!\['Escape', 'Tab'\]\.includes\(event\.key\)\) return;\s*if \(hasActiveAppTopLayer\(document\)\) return;/,
  'both owned keys must yield while AppQuit is the active top layer',
);
assert.match(
  dialogSource,
  /event\.key === 'Escape'[\s\S]*?event\.stopImmediatePropagation\(\)[\s\S]*?!busyRef\.current && !submissionLockRef\.current[\s\S]*?cancelRef\.current/,
  'Escape must be consumed while busy and dismiss only while the decision is idle',
);
assert.match(dialogSource, /enabledControls\.length === 0[\s\S]*?dialog\.focus\(\{ preventScroll: true \}\)/,
  'a busy or actionless decision must retain Tab focus on its root');
assert.match(
  dialogSource,
  /const focusInsideDialog = \(reverse = false\) => \{[\s\S]*?const target = reverse[\s\S]*?getSafeTarget\(\) \|\| enabledControls\[0\] \|\| dialog;\s*if \(target === dialog\) dialog\.focus\(\{ preventScroll: true \}\);\s*else focusAndReveal\(target\)/,
  'focus containment must reveal safe and reverse action targets while leaving root focus scroll-neutral',
);
assert.match(
  dialogSource,
  /!dialog\.contains\(activeElement\)[\s\S]*?focusAndReveal\(event\.shiftKey \? last : getSafeTarget\(\) \|\| first\)[\s\S]*?activeElement === first[\s\S]*?focusAndReveal\(last\)[\s\S]*?activeElement === last[\s\S]*?focusAndReveal\(first\)/,
  'Tab must recover outside focus, wrap in both directions, and reveal each focused action',
);
assert.match(
  dialogSource,
  /const statusFocusTargets = \[[\s\S]*?descriptionRef\.current,[\s\S]*?noticeRef\.current,[\s\S]*?errorRef\.current,[\s\S]*?statusFocusTargets\.includes\(activeElement\)[\s\S]*?querySelector\('\.settings-transition-dialog__actions'\)[\s\S]*?event\.shiftKey[\s\S]*?enabledActions\[enabledActions\.length - 1\] \|\| last[\s\S]*?enabledActions\[0\] \|\| first[\s\S]*?focusAndReveal\(directionalAction\)/,
  'Tab from a programmatically focused settled status must reveal the first action and Shift+Tab the last action',
);
assert.match(
  dialogSource,
  /!dialog \|\| dialog\.contains\(event\.target\) \|\| hasActiveAppTopLayer\(document\)[\s\S]*?focusInsideDialog\(false\)/,
  'focus containment must yield to AppQuit instead of stealing focus back',
);
assert.match(
  dialogSource,
  /const target = busyRef\.current \? dialog : getSafeTarget\(\) \|\| dialog;\s*if \(target === dialog\) dialog\?\.focus\(\{ preventScroll: true \}\);\s*else focusAndReveal\(target\)/,
  'initial focus must reveal the safe action while preserving preventScroll-only focus for the busy dialog root',
);
assert.match(dialogSource, /previousFocusRef\.current = document\.activeElement/,
  'restoration must preserve the exact active opener independently from the live trigger fallback');
assert.match(
  dialogSource,
  /const focusInitialTarget = \(\) => \{[\s\S]*?hasActiveAppTopLayer\(document\)[\s\S]*?new MutationObserver[\s\S]*?focusInitialTarget[\s\S]*?getSafeTarget\(\) \|\| dialog/,
  'a transition mounted beneath AppQuit must wait and claim safe focus when the top layer leaves',
);
assert.match(
  dialogSource,
  /if \(!busy\) return undefined;[\s\S]*?const focusBusyRoot = \(\) => \{[\s\S]*?hasActiveAppTopLayer\(document\)[\s\S]*?new MutationObserver[\s\S]*?dialogRef\.current\?\.focus/,
  'entering an externally controlled busy state must focus the root now or immediately after AppQuit leaves',
);

assert.match(
  dialogSource,
  /const beginConfirmation = \(overrideAction\) => \{\s*if \(busyRef\.current \|\| submissionLockRef\.current\) return;[\s\S]*?submissionLockRef\.current = true;[\s\S]*?busyRef\.current = true;[\s\S]*?restoreFocusRef\.current = false;[\s\S]*?dialogRef\.current\?\.focus/,
  'a committed action must synchronously own duplicate clicks, Escape, focus, and restoration',
);
assert.match(
  dialogSource,
  /Promise\.resolve\(actionResult\)[\s\S]*?succeeded === true[\s\S]*?submissionLockRef\.current = false;[\s\S]*?\.catch\(\(\) => \{[\s\S]*?restoreFocusRef\.current = true/,
  'failed, rejected, or incomplete transitions must release the synchronous lock and restore safe dismissal',
);
assert.match(
  dialogSource,
  /typeof actions === 'function'[\s\S]*?safeActionProps,[\s\S]*?confirmActionProps,[\s\S]*?beginConfirmation,[\s\S]*?busy,[\s\S]*?status/,
  'connection states must be able to supply distinct actions without reimplementing modal ownership',
);
assert.match(dialogSource, /'data-settings-transition-safe': true[\s\S]*?'data-settings-draft-safe': true/,
  'default and slotted safe actions must retain stable focus hooks and legacy draft compatibility');

assert.match(
  dialogSource,
  /const committed = committedRefRef\.current\?\.current === true;[\s\S]*?const externallySuppressed = suppressRestoreRefRef\.current\?\.current === true;[\s\S]*?current\.current = false[\s\S]*?if \(!restoreFocusRef\.current \|\| committed \|\| externallySuppressed\) return;/,
  'external navigation ownership must suppress stale restoration through one-shot refs',
);
assert.match(
  dialogSource,
  /window\.requestAnimationFrame\(\(\) => \{\s*window\.requestAnimationFrame\(\(\) => \{[\s\S]*?const exactTrigger = authoritativeRadioTarget\(previousFocusRef\.current\);[\s\S]*?const liveTrigger = authoritativeRadioTarget\(returnFocusRefRef\.current\?\.current\);[\s\S]*?aria-label="返回主面板"[\s\S]*?canRestoreFocus\(exactTrigger\)[\s\S]*?canRestoreFocus\(liveTrigger\)[\s\S]*?canRestoreFocus\(fallback\)/,
  'idle close must wait for settled DOM, normalize obsolete radios, then prefer the exact trigger, its live ref, and Settings return',
);

assert.match(dialogSource, /status === 'error' \|\| status === 'completed'/,
  'connection error and completed descriptions must be explicit settled notices');
assert.match(dialogSource, /role=\{!error && status === 'error' \? 'alert' : status === 'completed' \? 'status' : undefined\}/);
assert.match(dialogSource, /tabIndex=\{status === 'error' \|\| status === 'completed' \? -1 : undefined\}/,
  'settled notices must be programmatically focusable');
assert.match(dialogSource, /new MutationObserver[\s\S]*?data-app-top-layer[\s\S]*?disconnect\(\)/,
  'notice focus must wait for AppQuit to leave and clean up its observer');
assert.match(
  dialogSource,
  /thirdFrame[\s\S]*?hasActiveAppTopLayer\(document\)[\s\S]*?observeUntilTopLayerLeaves\(\)/,
  'a top layer arriving during the settling frames must still defer notice focus until it leaves',
);
assert.match(
  dialogSource,
  /thirdFrame[\s\S]*?hasActiveAppTopLayer\(document\)[\s\S]*?errorRef\.current \|\| noticeRef\.current \|\| descriptionRef\.current[\s\S]*?focusAndReveal\(target\)/,
  'error/completed focus must settle after the app top layer completes its restoration and reveal the active status',
);
assert.match(
  dialogSource,
  /const target = canRestoreFocus\(exactTrigger\)[\s\S]*?canRestoreFocus\(fallback\) \? fallback : null;\s*target\?\.focus\(\{ preventScroll: true \}\)/,
  'closing the dialog must restore its external trigger without moving the Settings scroll position',
);

assert.match(dialogSource, /className=\{joinClassNames\('settings-draft-exit-backdrop', backdropClassName\)\}/);
assert.match(dialogSource, /className=\{joinClassNames\('settings-draft-exit-dialog', className\)\}/,
  'the shared shell must keep legacy draft and caller-supplied connection classes');
const backdropOpeningTag = dialogSource.match(/<div\s+ref=\{backdropRef\}[\s\S]*?>/)?.[0] || '';
assert.doesNotMatch(backdropOpeningTag, /onClick=/,
  'backdrop clicks must never silently choose a transition outcome');

assert.match(settingsSource, /import SettingsTransitionDialog from '\.\/SettingsTransitionDialog'/);
assert.doesNotMatch(settingsSource, /draftExitDialogRef|connectionExitDialogRef/,
  'Settings must not retain competing keyboard/focus effects from the obsolete inline dialogs');
assert.match(
  settingsSource,
  /<SettingsTransitionDialog[\s\S]*?id="settings-connection-exit-dialog"[\s\S]*?className="settings-connection-exit-dialog"[\s\S]*?backdropClassName="settings-connection-exit-backdrop"[\s\S]*?status=\{connectionExitStatus\}[\s\S]*?busy=\{connectionExitStatus === 'cancelling'\}[\s\S]*?error=\{connectionExitStatus === 'error'[\s\S]*?returnFocusRef=\{connectionExitTriggerRef\}[\s\S]*?committedRef=\{connectionExitConfirmedRef\}[\s\S]*?actions=\{\(\{ safeActionProps, confirmActionProps, status \}\) =>/,
  'connection exit states must use the shared shell while retaining their status-specific action slot',
);
assert.match(
  settingsSource,
  /<button \{\.\.\.safeActionProps\} data-settings-connection-safe>[\s\S]*?<button \{\.\.\.confirmActionProps\}>/,
  'connection actions must spread the shell-owned focus, busy, and duplicate-submission guards',
);
assert.match(
  settingsSource,
  /const reviewCompletedConnectionTest = useCallback\(\(\) => \{\s*connectionExitConfirmedRef\.current = true;[\s\S]*?requestAnimationFrame[\s\S]*?requestAnimationFrame[\s\S]*?connectionResultRef\.current/,
  'reviewing a completed test must suppress stale opener restoration and focus the retained result',
);
assert.match(
  settingsSource,
  /ref=\{connectionResultRef\}[\s\S]*?role="region"[\s\S]*?aria-label=\{`\$\{connectionResultCopy\[0\]\}：\$\{connectionResultCopy\[1\]\}`\}[\s\S]*?tabIndex=\{-1\}/,
  'the focused retained result must expose a useful accessible name instead of a generic div',
);
assert.match(
  settingsSource,
  /<SettingsTransitionDialog[\s\S]*?id="settings-draft-exit-dialog"[\s\S]*?status=\{settingsSaving \? 'busy' : draftExitSaveFailed \? 'error' : 'idle'\}[\s\S]*?error=\{draftExitSaveFailed[\s\S]*?onConfirm=\{confirmDraftExitIntent\}[\s\S]*?returnFocusRef=\{draftExitTriggerRef\}[\s\S]*?committedRef=\{draftExitConfirmedRef\}/,
  'draft exit must keep failed saves inside the shared decision and preserve exact navigation ownership',
);
assert.equal(
  (settingsSource.match(/disabled=\{settingsSaving \|\| isTestingConnection \|\| isCancellingConnection \|\| isRetryingSave\}/g) || []).length,
  3,
  'connection editors must remain locked until their initial save, validation, or a correlated retry settles',
);
assert.match(
  settingsSource,
  /const \[connectionDraftResetEpoch, setConnectionDraftResetEpoch\] = useState\(0\)[\s\S]*?const discardConnectionDrafts = useCallback\(\(\) => \{\s*clearConnectionDrafts\(\);\s*setConnectionDraftResetEpoch\(\(current\) => current \+ 1\)/,
  'explicit discard must reset both parent draft ownership and every visible local editor',
);
assert.match(
  settingsSource,
  /const discardSettingsDraftsAndFailedWrites = useCallback\(\(\) => \{[\s\S]*?settingsKeysForDiscardedDrafts\(\{[\s\S]*?connectionDraftKinds: connectionDraftKeysRef\.current,[\s\S]*?backend: settings\.activeBackend,[\s\S]*?hasPromptDraft: hasUnsavedPromptDraft,[\s\S]*?discardConnectionDrafts\(\);[\s\S]*?setHasUnsavedPromptDraft\(false\);[\s\S]*?setPromptDraftResetEpoch\(\(current\) => current \+ 1\);[\s\S]*?discardFailedSettings\(abandonedKeys\)/,
  'explicit discard must reset both draft families and revoke only their failed persistence',
);
assert.match(
  settingsSource,
  /const confirmDraftExitIntent = useCallback\(\(\) => \{[\s\S]*?discardSettingsDraftsAndFailedWrites\(\);[\s\S]*?requestConnectionExitIntent/,
  'the destructive draft-exit decision must reset visible editors and revoke their failed writes before continuing',
);
assert.equal(
  (settingsSource.match(/resetEpoch=\{connectionDraftResetEpoch\}/g) || []).length,
  3,
  'the primary credential, custom credential, and model editors must share the discard epoch',
);
assert.match(
  apiKeySource,
  /resetEpoch = 0[\s\S]*?useEffect\(\(\) => \{[\s\S]*?setDraft\(isUrlType \? \(latestValueRef\.current \|\| ''\) : ''\)[\s\S]*?\}, \[backend, isUrlType, onDraftStateChange, resetEpoch\]\)/,
  'credential editors must erase discarded local input when the parent advances the reset epoch',
);
assert.match(
  apiKeySource,
  /failedDraftRevisionRef[\s\S]*?retryReceipt\.savedSettingKeys\?\.includes\(settingKey\)[\s\S]*?draftRevisionRef\.current !== failedRevision[\s\S]*?onDraftStateChange\?\.\(true\)[\s\S]*?setDraft\(isUrlType \? \(latestValueRef\.current \|\| ''\) : ''\)[\s\S]*?onDraftStateChange\?\.\(false\)/,
  'a credential retry receipt must clear the exact failed draft while preserving a newer same-field edit',
);
assert.match(
  modelSource,
  /failedDraftRevisionRef[\s\S]*?retryReceipt\.savedSettingKeys\?\.includes\(settingKey\)[\s\S]*?draftRevisionRef\.current !== failedRevision[\s\S]*?onDraftStateChange\?\.\(true\)/,
  'model retry reconciliation must preserve a newer model edit',
);
assert.match(
  settingsHookSource,
  /const retriedKeys = \[\.\.\.new Set\(entries\.map\(\(\[key\]\) => key\)\)\][\s\S]*?Object\.freeze\(\{ status: 'saved', savedSettingKeys: retriedKeys \}\)/,
  'the retry receipt must contain only confirmed setting keys and never their values',
);
assert.match(
  settingsSource,
  /setSaveRetryReceipt\(Object\.freeze\([\s\S]*?connectionDraftKinds[\s\S]*?connectionTestButtonRef\.current[\s\S]*?\.setting-save-status\.is-dirty[\s\S]*?settingsReturnButtonRef\.current/,
  'the parent must route the receipt precisely and restore focus to the next usable task',
);
assert.match(
  apiKeySource,
  /credentialDraftAfterSavedStateChange\(\{[\s\S]*?draft,[\s\S]*?if \(!transition\.savedCredentialRemoved\) return;[\s\S]*?setIsDirty\(transition\.hasUnsavedReplacement\)[\s\S]*?onDraftStateChange\?\.\(transition\.hasUnsavedReplacement\)/,
  'an external saved-key removal must preserve both local dirty state and parent draft ownership',
);
assert.doesNotMatch(
  apiKeySource,
  /previous\.backend !== backend \|\| isUrlType \|\| !previous\.isSaved \|\| isSaved[\s\S]{0,420}onDraftStateChange\?\.\(false\)/,
  'the old saved-to-empty effect must not silently release a visible replacement draft',
);
assert.match(settingsSource, /const requestClose = useCallback[\s\S]*?requestDraftExitIntent\(\{ kind: 'close' \}/,
  'return must continue through the shared draft guard');
assert.match(settingsSource, /const requestBackendChange = useCallback[\s\S]*?requestDraftExitIntent\(\{ kind: 'backend'/,
  'provider switching must continue through the shared draft guard');
assert.match(settingsSource, /captureKind: captureRequest\.kind,[\s\S]*?\}, settingsReturnButtonRef\.current\)/,
  'shortcut capture must continue through the shared draft guard');
assert.match(
  modelSource,
  /resetEpoch = 0[\s\S]*?useEffect\(\(\) => \{[\s\S]*?setDraft\(latestValueRef\.current \|\| models\[0\] \|\| ''\)[\s\S]*?\}, \[backend, models, onDraftStateChange, resetEpoch\]\)/,
  'the model editor must restore its saved value when the parent advances the reset epoch',
);
assert.match(
  promptSource,
  /resetEpoch = 0[\s\S]*?useEffect\(\(\) => \{[\s\S]*?draftRevisionRef\.current \+= 1;[\s\S]*?failedDraftRevisionRef\.current = null;[\s\S]*?setDraft\(latestValueRef\.current \|\| ''\)[\s\S]*?setIsDirty\(false\)[\s\S]*?onDraftStateChange\?\.\(false\)[\s\S]*?\}, \[onDraftStateChange, resetEpoch\]\)/,
  'the prompt editor must restore the persisted value and release parent ownership on explicit discard',
);

const promptCommitStart = promptSource.indexOf('const commit = async () => {');
const promptCommitEnd = promptSource.indexOf('\n\n  const charCount', promptCommitStart);
assert.ok(promptCommitStart >= 0 && promptCommitEnd > promptCommitStart,
  'the prompt editor must expose one inspectable explicit commit transaction');
const promptCommitSource = promptSource.slice(promptCommitStart, promptCommitEnd);
assert.match(promptCommitSource,
  /if \(disabled \|\| isSaving \|\| !isDirty\) return false;[\s\S]*?const attemptedRevision = draftRevisionRef\.current;[\s\S]*?setIsSaving\(true\)/,
  'prompt saving must lock duplicate submission and bind the attempt to its draft revision');
assert.match(promptCommitSource, /const saved = await onChange\(draft\)/,
  'the explicit save must persist the exact draft, including an intentional empty string');
assert.doesNotMatch(promptCommitSource, /draft\.trim\(|!draft\b|draft\.length/,
  'clearing a previously saved prompt must remain a valid explicit save');
assert.match(promptCommitSource,
  /saved === false[\s\S]*?setIsDirty\(false\)[\s\S]*?setOperationNotice\('高级分析说明已保存。'\)[\s\S]*?catch[\s\S]*?failedDraftRevisionRef\.current = attemptedRevision;[\s\S]*?setSaveFailed\(true\)[\s\S]*?onDraftStateChange\?\.\(true\)/,
  'success must release the draft while failure retains it with the exact failed revision');
assert.match(promptSource,
  /const dirty = nextDraft !== String\(value \|\| ''\);[\s\S]*?setIsDirty\(dirty\)[\s\S]*?onDraftStateChange\?\.\(dirty\)/,
  'typing, including clearing the field, must synchronously publish prompt draft ownership');
assert.doesNotMatch(promptSource, /onBlur=|onKeyDown=/,
  'blur and Enter must never implicitly submit or erase the prompt draft');
assert.match(promptSource,
  /<button[\s\S]*?className="setting-save-button"[\s\S]*?onClick=\{commit\}[\s\S]*?保存说明/,
  'prompt persistence must be initiated by a visible, explicit save action');
assert.match(promptSource,
  /const statusText = saveFailed\s*\? '保存失败，请重试'[\s\S]*?: isSaving\s*\? '正在保存…'[\s\S]*?: isDirty\s*\? '有未保存的更改'/,
  'the prompt editor must expose error, saving, and dirty states instead of silent persistence');
assert.equal(
  (promptSource.match(/setOperationNotice\('高级分析说明已保存。'\)/g) || []).length,
  2,
  'both direct save and correlated retry success must publish the same explicit confirmation',
);
assert.match(promptSource,
  /retryReceipt\?\.id[\s\S]*?lastRetryReceiptIdRef\.current === receiptId[\s\S]*?retryReceipt\.savedSettingKeys\?\.includes\(settingKey\)[\s\S]*?const failedRevision = failedDraftRevisionRef\.current[\s\S]*?draftRevisionRef\.current !== failedRevision[\s\S]*?setIsDirty\(true\)[\s\S]*?onDraftStateChange\?\.\(true\)[\s\S]*?setDraft\(latestValueRef\.current \|\| ''\)[\s\S]*?setIsDirty\(false\)/,
  'a one-shot retry receipt may reconcile the failed revision but must preserve a newer prompt edit');
assert.match(settingsSource,
  /const hasUnsavedSettingsDraft = hasUnsavedConnectionDraft \|\| hasUnsavedPromptDraft;[\s\S]*?describeSettingsDraftIntent\(draftExitIntent, \{[\s\S]*?hasConnectionDraft: hasUnsavedConnectionDraft,[\s\S]*?hasPromptDraft: hasUnsavedPromptDraft/,
  'the shared draft decision must describe both connection and advanced-instructions ownership');
assert.match(settingsSource,
  /settingsExitOwner\(\{[\s\S]*?hasUnsavedConnectionDraft,[\s\S]*?hasUnsavedPromptDraft,[\s\S]*?isTestingConnection,[\s\S]*?\}\) !== 'draft'/,
  'all Settings exits must consult prompt draft ownership before navigation or provider-task cancellation');
assert.match(settingsSource,
  /<PromptEditor[\s\S]*?settingKey="customPrompt"[\s\S]*?inputId="custom-prompt-input"[\s\S]*?onDraftStateChange=\{handlePromptDraftStateChange\}[\s\S]*?disabled=\{settingsSaving \|\| isRetryingSave\}[\s\S]*?resetEpoch=\{promptDraftResetEpoch\}[\s\S]*?retryReceipt=\{saveRetryReceipt\}/,
  'Settings must connect prompt dirty, failed-write revocation, lock, discard, and retry reconciliation to the shared transaction');
assert.match(settingsSource,
  /const promptRetry = saveRetryReceipt\.savedSettingKeys\?\.includes\('customPrompt'\);[\s\S]*?promptRetry[\s\S]*?querySelector\('#custom-prompt-input:not\(:disabled\)'\)[\s\S]*?target\?\.focus\(\{ preventScroll: true \}\)/,
  'after a prompt retry settles, focus must return to the retained textarea rather than an unrelated control');
assert.match(settingsSource, /if \(connectionTaskActiveRef\.current\) return false;/,
  'configuration invalidation must fail closed while a provider task is still owned');
assert.match(settingsSource, /connectionRunRef\.current === runId && connectionRevisionRef\.current === revision/,
  'a late result must not overwrite a newer validation run');
assert.match(
  settingsSource,
  /!\['idle', 'cancelling', 'error'\]\.includes\(connectionExitStatus\)[\s\S]*?setConnectionExitPhase\('completed'\)/,
  'a result arriving after a stop timeout must replace the stale running warning with the retained result',
);
assert.match(
  settingsSource,
  /disabled=\{settingsSaving \|\| clipboardWritePending \|\| confirmReset \|\| isTestingConnection \|\| isCancellingConnection\}/,
  'full reset must not bypass an active provider validation or unsettled clipboard write',
);

assert.match(
  stylesSource,
  /\.settings-draft-exit-dialog\s*\{[\s\S]*?max-height:\s*calc\(100% - 12px\);[\s\S]*?overflow:\s*auto;/,
  'long transition copy must remain available inside short Settings windows',
);
assert.match(
  stylesSource,
  /\.settings-draft-exit-dialog\s*\{[\s\S]*?scroll-padding:\s*6px;/,
  'scaled focus targets must keep the complete semantic focus ring inside the dialog scrollport',
);
assert.match(
  stylesSource,
  /\.settings-draft-exit-dialog:focus,[\s\S]*?\.settings-transition-dialog__notice:focus/,
  'busy roots and settled notices must expose visible focus for both keyboard and programmatic entry',
);
assert.match(
  stylesSource,
  /\.settings-draft-exit-dialog\s*\{[\s\S]*?--settings-transition-focus-ring:\s*var\(--warning\);[\s\S]*?\.settings-draft-exit-dialog\[data-status="completed"\]\s*\{\s*--settings-transition-focus-ring:\s*var\(--success\);[\s\S]*?\.settings-draft-exit-dialog\[data-status="error"\]\s*\{\s*--settings-transition-focus-ring:\s*var\(--error\);/,
  'warning, completed, and error states must select an opaque semantic focus color',
);
assert.match(
  stylesSource,
  /\.settings-draft-exit-dialog button:focus,[\s\S]*?outline:\s*2px solid var\(--settings-transition-focus-ring\);[\s\S]*?outline-offset:\s*2px;[\s\S]*?box-shadow:\s*0 0 0 2px var\(--surface-raised\);/,
  'transition focus must use a high-contrast opaque double ring instead of a translucent halo',
);
assert.match(
  stylesSource,
  /\.settings-draft-exit-dialog strong\s*\{[\s\S]*?font-size:\s*15px;[\s\S]*?\.settings-draft-exit-dialog p\s*\{[\s\S]*?font-size:\s*13px;[\s\S]*?\.settings-transition-dialog__notice\s*\{[\s\S]*?font-size:\s*12px;[\s\S]*?\.settings-draft-exit-dialog button\s*\{[\s\S]*?min-height:\s*44px;[\s\S]*?font-size:\s*12px;/,
  'compact transition copy and actions must remain readable with a 44px minimum target',
);
assert.match(
  stylesSource,
  /\.settings-draft-exit-discard\s*\{\s*border:\s*1px solid var\(--warning\);\s*background:\s*var\(--warning-bg\);\s*color:\s*var\(--warning\);\s*\}/,
  'the warning action must keep semantic high-contrast text in both appearance modes',
);
assert.match(
  stylesSource,
  /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.settings-connection-exit-spinner\s*\{\s*animation:\s*none;/,
  'the progress spinner must stop under reduced-motion preferences',
);
assert.match(
  settingsSource,
  /safeLabel=\{draftExitSaveFailed \? '返回草稿' : draftExitCopy\.safeLabel\}/,
  'a failed save may only promise to return to the retained draft, not to retry it',
);
assert.doesNotMatch(settingsSource, /返回草稿并重试保存/,
  'the error action label must not imply that navigation itself retries persistence');
assert.match(
  stylesSource,
  /@media \(max-width: 620px\)[\s\S]*?\.settings-draft-exit-dialog\s*\{[\s\S]*?width:\s*100%;[\s\S]*?grid-template-columns:\s*1fr;[\s\S]*?\.settings-draft-exit-dialog footer button\s*\{\s*width:\s*100%;/,
  'narrow dialogs and every action slot must become full-width without horizontal clipping',
);

assert.equal(
  packageJson.scripts['check:settings-transition-dialog'],
  'node scripts/check-settings-transition-dialog.mjs',
);
assert.match(packageJson.scripts.test, /npm run check:settings-transition-dialog/,
  'the default regression chain must enforce the shared transition-dialog contract');
assert.match(fixtureMainSource, /'settings-draft-discard-native'[\s\S]*?discardResetVisibleDraft[\s\S]*?discardClearedDirtyState[\s\S]*?discardTestUsesSavedConfiguration[\s\S]*?discardFailureKeptSavedBackend/,
  'the native Electron probe must exercise the real destructive discard path under save failure');
assert.match(nativeRuntimeSource, /save=once[\s\S]*?settings-draft-discard-native/,
  'the discard probe must inject a backend persistence failure rather than manually clearing the input');
assert.match(nativeRuntimeSource, /discardResetVisibleDraft[\s\S]*?discardClearedDirtyState[\s\S]*?discardTestUsesSavedConfiguration[\s\S]*?discardFailureKeptSavedBackend[\s\S]*?discardFailureRecoveryVisible/,
  'the runtime gate must assert visible draft reset, dirty-state agreement, saved-config testing, backend truth, and recovery');

console.log('Settings transition dialog checks passed.');
