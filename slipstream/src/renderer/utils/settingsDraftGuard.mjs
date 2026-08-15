const BACKEND_LABELS = Object.freeze({
  anthropic: 'Anthropic',
  custom: '自定义服务',
  deepseek: 'DeepSeek',
  free_translate: '基础翻译',
  ollama: 'Ollama',
  openai: 'OpenAI',
});

const PRIMARY_CONNECTION_SETTING_BY_BACKEND = Object.freeze({
  anthropic: 'anthropicApiKey',
  custom: 'customEndpointUrl',
  deepseek: 'deepseekApiKey',
  ollama: 'ollamaBaseUrl',
  openai: 'openaiApiKey',
});

/**
 * Resolve the visible connection editors whose exact persisted setting was
 * confirmed by the generic retry transaction. This lets the parent reconcile
 * only the editor that owns that write, without erasing a different draft the
 * user may still be working on.
 */
export function connectionDraftKindsForRetriedSettings(settingKeys, backend) {
  const keys = new Set(settingKeys || []);
  const kinds = [];
  const primaryKey = PRIMARY_CONNECTION_SETTING_BY_BACKEND[backend];
  if (primaryKey && keys.has(primaryKey)) kinds.push('primary');
  if (backend === 'custom' && keys.has('customEndpointApiKey')) kinds.push('custom-key');
  if (keys.has('activeModel')) kinds.push('model');
  return kinds;
}

/**
 * Resolve the persisted settings owned by connection editors the user is
 * explicitly discarding. A failed editor save may also have paused full mode
 * before the field write, so setupMode belongs to the same abandoned intent.
 */
export function settingsKeysForDiscardedConnectionDrafts(draftKinds, backend) {
  const drafts = new Set(draftKinds || []);
  const keys = [];
  if (drafts.has('primary')) {
    const primaryKey = PRIMARY_CONNECTION_SETTING_BY_BACKEND[backend];
    if (primaryKey) keys.push(primaryKey);
  }
  if (drafts.has('custom-key') && backend === 'custom') keys.push('customEndpointApiKey');
  if (drafts.has('model')) keys.push('activeModel');
  return keys.length ? ['setupMode', ...new Set(keys)] : [];
}

export function settingsKeysForDiscardedDrafts({
  connectionDraftKinds = [],
  backend,
  hasPromptDraft = false,
} = {}) {
  return [...new Set([
    ...settingsKeysForDiscardedConnectionDrafts(connectionDraftKinds, backend),
    ...(hasPromptDraft ? ['customPrompt'] : []),
  ])];
}

export function settingsExitOwner({
  hasUnsavedConnectionDraft = false,
  hasUnsavedPromptDraft = false,
  isTestingConnection = false,
} = {}) {
  if (hasUnsavedConnectionDraft || hasUnsavedPromptDraft) return 'draft';
  if (isTestingConnection) return 'connection';
  return 'perform';
}

/**
 * Reconcile the local secret editor when the renderer learns that a formerly
 * persisted credential no longer exists. This can happen without the editor
 * initiating a delete: changing a custom endpoint origin atomically revokes
 * the credential that belonged to the old origin.
 *
 * Secret values are deliberately not returned to the renderer, so a visible
 * non-blank draft cannot be compared with the persisted value. It remains an
 * unsaved replacement until that editor explicitly saves or discards it.
 */
export function credentialDraftAfterSavedStateChange({
  backend,
  previousBackend,
  previousIsSaved = false,
  isSaved = false,
  isUrlType = false,
  draft = '',
} = {}) {
  const savedCredentialRemoved = !isUrlType
    && previousBackend === backend
    && previousIsSaved
    && !isSaved;
  if (!savedCredentialRemoved) {
    return {
      savedCredentialRemoved: false,
      hasUnsavedReplacement: false,
    };
  }
  return {
    savedCredentialRemoved: true,
    hasUnsavedReplacement: Boolean(String(draft || '').trim()),
  };
}

export function describeSettingsDraftIntent(intent, {
  guidedSetup = false,
  hasConnectionDraft = false,
  hasPromptDraft = false,
} = {}) {
  let actionLabel = guidedSetup ? '返回首次使用选择' : '返回主面板';
  let safeLabel = '继续编辑';

  if (intent?.kind === 'capture') {
    actionLabel = intent.captureKind === 'screenshot' ? '开始截图' : '处理新文字';
    safeLabel = '继续编辑，稍后处理';
  } else if (intent?.kind === 'backend') {
    actionLabel = intent.value === 'free_translate'
      ? '改用基础翻译'
      : `切换到 ${BACKEND_LABELS[intent.value] || '其他服务'}`;
  } else if (intent?.kind === 'location') {
    actionLabel = intent.value === 'local' ? '改为在本机分析' : '改为在线分析';
  } else if (intent?.kind === 'translation-fallback') {
    actionLabel = intent.removeCredential
      ? '删除当前凭据并改用基础翻译'
      : '保留当前凭据并改用基础翻译';
  } else if (intent?.kind === 'activate-mode') {
    actionLabel = '启用完整分析';
  }

  const draftSubject = hasConnectionDraft && hasPromptDraft
    ? 'API Key、服务地址或模型，以及高级分析说明'
    : hasPromptDraft
      ? '高级分析说明'
      : hasConnectionDraft
        ? 'API Key、服务地址或模型'
        : '设置';
  const titleSubject = hasConnectionDraft && hasPromptDraft
    ? '设置'
    : hasPromptDraft ? '高级分析说明' : '连接信息';

  return {
    actionLabel,
    safeLabel,
    failedTitle: `${titleSubject}没有保存`,
    title: intent?.kind === 'capture'
      ? `先处理未保存的${titleSubject}`
      : `要放弃未保存的${titleSubject}吗？`,
    detail: intent?.kind === 'capture'
      ? `${draftSubject}中仍有未保存的输入。“${actionLabel}”需要离开设置，并会丢弃这些输入；已经安全保存的配置不会改变。`
      : `${draftSubject}中仍有未保存的输入。“${actionLabel}”后会丢弃这些输入；已经安全保存的配置不会改变。`,
    confirmLabel: `放弃草稿并${actionLabel}`,
  };
}
