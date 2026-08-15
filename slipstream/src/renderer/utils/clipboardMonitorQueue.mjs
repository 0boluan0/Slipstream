const DEFAULT_PREVIEW_LENGTH = 108;

export function isCaptureContextProtected({
  status,
  hasInput = false,
  hasResult = false,
  isEditingSource = false,
  isVerifying = false,
  hasSessionRecovery = false,
  hasForegroundDecision = false,
} = {}) {
  return status === 'processing'
    || hasInput
    || hasResult
    || isEditingSource
    || isVerifying
    || hasSessionRecovery
    || hasForegroundDecision;
}

export function shouldHoldClipboardCapture({
  source,
  monitoringEnabled,
  ...context
} = {}) {
  if (source === 'monitor' && monitoringEnabled !== true) return false;
  if (source !== 'monitor' && source !== 'shortcut' && source !== 'manual-read') return false;
  return isCaptureContextProtected(context);
}

export function shouldHoldMonitoredClipboard(options = {}) {
  return shouldHoldClipboardCapture(options);
}

export function createPendingClipboardItem(payload, previous = null, {
  replyDraftProtected = false,
} = {}) {
  const text = typeof payload?.text === 'string' ? payload.text : '';
  const source = payload?.source === 'manual-read'
    ? 'manual-read'
    : payload?.source === 'shortcut'
      ? 'shortcut'
      : 'monitor';
  const protectsReplyDraft = replyDraftProtected === true
    || previous?.replyDraftProtected === true;
  const preservesExplicitManualRead = previous?.source === 'manual-read'
    && source !== 'manual-read';
  const preservesShortcutOverMonitor = source === 'monitor'
    && previous?.source === 'shortcut';
  if (preservesExplicitManualRead || preservesShortcutOverMonitor) {
    return {
      ...previous,
      replyDraftProtected: protectsReplyDraft,
      skippedAutomaticCount: Math.min(999, Number(previous.skippedAutomaticCount || 0) + 1),
    };
  }
  const continuesSameSource = Boolean(previous) && (!previous.source || previous.source === source);
  return {
    text,
    source,
    truncated: Boolean(payload?.truncated),
    originalLength: payload?.originalLength ?? text.length,
    confidence: payload?.confidence ?? null,
    blocks: Array.isArray(payload?.blocks) ? payload.blocks : [],
    receivedCount: Math.min(999, Math.max(
      1,
      Number(continuesSameSource ? previous?.receivedCount || 0 : 0) + 1,
    )),
    skippedAutomaticCount: 0,
    replyDraftProtected: protectsReplyDraft,
    foregroundReason: typeof payload?.foregroundReason === 'string'
      ? payload.foregroundReason
      : null,
  };
}

export function pendingClipboardPreview(text, limit = DEFAULT_PREVIEW_LENGTH) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function pendingClipboardTitle(item, title) {
  const count = Math.max(1, Number(item?.receivedCount || 1));
  const isShortcut = item?.source === 'shortcut';
  if (count <= 1) return title;
  return isShortcut
    ? `${title}（连续按下 ${count} 次）`
    : `${title}（连续检测到 ${count} 段）`;
}

const MANUAL_READ_TITLE = '手动读取的文字等待确认';
const MANUAL_READ_NO_AUTO = '不会自动处理或发送给模型。';

function describePendingManualRead(item, {
  foregroundReason = null,
} = {}) {
  const foregroundCopy = {
    'reply-draft': {
      decision: '：回复草稿',
      unchanged: '回复草稿、结果和光标未变。',
      replacement: '放弃草稿并更新原文',
      actionLabel: '放弃回复草稿并替换',
      ignoreLabel: '继续编辑回复',
    },
    'source-edit': {
      decision: '：原文修正',
      unchanged: '未保存的修正未变。',
      replacement: '替换原文',
      actionLabel: '放弃修正并替换',
      ignoreLabel: '继续修正',
    },
    'source-draft': {
      decision: '：原文草稿',
      unchanged: '原文草稿未变。',
      replacement: '替换原文',
      actionLabel: '放弃草稿并替换',
      ignoreLabel: '继续编辑原文',
    },
    'clear-undo': {
      decision: '：清空撤销',
      unchanged: '已清空内容未变；撤销倒计时已暂停，选择保留后会从剩余时间继续。',
      replacement: '结束撤销并显示新文字',
      actionLabel: '结束撤销并替换',
      ignoreLabel: '保留撤销机会',
    },
  };
  const effectiveReason = foregroundReason || item?.foregroundReason || (item?.replyDraftProtected === true
    ? 'reply-draft'
    : null);
  const copy = foregroundCopy[effectiveReason];
  if (copy) {
    return {
      title: `${MANUAL_READ_TITLE}${copy.decision}`,
      detail: `${copy.unchanged}确认替换才会${copy.replacement}；${MANUAL_READ_NO_AUTO}`,
      actionLabel: copy.actionLabel,
      ignoreLabel: copy.ignoreLabel,
    };
  }

  return {
    title: MANUAL_READ_TITLE,
    detail: `当前内容未变。确认替换才会更新原文；${MANUAL_READ_NO_AUTO}`,
    actionLabel: '替换当前内容',
    ignoreLabel: '保留当前内容',
  };
}

