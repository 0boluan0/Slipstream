import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  authoritativeRadioTarget,
  radioGroupTargetIndex,
} from '../src/renderer/utils/radioGroupNavigation.mjs';

const settingsSource = readFileSync(
  new URL('../src/renderer/components/SettingsPanel.jsx', import.meta.url),
  'utf8',
);
const promptSource = readFileSync(
  new URL('../src/renderer/components/PromptEditor.jsx', import.meta.url),
  'utf8',
);

assert.equal(radioGroupTargetIndex('ArrowLeft', 0, 3), 2);
assert.equal(radioGroupTargetIndex('ArrowUp', 1, 3), 0);
assert.equal(radioGroupTargetIndex('ArrowRight', 2, 3), 0);
assert.equal(radioGroupTargetIndex('ArrowDown', 1, 3), 2);
assert.equal(radioGroupTargetIndex('Home', 2, 3), 0);
assert.equal(radioGroupTargetIndex('End', 0, 3), 2);
assert.equal(radioGroupTargetIndex('ArrowRight', 0, 1), 0);
assert.equal(radioGroupTargetIndex('Enter', 1, 3), null);
assert.equal(radioGroupTargetIndex('ArrowLeft', -1, 3), null);
assert.equal(radioGroupTargetIndex('ArrowLeft', 0, 0), null);

const checkedRadio = { id: 'checked' };
const radioGroup = {
  querySelector(selector) {
    assert.equal(selector, '[role="radio"][aria-checked="true"]:not([disabled])');
    return checkedRadio;
  },
};
const obsoleteRadio = {
  tabIndex: -1,
  matches: (selector) => selector === '[role="radio"]',
  getAttribute: (name) => name === 'aria-checked' ? 'false' : null,
  closest: (selector) => selector === '[role="radiogroup"]' ? radioGroup : null,
};
assert.equal(authoritativeRadioTarget(obsoleteRadio), checkedRadio,
  'an unchecked radio removed from the tab order must resolve to the checked peer');
const fallbackRadio = { ...obsoleteRadio, tabIndex: 0 };
assert.equal(authoritativeRadioTarget(fallbackRadio), fallbackRadio,
  'the deliberate fallback tab stop must remain focusable when a group has no checked item');
assert.equal(authoritativeRadioTarget(checkedRadio), checkedRadio,
  'non-radio targets must remain unchanged');

assert.match(
  settingsSource,
  /<main className="settings-panel"[^>]*aria-labelledby="settings-title"/,
  'Settings must expose its root as the labelled main landmark',
);
assert.match(
  settingsSource,
  /<h1 id="settings-title"[^>]*>\s*\{isGuidedSetup \? '配置完整分析' : '设置'\}\s*<\/h1>/,
  'the existing visible Settings title must be the page h1',
);
assert.match(
  settingsSource,
  /const \[showTranslationFallback, setShowTranslationFallback\] = useState\(false\);/,
  'the translation-only explanation must default to collapsed',
);

const radioGroups = settingsSource.match(
  /<div(?=[^>]*role="radiogroup")[^>]*>/g,
) || [];
const keyboardEnabledGroups = settingsSource.match(
  /onKeyDown=\{handleRadioGroupKeyDown\}/g,
) || [];
assert.equal(radioGroups.length, 4,
  'Settings must keep location, local-provider, online-provider, and verification radio groups');
assert.equal(
  keyboardEnabledGroups.length,
  radioGroups.length,
  'every custom radio group must share keyboard navigation',
);

const radioButtonTemplates = settingsSource.match(
  /<button(?=[^>]*role="radio")[^>]*>/g,
) || [];
assert.equal(radioButtonTemplates.length, 5,
  'the two static choices and three mapped option templates must remain radios');
for (const radioButton of radioButtonTemplates) {
  assert.match(radioButton, /aria-checked=\{/);
  assert.match(radioButton, /tabIndex=\{/,
    'every radio template must participate in the roving tab stop');
}

assert.match(
  settingsSource,
  /function handleRadioGroupKeyDown\(event\)[\s\S]*?radioGroupTargetIndex\([\s\S]*?event\.preventDefault\(\)[\s\S]*?nextRadio\.focus\(\{ preventScroll: true \}\)[\s\S]*?nextRadio\.click\(\)/,
  'a handled navigation key must move focus and activate the destination radio',
);

assert.match(promptSource,
  /<label className="prompt-editor__label" htmlFor=\{inputId\}>[\s\S]*?<textarea[\s\S]*?id=\{inputId\}/,
  'the visible prompt label must name its textarea without placeholder-only labelling');
assert.match(promptSource,
  /aria-busy=\{isSaving\}[\s\S]*?aria-invalid=\{saveFailed \|\| undefined\}[\s\S]*?aria-describedby=\{`\$\{descriptionId\} \$\{statusId\}`\}/,
  'the prompt textarea must expose its instructions, status, pending save, and failed save semantics');
assert.match(promptSource,
  /id=\{statusId\}[\s\S]*?role=\{ownsLiveStatus \? 'status' : undefined\}[\s\S]*?aria-live=\{ownsLiveStatus \? 'polite' : undefined\}/,
  'prompt save changes must be announced without making a resting status repeatedly live');
assert.match(promptSource,
  /<button[\s\S]*?type="button"[\s\S]*?className="setting-save-button"[\s\S]*?disabled=\{disabled \|\| !isDirty \|\| isSaving\}[\s\S]*?onClick=\{commit\}[\s\S]*?aria-busy=\{isSaving\}/,
  'the explicit prompt save action must communicate disabled and pending states to assistive technology');
assert.match(promptSource,
  /<span className="prompt-editor__count" aria-hidden="true">\{charCount\}<\/span>/,
  'the decorative character count must not add noisy unlabelled output to the accessibility tree');

console.log('Settings accessibility checks passed.');
