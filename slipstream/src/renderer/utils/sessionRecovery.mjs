import { sanitizeReplyDraftState } from './replyDraftState.mjs';
import { PROCESSING_LOCATION_KINDS } from '../../shared/endpoint-location.mjs';

export const SESSION_RECOVERY_VERSION = 1;
export const SESSION_RECOVERY_KEY = 'slipstream:temporary-session-recovery:v1';
export const SESSION_RECOVERY_TTL_MS = 30 * 60 * 1000;
export const SESSION_RECOVERY_WRITE_DELAY_MS = 180;

const MAX_TEXT_LENGTH = 10000;
const MAX_RESULT_LENGTH = 200000;
const MAX_WARNING_LENGTH = 4000;
const MAX_ACTION_IDS = 50;
const MAX_ACTION_ID_LENGTH = 200;
const MAX_RECORD_BYTES = 750000;
const MAX_MODEL_MARKER_LENGTH = 80;
const VALID_STATUSES = new Set(['idle', 'processing', 'done', 'error']);
const VALID_KINDS = new Set(['draft', 'result', 'edit']);
const VALID_SOURCE_TYPES = new Set(['clipboard', 'manual', 'monitor', 'ocr', 'sample', 'shortcut']);
const VALID_PROCESSING_ERROR_CODES = new Set([
  'model-not-found',
  'ollama-runtime-failed',
  'ollama-unavailable',
  'processing-failed',
  'processing-invalid',
  'processing-key-missing',
  'processing-location-unknown',
  'processing-rate-limited',
  'processing-service-unavailable',
  'processing-timeout',
  'processing-unauthorized',
  'processing-unreachable',
]);
const VALID_PROCESSING_PROVIDERS = new Set([
  'anthropic',
  'custom',
  'deepseek',
  'free_translate',
  'ollama',
  'openai',
]);
const ONLINE_PROCESSING_PROVIDERS = new Set([
  'anthropic',
  'deepseek',
  'free_translate',
  'openai',
]);
const RECOVERY_PROVIDER_LABELS = Object.freeze({
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  free_translate: 'Google Translate / MyMemory',
  openai: 'OpenAI',
});
const MODEL_MARKER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._+:/-]*[A-Za-z0-9])?$/u;
const MODEL_MARKER_SENSITIVE_PATTERN = /(?:^|[._+:/-])(?:api[-_.]?key|authorization|bearer|credential|password|secret|token)(?:$|[._+:/-])|^(?:sk|pk|rk|xox[baprs]|gh[pousr]|glpat|AIza)[-_]/iu;
const MODEL_MARKER_ADDRESS_PATTERN = /(?:[a-z][a-z\d+.-]*:\/\/|www\.|localhost|(?:\d{1,3}\.){3}\d{1,3}|(?:^|\/)[A-Za-z\d-]+(?:\.[A-Za-z\d-]+)*\.[A-Za-z]{2,}(?=[:/]|$))/iu;
const MODEL_MARKER_OPAQUE_PATTERN = /[A-Za-z\d_]{32,}/u;

function boundedString(value, maxLength) {
  return typeof value === 'string' && value.length <= maxLength ? value : '';
}

function cloneJson(value, maxBytes) {
  if (!value || typeof value !== 'object') return null;
  try {
    const serialized = JSON.stringify(value);
    if (byteLength(serialized) > maxBytes) return null;
    return JSON.parse(serialized);
  } catch {
    return null;
  }
}

function byteLength(value) {
  try {
    return new TextEncoder().encode(value).byteLength;
  } catch {
    return value.length * 2;
  }
}

