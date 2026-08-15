const ACTION_BRIEF_SOURCE_LANGUAGE_TAGS = Object.freeze({
  en: 'en',
  zh: 'zh-CN',
  mixed: 'mul',
  unknown: 'und',
});

const HAN_CHARACTER = /\p{Script=Han}/u;
const LATIN_CHARACTER = /\p{Script=Latin}/u;

/**
 * Convert ActionBriefV1's closed source-language enum to honest BCP 47 tags.
 * Values outside the enum fail closed to an explicitly undetermined language.
 */
export function getActionBriefSourceLanguageTag(sourceLanguage) {
  return ACTION_BRIEF_SOURCE_LANGUAGE_TAGS[sourceLanguage] || 'und';
}

/**
 * Infer only the language distinctions the renderer can make conservatively.
 * Other scripts and content without letters remain explicitly undetermined.
 */
export function inferTextLanguageTag(value) {
  const text = typeof value === 'string' ? value.normalize('NFKC') : '';
  const hasHan = HAN_CHARACTER.test(text);
  const hasLatin = LATIN_CHARACTER.test(text);

  if (hasHan && hasLatin) return 'mul';
  if (hasHan) return 'zh-CN';
  if (hasLatin) return 'en';
  return 'und';
}

/**
 * Prefer what a content fragment itself establishes, then fall back to the
 * containing action brief's declared source language for punctuation/dates.
 */
export function getContentLanguageTag(value, sourceLanguage = 'unknown') {
  const inferred = inferTextLanguageTag(value);
  return inferred === 'und'
    ? getActionBriefSourceLanguageTag(sourceLanguage)
    : inferred;
}

export { ACTION_BRIEF_SOURCE_LANGUAGE_TAGS };
