import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACTION_BRIEF_SOURCE_LANGUAGE_TAGS,
  getActionBriefSourceLanguageTag,
  getContentLanguageTag,
  inferTextLanguageTag,
} from '../src/renderer/utils/languageBoundary.mjs';
import './check-processing-accessibility.mjs';
import './check-result-main-landmark.mjs';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readProjectFile = (relativePath) => readFileSync(path.join(projectRoot, relativePath), 'utf8');

const indexHtml = readProjectFile('src/renderer/index.html');
const appCss = readProjectFile('src/renderer/App.css');
const resultDisplay = readProjectFile('src/renderer/components/ResultDisplay.jsx');
const floatingPanel = readProjectFile('src/renderer/components/FloatingPanel.jsx');
const savedTermsLibrary = readProjectFile('src/renderer/components/SavedTermsLibrary.jsx');
const loadingOverlay = readProjectFile('src/renderer/components/LoadingOverlay.jsx');
const rendererSources = [resultDisplay, floatingPanel, savedTermsLibrary, loadingOverlay].join('\n');
const require = createRequire(import.meta.url);
const { Parser } = require('acorn');
const jsx = require('acorn-jsx');
const RendererParser = Parser.extend(jsx());

const legacyFocusHandoffArmingPattern = /if \(wasVisible === false\) settingsReturnFocusReadyRef\.current = true;[\s\S]{0,500}const enteredAfterSetup = settingsReturnFocusReadyRef\.current[\s\S]{0,160}status === STATUS\.IDLE[\s\S]{0,160}!hasForegroundFocusOwner/u;
const legacyFocusHandoffTargetPattern = /else if \(destination === 'source'\) \{[\s\S]{0,160}focusTransferred = focusAvailableElement\(textareaRef\.current\)/u;
const legacySavedTermsLoadingPattern = /!termsReady \? \([\s\S]*?role="status" aria-live="polite"[\s\S]*?termsReady && <footer/u;

function visit(node, visitor, ancestors = []) {
  if (!node || typeof node !== 'object') return;
  visitor(node, ancestors);
  const nextAncestors = [...ancestors, node];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) value.forEach((child) => visit(child, visitor, nextAncestors));
    else if (value?.type) visit(value, visitor, nextAncestors);
  }
}

function parseRendererSource(source) {
  return RendererParser.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
}

function findSettingsFocusHandoffEffect(source) {
  let match = null;
  visit(parseRendererSource(source), (node) => {
    if (
      !match
      && node.type === 'CallExpression'
      && node.callee?.type === 'Identifier'
      && node.callee.name === 'useEffect'
      && ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.arguments?.[0]?.type)
      && source.slice(node.arguments[0].start, node.arguments[0].end)
        .includes('const settingsDestination = settingsReturnFocusRef.current')
    ) match = node.arguments[0];
  });
  assert.ok(match, 'the Settings return-focus effect must remain structurally inspectable');
  return match;
}

function isSettingsReturnReadyAssignment(node) {
  return node.type === 'AssignmentExpression'
    && node.operator === '='
    && node.right?.type === 'Literal'
    && node.right.value === false
    && node.left?.type === 'MemberExpression'
    && node.left.property?.name === 'current'
    && node.left.object?.type === 'Identifier'
    && node.left.object.name === 'settingsReturnFocusReadyRef';
}

function isInsideIfConsequent(node, ancestors, source, expectedTest) {
  return ancestors.some((ancestor) => (
    ancestor.type === 'IfStatement'
    && ancestor.consequent
    && node.start >= ancestor.consequent.start
    && node.end <= ancestor.consequent.end
    && source.slice(ancestor.test.start, ancestor.test.end).replace(/\s+/gu, '') === expectedTest
  ));
}