function cleanCaptureMeta(candidate) {
  if (!candidate || typeof candidate !== 'object') return { confidence: null, blocks: [] };
  const confidence = Number.isFinite(candidate.confidence) ? candidate.confidence : null;
  const blocks = Array.isArray(candidate.blocks)
    ? candidate.blocks.slice(0, 1000).map((block) => {
      if (!block || typeof block !== 'object') return null;
      const text = boundedString(block.text, MAX_TEXT_LENGTH);
      if (!text) return null;
      const boundingBox = block.boundingBox && typeof block.boundingBox === 'object'
        ? {
          x: Number.isFinite(block.boundingBox.x) ? block.boundingBox.x : null,
          y: Number.isFinite(block.boundingBox.y) ? block.boundingBox.y : null,
          w: Number.isFinite(block.boundingBox.w) ? block.boundingBox.w : null,
          h: Number.isFinite(block.boundingBox.h) ? block.boundingBox.h : null,
        }
        : null;
      const id = boundedString(block.id, 200);
      return {
        ...(id ? { id } : {}),
        text,
        confidence: Number.isFinite(block.confidence) ? block.confidence : null,
        ...(boundingBox ? { boundingBox } : {}),
      };
    }).filter(Boolean)
    : [];
  return { confidence, blocks };
}

function cleanSourceMeta(candidate) {
  return {
    truncated: Boolean(candidate?.truncated),
    originalLength: Number.isSafeInteger(candidate?.originalLength) && candidate.originalLength >= 0
      ? candidate.originalLength
      : null,
  };
}

function cleanSourceEditDraft(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const baseSourceText = boundedString(candidate.baseSourceText, MAX_TEXT_LENGTH);
  const text = boundedString(candidate.text, MAX_TEXT_LENGTH);
  if (!baseSourceText && !text) return null;
  return { baseSourceText, text };
}

function cleanCompletedActionIds(candidate) {
  if (!Array.isArray(candidate)) return [];
  return [...new Set(candidate
    .slice(0, MAX_ACTION_IDS)
    .map((value) => boundedString(value, MAX_ACTION_ID_LENGTH).trim())
    .filter(Boolean))];
}

function cleanProcessingLocation(candidate) {
  return Object.values(PROCESSING_LOCATION_KINDS).includes(candidate)
    ? candidate
    : PROCESSING_LOCATION_KINDS.UNKNOWN;
}

function cleanProcessingProvider(candidate) {
  return VALID_PROCESSING_PROVIDERS.has(candidate) ? candidate : null;
}

function cleanProcessingSnapshot(providerCandidate, locationCandidate) {
  const provider = cleanProcessingProvider(providerCandidate);
  const location = cleanProcessingLocation(locationCandidate);
  if (!provider) {
    return { processingProvider: null, processingLocation: PROCESSING_LOCATION_KINDS.UNKNOWN };
  }
  const locationMatchesProvider = ONLINE_PROCESSING_PROVIDERS.has(provider)
    ? location === PROCESSING_LOCATION_KINDS.ONLINE
    : provider === 'ollama'
      ? location === PROCESSING_LOCATION_KINDS.LOCAL
      : location === PROCESSING_LOCATION_KINDS.LOCAL_LOOPBACK
        || location === PROCESSING_LOCATION_KINDS.ONLINE;
  return {
    processingProvider: provider,
    processingLocation: locationMatchesProvider
      ? location
      : PROCESSING_LOCATION_KINDS.UNKNOWN,
  };
}

function cleanModelMarker(value) {
  if (typeof value !== 'string') return null;
  const marker = value.trim();
  if (
    !marker
    || marker.length > MAX_MODEL_MARKER_LENGTH
    || !MODEL_MARKER_PATTERN.test(marker)
    || MODEL_MARKER_SENSITIVE_PATTERN.test(marker)
    || MODEL_MARKER_ADDRESS_PATTERN.test(marker)
    || MODEL_MARKER_OPAQUE_PATTERN.test(marker)
  ) {
    return null;
  }
  return marker;
}

function cleanSourceType(candidate) {
  return VALID_SOURCE_TYPES.has(candidate) ? candidate : 'manual';
}

