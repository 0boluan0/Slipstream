'use strict';

const TASK_LABELS = Object.freeze({
  capture: Object.freeze({
    processing: '正在等待框选截图…',
    success: '截图已获取',
    failure: '截图没有完成，请查看恢复操作',
    tooltip: '正在等待框选截图',
    successTitle: '截图已获取',
    failureTitle: '截图没有完成',
    successBody: '打开 Slipstream 继续；提醒不包含截图或识别内容。',
    failureBody: '打开 Slipstream 查看原因和恢复操作；提醒不包含截图或识别内容。',
  }),
  ocr: Object.freeze({
    processing: '正在识别截图文字（仅在本机）…',
    success: '截图文字识别完成',
    failure: '截图文字识别没有完成，请查看恢复操作',
    tooltip: '正在识别截图文字（仅在本机）',
    successTitle: '截图文字识别完成',
    failureTitle: '截图文字识别没有完成',
    successBody: '打开 Slipstream 继续；提醒不包含截图或识别出的文字。',
    failureBody: '打开 Slipstream 查看原因和恢复操作；提醒不包含截图或识别出的文字。',
  }),
  analysis: Object.freeze({
    processing: '正在处理原文…',
    success: '分析完成，可以查看结果',
    failure: '分析没有完成，请查看恢复操作',
    tooltip: '正在分析',
    successTitle: '分析完成',
    failureTitle: '分析没有完成',
    successBody: '结果已准备好。点击查看；提醒不包含原文或分析内容。',
    failureBody: '打开 Slipstream 查看原因和恢复操作；提醒不包含原文。',
  }),
  verification: Object.freeze({
    processing: '正在核验官方来源…',
    success: '官方来源核验完成',
    failure: '官方来源核验没有完成',
    tooltip: '正在核验官方来源',
    successTitle: '官方来源核验完成',
    failureTitle: '官方来源核验没有完成',
    successBody: '核验结果已准备好。点击查看；提醒不包含原文或核验内容。',
    failureBody: '打开 Slipstream 查看原因和恢复操作；提醒不包含原文或核验内容。',
  }),
});

function normalizeKind(kind) {
  return Object.hasOwn(TASK_LABELS, kind) ? kind : 'analysis';
}

function createCompletedTaskState({
  kind = 'analysis',
  outcome = 'failure',
  windowHidden = false,
  appQuitting = false,
} = {}) {
  const normalizedKind = normalizeKind(kind);
  if (appQuitting || outcome === 'cancelled' || !windowHidden) {
    return { phase: 'idle', kind: normalizedKind, outcome: null };
  }
  return {
    phase: 'completed',
    kind: normalizedKind,
    outcome: outcome === 'success' ? 'success' : 'failure',
  };
}

function createBackgroundTaskPresentation({ phase = 'idle', kind = 'analysis', outcome = null } = {}) {
  const labels = TASK_LABELS[normalizeKind(kind)];
  if (phase === 'processing') {
    return {
      trayTitle: '…',
      tooltip: `Slipstream · ${labels.tooltip}`,
      statusLabel: labels.processing,
      notification: null,
    };
  }
  if (phase === 'completed' && outcome === 'success') {
    return {
      trayTitle: '✓',
      tooltip: `Slipstream · ${labels.success}`,
      statusLabel: labels.success,
      notification: {
        title: labels.successTitle,
        body: labels.successBody,
      },
    };
  }
  if (phase === 'completed' && outcome === 'failure') {
    return {
      trayTitle: '!',
      tooltip: `Slipstream · ${labels.failure}`,
      statusLabel: labels.failure,
      notification: {
        title: labels.failureTitle,
        body: labels.failureBody,
      },
    };
  }
  return {
    trayTitle: '',
    tooltip: 'Slipstream',
    statusLabel: 'Slipstream 已就绪',
    notification: null,
  };
}

module.exports = { createBackgroundTaskPresentation, createCompletedTaskState };
