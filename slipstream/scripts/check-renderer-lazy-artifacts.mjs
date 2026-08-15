import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rendererRoot = path.join(projectRoot, 'dist', 'renderer');
const assetRoot = path.join(rendererRoot, 'assets');
const ENTRY_JAVASCRIPT_BUDGET_BYTES = 490_000;
const ENTRY_JAVASCRIPT_RELEASE_CEILING_BYTES = 500_000;

assert.ok(fs.statSync(rendererRoot).isDirectory(),
  'build the production renderer before checking lazy assets');

function collectRendererFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectRendererFiles(entryPath);
    return entry.isFile() ? [entryPath] : [];
  });
}

const rendererFiles = collectRendererFiles(rendererRoot).sort();
const sourceMapFiles = rendererFiles.filter((file) => file.endsWith('.map'));
assert.deepEqual(sourceMapFiles, [],
  'production renderer must not emit or package source maps');

const workspaceAssets = [
  'ResultDisplay.js',
  'SettingsPanel.js',
  'SavedTermsLibrary.js',
];
const workspaceStylesheets = [
  'ResultDisplay.css',
  'SavedTermsLibrary.css',
  'SettingsPanel.css',
];
const stylesheetByWorkspace = new Map([
  ['ResultDisplay.js', 'ResultDisplay.css'],
  ['SettingsPanel.js', 'SettingsPanel.css'],
  ['SavedTermsLibrary.js', 'SavedTermsLibrary.css'],
]);
const assetNames = fs.readdirSync(assetRoot).sort();
const entryJavaScript = assetNames.filter((name) => /^index-[A-Za-z0-9_-]+\.js$/u.test(name));
const entryStylesheet = assetNames.filter((name) => /^index-[A-Za-z0-9_-]+\.css$/u.test(name));
const ocrReviewDestinationJavaScript = assetNames.filter((name) => (
  /^ocr-review-destination-[A-Za-z0-9_-]+\.js$/u.test(name)
));
const unexpectedFullDataResetChunks = assetNames.filter((name) => /fullDataReset/iu.test(name));
assert.equal(entryJavaScript.length, 1, 'expected exactly one hashed renderer entry script');
assert.equal(entryStylesheet.length, 1, 'expected exactly one eager renderer stylesheet');
assert.equal(ocrReviewDestinationJavaScript.length, 1,
  'expected one fail-closed destination helper loaded only during explicit OCR confirmation');
assert.deepEqual(unexpectedFullDataResetChunks, [],
  'the reset transaction must ship inside the retryable Settings workspace, not a click-time chunk');

for (const workspace of workspaceAssets) {
  assert.ok(assetNames.includes(workspace), `missing stable ${workspace} production asset`);
  const source = fs.readFileSync(path.join(assetRoot, workspace), 'utf8');
  const importedScripts = [...source.matchAll(/from["']\.\/([^"']+\.js)["']/gu)]
    .map((match) => match[1]);
  assert.deepEqual([...new Set(importedScripts)], entryJavaScript,
    `${workspace} must import only the already-loaded renderer entry`);
  const dedicatedStylesheet = stylesheetByWorkspace.get(workspace);
  if (dedicatedStylesheet) {
    assert.match(source, new RegExp(dedicatedStylesheet.replace('.', '\\.')),
      `${workspace} must retain its stable dedicated stylesheet URL`);
    for (const otherStylesheet of workspaceStylesheets) {
      if (otherStylesheet === dedicatedStylesheet) continue;
      assert.doesNotMatch(source, new RegExp(otherStylesheet.replace('.', '\\.')),
        `${workspace} must not depend on ${otherStylesheet}`);
    }
  }
}

const stylesheets = assetNames.filter((name) => name.endsWith('.css'));
assert.deepEqual(stylesheets, [...entryStylesheet, ...workspaceStylesheets].sort(),
  'production must emit only the eager entry stylesheet and stable workspace stylesheets');