function cleanBrief(candidate) {
  const cloned = cloneJson(candidate, 400000);
  if (!cloned) return null;
  const provenance = cloned.analysisProvenance;
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) return cloned;
  const processingSnapshot = cleanProcessingSnapshot(
    provenance.provider,
    provenance.processingLocation,
  );
  cloned.analysisProvenance = {
    responseKind: boundedString(provenance.responseKind, 80),
    provider: processingSnapshot.processingProvider,
    model: cleanModelMarker(provenance.model),
    processingTimeMs: Number.isFinite(provenance.processingTimeMs)
      ? provenance.processingTimeMs
      : null,
    processingLocation: processingSnapshot.processingLocation,
    promptVersion: boundedString(provenance.promptVersion, 120) || null,
    generatedAt: boundedString(provenance.generatedAt, 100),
  };
  return cloned;
}

function cleanLastGood(candidate) {
  const cloned = cloneJson(candidate, 500000);
  if (!cloned) return null;
  const inputText = boundedString(cloned.inputText, MAX_TEXT_LENGTH);
  const processedSourceText = boundedString(cloned.processedSourceText, MAX_TEXT_LENGTH);
  const result = boundedString(cloned.result, MAX_RESULT_LENGTH);
  const brief = cleanBrief(cloned.brief);
  if (!inputText.trim() && !processedSourceText.trim() && !result && !brief) return null;
  const processingSnapshot = cleanProcessingSnapshot(
    cloned.processingProvider,
    cloned.processingLocation,
  );
  return {
    inputText,
    processedSourceText,
    result,
    brief,
    sourceType: cleanSourceType(cloned.sourceType),
    captureMeta: cleanCaptureMeta(cloned.captureMeta),
    sourceMeta: cleanSourceMeta(cloned.sourceMeta),
    processingTimeMs: Number.isFinite(cloned.processingTimeMs) ? cloned.processingTimeMs : null,
    verificationTimeMs: Number.isFinite(cloned.verificationTimeMs) ? cloned.verificationTimeMs : null,
    verificationApprovalId: null,
    ...processingSnapshot,
    warning: boundedString(cloned.warning, MAX_WARNING_LENGTH),
    completedActionIds: cleanCompletedActionIds(cloned.completedActionIds),
  };
}

function sanitizePayload(session = {}) {
  const inputText = boundedString(session.inputText, MAX_TEXT_LENGTH);
  const processedSourceText = boundedString(session.processedSourceText, MAX_TEXT_LENGTH);
  const result = boundedString(session.result, MAX_RESULT_LENGTH);
  const brief = cleanBrief(session.brief);
  const lastGood = cleanLastGood(session.lastGood);
  const sourceEditDraft = cleanSourceEditDraft(session.sourceEditDraft);
  const status = VALID_STATUSES.has(session.status) ? session.status : 'idle';
  const isEditingSource = Boolean(session.isEditingSource && lastGood);
  const hasCurrentResult = status === 'done' && Boolean(brief || result);
  const hasDraft = Boolean(
    inputText.trim()
    || processedSourceText.trim()
    || sourceEditDraft?.text?.trim(),
  );
  if (!hasDraft && !hasCurrentResult && !lastGood) return null;
  const replyDraftState = hasCurrentResult || lastGood
    ? sanitizeReplyDraftState(session.replyDraftState, { preserveOverride: false })
    : null;
  const processingErrorCode = VALID_PROCESSING_ERROR_CODES.has(session.processingErrorCode)
    ? session.processingErrorCode
    : null;
  const processingSnapshot = cleanProcessingSnapshot(
    session.processingProvider,
    session.processingLocation,
  );

  return {
    inputText,
    processedSourceText,
    brief,
    result,
    captureMeta: cleanCaptureMeta(session.captureMeta),
    sourceMeta: cleanSourceMeta(session.sourceMeta),
    status,
    warning: boundedString(session.warning, MAX_WARNING_LENGTH),
    ...(processingErrorCode ? { processingErrorCode } : {}),
    processingTimeMs: Number.isFinite(session.processingTimeMs) ? session.processingTimeMs : null,
    verificationTimeMs: Number.isFinite(session.verificationTimeMs) ? session.verificationTimeMs : null,
    sourceType: cleanSourceType(session.sourceType),
    ...processingSnapshot,
    lastGood,
    completedActionIds: cleanCompletedActionIds(session.completedActionIds),
    isEditingSource,
    sourceEditDraft,
    replyDraftState,
  };
}

