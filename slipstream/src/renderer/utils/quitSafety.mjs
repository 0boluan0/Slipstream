import { PROCESSING_LOCATION_KINDS } from '../../shared/endpoint-location.mjs';

const RISK_KEYS = Object.freeze([
  'activeAnalysis',
  'activeVerification',
  'activeProviderTest',
  'hasSourceDraft',
  'hasResult',
  'hasReplyWork',
  'hasPendingClipboardWrite',
  'hasPendingClipboardAcknowledgement',
  'hasClipboardCopyConsequence',
  'hasClipboardResidueRisk',
  'hasPendingClipboard',
  'hasPendingCapture',
  'hasClearedSessionUndo',
  'hasConnectionDraft',
  'hasPromptDraft',
  'resetInProgress',
  'hasResetRecovery',
  'settingsSaving',
]);

const LOCATION_KEYS = Object.freeze([
  'activeAnalysisLocation',
  'activeProviderTestLocation',
]);

function normalizeLocation(value) {
  return Object.values(PROCESSING_LOCATION_KINDS).includes(value)
    ? value
    : PROCESSING_LOCATION_KINDS.UNKNOWN;
}

export const EMPTY_QUIT_RISK = Object.freeze({
  ...Object.fromEntries(RISK_KEYS.map((key) => [key, false])),
  ...Object.fromEntries(LOCATION_KEYS.map((key) => [key, PROCESSING_LOCATION_KINDS.UNKNOWN])),
});

export function normalizeQuitRisk(candidate = {}) {
  return {
    ...Object.fromEntries(RISK_KEYS.map((key) => [key, candidate?.[key] === true])),
    ...Object.fromEntries(LOCATION_KEYS.map((key) => [key, normalizeLocation(candidate?.[key])])),
  };
}

function mergeActiveLocation(normalized, activeKey, locationKey) {
  const locations = normalized
    .filter((candidate) => candidate[activeKey])
    .map((candidate) => candidate[locationKey]);
  for (const preferred of [
    PROCESSING_LOCATION_KINDS.ONLINE,
    PROCESSING_LOCATION_KINDS.LOCAL_LOOPBACK,
    PROCESSING_LOCATION_KINDS.LOCAL,
  ]) {
    if (locations.includes(preferred)) return preferred;
  }
  return PROCESSING_LOCATION_KINDS.UNKNOWN;
}

export function mergeQuitRisks(...candidates) {
  const normalized = candidates.map(normalizeQuitRisk);
  return {
    ...Object.fromEntries(RISK_KEYS.map((key) => [
      key,
      normalized.some((candidate) => candidate[key]),
    ])),
    activeAnalysisLocation: mergeActiveLocation(
      normalized,
      'activeAnalysis',
      'activeAnalysisLocation',
    ),
    activeProviderTestLocation: mergeActiveLocation(
      normalized,
      'activeProviderTest',
      'activeProviderTestLocation',
    ),
  };
}

export function hasQuitRisk(candidate = {}) {
  const risk = normalizeQuitRisk(candidate);
  return RISK_KEYS.some((key) => risk[key]);
}

