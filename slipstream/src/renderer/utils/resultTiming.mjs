function formatSeconds(value) {
  if (!Number.isFinite(value) || value < 0) return null;
  return `${(value / 1000).toFixed(1)} 秒`;
}

export function formatResultTiming({
  processingTimeMs,
  verificationTimeMs,
  translationOnly = false,
}) {
  const processingDuration = formatSeconds(processingTimeMs);
  const verificationDuration = formatSeconds(verificationTimeMs);
  const parts = [];
  if (processingDuration) parts.push(`${translationOnly ? '翻译' : '分析'} ${processingDuration}`);
  if (verificationDuration) parts.push(`最近核验 ${verificationDuration}`);
  return parts.join(' · ') || '已处理';
}
