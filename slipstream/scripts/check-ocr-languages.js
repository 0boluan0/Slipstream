const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'VisionOCR.swift'), 'utf8');

assert(source.includes('let OCR_VERSION = 3'));
assert(source.includes('usesLanguageCorrection = true'));
assert(source.includes('supportedRecognitionLanguages()'));

for (const language of ['en-US', 'zh-Hans', 'zh-Hant', 'ja-JP', 'ko-KR', 'fr-FR', 'de-DE', 'es-ES']) {
  assert(source.includes(`"${language}"`), `missing OCR language ${language}`);
}

console.log('ocr languages check passed');