export function describeQuitRisk(candidate = {}) {
  const risk = normalizeQuitRisk(candidate);
  const activeTask = risk.activeAnalysis || risk.activeVerification || risk.activeProviderTest;
  const hasClipboardConsequence = risk.hasClipboardCopyConsequence
    || risk.hasClipboardResidueRisk;
  const hasSessionLoss = risk.hasSourceDraft
    || risk.hasResult
    || risk.hasReplyWork
    || risk.hasPendingClipboardWrite
    || risk.hasPendingClipboardAcknowledgement
    || risk.hasPendingClipboard
    || risk.hasPendingCapture
    || risk.hasClearedSessionUndo
    || risk.hasConnectionDraft
    || risk.hasPromptDraft;
  const items = [];

  if (risk.activeAnalysis) {
    if (risk.activeAnalysisLocation === PROCESSING_LOCATION_KINDS.ONLINE) {
      items.push('当前分析会被停止，本次不会生成可查看结果；在线服务可能已经接收原文并产生费用。');
    } else if (risk.activeAnalysisLocation === PROCESSING_LOCATION_KINDS.LOCAL_LOOPBACK) {
      items.push('当前本机兼容服务请求会被停止，本次不会生成可查看结果；原文可能已到达本机回环服务，它是否再联网或计费取决于自己的配置。');
    } else if (risk.activeAnalysisLocation === PROCESSING_LOCATION_KINDS.LOCAL) {
      items.push('当前本机分析会被停止，本次不会生成可查看结果；原文没有发送给在线模型服务。');
    } else {
      items.push('当前分析会被停止，本次不会生成可查看结果；当前服务可能已经接收原文，但处理位置与计费情况无法确认。');
    }
  }
  if (risk.activeVerification) {
    items.push('正在进行的官方来源查找会被停止，当前已保留的结果不会写入历史。');
  }
  if (risk.activeProviderTest) {
    if (risk.activeProviderTestLocation === PROCESSING_LOCATION_KINDS.ONLINE) {
      items.push('完整分析能力验证会被停止；在线服务可能已经产生少量调用费用。');
    } else if (risk.activeProviderTestLocation === PROCESSING_LOCATION_KINDS.LOCAL_LOOPBACK) {
      items.push('完整分析能力验证会被停止；本机兼容服务是否再联网或计费取决于自己的配置。');
    } else if (risk.activeProviderTestLocation === PROCESSING_LOCATION_KINDS.LOCAL) {
      items.push('本机完整分析能力验证会被停止；不会产生在线模型调用费用。');
    } else {
      items.push('完整分析能力验证会被停止；当前服务的位置与计费情况无法确认。');
    }
  }
  if (risk.hasResult) {
    items.push('当前结果与对应原文只保留在这次会话中，退出后无法恢复。');
  } else if (risk.hasSourceDraft) {
    items.push('当前原文尚未生成结果，只保留在这次会话中，退出后无法恢复。');
  }
  if (risk.hasReplyWork) {
    items.push('未发送的英文回复草稿及你确认的真实进度只保留在当前窗口，退出后会丢失；Slipstream 不会自动发送。');
  }
  if (risk.hasPendingClipboardWrite) {
    items.push('内容正在写入系统剪贴板；收到明确写入结果前不会退出。');
  }
  if (risk.hasPendingClipboardAcknowledgement) {
    items.push('正在确认你已在其他位置复制新内容；收到明确结果前不会退出。');
  }
  if (risk.hasPendingClipboard) {
    items.push('等待处理的最新复制文字只保存在内存中，退出后会丢失；系统剪贴板不会被清除。');
  }
  if (risk.hasPendingCapture) {
    items.push('等待确认的截图请求只保存在本次会话中；退出后不会开始截图框选。');
  }
  if (risk.hasClearedSessionUndo) {
    items.push('刚清空内容的撤销机会仍在倒计时，退出后将立即失效。');
  }
  if (risk.hasClipboardCopyConsequence && !risk.hasClipboardResidueRisk) {
    items.push('Slipstream 上次复制的内容可能仍在系统剪贴板；退出不会读取、清除或覆盖它。');
  }
  if (risk.hasClipboardResidueRisk) {
    items.push('界面中断前由 Slipstream 复制的内容可能仍在系统剪贴板；退出不会检查、清除或覆盖当前剪贴板。');
  }
  if (risk.hasConnectionDraft) {
    items.push('未保存的 API Key、服务地址或模型草稿会丢失；已经保存的配置不受影响。');
  }
  if (risk.hasPromptDraft) {
    items.push('未保存的高级分析说明会丢失；已经保存的说明与其他配置不受影响。');
  }
  if (risk.resetInProgress) {
    items.push('应用内数据正在清除；完成前不会退出。成功后会继续这次退出，失败时会保留可见的恢复选择。');
  }
  if (risk.hasResetRecovery) {
    items.push('本次应用内数据清除尚未确认完成；现在退出会放弃设置中可见的重试与恢复入口，凭据、术语或设置等尚未清除的数据可能仍然保留。');
  }
  if (risk.settingsSaving) {
    items.push('设置仍在保存；完成前不会允许退出，以免留下不确定状态。');
  }

  if (items.length === 0) {
    return {
      title: '可以安全退出',
      items: ['当前没有尚未处理的会话内容；Slipstream 正在完成退出。'],
      confirmLabel: '退出 Slipstream',
      safeLabel: '继续使用 Slipstream',
      busy: false,
    };
  }

  const busy = risk.settingsSaving
    || risk.resetInProgress
    || risk.hasPendingClipboardWrite
    || risk.hasPendingClipboardAcknowledgement;

  return {
    title: activeTask
      ? '退出会停止当前任务'
      : risk.resetInProgress
        ? '清除完成后退出'
        : risk.hasPendingClipboardWrite
          ? '正在确认剪贴板复制'
          : risk.hasPendingClipboardAcknowledgement
            ? '正在确认手动覆盖'
            : risk.hasResult
              ? '退出会丢失当前结果'
              : hasClipboardConsequence
                ? '退出前确认系统剪贴板后果'
                : risk.hasResetRecovery
                  ? '退出会放弃清除恢复'
                  : '退出会丢失未保存内容',
    items,
    confirmLabel: risk.hasPendingClipboardWrite
      ? '等待复制完成'
      : risk.hasPendingClipboardAcknowledgement
        ? '等待确认完成'
        : risk.resetInProgress
          ? '等待清除完成'
          : hasClipboardConsequence
            ? risk.hasResetRecovery
              ? activeTask
                ? '保留当前剪贴板、停止任务并放弃剩余清除'
                : '保留当前剪贴板、放弃剩余清除并退出'
              : activeTask
                ? '保留当前剪贴板并停止任务'
                : '保留当前剪贴板并退出'
            : activeTask
              ? risk.hasResetRecovery
                ? '停止任务、放弃剩余清除并退出'
                : '停止任务并退出'
              : risk.hasResetRecovery
                ? hasSessionLoss
                  ? '退出并放弃本次会话与剩余清除'
                  : '退出并放弃剩余清除'
                : '退出并放弃本次会话',
    safeLabel: risk.hasPendingClipboardWrite
      ? '取消退出并等待复制'
      : risk.hasPendingClipboardAcknowledgement
        ? '取消退出并等待确认'
        : risk.resetInProgress
          ? '取消退出并等待清除'
          : risk.hasClipboardResidueRisk
            ? '返回并检查剪贴板'
            : risk.hasResetRecovery
              ? '继续处理剩余清除'
              : '继续使用 Slipstream',
    busy,
    busyMessage: risk.hasPendingClipboardWrite
      ? '系统剪贴板写入仍在确认；完成前不会退出。'
      : risk.hasPendingClipboardAcknowledgement
        ? 'Slipstream 仍在确认这次手动覆盖声明；完成前不会退出。'
        : risk.resetInProgress
          ? '应用内数据清除完成后会继续这次退出；如果清除失败，Slipstream 会保留恢复入口，不会自动退出。'
          : '设置保存完成后才能退出；如果保存失败，草稿会继续保留供你处理。',
  };
}
