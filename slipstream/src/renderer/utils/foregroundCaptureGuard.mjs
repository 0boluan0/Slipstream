const MODAL_REASONS = new Set([
  'app-decision',
  'session-recovery',
  'clipboard-residue',
  'saved-terms',
  'active-decision',
  'reply-draft',
]);

export function getForegroundCaptureBlockReason({
  appDecisionBlocked = false,
  hasSessionRecovery = false,
  hasClipboardResidueRisk = false,
  savedTermsOpen = false,
  hasActiveDecision = false,
  hasReplyDraft = false,
  isEditingSource = false,
  hasClearedSessionUndo = false,
  hasSourceDraft = false,
} = {}) {
  if (appDecisionBlocked) return 'app-decision';
  if (hasSessionRecovery) return 'session-recovery';
  if (hasClipboardResidueRisk) return 'clipboard-residue';
  if (savedTermsOpen) return 'saved-terms';
  if (hasActiveDecision) return 'active-decision';
  if (hasReplyDraft) return 'reply-draft';
  if (isEditingSource) return 'source-edit';
  if (hasClearedSessionUndo) return 'clear-undo';
  if (hasSourceDraft) return 'source-draft';
  return null;
}

export function isForegroundCaptureDecisionBlocking(reason, context = {}) {
  if (!MODAL_REASONS.has(reason)) return false;
  if (reason === 'app-decision') return context.appDecisionBlocked === true;
  if (reason === 'session-recovery') return context.hasSessionRecovery === true;
  if (reason === 'clipboard-residue') return context.hasClipboardResidueRisk === true;
  if (reason === 'saved-terms') return context.savedTermsOpen === true;
  if (reason === 'reply-draft') return context.hasReplyDraft === true;
  return context.hasActiveDecision === true;
}

function repeatedTitle(title, count) {
  return count > 1 ? `${title}（连续按下 ${count} 次）` : title;
}

