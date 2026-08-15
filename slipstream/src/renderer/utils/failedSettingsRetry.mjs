import { SETUP_MODES } from './setupReadiness.mjs';

export const PROCESSING_CONFIG_KEYS = new Set([
  'anthropicApiKey',
  'openaiApiKey',
  'deepseekApiKey',
  'ollamaBaseUrl',
  'customEndpointUrl',
  'customEndpointApiKey',
  'activeBackend',
  'activeModel',
  'customPrompt',
  'languageHint',
  'verificationPolicy',
]);

function copyEntries(entries = []) {
  return entries.map(([key, value]) => [key, value]);
}

function includesFullSetup(entries) {
  return entries.some(([key, value]) => (
    key === 'setupMode' && value === SETUP_MODES.FULL
  ));
}

export function createFailedSaveOperation(entries, processingConfigGeneration) {
  const copiedEntries = copyEntries(entries);
  return {
    entries: copiedEntries,
    fullSetupConfigGeneration: includesFullSetup(copiedEntries)
      ? processingConfigGeneration
      : null,
  };
}

/**
 * Preserve every independently failed setting while replacing stale attempts
 * for keys the user has just tried again. A later failure must not orphan an
 * earlier one behind a global retry action that can no longer reach it.
 */
export function mergeFailedSaveOperation(
  operation,
  entries,
  processingConfigGeneration,
) {
  const incomingEntries = copyEntries(entries);
  const incomingKeys = new Set(incomingEntries.map(([key]) => key));
  const retainedEntries = failedSaveEntries(operation)
    .filter(([key]) => !incomingKeys.has(key));
  const mergedEntries = [...retainedEntries, ...incomingEntries];
  if (mergedEntries.length === 0) return null;

  const incomingOwnsFullSetup = includesFullSetup(incomingEntries);
  const retainedOwnsFullSetup = includesFullSetup(retainedEntries);
  const fullSetupConfigGeneration = incomingOwnsFullSetup
    ? processingConfigGeneration
    : retainedOwnsFullSetup
      ? operation?.fullSetupConfigGeneration
      : processingConfigGeneration;
  return createFailedSaveOperation(mergedEntries, fullSetupConfigGeneration);
}

export function failedSaveEntries(operation) {
  return Array.isArray(operation?.entries) ? operation.entries : [];
}

export function removeFailedSaveOperationKeys(operation, keys = []) {
  const removedKeys = new Set(keys);
  const entries = failedSaveEntries(operation).filter(([key]) => !removedKeys.has(key));
  if (entries.length === 0) return null;
  return createFailedSaveOperation(entries, operation.fullSetupConfigGeneration);
}

export function reconcileFailedSaveOperation(operation, processingConfigGeneration) {
  const entries = failedSaveEntries(operation);
  if (
    entries.length === 0
    || operation.fullSetupConfigGeneration === null
    || operation.fullSetupConfigGeneration === processingConfigGeneration
  ) {
    return { operation, invalidated: false, removedKeys: [] };
  }

  const removedKeys = [];
  const retryableEntries = entries.filter(([key]) => {
    const connectionBound = key === 'setupMode' || PROCESSING_CONFIG_KEYS.has(key);
    if (connectionBound) removedKeys.push(key);
    return !connectionBound;
  });

  return {
    operation: retryableEntries.length
      ? createFailedSaveOperation(retryableEntries, processingConfigGeneration)
      : null,
    invalidated: true,
    removedKeys: [...new Set(removedKeys)],
  };
}
