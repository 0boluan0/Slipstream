const SECRET_SETTING_KEYS = ['anthropicApiKey', 'openaiApiKey', 'deepseekApiKey', 'customEndpointApiKey'];

function toSavedFlagName(secretKey) {
  return `has${secretKey.charAt(0).toUpperCase()}${secretKey.slice(1)}`;
}

function redactSettingsForRenderer(settings) {
  const safe = { ...settings };
  for (const key of SECRET_SETTING_KEYS) {
    safe[toSavedFlagName(key)] = Boolean(settings[key]);
    delete safe[key];
  }
  return safe;
}

module.exports = {
  SECRET_SETTING_KEYS,
  redactSettingsForRenderer,
};