export function describePendingScreenshotRequest(request, {
  busy = false,
  decisionStillBlocking = false,
  stopRequestPending = false,
} = {}) {
  const count = Math.max(1, Number(request?.receivedCount || 1));
  const reason = request?.replyDraftProtected === true && request?.reason === 'foreground-resolved'
    ? 'reply-draft'
    : request?.reason;
  if (request?.status === 'stopping') {
    const stopNeedsRetry = busy && !stopRequestPending;
    return {
      title: stopRequestPending
        ? '正在安全停止当前任务'
        : stopNeedsRetry ? '尚未确认任务停止' : '当前任务已结束',
      detail: stopRequestPending
        ? '停止请求已经发出，无法撤回。只有应用确认任务停止或完成后，才会打开框选；当前原文和结果仍保留。'
        : stopNeedsRetry
          ? '上次停止请求未被确认；当前任务可能仍在继续，截图没有打开。你可以重试停止，当前原文和结果仍保留。'
          : '当前任务已经停止或完成，正在准备截图框选。',
      actionLabel: stopRequestPending
        ? '正在停止…'
        : stopNeedsRetry ? '重试停止后截图' : '正在打开框选…',
      actionDisabled: !stopNeedsRetry,
      showIgnoreAction: false,
    };
  }

  if (busy) {
    return {
      title: repeatedTitle('截图请求正在等待', count),
      detail: '当前原文和结果没有改变。要开始框选，需要先明确停止当前任务。',
      actionLabel: '停止后截图',
      ignoreLabel: '继续当前任务',
      actionDisabled: false,
      showIgnoreAction: true,
    };
  }

  const reasonCopy = {
    'app-decision': {
      title: '截图请求正在等待退出决定',
      blockingDetail: '先完成退出确认；Slipstream 不会在确认层背后打开截图框选。',
      detail: '退出确认已经关闭；当前内容没有改变，现在可以决定是否开始截图。',
      actionLabel: '开始截图',
      ignoreLabel: '保留当前内容',
    },
    'session-recovery': {
      title: '截图请求正在等待恢复选择',
      blockingDetail: '先恢复或丢弃上次临时内容；Slipstream 不会替你做这个选择。',
      detail: '恢复选择已经完成；当前内容没有改变，现在可以决定是否开始截图。',
      actionLabel: '开始截图',
      ignoreLabel: '保留恢复后的内容',
    },
    'clipboard-residue': {
      title: '截图请求正在等待剪贴板检查',
      blockingDetail: '先检查或手动覆盖上次复制的系统剪贴板内容；Slipstream 不会从这个恢复提示背后打开截图框选。',
      detail: '剪贴板恢复提示已经确认；当前内容没有改变，现在可以决定是否开始截图。',
      actionLabel: '开始截图',
      ignoreLabel: '保留当前内容',
    },
    'saved-terms': {
      title: '截图请求正在等待术语库关闭',
      blockingDetail: '先完成或关闭术语库；Slipstream 不会从它背后打开截图框选。',
      detail: '术语库已经关闭；当前内容没有改变，现在可以决定是否开始截图。',
      actionLabel: '开始截图',
      ignoreLabel: '保留当前内容',
    },
    'active-decision': {
      title: '截图请求正在等待当前确认',
      blockingDetail: '先完成当前确认；Slipstream 不会同时打开第二个决策流程。',
      detail: '当前确认已经结束；现在可以决定是否开始截图。',
      actionLabel: '开始截图',
      ignoreLabel: '保留当前内容',
    },
    'reply-draft': {
      title: '截图请求正在等待回复草稿决定',
      blockingDetail: '先完成或关闭回复草稿；Slipstream 不会从草稿背后打开截图框选。',
      detail: '回复草稿和当前结果没有改变。开始截图并成功生成新结果后，这份草稿会被替换。',
      actionLabel: '放弃回复草稿并截图',
      ignoreLabel: '继续编辑回复',
    },
    'source-edit': {
      title: '截图请求正在等待原文修正决定',
      detail: '未保存的修正没有改变。开始截图并成功生成新结果后，这份修正会被替换。',
      actionLabel: '放弃修正并截图',
      ignoreLabel: '继续修正',
    },
    'source-draft': {
      title: '截图请求正在等待原文草稿决定',
      detail: '当前原文没有改变。开始截图并成功生成新结果后，这份草稿会被替换。',
      actionLabel: '放弃草稿并截图',
      ignoreLabel: '继续编辑原文',
    },
    'clear-undo': {
      title: '截图请求正在等待撤销决定',
      detail: '十秒撤销机会仍然保留；开始截图会明确放弃这次撤销。',
      actionLabel: '放弃撤销并截图',
      ignoreLabel: '保留撤销机会',
    },
    'foreground-resolved': {
      title: '截图请求仍在等待',
      detail: '刚才的前台操作已经结束；当前内容没有改变，现在可以决定是否开始截图。',
      actionLabel: '开始截图',
      ignoreLabel: '保留当前内容',
    },
    settings: {
      title: '截图请求正在等待',
      detail: '设置仍然保留；返回主面板后再决定是否开始截图。',
      actionLabel: '开始截图',
      ignoreLabel: '保留当前内容',
    },
    setup: {
      title: '首次截图请求正在等待',
      detail: '处理方式已经选好；现在由你决定是否打开截图框选。',
      actionLabel: '开始截图',
      ignoreLabel: '暂不截图',
    },
  };
  const copy = reasonCopy[reason] || {
    title: '截图请求正在等待',
    detail: '当前内容没有改变；开始截图时，上一份有效结果仍会保留。',
    actionLabel: '开始截图',
    ignoreLabel: '保留当前内容',
  };
  return {
    ...copy,
    title: repeatedTitle(copy.title, count),
    detail: decisionStillBlocking && copy.blockingDetail ? copy.blockingDetail : copy.detail,
    actionDisabled: false,
    showIgnoreAction: true,
  };
}
