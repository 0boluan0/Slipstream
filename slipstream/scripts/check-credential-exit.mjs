import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  buildTranslationFallbackPauseUpdates,
  describeCredentialExit,
  translationFallbackCompletionUpdate,
} from '../src/renderer/utils/credentialExit.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const readProjectFile = (relativePath) => readFileSync(
  path.join(projectRoot, relativePath),
  'utf8',
);

const deepseekSettings = {
  setupMode: 'full',
  activeBackend: 'deepseek',
  activeModel: 'deepseek-v4-flash',
  hasDeepseekApiKey: true,
};
const deepseekExit = describeCredentialExit(deepseekSettings);
assert.equal(deepseekExit.providerLabel, 'DeepSeek');
assert.equal(deepseekExit.credentialLabel, 'DeepSeek API Key');
assert.equal(deepseekExit.hasSavedCredential, true);
assert.deepEqual(deepseekExit.settingKeys, ['deepseekApiKey']);

const keepUpdates = buildTranslationFallbackPauseUpdates(deepseekSettings, false);
assert.deepEqual(keepUpdates, {
  setupMode: 'unconfigured',
  activeBackend: 'free_translate',
  activeModel: 'google-translate',
});
assert.equal(Object.hasOwn(keepUpdates, 'deepseekApiKey'), false);

const removeUpdates = buildTranslationFallbackPauseUpdates(deepseekSettings, true);
assert.equal(removeUpdates.setupMode, 'unconfigured');
assert.equal(removeUpdates.deepseekApiKey, '');
assert.equal(removeUpdates.activeBackend, 'free_translate');
assert.equal(removeUpdates.activeModel, 'google-translate');
assert.deepEqual(translationFallbackCompletionUpdate(), ['setupMode', 'translation-only']);

const customExit = describeCredentialExit({
  activeBackend: 'custom',
  customEndpointUrl: 'https://example.com/v1',
  hasCustomEndpointApiKey: false,
});
assert.equal(customExit.hasSavedCredential, true);
assert.deepEqual(customExit.settingKeys, ['customEndpointUrl', 'customEndpointApiKey']);
const customRemoval = buildTranslationFallbackPauseUpdates({
  activeBackend: 'custom',
  customEndpointUrl: 'https://example.com/v1',
  hasCustomEndpointApiKey: true,
}, true);
assert.equal(customRemoval.customEndpointUrl, '');
assert.equal(customRemoval.customEndpointApiKey, '');

const settingsSource = readProjectFile('src/renderer/components/SettingsPanel.jsx');
const apiKeySource = readProjectFile('src/renderer/components/ApiKeyInput.jsx');
const removalDialogSource = readProjectFile('src/renderer/components/CredentialRemovalDialog.jsx');
const draftGuardSource = readProjectFile('src/renderer/utils/settingsDraftGuard.mjs');
const connectionExitSource = readProjectFile('src/renderer/utils/connectionTestExit.mjs');

assert.match(settingsSource, /保留 .*凭据并改用/);
assert.match(settingsSource, /删除 .*凭据并改用/);
assert.match(settingsSource, /改用基础翻译不会自动删除它/);
assert.match(settingsSource, /不会把凭据发送给 Google \/ MyMemory/);
assert.match(settingsSource, /当前原文和上一份结果不会被清除/);
assert.match(settingsSource, /confirmLabel="删除凭据并继续"/);
assert.match(settingsSource, /切换没有完整保存/);
assert.match(settingsSource, /kind: 'translation-fallback'/);
assert.match(apiKeySource, /confirmDelete/);
assert.match(apiKeySource, /等待确认删除/);
assert.match(apiKeySource, /<CredentialRemovalDialog/);
assert.match(apiKeySource, /onConfirm=\{handleDelete\}/);
assert.match(apiKeySource, /onDeleteConfirmationChange/);
assert.match(settingsSource, /apiKeyDeleteConfirmationOpen/,
  'Escape must cancel credential deletion without closing settings');
assert.match(removalDialogSource, /confirmLabel = '删除凭据'/);
assert.match(removalDialogSource, /if \(!busyRef\.current\) cancelRef\.current/,
  'the shared removal decision must cancel only while no credential write is pending');
assert.match(draftGuardSource, /translation-fallback/,
  'unsaved provider drafts must be resolved before switching modes');
assert.match(connectionExitSource, /translation-fallback/,
  'active provider validation must be stopped before switching modes');

console.log('credential exit and translation fallback choice checks passed');