function assertFocusHandoffClearsOnlyAfterSuccess(source) {
  const effect = findSettingsFocusHandoffEffect(source);
  const falseAssignments = [];
  visit(effect.body, (node, ancestors) => {
    if (isSettingsReturnReadyAssignment(node)) falseAssignments.push({ node, ancestors });
  });
  assert.equal(falseAssignments.length, 2,
    'the focus-handoff ready flag may clear only for hidden state and confirmed focus transfer');
  for (const { node, ancestors } of falseAssignments) {
    const hiddenReset = isInsideIfConsequent(node, ancestors, source, '!visible');
    const successfulTransfer = isInsideIfConsequent(
      node,
      ancestors,
      source,
      'focusTransferred',
    );
    assert.ok(hiddenReset || successfulTransfer,
      'the focus-handoff ready flag may clear only while hidden or after confirmed focus transfer');
  }
}

function findUnknownSavedTermsBranch(source) {
  let match = null;
  visit(parseRendererSource(source), (node) => {
    if (
      !match
      && node.type === 'ConditionalExpression'
      && node.test?.type === 'UnaryExpression'
      && node.test.operator === '!'
      && node.test.argument?.type === 'Identifier'
      && node.test.argument.name === 'termsReady'
      && source.slice(node.consequent.start, node.consequent.end).includes('termsLoadError')
    ) match = node.consequent;
  });
  assert.ok(match, 'the unknown/loading Saved Terms branch must remain structurally inspectable');
  return match;
}

const SAVED_TERMS_MUTATION_IDENTIFIERS = new Set([
  'confirmExport',
  'confirmImport',
  'handleCopy',
  'handleDelete',
  'handleKeepDeletion',
  'handleRestore',
  'onCommitImport',
  'onDeleteTerm',
  'onExportTerms',
  'onPreviewImport',
  'onRestoreTerm',
  'onWriteClipboard',
  'prepareExport',
  'previewImport',
]);

function assertUnknownSavedTermsBranchHasNoMutationControls(source) {
  const unknownBranch = findUnknownSavedTermsBranch(source);
  const forbiddenIdentifiers = new Set();
  const forbiddenAttributes = new Set();
  visit(unknownBranch, (node) => {
    if (node.type === 'Identifier' && SAVED_TERMS_MUTATION_IDENTIFIERS.has(node.name)) {
      forbiddenIdentifiers.add(node.name);
    }
    if (
      node.type === 'JSXAttribute'
      && ['data-saved-term-copy-action', 'data-saved-term-remove-id']
        .includes(node.name?.name)
    ) forbiddenAttributes.add(node.name.name);
  });
  assert.deepEqual([...forbiddenIdentifiers], [],
    'loading/error Saved Terms UI must not invoke persistent mutation or transfer handlers');
  assert.deepEqual([...forbiddenAttributes], [],
    'loading/error Saved Terms UI must not expose ready-only mutation controls');
}

const immediateFocusClearMutation = floatingPanel.replace(
  'if (wasVisible === false) settingsReturnFocusReadyRef.current = true;',
  `if (wasVisible === false) settingsReturnFocusReadyRef.current = true;
    settingsReturnFocusReadyRef.current = false;`,
);
assert.notEqual(immediateFocusClearMutation, floatingPanel);
assert.match(immediateFocusClearMutation, legacyFocusHandoffArmingPattern,
  'the legacy focus text gate must demonstrate its immediate-clear false pass');
assert.match(immediateFocusClearMutation, legacyFocusHandoffTargetPattern,
  'the legacy focus target gate must still pass the immediate-clear mutation');
assert.throws(
  () => assertFocusHandoffClearsOnlyAfterSuccess(immediateFocusClearMutation),
  /may clear only for hidden state and confirmed focus transfer/u,
  'the structural gate must reject an immediately consumed focus handoff',
);

