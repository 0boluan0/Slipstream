const assert = require('assert');
const {
  SECRET_SETTING_KEYS,
  redactSettingsForRenderer,
} = require('../src/main/safe-settings');

const settings = {
  anthropicApiKey: 'sk-ant-test',
  openaiApiKey: 'sk-openai-test',
  deepseekApiKey: 'sk-deepseek-test',
  customEndpointApiKey: 'sk-custom-test',
  activeBackend: 'custom',
  clipboardShortcut: 'Alt+C',
};

const safe = redactSettingsForRenderer(settings);

for (const key of SECRET_SETTING_KEYS) {
  assert.strictEqual(Object.hasOwn(safe, key), false, `${key} leaked to renderer settings`);
}

assert.deepStrictEqual(
  {
    hasAnthropicApiKey: safe.hasAnthropicApiKey,
    hasOpenaiApiKey: safe.hasOpenaiApiKey,
    hasDeepseekApiKey: safe.hasDeepseekApiKey,
    hasCustomEndpointApiKey: safe.hasCustomEndpointApiKey,
  },
  {
    hasAnthropicApiKey: true,
    hasOpenaiApiKey: true,
    hasDeepseekApiKey: true,
    hasCustomEndpointApiKey: true,
  },
);

assert.strictEqual(safe.activeBackend, 'custom');
assert.strictEqual(safe.clipboardShortcut, 'Alt+C');

async function checkRendererSecretUpdate() {
  const { applyRendererSettingUpdate } = await import('../src/renderer/hooks/settingsRedaction.mjs');
  const current = {
    anthropicApiKey: '',
    openaiApiKey: '',
    deepseekApiKey: '',
    customEndpointApiKey: '',
    hasAnthropicApiKey: false,
    hasOpenaiApiKey: false,
    hasDeepseekApiKey: false,
    hasCustomEndpointApiKey: false,
  };
  const updated = applyRendererSettingUpdate(current, 'openaiApiKey', 'sk-openai-test');
  assert.strictEqual(updated.openaiApiKey, '');
  assert.strictEqual(updated.hasOpenaiApiKey, true);
  assert.strictEqual(Object.values(updated).includes('sk-openai-test'), false);
}

checkRendererSecretUpdate()
  .then(() => console.log('settings redaction check passed'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
