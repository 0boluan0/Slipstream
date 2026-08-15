function safeLength(value, fallback = 0) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function formatCount(value) {
  return safeLength(value).toLocaleString('zh-CN');
}

export function getSourceLimitState({
  textLength = 0,
  originalLength = null,
  truncated = false,
  sourceType = 'manual',
  limit = 10000,
} = {}) {
  const currentLength = safeLength(textLength);
  const normalizedLimit = Math.max(1, safeLength(limit, 10000));
  const normalizedOriginalLength = Math.max(
    currentLength,
    safeLength(originalLength, currentLength),
  );
  const isImportedPrefix = Boolean(truncated) && normalizedOriginalLength > currentLength;
  const blocked = isImportedPrefix || currentLength > normalizedLimit;
  const countLabel = isImportedPrefix
    ? `已载入 ${formatCount(currentLength)} / 原文 ${formatCount(normalizedOriginalLength)}`
    : `${formatCount(currentLength)} / ${formatCount(normalizedLimit)}`;

  if (!blocked) {
    return {
      blocked: false,
      kind: 'within-limit',
      currentLength,
      originalLength: normalizedOriginalLength,
      limit: normalizedLimit,
      countLabel,
      title: '',
      detail: '',
      missingLength: 0,
      overflowLength: 0,
      recovery: null,
    };
  }

  if (isImportedPrefix) {
    const missingLength = normalizedOriginalLength - currentLength;
    const isScreenshot = sourceType === 'ocr';
    const origin = isScreenshot ? '截图识别结果' : '剪贴板原文';
    return {
      blocked: true,
      kind: 'prefix-only',
      currentLength,
      originalLength: normalizedOriginalLength,
      limit: normalizedLimit,
      countLabel,
      title: `只载入了前 ${formatCount(currentLength)} 个字符`,
      detail: `${origin}共有 ${formatCount(normalizedOriginalLength)} 个字符；后面的 ${formatCount(missingLength)} 个字符不在输入框中，也没有开始分析。${isScreenshot ? '请重新框选较小、内容完整的区域。' : '请手动粘贴全文，再保留一段完整内容。'}`,
      missingLength,
      overflowLength: Math.max(0, normalizedOriginalLength - normalizedLimit),
      recovery: isScreenshot ? 'recapture' : 'manual-paste',
    };
  }

  const overflowLength = currentLength - normalizedLimit;
  return {
    blocked: true,
    kind: 'full-over-limit',
    currentLength,
    originalLength: currentLength,
    limit: normalizedLimit,
    countLabel,
    title: `超出 ${formatCount(overflowLength)} 个字符，完整原文仍保留`,
    detail: `输入框中保留了全部 ${formatCount(currentLength)} 个字符，尚未发送或分析。请定位超出部分，并删减为一段内容完整的原文。`,
    missingLength: 0,
    overflowLength,
    recovery: 'select-overflow',
  };
}

export function sourceLimitWarning(state) {
  if (!state?.blocked) return '';
  return [state.title, state.detail].filter(Boolean).join('。');
}