function recoveryKind(payload) {
  if (payload.isEditingSource && payload.lastGood) return 'edit';
  if (payload.status === 'done' && (payload.brief || payload.result)) return 'result';
  if (payload.status === 'processing' && payload.lastGood) return 'result';
  return 'draft';
}

export function createSessionRecoveryRecord(session = {}, now = Date.now()) {
  const savedAt = Number(now);
  if (!Number.isFinite(savedAt)) return null;
  const payload = sanitizePayload(session);
  if (!payload) return null;
  const record = {
    version: SESSION_RECOVERY_VERSION,
    savedAt,
    kind: recoveryKind(payload),
    interruptedTask: payload.status === 'processing' || session.isVerifying === true,
    hadVerificationApproval: Boolean(
      session.verificationApprovalId
      || session.lastGood?.verificationApprovalId,
    ),
    payload,
  };
  try {
    return byteLength(JSON.stringify(record)) <= MAX_RECORD_BYTES ? record : null;
  } catch {
    return null;
  }
}

export function parseSessionRecoveryRecord(serialized, now = Date.now()) {
  if (typeof serialized !== 'string' || !serialized || byteLength(serialized) > MAX_RECORD_BYTES) {
    return null;
  }
  let candidate;
  try {
    candidate = JSON.parse(serialized);
  } catch {
    return null;
  }
  const currentTime = Number(now);
  if (
    !candidate
    || typeof candidate !== 'object'
    || candidate.version !== SESSION_RECOVERY_VERSION
    || !VALID_KINDS.has(candidate.kind)
    || !Number.isFinite(candidate.savedAt)
    || !Number.isFinite(currentTime)
    || candidate.savedAt > currentTime + 5000
    || currentTime - candidate.savedAt > SESSION_RECOVERY_TTL_MS
  ) {
    return null;
  }
  const recreated = createSessionRecoveryRecord({
    ...candidate.payload,
    isVerifying: candidate.interruptedTask && candidate.payload?.status !== 'processing',
    verificationApprovalId: candidate.hadVerificationApproval ? 'discarded' : null,
  }, candidate.savedAt);
  if (!recreated || recreated.kind !== candidate.kind) return null;
  return {
    ...recreated,
    kind: candidate.kind,
    interruptedTask: candidate.interruptedTask === true,
    hadVerificationApproval: candidate.hadVerificationApproval === true,
  };
}

export function readSessionRecovery(storage, now = Date.now()) {
  if (!storage?.getItem) return null;
  try {
    const serialized = storage.getItem(SESSION_RECOVERY_KEY);
    const record = parseSessionRecoveryRecord(serialized, now);
    if (!record && serialized) storage.removeItem(SESSION_RECOVERY_KEY);
    return record;
  } catch {
    return null;
  }
}

