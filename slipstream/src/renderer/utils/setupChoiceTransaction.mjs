export const SETUP_CHOICE_ACTIONS = Object.freeze({
  CONFIGURE_FULL: 'configure-full',
  RETRY_TRANSLATION_ONLY: 'retry-translation-only',
  SAVE_TRANSLATION_ONLY: 'save-translation-only',
});

export const TRANSLATION_ONLY_SETUP_KEYS = Object.freeze([
  'activeBackend',
  'activeModel',
  'languageHint',
  'setupMode',
]);

export function claimSetupChoice(lockRef, action) {
  if (lockRef.current !== null) return null;
  const claim = Object.freeze({ action });
  lockRef.current = claim;
  return claim;
}

export function releaseSetupChoice(lockRef, claim) {
  if (lockRef.current !== claim) return false;
  lockRef.current = null;
  return true;
}