const loadingMutationControlMutation = savedTermsLibrary.replace(
  `                <span>
                  <strong>{termsLoading ? '正在读取这台 Mac 上的术语' : '准备读取这台 Mac 上的术语'}</strong>`,
  `                <button type="button" onClick={() => onDeleteTerm(null)}>移除</button>
                <span>
                  <strong>{termsLoading ? '正在读取这台 Mac 上的术语' : '准备读取这台 Mac 上的术语'}</strong>`,
);
assert.notEqual(loadingMutationControlMutation, savedTermsLibrary);
assert.match(loadingMutationControlMutation, legacySavedTermsLoadingPattern,
  'the legacy loading text gate must demonstrate its mutation-control false pass');
assert.throws(
  () => assertUnknownSavedTermsBranchHasNoMutationControls(loadingMutationControlMutation),
  /must not invoke persistent mutation or transfer handlers/u,
  'the structural gate must reject mutation controls before Saved Terms is ready',
);

assertFocusHandoffClearsOnlyAfterSuccess(floatingPanel);
assertUnknownSavedTermsBranchHasNoMutationControls(savedTermsLibrary);

assert.deepEqual(ACTION_BRIEF_SOURCE_LANGUAGE_TAGS, {
  en: 'en',
  zh: 'zh-CN',
  mixed: 'mul',
  unknown: 'und',
});
assert.equal(getActionBriefSourceLanguageTag('en'), 'en');
assert.equal(getActionBriefSourceLanguageTag('zh'), 'zh-CN');
assert.equal(getActionBriefSourceLanguageTag('mixed'), 'mul');
assert.equal(getActionBriefSourceLanguageTag('unknown'), 'und');
assert.equal(getActionBriefSourceLanguageTag('invalid'), 'und');
assert.equal(getActionBriefSourceLanguageTag(undefined), 'und');

assert.equal(inferTextLanguageTag('Dear Student'), 'en');
assert.equal(inferTextLanguageTag('请核对原文'), 'zh-CN');
assert.equal(inferTextLanguageTag('请提交 passport'), 'mul');
assert.equal(inferTextLanguageTag('2026-07-30'), 'und');
assert.equal(inferTextLanguageTag(''), 'und');
assert.equal(inferTextLanguageTag(null), 'und');
assert.equal(getContentLanguageTag('2026-07-30', 'en'), 'en');
assert.equal(getContentLanguageTag('2026-07-30', 'mixed'), 'mul');
assert.equal(getContentLanguageTag('明确中文', 'en'), 'zh-CN');

