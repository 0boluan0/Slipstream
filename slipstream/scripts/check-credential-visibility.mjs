import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describeCredentialVisibility } from '../src/renderer/utils/credentialVisibility.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');

assert.deepEqual(describeCredentialVisibility({ isSaved: true }), {
  inputType: 'password',
  hasSecretDraft: false,
  canToggleSecret: false,
  revealsSecretDraft: false,
  showStoredCredentialNotice: true,
  toggleLabel: '显示新输入的 API Key',
});

assert.deepEqual(describeCredentialVisibility({
  isSaved: true,
  draft: 'replacement-secret',
}), {
  inputType: 'password',
  hasSecretDraft: true,
  canToggleSecret: true,
  revealsSecretDraft: false,
  showStoredCredentialNotice: false,
  toggleLabel: '显示新输入的 API Key',
});

assert.deepEqual(describeCredentialVisibility({
  isSaved: true,
  draft: 'replacement-secret',
  showKey: true,
}), {
  inputType: 'text',
  hasSecretDraft: true,
  canToggleSecret: true,
  revealsSecretDraft: true,
  showStoredCredentialNotice: false,
  toggleLabel: '隐藏新输入的 API Key',
});

assert.equal(describeCredentialVisibility({ isUrlType: true, isSaved: true }).inputType, 'text');
assert.equal(describeCredentialVisibility({ isUrlType: true, isSaved: true }).showStoredCredentialNotice, false);

const inputSource = readFileSync(path.join(
  projectRoot,
  'src/renderer/components/ApiKeyInput.jsx',
), 'utf8');
const styleSource = readFileSync(path.join(
  projectRoot,
  'src/renderer/components/SettingsPanel.css',
), 'utf8');

assert.match(inputSource, /已保存的密钥不会显示/);
assert.match(inputSource, /不会把它回传到此窗口/);
assert.match(inputSource, /aria-describedby=\{credentialVisibility\.showStoredCredentialNotice/);
assert.match(inputSource, /credentialVisibility\.canToggleSecret &&/,
  'the reveal action must not appear for an empty redacted saved credential');
assert.match(inputSource, /aria-label=\{credentialVisibility\.toggleLabel\}/);
assert.match(inputSource, /aria-pressed=\{credentialVisibility\.revealsSecretDraft\}/);
assert.match(inputSource, /setShowKey\(false\)/,
  'saving, deleting, clearing, or changing providers must return the input to a concealed state');
assert.match(styleSource, /\.credential-visibility-toggle[\s\S]*?width: 32px;[\s\S]*?height: 32px;/);

console.log('Saved credential visibility checks passed.');
