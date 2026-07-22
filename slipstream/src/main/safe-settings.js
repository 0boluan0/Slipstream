const SECRET_SETTING_KEYS = Object.freeze([
  'anthropicApiKey',
  'openaiApiKey',
  'deepseekApiKey',
  'customEndpointApiKey',
]);
const SECRET_NAME_PATTERN = /(api.?key|password|secret|token)$/i;

function toSavedFlagName(secretKey) {
  return `has${secretKey.charAt(0).toUpperCase()}${secretKey.slice(1)}`;
}

function isSecretSettingKey(key) {
  if (/^has[A-Z]/.test(key)) return false;
  return SECRET_SETTING_KEYS.includes(key) || SECRET_NAME_PATTERN.test(key);
}

function redactSettingsForRenderer(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const safe = { ...source };
  for (const key of SECRET_SETTING_KEYS) {
    safe[toSavedFlagName(key)] = Boolean(source[key]);
  }
  for (const key of Object.keys(safe)) {
    if (isSecretSettingKey(key)) delete safe[key];
  }
  return safe;
}

module.exports = {
  SECRET_SETTING_KEYS,
  isSecretSettingKey,
  redactSettingsForRenderer,
};
