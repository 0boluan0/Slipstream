const REPLY_CONTENT_IDENTITY_PATTERN = /^reply-content-v1-[a-f0-9]{16}$/;
const REPLY_MODEL_IDENTITY_PATTERN = /^reply-v1-[a-f0-9]{16}$/;
const MAX_CONSEQUENCE_ID_LENGTH = 100;

function hash32(text, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
    hash ^= hash >>> 13;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createReplyContentIdentity(draft) {
  const text = typeof draft === 'string' ? draft : '';
  return `reply-content-v1-${hash32(text, 0x811c9dc5)}${hash32(text, 0x9e3779b9)}`;
}

function validRequestId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validTaskGeneration(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validModelIdentity(value) {
  return typeof value === 'string' && REPLY_MODEL_IDENTITY_PATTERN.test(value);
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

function snapshotPreviousConsequence(notice) {
  const source = notice?.status === 'copying' ? notice.previousConsequence : notice;
  if (!validConsequenceId(source?.consequenceId)) return null;
  return {
    kind: source.kind,
    status: source.status,
    consequenceId: source.consequenceId,
    message: source.message,
    detail: source.detail,
    ...(validModelIdentity(source.modelIdentity) ? { modelIdentity: source.modelIdentity } : {}),
    ...(REPLY_CONTENT_IDENTITY_PATTERN.test(source.contentIdentity || '')
      ? { contentIdentity: source.contentIdentity }
      : {}),
    ...(validTaskGeneration(source.taskGeneration)
      ? { taskGeneration: source.taskGeneration }
      : {}),
  };
}

export function beginReplyClipboardCopy({
  requestId,
  modelIdentity,
  draft,
  taskGeneration,
  previousNotice = null,
} = {}) {
  if (!validRequestId(requestId) || !validTaskGeneration(taskGeneration)
    || !validModelIdentity(modelIdentity) || typeof draft !== 'string') {
    return null;
  }
  const previousConsequence = snapshotPreviousConsequence(previousNotice);
  return {
    kind: 'reply',
    status: 'copying',
    consequenceId: null,
    requestId,
    taskGeneration,
    modelIdentity,
    contentIdentity: createReplyContentIdentity(draft),
    outdated: false,
    taskExited: false,
    dismissed: false,
    previousConsequence,
    message: '正在复制英文回复',
    detail: previousConsequence
      ? '可继续修改；写入完成前，系统剪贴板仍可能保留先前内容。'
      : '可继续修改；写入完成后，Slipstream 会说明剪贴板对应当前版还是上一版。',
  };
}

export function isReplyClipboardCopyPending(notice) {
  return notice?.kind === 'reply'
    && notice?.status === 'copying'
    && validRequestId(notice?.requestId);
}

export function markPendingReplyCopyOutdated(notice) {
  if (!isReplyClipboardCopyPending(notice) || notice.outdated === true) return notice;
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

export function markPendingReplyCopyAfterTaskExit(notice) {
  if (!isReplyClipboardCopyPending(notice)) return notice;
  return {
    ...notice,
    taskExited: true,
    dismissed: false,
    message: notice.outdated
      ? '任务已结束，正在确认上一版英文回复是否复制'
      : '任务已结束，正在确认英文回复是否复制',
    detail: '系统写入完成前不会丢失结果；成功后仍会提醒你检查或手动覆盖系统剪贴板。',
  };
}

function replyRelation(notice, replyDraftState, taskActive, completionClaimCurrent = true) {
  if (!taskActive || !validModelIdentity(replyDraftState?.modelIdentity)) return 'retained';
  if (replyDraftState.modelIdentity !== notice.modelIdentity) return 'retained';
  if (createReplyContentIdentity(replyDraftState.draft) !== notice.contentIdentity) {
    return 'outdated';
  }
  if (replyDraftState.completionStatus === 'completed' && completionClaimCurrent !== true) {
    return 'outdated';
  }
  return 'current';
}

function copiedReplyNotice(response, pendingNotice) {
  const consequenceId = consequenceIdFromResponse(response);
  if (!consequenceId) {
    const error = new Error('clipboard-consequence-id-missing');
    error.code = 'clipboard-consequence-id-missing';
    throw error;
  }
  return {
    kind: 'reply',
    status: 'copied',
    consequenceId,
    modelIdentity: pendingNotice.modelIdentity,
    contentIdentity: pendingNotice.contentIdentity,
    taskGeneration: pendingNotice.taskGeneration,
    dismissed: false,
    message: '英文回复已复制到系统剪贴板',
    detail: '系统剪贴板可能被其他应用读取。Slipstream 不会自动读取、清除或覆盖；使用完后，请在其他位置复制一段不敏感文字手动覆盖。',
  };
}

function asOutdated(notice) {
  return {
    ...notice,
    status: 'outdated',
    dismissed: false,
    message: '剪贴板里仍可能是上一版英文回复',
    detail: '当前草稿已经改变，系统剪贴板不会自动更新；请重新检查并复制最新版，或在其他位置复制不敏感文字手动覆盖。',
  };
}

function asRetained(notice) {
  return {
    ...notice,
    status: 'retained',
    taskExited: true,
    dismissed: false,
    message: '任务已结束，系统剪贴板仍保留英文回复',
    detail: 'Slipstream 不会自动读取、清除或覆盖；使用完后，请在其他位置复制一段不敏感文字手动覆盖。',
  };
}

export function settleReplyClipboardCopySuccess(notice, response, {
  requestId,
  replyDraftState,
  taskActive = true,
  completionClaimCurrent = true,
} = {}) {
  if (!isReplyClipboardCopyPending(notice) || notice.requestId !== requestId) return notice;
  const written = copiedReplyNotice(response, notice);
  const relation = replyRelation(
    notice,
    replyDraftState,
    taskActive && notice.taskExited !== true,
    completionClaimCurrent,
  );
  if (relation === 'retained') return asRetained(written);
  if (relation === 'outdated' || notice.outdated === true) return asOutdated(written);
  return written;
}

function reconcilePreviousConsequence(
  previous,
  replyDraftState,
  taskActive,
  completionClaimCurrent,
) {
  if (!validConsequenceId(previous?.consequenceId)) return null;
  const restored = { ...previous, dismissed: false };
  if (previous.kind !== 'reply' || !validModelIdentity(previous.modelIdentity)) return restored;
  const relation = replyRelation(
    previous,
    replyDraftState,
    taskActive,
    completionClaimCurrent,
  );
  if (relation === 'retained') return asRetained(restored);
  if (relation === 'outdated') return asOutdated(restored);
  return {
    ...restored,
    status: 'copied',
    taskExited: false,
    message: '英文回复已复制到系统剪贴板',
    detail: '系统剪贴板可能被其他应用读取。使用完后，请在其他位置复制一段不敏感文字手动覆盖。',
  };
}

export function settleReplyClipboardCopyFailure(notice, {
  requestId,
  replyDraftState,
  taskActive = true,
  completionClaimCurrent = true,
} = {}) {
  if (!isReplyClipboardCopyPending(notice) || notice.requestId !== requestId) return notice;
  const previous = reconcilePreviousConsequence(
    notice.previousConsequence,
    replyDraftState,
    taskActive && notice.taskExited !== true,
    completionClaimCurrent,
  );
  if (previous) {
    return {
      ...previous,
      dismissed: false,
      message: '英文回复没有复制；系统剪贴板仍可能保留先前内容',
      detail: '这次写入失败，没有覆盖先前内容；可以重试，或在其他位置复制不敏感文字手动覆盖。',
    };
  }
  if (!taskActive || notice.taskExited === true) {
    return {
      kind: 'reply',
      status: 'copy-error',
      consequenceId: null,
      modelIdentity: notice.modelIdentity,
      contentIdentity: notice.contentIdentity,
      taskGeneration: notice.taskGeneration,
      taskExited: true,
      dismissed: false,
      message: '任务已结束，英文回复没有复制',
      detail: '系统剪贴板没有因这次操作改变；如仍需要，请撤销清空后重新复制。',
    };
  }
  return {
    kind: 'reply',
    status: 'copy-error',
    consequenceId: null,
    modelIdentity: notice.modelIdentity,
    contentIdentity: notice.contentIdentity,
    taskGeneration: notice.taskGeneration,
    dismissed: false,
    message: '没有复制英文回复',
    detail: '剪贴板内容没有因这次操作改变；可以重试，或选中文本手动复制。',
  };
}

export function reconcileReplyClipboardNotice(notice, {
  replyDraftState,
  taskActive = true,
  completionClaimCurrent = true,
} = {}) {
  if (notice?.kind !== 'reply') return notice;
  if (isReplyClipboardCopyPending(notice)) {
    if (!taskActive || replyDraftState?.modelIdentity !== notice.modelIdentity) {
      return markPendingReplyCopyAfterTaskExit(notice);
    }
    const outdated = createReplyContentIdentity(replyDraftState?.draft) !== notice.contentIdentity
      || (
        replyDraftState?.completionStatus === 'completed'
        && completionClaimCurrent !== true
      );
    const activeNotice = {
      ...notice,
      taskExited: false,
      dismissed: false,
      message: '正在复制英文回复',
      detail: '可继续修改；写入完成后，Slipstream 会说明剪贴板对应当前版还是上一版。',
    };
    return outdated ? markPendingReplyCopyOutdated({ ...activeNotice, outdated: false }) : {
      ...activeNotice,
      outdated: false,
    };
  }
  if (['copied', 'outdated', 'retained'].includes(notice.status)
    && validConsequenceId(notice.consequenceId)) {
    const relation = replyRelation(
      notice,
      replyDraftState,
      taskActive,
      completionClaimCurrent,
    );
    if (relation === 'current') {
      return {
        ...notice,
        status: 'copied',
        taskExited: false,
        dismissed: false,
        message: '英文回复已复制到系统剪贴板',
        detail: '系统剪贴板可能被其他应用读取。使用完后，请在其他位置复制一段不敏感文字手动覆盖。',
      };
    }
    if (relation === 'outdated') return asOutdated(notice);
    if (relation === 'retained') return asRetained(notice);
  }
  if (notice.status === 'copy-error' && notice.taskExited === true
    && replyDraftState?.modelIdentity === notice.modelIdentity) {
    return {
      ...notice,
      taskExited: false,
      dismissed: false,
      message: '没有复制英文回复',
      detail: '剪贴板内容没有因这次操作改变；可以重试，或选中文本手动复制。',
    };
  }
  return notice;
}