assert.match(indexHtml, /<html\s+lang="zh-CN">/u);
assert.doesNotMatch(rendererSources, /lang\s*=\s*["'](?:mixed|unknown)["']/u);
assert.doesNotMatch(
  resultDisplay,
  /lang=\{normalizedBrief\.source\?\.language/u,
  'ActionBrief source enums must pass through the BCP-47 mapper',
);

assert.match(resultDisplay, /const sourceLanguageTag = getActionBriefSourceLanguageTag\(sourceLanguage\);/u);
assert.match(resultDisplay, /className="source-paper" lang=\{sourceLanguageTag\}/u);
assert.match(
  resultDisplay,
  /<q lang=\{getContentLanguageTag\(entry\.quote, sourceLanguage\)\}>\{entry\.quote\}<\/q>/u,
);
assert.match(
  resultDisplay,
  /<q lang=\{getContentLanguageTag\(fact\.value, sourceLanguage\)\}>\{fact\.value\}<\/q>/u,
);
assert.match(
  resultDisplay,
  /aria-label="英文回复草稿"[\s\S]{0,300}lang="en"/u,
);
assert.equal(
  resultDisplay.includes('aria-label={`${label}，证据 ${entry.id}：${entry.quote}`}'),
  false,
  'Evidence controls must not flatten Chinese actions and English quotes into one aria-label',
);
assert.equal(
  resultDisplay.includes('aria-label={`行动项原文，证据 ${entry.id}：${entry.quote}`}'),
  false,
  'Action evidence controls must keep visible language segments available to assistive technology',
);
assert.equal(
  resultDisplay.includes('aria-describedby="evidence-navigation-status"'),
  false,
  'Source evidence must not inherit a stale shared live-region description',
);

assert.match(
  floatingPanel,
  /aria-label="要解释的完整原文"[\s\S]{0,180}lang=\{inputText\.trim\(\) \? inferTextLanguageTag\(inputText\) : undefined\}/u,
);
assert.match(floatingPanel, /const previousVisibleRef = useRef\(visible\);/u);
assert.match(
  floatingPanel,
  legacyFocusHandoffArmingPattern,
);
assert.match(floatingPanel, /const destination = settingsDestination \|\| 'source';/u);
assert.match(
  floatingPanel,
  legacyFocusHandoffTargetPattern,
);

assert.match(savedTermsLibrary, /lang=\{inferTextLanguageTag\(term\.term\)\}/u);
assert.match(savedTermsLibrary, /lang=\{inferTextLanguageTag\(term\.evidence\)\}/u);
assert.match(savedTermsLibrary, /className="saved-term-card" aria-labelledby=\{termNameId\}/u);
assert.match(savedTermsLibrary, /role="group"[\s\S]{0,100}aria-label="复制选项"/u);
assert.match(
  floatingPanel,
  /savedTermsLoadStatus === SAVED_TERMS_LOAD_STATUS\.READY[\s\S]*?打开术语库，已保存 \$\{savedTerms\.length\} 个术语[\s\S]*?暂时无法读取已保存术语，可打开后重试[\s\S]*?正在读取已保存术语/u,
  'the Saved Terms trigger must expose a count only from a ready snapshot',
);
assert.match(
  floatingPanel,
  /aria-label=\{savedTermsTriggerLabel\}[\s\S]*?aria-busy=\{savedTermsLoadStatus === SAVED_TERMS_LOAD_STATUS\.LOADING\}/u,
  'the Saved Terms trigger must publish its loading state to assistive technology',
);
assert.match(
  savedTermsLibrary,
  /termsLoadError \? \([\s\S]*?role="alert"[\s\S]*?id="saved-terms-retry-load"[\s\S]*?重试读取[\s\S]*?返回当前任务/u,
  'the Saved Terms read failure must have one alert and an explicit retry/return path',
);
assert.match(
  savedTermsLibrary,
  legacySavedTermsLoadingPattern,
  'unknown Saved Terms data must not expose ready-only search, mutation, or transfer controls',
);
assert.match(
  resultDisplay,
  /savedTermsLoadStatus === 'ready'[\s\S]*?hasSavedTerm\(savedTerms, selectedTerm\?\.surface\)[\s\S]*?正在确认是否已保存…[\s\S]*?重试检查并保存/u,
  'Result term membership and save actions must distinguish loading, error, and ready snapshots',
);

assert.match(
  loadingOverlay,
  /<section className="processing-card" aria-label="处理进度">/u,
);
assert.doesNotMatch(
  loadingOverlay,
  /<section className="processing-card"[^>]*aria-live/u,
  'The processing card must not duplicate its dedicated live status',
);
assert.match(
  loadingOverlay,
  /<span role="status" aria-live="polite" aria-atomic="true">/u,
);

const disclosureStart = resultDisplay.indexOf('function Disclosure(');
const disclosureEnd = resultDisplay.indexOf('\nfunction ProvenanceBadge', disclosureStart);
assert.ok(disclosureStart >= 0 && disclosureEnd > disclosureStart,
  'the shared result Disclosure implementation must remain inspectable');
const disclosureSource = resultDisplay.slice(disclosureStart, disclosureEnd);
assert.match(disclosureSource, /function Disclosure\(\{ id, title, meta, Icon, open, onToggle, triggerRef,/u);
assert.match(disclosureSource, /const headingId = `\$\{id\}-heading`;/u);
assert.match(disclosureSource, /const titleId = `\$\{id\}-title`;/u);
assert.match(disclosureSource, /const metaId = meta \? `\$\{id\}-meta` : undefined;/u);
assert.match(disclosureSource, /const panelId = `\$\{id\}-panel`;/u);
assert.match(
  disclosureSource,
  /<h2 id=\{headingId\} className="disclosure__heading">\s*<button/u,
  'each result accordion trigger must be the only substantive child of its H2',
);
assert.match(disclosureSource, /<button[\s\S]*?id=\{id\}[\s\S]*?ref=\{triggerRef\}/u);
assert.match(disclosureSource, /aria-expanded=\{open\}\s*aria-controls=\{panelId\}/u);
assert.match(disclosureSource, /aria-labelledby=\{titleId\}\s*aria-describedby=\{metaId\}/u);
assert.match(disclosureSource, /<span id=\{titleId\}>\{title\}<\/span>/u);
assert.match(disclosureSource, /\{meta && <small id=\{metaId\}>\{meta\}<\/small>\}/u);
assert.match(disclosureSource, /<Icon size=\{19\} weight="regular" aria-hidden="true" \/>/u);
assert.match(disclosureSource, /<CaretDown size=\{18\} aria-hidden="true" \/>/u);
assert.match(disclosureSource, /<CaretRight size=\{18\} aria-hidden="true" \/>/u);
assert.match(disclosureSource, /<\/button>\s*<\/h2>\s*<div id=\{panelId\} className="disclosure__content" hidden=\{!open\}>/u);
assert.doesNotMatch(disclosureSource, /\{open &&/u,
  'collapsed result panels must remain mounted for stable controls and focus targets');
assert.doesNotMatch(disclosureSource, /role="region"/u,
  'common result disclosures must not overload the landmark list');
assert.match(appCss, /\.disclosure__content\[hidden\]\s*\{\s*display:\s*none;/u,
  'the persistent common panels must remain visually collapsed');

const disclosureCallIds = [...resultDisplay.matchAll(/<Disclosure\s+id="([^"]+)"/gu)]
  .map((match) => match[1]);
assert.deepEqual(disclosureCallIds, [
  'result-translation',
  'result-explanation',
  'result-materials',
  'result-deadlines',
  'result-terms',
  'result-context',
  'result-sources',
  'result-verification',
  'result-warnings',
], 'all nine result accordion call sites must keep deterministic trigger ids');

const completionStart = resultDisplay.indexOf('<div className="result-completion">');
const completionEnd = resultDisplay.indexOf('<button\n          ref={newCaptureButtonRef}', completionStart);
assert.ok(completionStart >= 0 && completionEnd > completionStart,
  'the processing-completion disclosure must remain inspectable');
const completionSource = resultDisplay.slice(completionStart, completionEnd);
assert.match(
  completionSource,
  /<h2 id="result-processing-completion-heading" className="completion-heading">\s*<button\s+id="result-processing-completion"/u,
);
assert.match(
  completionSource,
  /aria-expanded=\{showProcess\}\s*aria-controls="result-processing-completion-panel"\s*aria-label=\{completionButtonLabel\}/u,
);
assert.match(
  completionSource,
  /id="result-processing-completion-panel"\s*className="completion-popover"\s*role="region"\s*aria-labelledby="result-processing-completion"\s*hidden=\{!showProcess\}/u,
  'processing details must stay mounted as the one labelled result-footer region',
);
assert.equal((completionSource.match(/role="region"/gu) || []).length, 1,
  'the processing-completion disclosure must add exactly one landmark');
assert.doesNotMatch(completionSource, /\{showProcess &&/u);
assert.match(completionSource, /<CheckCircle size=\{20\} weight="fill" aria-hidden="true" \/>/u);
assert.match(completionSource, /<Clock size=\{16\} aria-hidden="true" \/>/u);
assert.match(appCss, /\.completion-popover\[hidden\]\s*\{\s*display:\s*none;/u,
  'the persistent processing region must remain visually collapsed');

console.log('Screen-reader language, accordion, naming, focus-handoff, and live-region static checks passed.');
