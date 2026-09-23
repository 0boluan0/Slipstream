'use strict';

// Authored material only. Setup never accepts a clipboard, screenshot or user
// excerpt, and its result is a session-only preview rather than saved content.
const READING_SETUP_SOURCE = 'A confounder is a variable that influences both a treatment and an outcome. An association between treatment and outcome may therefore persist even when the treatment has no causal effect.';
const READING_SETUP_SELECTION = 'confounder';

function readingSetupSample(value) {
  if (!value || typeof value !== 'object') return null;
  const validText = (text, limit, chineseRequired) => typeof text === 'string'
    && text.length <= limit && !/\p{Cc}/u.test(text.replace(/\n/gu, ''))
    && (!chineseRequired || /[\u3400-\u9fff]/u.test(text));
  if (!validText(value.translation, 4000, true)
    || !validText(value.meaning, 1500, true)
    || !validText(value.note, 1500, false)) return null;
  return { translation: value.translation.trim(), meaning: value.meaning.trim(), note: value.note.trim() };
}

export { READING_SETUP_SOURCE, READING_SETUP_SELECTION, readingSetupSample };