const entrySource = fs.readFileSync(path.join(assetRoot, entryJavaScript[0]), 'utf8');
const entryCssSource = fs.readFileSync(path.join(assetRoot, entryStylesheet[0]), 'utf8');
const resultCssSource = fs.readFileSync(path.join(assetRoot, 'ResultDisplay.css'), 'utf8');
const savedTermsCssSource = fs.readFileSync(
  path.join(assetRoot, 'SavedTermsLibrary.css'),
  'utf8',
);
const settingsCssSource = fs.readFileSync(path.join(assetRoot, 'SettingsPanel.css'), 'utf8');
const settingsJavaScriptSource = fs.readFileSync(path.join(assetRoot, 'SettingsPanel.js'), 'utf8');
const rendererHtml = fs.readFileSync(path.join(rendererRoot, 'index.html'), 'utf8');
const eagerStylesheetHrefs = [...rendererHtml.matchAll(
  /<link\s+rel="stylesheet"[^>]*href="\.\/assets\/([^"]+\.css)"/gu,
)].map((match) => match[1]);
assert.deepEqual(eagerStylesheetHrefs, entryStylesheet,
  'index.html must eagerly reference only the hashed entry stylesheet');
assert.doesNotMatch(entrySource, /(?:ResultDisplay|SavedTermsLibrary|SettingsPanel)\.css/u,
  'the renderer entry must not preload a dedicated workspace stylesheet');
assert.doesNotMatch(entrySource, /persistent-reset-unconfirmed/u,
  'the destructive reset transaction must stay outside the startup entry');
assert.match(settingsJavaScriptSource, /persistent-reset-unconfirmed/u,
  'the retryable Settings workspace must retain the destructive reset transaction');
