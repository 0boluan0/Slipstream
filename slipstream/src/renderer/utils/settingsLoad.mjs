import { SETUP_MODES } from './setupReadiness.mjs';

const VALID_SETUP_MODES = new Set(Object.values(SETUP_MODES));
const VALID_BACKENDS = new Set([
  'anthropic',
  'openai',
  'deepseek',
  'ollama',
  'custom',
  'free_translate',
]);
const UNSAFE_SECRET_KEYS = Object.freeze([
  'anthropicApiKey',
  'openaiApiKey',
  'deepseekApiKey',
  'customEndpointApiKey',
]);

export const STARTUP_BLOCK_REASONS = Object.freeze({
  CORRUPT_JSON: 'corrupt-json',
  SCHEMA_INVALID: 'schema-invalid',
  UNAVAILABLE: 'unavailable',
  MIGRATION_FAILED: 'migration-failed',
});

const VALID_STARTUP_BLOCK_REASONS = new Set(Object.values(STARTUP_BLOCK_REASONS));

export const SETTINGS_LOAD_TIMEOUT_MS = 2000;

function isPlainRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function sanitizeStartupBlockReason(reason) {
  return VALID_STARTUP_BLOCK_REASONS.has(reason)
    ? reason
    : STARTUP_BLOCK_REASONS.UNAVAILABLE;
}

export function isLoadedSettingsPayload(payload) {
  return Boolean(
    isPlainRecord(payload)
      && payload.startupBlocked !== true
      && VALID_SETUP_MODES.has(payload.setupMode)
      && VALID_BACKENDS.has(payload.activeBackend)
      && typeof payload.activeModel === 'string'
      && payload.activeModel.trim()
      && UNSAFE_SECRET_KEYS.every((key) => !payload[key])
  );
}

export function classifySettingsLoadPayload(payload) {
  if (isPlainRecord(payload) && payload.startupBlocked === true) {
    return {
      status: 'blocked',
      reason: sanitizeStartupBlockReason(payload.reason),
    };
  }
  if (isLoadedSettingsPayload(payload)) {
    return { status: 'ready', settings: payload };
  }
  return {
    status: 'blocked',
    reason: STARTUP_BLOCK_REASONS.SCHEMA_INVALID,
  };
}

export function normalizeRecoveryNotice(payload) {
  if (!isPlainRecord(payload) || typeof payload.backupCreated !== 'boolean') return null;
  if (!payload.backupCreated) {
    return payload.backupFileName === null
      ? { backupCreated: false, backupFileName: null }
      : null;
  }

  if (typeof payload.backupFileName !== 'string') return null;
  const backupFileName = payload.backupFileName.trim();
  if (
    !backupFileName
    || backupFileName.length > 180
    || backupFileName === '.'
    || backupFileName === '..'
    || backupFileName.includes('/')
    || backupFileName.includes('\\')
    || [...backupFileName].some((character) => {
      const code = character.codePointAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    return null;
  }
  return { backupCreated: true, backupFileName };
}

export function classifySettingsRecoveryResponse(payload) {
  if (isPlainRecord(payload) && payload.status === 'recovered') {
    if (!isLoadedSettingsPayload(payload.settings)) {
      return {
        status: 'failed',
        reason: STARTUP_BLOCK_REASONS.SCHEMA_INVALID,
      };
    }
    const recovery = normalizeRecoveryNotice(payload.recovery);
    if (recovery) {
      return {
        status: 'recovered',
        settings: payload.settings,
        recovery,
      };
    }
  }
  if (isPlainRecord(payload) && payload.status === 'failed') {
    return {
      status: 'failed',
      reason: sanitizeStartupBlockReason(payload.reason),
    };
  }
  return {
    status: 'failed',
    reason: STARTUP_BLOCK_REASONS.UNAVAILABLE,
  };
}

export function settingsLoadErrorCode(error) {
  if (error?.code === 'settings-load-timeout') return 'timeout';
  if (error?.code === 'settings-load-invalid') return STARTUP_BLOCK_REASONS.SCHEMA_INVALID;
  if (VALID_STARTUP_BLOCK_REASONS.has(error?.code)) return error.code;
  return STARTUP_BLOCK_REASONS.UNAVAILABLE;
}
