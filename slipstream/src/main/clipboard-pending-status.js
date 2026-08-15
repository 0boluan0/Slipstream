'use strict';

function normalizeClipboardPendingStatus(payload = {}) {
  const pending = payload?.pending === true;
  const count = pending
    ? Math.min(999, Math.max(1, Number.isInteger(payload?.count) ? payload.count : 1))
    : 0;
  return { pending, count };
}

function createClipboardPendingTrayPresentation(payload = {}) {
  const status = normalizeClipboardPendingStatus(payload);
  if (!status.pending) {
    return {
      enabled: false,
      trayTitle: '',
      tooltip: '',
      statusLabel: '',
      actionLabel: '',
    };
  }
  return {
    enabled: true,
    trayTitle: '•',
    tooltip: '新复制文字正在等待；当前内容未被替换',
    statusLabel: status.count > 1
      ? `最新复制文字正在等待（连续检测到 ${status.count} 段，仅保留最近一段）`
      : '新复制文字正在等待（当前内容未被替换）',
    actionLabel: '显示等待内容',
  };
}

module.exports = {
  createClipboardPendingTrayPresentation,
  normalizeClipboardPendingStatus,
};