assert.match(resultCssSource, /\.insight-column--translation-only\{/u,
  'the dedicated Result stylesheet must retain its private translation-only rule');
assert.doesNotMatch(entryCssSource, /\.insight-column--translation-only\{/u,
  'the Result-private rule must stay outside the eager stylesheet');
assert.match(settingsCssSource, /\.verification-policy\{[^}]*display:grid/u,
  'the dedicated Settings stylesheet must retain its private verification-policy rule');
assert.doesNotMatch(entryCssSource, /\.verification-policy\{[^}]*display:grid/u,
  'the Settings-private verification-policy rule must stay outside the eager stylesheet');
assert.match(settingsCssSource, /\.slipstream-textarea,/u,
  'the dedicated Settings stylesheet must retain its private shared-input rule');
assert.doesNotMatch(entryCssSource, /\.slipstream-textarea,/u,
  'the Settings-private shared-input rule must stay outside the eager stylesheet');
assert.match(entryCssSource, /\.result-a11y-live/u,
  'the shared Result/Saved-Terms live-region rule must remain eager');
assert.doesNotMatch(resultCssSource, /\.result-a11y-live/u,
  'the deferred Result stylesheet must not own the shared live-region dependency');
assert.doesNotMatch(settingsCssSource, /\.result-a11y-live/u,
  'the deferred Settings stylesheet must not own the shared live-region dependency');
assert.doesNotMatch(savedTermsCssSource, /\.result-a11y-live/u,
  'the deferred Saved Terms stylesheet must not own the shared live-region dependency');
for (const selector of [
  '.saved-terms-trigger',
  '.saved-terms-drawer-backdrop',
  '.saved-terms-drawer{',
  '.saved-terms-drawer__header',
  '.saved-terms-drawer__body{',
  '.saved-terms-workspace-state__notice',
  '.saved-terms-workspace-state__actions',
  '.term-operation-error',
]) {
  assert.ok(entryCssSource.includes(selector),
    `the eager stylesheet must retain the Saved Terms shell selector ${selector}`);
}
for (const selector of [
  '.saved-terms-drawer__privacy',
  '.saved-terms-drawer__body--populated',
  '.saved-terms-drawer__empty',
  '.saved-term-library',
  '.saved-term-search',
  '.saved-term-card',
  '.saved-term-copy-actions',
  '.saved-term-undo',
  '.saved-term-error',
  '.saved-term-transfer',
  '.saved-term-import-trust-review',
]) {
  assert.ok(!entryCssSource.includes(selector),
    `the eager stylesheet must exclude the Saved Terms-private selector ${selector}`);
  assert.ok(savedTermsCssSource.includes(selector),
    `the deferred Saved Terms stylesheet must retain its private selector ${selector}`);
}
assert.doesNotMatch(savedTermsCssSource,
  /\.saved-terms-trigger|\.saved-terms-drawer-backdrop|\.saved-terms-drawer\{|\.saved-terms-drawer__header|\.saved-terms-drawer__body\{|\.saved-terms-workspace-state|\.term-operation-error/u,
  'the deferred Saved Terms stylesheet must not duplicate its eager trigger, modal recovery shell, or shared operation error');
const entryJavaScriptBytes = fs.statSync(path.join(assetRoot, entryJavaScript[0])).size;
const resultStylesheetBytes = fs.statSync(
  path.join(assetRoot, 'ResultDisplay.css'),
).size;
const settingsStylesheetBytes = fs.statSync(
  path.join(assetRoot, 'SettingsPanel.css'),
).size;
const savedTermsStylesheetBytes = fs.statSync(
  path.join(assetRoot, 'SavedTermsLibrary.css'),
).size;
assert.ok(entryJavaScriptBytes < ENTRY_JAVASCRIPT_BUDGET_BYTES,
  `renderer entry must preserve the 10 kB release reserve by staying below ${ENTRY_JAVASCRIPT_BUDGET_BYTES} bytes (received ${entryJavaScriptBytes} bytes)`);
assert.match(entrySource, /ResultDisplay\.js/u,
  'the entry must retain the statically emitted Result workspace');
assert.match(entrySource, /SettingsPanel\.js/u,
  'the entry must retain the statically emitted Settings workspace');
assert.match(entrySource, /SavedTermsLibrary\.js/u,
  'the entry must retain the statically emitted Saved Terms workspace');
assert.match(entrySource, new RegExp(ocrReviewDestinationJavaScript[0].replace('.', '\\.')),
  'the entry must retain the explicit-confirmation destination helper import');
assert.match(entrySource, /workspace-attempt/u,
  'the entry must retain the bounded production retry query');
assert.ok((entrySource.match(/SavedTermsLibrary\.js/gu) || []).length >= 2,
  'the entry must retain both the ordinary Saved Terms import and its stable-asset retry');
assert.equal((entrySource.match(/workspace-attempt/gu) || []).length, 1,
  'production retries must share one bounded query-key implementation');

const productionText = rendererFiles
  .filter((file) => /\.(?:css|html|js|json)$/u.test(file))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');
assert.doesNotMatch(productionText,
  /lazy-workspace-recovery-native|result-stylesheet-recovery-native|saved-terms-deferral-native|settings-fixture-primary|settings-style-fixture-primary|settings-style-retry|result-fixture-primary|result-style-fixture-primary|saved-terms-fixture-primary|saved-terms-style-fixture-primary|workspace-load=saved-terms-retry|Fixed lazy workspace fixture failure|workspaceBaseline/u,
  'development failure injection must not enter production assets');
assert.doesNotMatch(productionText,
  /fixture-source-b-block-1|Fixture source B|demoProcessRequests|Previewed settings read failure|native-isolated/u,
  'renderer demo fixtures must not enter production assets');
assert.doesNotMatch(productionText,
  /preview-university-services-email|action-brief-preview|verify-evisa-guidance/u,
  'the development structured-result fixture must not enter production assets');

const totalBytes = rendererFiles.reduce((sum, file) => sum + fs.statSync(file).size, 0);

console.log('Renderer lazy-asset checks passed.');
console.log(JSON.stringify({
  entryJavaScript: entryJavaScript[0],
  entryJavaScriptBytes,
  entryJavaScriptBudgetBytes: ENTRY_JAVASCRIPT_BUDGET_BYTES,
  entryJavaScriptBudgetHeadroomBytes: ENTRY_JAVASCRIPT_BUDGET_BYTES - entryJavaScriptBytes,
  entryJavaScriptReleaseCeilingBytes: ENTRY_JAVASCRIPT_RELEASE_CEILING_BYTES,
  entryJavaScriptReleaseHeadroomBytes:
    ENTRY_JAVASCRIPT_RELEASE_CEILING_BYTES - entryJavaScriptBytes,
  entryStylesheet: entryStylesheet[0],
  workspaceStylesheets,
  resultStylesheetBytes,
  savedTermsStylesheetBytes,
  settingsStylesheetBytes,
  workspaceAssets,
  fileCount: rendererFiles.length,
  totalBytes,
}, null, 2));
