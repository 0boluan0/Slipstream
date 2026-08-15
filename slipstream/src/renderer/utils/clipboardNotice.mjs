const COPY_LABELS = Object.freeze({
  result: '完整结果',
  actions: '行动清单',
  reply: '英文回复',
  'source-link': '官方来源链接',
  'saved-term': '术语',
  'saved-term-explanation': '术语解释',
  'saved-term-combined': '术语与解释',
  diagnostics: '诊断摘要',
  'support-diagnostics': '诊断摘要',
  'recovery-command': '恢复命令',
});

const TASK_SCOPED_COPY_KINDS = new Set(['result', 'actions', 'reply', 'source-link']);
const CONSEQUENCE_STATUSES = new Set(['copied', 'outdated', 'retained', 'copy-error']);
const MAX_CONSEQUENCE_ID_LENGTH = 100;

function copyLabel(kind) {
  return COPY_LABELS[kind] || '内容';
}

function validRequestId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validConsequenceId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_CONSEQUENCE_ID_LENGTH;
}

function consequenceIdFromResponse(response) {
  const candidate = response?.consequenceId ?? response?.clipboardConsequence?.id;
  return validConsequenceId(candidate) ? candidate : null;
}

function directClipboardCopyConsequenceId(notice) {
  if (!CONSEQUENCE_STATUSES.has(notice?.status)) return null;
  return validConsequenceId(notice?.consequenceId) ? notice.consequenceId : null;
}

export function clipboardCopyConsequenceId(notice) {
  if (notice?.status === 'copying') {
    return directClipboardCopyConsequenceId(notice.previousConsequence);
  }
  return directClipboardCopyConsequenceId(notice);
}

export function hasClipboardCopyConsequence(notice) {
  return clipboardCopyConsequenceId(notice) !== null;
}

function snapshotClipboardConsequence(notice) {
  const consequenceId = clipboardCopyConsequenceId(notice);
  if (!consequenceId) return null;
  const source = notice?.status === 'copying' ? notice.previousConsequence : notice;
  const consequence = {
    ...source,
    consequenceId,
    dismissed: false,
  };
  delete consequence.previousConsequence;
  delete consequence.requestId;
  return consequence;
}

function retainedClipboardNotice(notice) {
  return {
    ...notice,
    status: 'retained',
    taskExited: true,
    dismissed: false,
    message: `任务已结束，系统剪贴板仍保留${copyLabel(notice.kind)}`,
    detail: 'Slipstream 不会自动读取、清除或覆盖；使用完后，请在其他位置复制一段不敏感文字手动覆盖。',
  };
}

export function beginClipboardCopy({ kind, requestId, previousNotice = null } = {}) {
  if (!Object.hasOwn(COPY_LABELS, kind) || kind === 'reply' || !validRequestId(requestId)) {
    return null;
  }
  const previousConsequence = snapshotClipboardConsequence(previousNotice);
  return {
    kind,
    status: 'copying',
    consequenceId: null,
    requestId,
    taskExited: false,
    dismissed: false,
    previousConsequence,
    message: `正在复制${copyLabel(kind)}`,
    detail: previousConsequence
      ? '写入完成前，系统剪贴板仍可能保留先前内容；如果这次失败，Slipstream 会继续提醒你手动覆盖。'
      : '正在等待系统确认；完成后会提醒你在其他位置复制不敏感文字手动覆盖。',
  };
}

export function settleClipboardCopySuccess(notice, response, { requestId } = {}) {
  if (notice?.status !== 'copying' || notice.kind === 'reply'
    || notice.requestId !== requestId || !validRequestId(requestId)) return notice;
  const copied = createCopiedClipboardNotice(notice.kind, response);
  return notice.taskExited === true && TASK_SCOPED_COPY_KINDS.has(notice.kind)
    ? retainedClipboardNotice(copied)
    : copied;
}

export function settleClipboardCopyFailure(notice, { requestId } = {}) {
  if (notice?.status !== 'copying' || notice.kind === 'reply'
    || notice.requestId !== requestId || !validRequestId(requestId)) return notice;
  const previous = snapshotClipboardConsequence(notice.previousConsequence);
  if (previous) return createClipboardCopyFailureNotice(notice.kind, previous);
  if (notice.taskExited === true && TASK_SCOPED_COPY_KINDS.has(notice.kind)) {
    return {
      kind: notice.kind,
      status: 'copy-error',
      consequenceId: null,
      taskExited: true,
      dismissed: false,
      message: `任务已结束，${copyLabel(notice.kind)}没有复制`,
      detail: '系统剪贴板没有因这次操作改变；如仍需要，请恢复或重新打开对应内容后再复制。',
    };
  }
  return createClipboardCopyFailureNotice(notice.kind);
}

