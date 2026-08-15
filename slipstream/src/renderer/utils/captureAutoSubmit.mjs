function isValidGeneration(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function ownsDelayedCaptureDispatch({
  ownerToken,
  currentToken,
  ownerSourceRevision,
  currentSourceRevision,
  visible,
  foregroundBlocked,
  processing,
} = {}) {
  return isValidGeneration(ownerToken)
    && isValidGeneration(currentToken)
    && ownerToken === currentToken
    && isValidGeneration(ownerSourceRevision)
    && isValidGeneration(currentSourceRevision)
    && ownerSourceRevision === currentSourceRevision
    && visible === true
    && foregroundBlocked === false
    && processing === false;
}
