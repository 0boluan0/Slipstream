export function openSourceEditDraft(sourceText, existingDraft = null) {
  const baseSourceText = String(sourceText || '');
  const reusableText = existingDraft?.baseSourceText === baseSourceText
    ? String(existingDraft.text ?? '')
    : baseSourceText;
  return { baseSourceText, text: reusableText };
}

export function updateSourceEditDraft(existingDraft, nextText, fallbackSourceText = '') {
  const baseSourceText = typeof existingDraft?.baseSourceText === 'string'
    ? existingDraft.baseSourceText
    : String(fallbackSourceText || '');
  return { baseSourceText, text: String(nextText ?? '') };
}

export function hasModifiedSourceEditDraft(draft, currentSourceText) {
  const currentSource = String(currentSourceText || '');
  return Boolean(
    draft
    && draft.baseSourceText === currentSource
    && draft.text !== draft.baseSourceText,
  );
}