export function createCopiedClipboardNotice(kind, response) {
  const consequenceId = consequenceIdFromResponse(response);
  const excludesSavedSource = kind === 'saved-term'
    || kind === 'saved-term-explanation'
    || kind === 'saved-term-combined';
  return {
    kind,
    status: 'copied',
    consequenceId,
    dismissed: false,
    message: `${copyLabel(kind)}已复制到系统剪贴板`,
    detail: excludesSavedSource
      ? '复制内容不包含保存时的原文片段；系统剪贴板可能被其他应用读取。使用完后，请在其他位置复制一段不敏感文字手动覆盖。'
      : '系统剪贴板可能被其他应用读取。Slipstream 不会自动读取、清除或覆盖；使用完后，请在其他位置复制一段不敏感文字手动覆盖。',
  };
}

export function createClipboardCopyFailureNotice(kind, previousNotice = null) {
  const previousConsequence = snapshotClipboardConsequence(previousNotice);
  if (previousConsequence) {
    return {
      ...previousConsequence,
      dismissed: false,
      message: `没有复制${copyLabel(kind)}；系统剪贴板仍可能保留先前内容`,
      detail: '这次写入失败，没有覆盖先前内容；如内容敏感，请在其他位置复制一段不敏感文字手动覆盖。',
    };
  }
  return {
    kind,
    status: 'copy-error',
    consequenceId: null,
    dismissed: false,
    message: `没有复制${copyLabel(kind)}`,
    detail: '系统剪贴板没有因这次操作改变；可以重试，或选中文字手动复制。',
  };
}

export function markCopiedClipboardNoticeOutdated(notice, kind) {
  if (notice?.kind !== kind) return notice;
  if (notice.status === 'copying' && kind === 'reply') {
    return {
      ...notice,
      outdated: true,
      dismissed: false,
      message: notice.taskExited
        ? '任务已结束，正在确认上一版英文回复是否复制'
        : '正在复制上一版英文回复',
      detail: notice.taskExited
        ? '当前任务已经离开；写入结果会保留为可检查、可手动覆盖的剪贴板状态。'
        : '当前草稿已经改变；写入完成后可重新检查并复制最新版。',
    };
  }
  if (!['copied', 'retained'].includes(notice.status)) return notice;
  return {
    ...notice,
    status: 'outdated',
    taskExited: false,
    dismissed: false,
    message: `剪贴板里仍可能是上一版${copyLabel(kind)}`,
    detail: '当前内容已经改变，系统剪贴板不会自动更新；请重新检查并复制最新版，或在其他位置复制不敏感文字手动覆盖。',
  };
}

export function markClipboardNoticeAfterTaskExit(notice) {
  if (!notice) return { status: 'idle' };
  if (!TASK_SCOPED_COPY_KINDS.has(notice.kind)) {
    return Object.hasOwn(COPY_LABELS, notice.kind) ? notice : { status: 'idle' };
  }
  if (notice.status === 'copying') {
    return {
      ...notice,
      taskExited: true,
      dismissed: false,
      message: notice.kind === 'reply' && notice.outdated
        ? '任务已结束，正在确认上一版英文回复是否复制'
        : `任务已结束，正在确认${copyLabel(notice.kind)}是否复制`,
      detail: '系统写入完成前不会丢失结果；成功后仍会提醒你检查或手动覆盖系统剪贴板。',
    };
  }
  if (notice.status === 'copy-error' && notice.taskExited === true) return notice;
  if (notice.status === 'retained') return notice;
  if (!['copied', 'outdated', 'copy-error'].includes(notice.status)) return { status: 'idle' };
  return hasClipboardCopyConsequence(notice) ? retainedClipboardNotice(notice) : notice;
}

export function dismissClipboardNotice(notice) {
  if (!notice || notice.status === 'idle') return { status: 'idle' };
  if (notice.status === 'copying' || hasClipboardCopyConsequence(notice)) {
    return { ...notice, dismissed: true };
  }
  return { status: 'idle' };
}