export function writeSessionRecovery(storage, record) {
  if (!storage?.setItem || !record) return false;
  try {
    const serialized = JSON.stringify(record);
    if (byteLength(serialized) > MAX_RECORD_BYTES) return false;
    storage.setItem(SESSION_RECOVERY_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

export function clearSessionRecovery(storage) {
  if (!storage?.removeItem) return false;
  try {
    storage.removeItem(SESSION_RECOVERY_KEY);
    return true;
  } catch {
    return false;
  }
}

export function describeSessionRecovery(record, now = Date.now()) {
  const ageMs = Math.max(0, Number(now) - Number(record?.savedAt || now));
  const ageLabel = ageMs < 60000 ? '刚刚' : `${Math.max(1, Math.ceil(ageMs / 60000))} 分钟前`;
  const sourceLength = record?.payload?.inputText?.length
    || record?.payload?.processedSourceText?.length
    || 0;
  const copy = {
    draft: {
      title: '恢复未完成的原文？',
      detail: `发现${ageLabel}留在当前窗口的临时草稿${sourceLength ? `，共 ${sourceLength.toLocaleString('zh-CN')} 字` : ''}。`,
      restoreLabel: '恢复原文',
    },
    result: {
      title: '恢复上一份原文和结果？',
      detail: `发现${ageLabel}留在当前窗口的临时结果及对应原文。`,
      restoreLabel: '恢复原文和结果',
    },
    edit: {
      title: '恢复修正中的原文？',
      detail: `发现${ageLabel}留下的修正草稿；上一份有效结果也仍在当前窗口。`,
      restoreLabel: '恢复草稿和上一份结果',
    },
  }[record?.kind] || null;
  if (!copy) return null;
  const replyDetail = record?.payload?.replyDraftState?.draft
    ? ' 未发送的回复草稿也会一并恢复，但不会自动打开或发送；恢复后不会把草稿视为已经复制，请重新检查并复制。'
    : '';
  const interruptedProcessingSnapshot = cleanProcessingSnapshot(
    record?.payload?.processingProvider,
    record?.payload?.processingLocation,
  );
  const interruptedDestination = interruptedProcessingSnapshot.processingLocation
    === PROCESSING_LOCATION_KINDS.ONLINE
    ? `上次任务曾把完整原文发送给${interruptedProcessingSnapshot.processingProvider === 'custom'
      ? '远程自定义服务'
      : `${RECOVERY_PROVIDER_LABELS[interruptedProcessingSnapshot.processingProvider]}（在线服务）`}。`
    : interruptedProcessingSnapshot.processingLocation
      === PROCESSING_LOCATION_KINDS.LOCAL_LOOPBACK
      ? '上次任务曾把完整原文发送给本机回环兼容服务。'
      : interruptedProcessingSnapshot.processingLocation === PROCESSING_LOCATION_KINDS.LOCAL
        ? '上次任务曾在这台 Mac 上由 Ollama 处理原文。'
        : '上次任务的处理位置未记录，无法确认原文是否曾发送给在线服务。';
  return {
    ...copy,
    detail: `${copy.detail}${replyDetail}`,
    taskDetail: record.interruptedTask
      ? `${interruptedDestination}任务已经停止，不会自动重新发送或产生新的调用。`
      : '',
    approvalDetail: record.hadVerificationApproval
      ? '此前的官方来源核验授权不会恢复；如需核验，请恢复后重新分析，Slipstream 会再次征求允许。'
      : '',
    privacyDetail: '临时内容只属于当前窗口，最多保留 30 分钟；不会进入应用历史、同步或自动发送。',
  };
}

export function prepareSessionRecoveryRestore(record) {
  if (!record?.payload) return null;
  const payload = sanitizePayload(record.payload);
  if (!payload) return null;
  const notice = record.kind === 'result'
    ? '已恢复同一窗口中的临时结果。'
    : record.kind === 'edit'
      ? '已恢复修正草稿和上一份有效结果。'
      : '已恢复同一窗口中的临时原文。';
  const safety = [
    record.interruptedTask ? '上次进行中的任务没有自动重启。' : '',
    record.hadVerificationApproval ? '如需官方核验，请重新分析后再批准。' : '',
  ].filter(Boolean).join('');
  const warning = `${notice}${safety}`;

  if (record.kind === 'result' && payload.lastGood) {
    return {
      ...payload,
      ...payload.lastGood,
      replyDraftState: sanitizeReplyDraftState(payload.replyDraftState, {
        preserveOverride: false,
      }),
      status: 'done',
      warning,
      verificationApprovalId: null,
      isEditingSource: false,
      sourceEditDraft: null,
      lastGood: { ...payload.lastGood, warning, verificationApprovalId: null },
    };
  }

  return {
    ...payload,
    replyDraftState: sanitizeReplyDraftState(payload.replyDraftState, {
      preserveOverride: false,
    }),
    status: record.kind === 'result' ? 'done' : 'idle',
    warning,
    verificationApprovalId: null,
    lastGood: payload.lastGood
      ? { ...payload.lastGood, warning, verificationApprovalId: null }
      : null,
  };
}
