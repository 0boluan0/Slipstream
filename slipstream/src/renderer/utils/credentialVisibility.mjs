export function describeCredentialVisibility({
  isUrlType = false,
  isSaved = false,
  draft = '',
  showKey = false,
} = {}) {
  const hasSecretDraft = !isUrlType && String(draft).length > 0;
  const canToggleSecret = hasSecretDraft;
  const revealsSecretDraft = canToggleSecret && showKey;

  return {
    inputType: isUrlType || revealsSecretDraft ? 'text' : 'password',
    hasSecretDraft,
    canToggleSecret,
    revealsSecretDraft,
    showStoredCredentialNotice: !isUrlType && isSaved && !hasSecretDraft,
    toggleLabel: revealsSecretDraft
      ? '隐藏新输入的 API Key'
      : '显示新输入的 API Key',
  };
}
