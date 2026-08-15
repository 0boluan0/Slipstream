const INTENT_COPY = Object.freeze({
  close: Object.freeze({
    actionLabel: '返回主面板',
    confirmLabel: '停止验证并返回',
    safeLabel: '继续等待',
  }),
  backend: Object.freeze({
    actionLabel: '切换分析服务',
    confirmLabel: '停止验证并切换服务',
    safeLabel: '继续等待',
  }),
  location: Object.freeze({
    actionLabel: '切换处理位置',
    confirmLabel: '停止验证并切换位置',
    safeLabel: '继续等待',
  }),
  'translation-fallback': Object.freeze({
    actionLabel: '改用基础翻译',
    confirmLabel: '停止验证并改用基础翻译',
    safeLabel: '继续等待',
  }),
});

export function describeConnectionTestExitIntent(intent, { guidedSetup = false } = {}) {
  if (intent?.kind === 'capture') {
    const actionLabel = intent.captureKind === 'screenshot' ? '开始截图' : '处理新文字';
    return {
      actionLabel,
      confirmLabel: `停止验证并${actionLabel}`,
      safeLabel: '继续等待，稍后处理',
    };
  }
  if (intent?.kind === 'close' && guidedSetup) {
    return {
      actionLabel: '返回首次使用选择',
      confirmLabel: '停止验证并返回首次使用选择',
      safeLabel: '继续等待',
    };
  }
  return INTENT_COPY[intent?.kind] || INTENT_COPY.close;
}

export function isConnectionTestStopConfirmed(response) {
  return response?.status === 'cancelled';
}

export function didConnectionTestFinishBeforeStop(response) {
  return response?.status === 'not-running';
}
