'use strict';

// Authored material only. Setup never accepts a clipboard, screenshot or user
// excerpt, and its result is a session-only preview rather than saved content.
const READING_SETUP_SOURCE = String.raw`An eigenvector of a matrix $A$ is a nonzero vector $v$ satisfying $Av = \lambda v$ for some scalar $\lambda$.

The scalar $\lambda$ is called the eigenvalue corresponding to $v$. For example, if $Av = 2v$, then $v$ is an eigenvector with eigenvalue $2$.`;
const READING_SETUP_SELECTION = 'eigenvector';

function readingSetupSample(value) {
  if (!value || typeof value !== 'object') return null;
  const validText = (text, limit, chineseRequired) => typeof text === 'string'
    && text.length <= limit && !/\p{Cc}/u.test(text.replace(/\n/gu, ''))
    && (!chineseRequired || /[\u3400-\u9fff]/u.test(text));
  if (!validText(value.translation, 4000, true)
    || !validText(value.meaning, 1500, true)
    || !validText(value.note, 1500, false)) return null;
  return { translation: value.translation.trim(), meaning: value.meaning.trim(), note: value.note.trim(),
    ...(value.imageChecked === true ? { imageChecked: true } : {}) };
}

export { READING_SETUP_SOURCE, READING_SETUP_SELECTION, readingSetupSample };