export function describePendingClipboard(item, {
  busy = false,
  foregroundReason = null,
} = {}) {
  if (item?.source === 'manual-read') {
    return describePendingManualRead(item, { foregroundReason });
  }

  const count = Math.max(1, Number(item?.receivedCount || 1));
  const isShortcut = item?.source === 'shortcut';
  const subject = isShortcut ? '快捷键捕获的新文字' : '新的复制文字';

  if (busy) {
    return {
      title: count > 1
        ? isShortcut
          ? `快捷键捕获的最新文字正在等待（连续按下 ${count} 次）`
          : `最新复制文字正在等待（连续检测到 ${count} 段）`
        : isShortcut ? '快捷键捕获的文字正在等待' : '新的复制文字正在等待',
      detail: count > 1
        ? '当前任务不会被替换；完成后再决定。只保留最近一段，不写入历史。'
        : '当前任务不会被替换；完成后再决定。只保留这一段，不写入历史。',
      actionLabel: '处理新文字',
      ignoreLabel: '继续当前任务',
    };
  }

  const foregroundCopy = {
    'app-decision': {
      title: `${subject}正在等待退出决定`,
      detail: '先完成退出确认；Slipstream 不会从确认层背后处理新文字。',
      actionLabel: '处理新文字',
      ignoreLabel: '保留当前内容',
    },
    'session-recovery': {
      title: `${subject}正在等待恢复选择`,
      detail: '先恢复或丢弃上次临时内容；Slipstream 不会替你做这个选择。',
      actionLabel: '处理新文字',
      ignoreLabel: '保留恢复内容',
    },
    'clipboard-residue': {
      title: `${subject}正在等待剪贴板检查`,
      detail: '先检查或手动覆盖上次复制的系统剪贴板内容；Slipstream 不会从这个恢复提示背后处理新文字。',
      actionLabel: '处理新文字',
      ignoreLabel: '保留当前内容',
    },
    'saved-terms': {
      title: `${subject}正在等待术语库关闭`,
      detail: '先完成或关闭术语库；Slipstream 不会从它背后处理新文字。',
      actionLabel: '处理新文字',
      ignoreLabel: '保留当前内容',
    },
    'active-decision': {
      title: `${subject}正在等待当前确认`,
      detail: '先完成当前确认；Slipstream 不会同时启动第二个处理流程。',
      actionLabel: '处理新文字',
      ignoreLabel: '保留当前内容',
    },
    'reply-draft': {
      title: `${subject}正在等待回复草稿决定`,
      detail: '回复草稿和当前结果没有改变。处理新文字会放弃这份回复草稿并立即开始新的处理。',
      actionLabel: '放弃回复草稿并处理',
      ignoreLabel: '继续编辑回复',
    },
    'source-edit': {
      title: `${subject}正在等待原文修正决定`,
      detail: '未保存的修正没有改变。处理新文字并成功生成结果后，这份修正会被替换。',
      actionLabel: '放弃修正并处理',
      ignoreLabel: '继续修正',
    },
    'source-draft': {
      title: `${subject}正在等待原文草稿决定`,
      detail: '当前原文草稿没有改变。处理新文字会放弃这份草稿并立即开始新的处理。',
      actionLabel: '放弃草稿并处理',
      ignoreLabel: '继续编辑原文',
    },
    'clear-undo': {
      title: `${subject}正在等待撤销决定`,
      detail: '十秒撤销机会仍然保留；处理新文字会明确放弃这次撤销。',
      actionLabel: '放弃撤销并处理',
      ignoreLabel: '保留撤销机会',
    },
  };
  const copy = foregroundCopy[foregroundReason];
  if (copy) {
    return {
      ...copy,
      title: pendingClipboardTitle(item, copy.title),
    };
  }

  if (item?.replyDraftProtected === true) {
    const replyDraftCopy = foregroundCopy['reply-draft'];
    return {
      ...replyDraftCopy,
      title: pendingClipboardTitle(item, replyDraftCopy.title),
    };
  }

  if (count > 1) {
    return {
      title: isShortcut
        ? `快捷键捕获的最新文字正在等待（连续按下 ${count} 次）`
        : `最新复制文字正在等待（连续检测到 ${count} 段）`,
      detail: '当前内容没有被替换；只保留最近一段，不写入历史。',
      actionLabel: '处理新文字',
      ignoreLabel: '保留当前内容',
    };
  }
  return {
    title: isShortcut ? '快捷键捕获的文字正在等待' : '新的复制文字正在等待',
    detail: '当前内容没有被替换；只保留这一段，不写入历史。',
    actionLabel: '处理新文字',
    ignoreLabel: '保留当前内容',
  };
}
