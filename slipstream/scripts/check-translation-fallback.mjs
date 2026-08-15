import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createTranslationOnlyPreview } from '../src/renderer/utils/translationOnlyPreview.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const readProjectFile = (relativePath) => readFileSync(
  path.join(projectRoot, relativePath),
  'utf8',
);

const sourceText = 'Please submit your passport copy by Friday.';
const brief = createTranslationOnlyPreview({
  sourceText,
  translation: '请在星期五前提交护照复印件。',
  generatedAt: '2026-07-27T08:00:00.000Z',
});

assert.equal(brief.status, 'translation_only');
assert.equal(brief.analysisProvenance.responseKind, 'translation_only');
assert.equal(brief.analysisProvenance.provider, 'free_translate');
assert.equal(brief.analysisProvenance.model, 'google-translate');
assert.equal(brief.source.length, sourceText.length);
assert.deepEqual(brief.terms, []);
assert.deepEqual(brief.contexts, []);
assert.deepEqual(brief.deadlines, []);
assert.deepEqual(brief.materials, []);
assert.deepEqual(brief.nextSteps, []);
assert.deepEqual(brief.verifications, []);
assert.deepEqual(
  brief.warnings.map((warning) => warning.code),
  ['ACTION_FIELDS_NOT_ANALYZED', 'OFFICIAL_VERIFICATION_NOT_RUN'],
);

const previewSource = readProjectFile('src/renderer/utils/previewData.js');
const ipcSource = readProjectFile('src/renderer/hooks/useIpc.js');
const resultSource = readProjectFile('src/renderer/components/ResultDisplay.jsx');
const panelSource = readProjectFile('src/renderer/components/FloatingPanel.jsx');
const settingsSource = readProjectFile('src/renderer/components/SettingsPanel.jsx');
const appSource = readProjectFile('src/renderer/App.jsx');
const configSource = readProjectFile('src/renderer/utils/processingConfig.mjs');

assert.match(previewSource, /PREVIEW_TRANSLATION_BRIEF/,
  'the demo must expose a truthful translation-only fixture');
assert.match(ipcSource, /translationOnly\s*\?\s*PREVIEW_TRANSLATION_BRIEF/,
  'the demo processing path must use the translation-only fixture');
assert.match(resultSource, /本次只完成了完整翻译/);
assert.match(resultSource, /没有生成行动、材料、截止日期或原文证据映射/);
assert.match(resultSource, /配置完整分析/);
assert.match(resultSource, /retryLabel/);
assert.match(panelSource, /setupMode === 'unconfigured'/,
  'an incomplete upgrade must prevent further processing');
assert.match(panelSource, /完整分析配置尚未完成/);
assert.match(panelSource, /handleConfigureFullAnalysis/);
assert.match(panelSource, /用完整分析重新处理/,
  'a completed upgrade must offer a full-analysis retry');
assert.match(settingsSource, /entryTarget === 'full-analysis'/,
  'the upgrade entry must focus the full-analysis location choice');
assert.match(appSource, /panelSessionStarted/,
  'the panel session must survive an incomplete upgrade');
assert.match(appSource, /setupComplete \|\| panelSessionStarted/,
  'closing settings must return an existing user task to the panel');
assert.match(configSource, /SETUP_INCOMPLETE_WARNING/,
  'the preserved result must explain why processing cannot continue yet');

console.log('translation-only fallback and upgrade continuity checks passed');
