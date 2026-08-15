import { SAFE_SAMPLE_SOURCE_TEXT } from './safeSampleSource';

// The safe source is a real capture-screen feature. The structured result and
// OCR fixtures belong only to development previews and must not ship in the
// production entry.
const PREVIEW_SOURCE_TEXT = SAFE_SAMPLE_SOURCE_TEXT;
const PREVIEW_ACTION_BRIEF = null;
const PREVIEW_CAPTURE = null;

export {
  PREVIEW_ACTION_BRIEF,
  PREVIEW_CAPTURE,
  PREVIEW_SOURCE_TEXT,
};
