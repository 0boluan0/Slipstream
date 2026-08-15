import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appCss = readFileSync(new URL('../src/renderer/App.css', import.meta.url), 'utf8');
const settingsCss = readFileSync(
  new URL('../src/renderer/components/SettingsPanel.css', import.meta.url),
  'utf8',
);
const rendererRoot = fileURLToPath(new URL('../src/renderer/', import.meta.url));

function rendererFiles(directory, extensions) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return rendererFiles(entryPath, extensions);
    return extensions.has(extname(entry.name)) ? [entryPath] : [];
  });
}

const combinedCss = rendererFiles(rendererRoot, new Set(['.css']))
  .map((sourcePath) => readFileSync(sourcePath, 'utf8'))
  .join('\n');
const combinedRendererSource = rendererFiles(
  rendererRoot,
  new Set(['.js', '.jsx', '.mjs', '.cjs']),
).map((sourcePath) => readFileSync(sourcePath, 'utf8')).join('\n');

const criticalBackdrops = [
  '.app-quit-backdrop',
  '.session-recovery-backdrop',
  '.processing-settings-guard-backdrop',
  '.saved-terms-drawer-backdrop',
  '.reply-drawer-backdrop',
  '.settings-draft-exit-backdrop',
  '.settings-reset-backdrop',
  '.credential-removal-backdrop',
];

function balancedBody(source, openingBraceIndex) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = openingBraceIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character !== '}') continue;
    depth -= 1;
    if (depth === 0) {
      return source.slice(openingBraceIndex + 1, index);
    }
  }
  throw new Error(`Unbalanced CSS block near byte ${openingBraceIndex}`);
}

function blocksMatching(source, headerPattern) {
  const blocks = [];
  const pattern = new RegExp(headerPattern.source, headerPattern.flags.includes('g')
    ? headerPattern.flags
    : `${headerPattern.flags}g`);
  for (const match of source.matchAll(pattern)) {
    const openingBraceIndex = source.indexOf('{', match.index);
    assert.notEqual(openingBraceIndex, -1, `Missing CSS block for ${match[0]}`);
    blocks.push({ header: match[0].slice(0, match[0].lastIndexOf('{')).trim(), body: balancedBody(source, openingBraceIndex) });
  }
  return blocks;
}

function declarationMap(body) {
  const declarations = new Map();
  for (const match of body.matchAll(/(^|;)\s*(--[\w-]+|[a-z-]+)\s*:\s*([^;{}]+)\s*(?=;|$)/gimu)) {
    declarations.set(match[2].trim(), match[3].trim());
  }
  return declarations;
}

function styleRules(source) {
  const rules = [];
  let cursor = 0;
  while (cursor < source.length) {
    const openingBraceIndex = source.indexOf('{', cursor);
    if (openingBraceIndex === -1) break;
    const priorBoundary = Math.max(
      source.lastIndexOf('}', openingBraceIndex - 1),
      source.lastIndexOf(';', openingBraceIndex - 1),
    );
    const header = source.slice(priorBoundary + 1, openingBraceIndex).trim();
    const body = balancedBody(source, openingBraceIndex);
    if (header.startsWith('@')) {
      rules.push(...styleRules(body));
    } else if (header) {
      rules.push({
        selectors: header.split(',').map((selector) => selector.trim()),
        declarations: declarationMap(body),
      });
    }
    cursor = openingBraceIndex + body.length + 2;
  }
  return rules;
}

function declarationsForSelector(rules, selector) {
  return rules
    .filter((rule) => rule.selectors.includes(selector))
    .map((rule) => rule.declarations);
}

function findRootDeclarations(source, selectorPattern = /^:root$/u) {
  const rule = styleRules(source).find((candidate) => (
    candidate.selectors.some((selector) => selectorPattern.test(selector))
  ));
  assert.ok(rule, `Missing root token block matching ${selectorPattern}`);
  return rule.declarations;
}

function hexToRgb(value, label) {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/u);
  assert.ok(match, `${label} must be a literal sRGB hex token, received ${value}`);
  const digits = match[1].length === 3
    ? [...match[1]].map((digit) => `${digit}${digit}`).join('')
    : match[1];
  return [0, 2, 4].map((offset) => Number.parseInt(digits.slice(offset, offset + 2), 16));
}

function relativeLuminance(rgb) {
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function tokenContrast(tokens, foregroundName, backgroundName, minimum, themeLabel) {
  const foreground = tokens.get(foregroundName);
  const background = tokens.get(backgroundName);
  assert.ok(foreground, `${themeLabel} is missing ${foregroundName}`);
  assert.ok(background, `${themeLabel} is missing ${backgroundName}`);
  const ratio = contrastRatio(
    hexToRgb(foreground, `${themeLabel} ${foregroundName}`),
    hexToRgb(background, `${themeLabel} ${backgroundName}`),
  );
  assert.ok(
    ratio >= minimum,
    `${themeLabel} ${foregroundName} on ${backgroundName} is ${ratio.toFixed(2)}:1; expected at least ${minimum}:1`,
  );
}

function requireTokens(tokens, names, label) {
  for (const name of names) assert.ok(tokens.has(name), `${label} is missing ${name}`);
}

const ordinaryLightTokens = findRootDeclarations(appCss);
const darkMedia = blocksMatching(appCss, /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{/giu)[0];
assert.ok(darkMedia, 'App.css must keep a dark color-scheme token block');
const ordinaryDarkTokens = findRootDeclarations(
  darkMedia.body,
  /^:root:not\(\[data-preview-theme=["']light["']\]\)$/u,
);

const requiredOrdinaryTokens = [
  '--bg-primary',
  '--surface-raised',
  '--text-primary',
  '--text-secondary',
  '--border-primary',
  '--border-secondary',
  '--accent',
  '--accent-light',
  '--accent-ink',
  '--on-solid',
  '--error',
  '--error-bg',
  '--error-fill',
  '--warning',
  '--warning-bg',
  '--warning-fill',
  '--success',
  '--success-bg',
  '--focus-ring',
  '--overlay-scrim',
];
requireTokens(ordinaryLightTokens, requiredOrdinaryTokens, 'light tokens');
requireTokens(ordinaryDarkTokens, requiredOrdinaryTokens, 'dark tokens');
for (const [label, tokens] of [
  ['ordinary light', ordinaryLightTokens],
  ['ordinary dark', ordinaryDarkTokens],
]) {
  tokenContrast(tokens, '--on-solid', '--accent-fill', 4.5, label);
  tokenContrast(tokens, '--on-solid', '--error-fill', 4.5, label);
  tokenContrast(tokens, '--on-solid', '--warning-fill', 4.5, label);
}

const moreBlocks = [
  ...blocksMatching(appCss, /@media\s*[^\n{]*\(prefers-contrast:\s*more\)[^\n{]*\{/giu),
  ...blocksMatching(settingsCss, /@media\s*[^\n{]*\(prefers-contrast:\s*more\)[^\n{]*\{/giu),
];
assert.ok(moreBlocks.length >= 2, 'renderer styles must define light and dark Increase Contrast media behavior');
const moreCss = moreBlocks.map((block) => block.body).join('\n');
const moreRules = styleRules(moreCss);

const lightMoreBlock = moreBlocks.find((block) => !block.header.includes('prefers-color-scheme'));
const darkMoreBlock = moreBlocks.find((block) => block.header.includes('prefers-color-scheme'));
assert.ok(lightMoreBlock, 'Increase Contrast needs a light/default token block');
assert.ok(darkMoreBlock, 'Increase Contrast needs a dark token block');
const lightMoreTokens = findRootDeclarations(lightMoreBlock.body);
const darkMoreTokens = findRootDeclarations(
  darkMoreBlock.body,
  /^:root:not\(\[data-preview-theme=["']light["']\]\)$/u,
);
requireTokens(lightMoreTokens, requiredOrdinaryTokens, 'light Increase Contrast tokens');
requireTokens(darkMoreTokens, requiredOrdinaryTokens, 'dark Increase Contrast tokens');

for (const [label, tokens] of [
  ['light Increase Contrast', lightMoreTokens],
  ['dark Increase Contrast', darkMoreTokens],
]) {
  tokenContrast(tokens, '--text-primary', '--bg-primary', 7, label);
  tokenContrast(tokens, '--text-secondary', '--bg-primary', 4.5, label);
  tokenContrast(tokens, '--text-tertiary', '--bg-primary', 4.5, label);
  tokenContrast(tokens, '--accent', '--bg-primary', 4.5, label);
  tokenContrast(tokens, '--accent-ink', '--accent-light', 4.5, label);
  tokenContrast(tokens, '--error', '--error-bg', 4.5, label);
  tokenContrast(tokens, '--warning', '--warning-bg', 4.5, label);
  tokenContrast(tokens, '--success', '--success-bg', 4.5, label);
  tokenContrast(tokens, '--on-solid', '--accent-fill', 4.5, label);
  tokenContrast(tokens, '--on-solid', '--error-fill', 4.5, label);
  tokenContrast(tokens, '--on-solid', '--warning-fill', 4.5, label);
  tokenContrast(tokens, '--border-primary', '--bg-primary', 3, label);
  tokenContrast(tokens, '--border-secondary', '--bg-primary', 3, label);
  tokenContrast(tokens, '--focus-ring', '--bg-primary', 3, label);
}

for (const selector of criticalBackdrops) {
  const declarations = declarationsForSelector(moreRules, selector);
  assert.ok(declarations.length > 0, `${selector} must be covered by Increase Contrast`);
  assert.ok(
    declarations.some((rule) => /^none\s*!important$/iu.test(rule.get('backdrop-filter') || '')),
    `${selector} must remove backdrop blur with !important under Increase Contrast`,
  );
}

assert.ok(
  moreRules.some((rule) => (
    rule.selectors.some((selector) => selector.includes(':focus'))
    && /^3px\s+solid\s+var\(--focus-ring\)\s*!important$/iu.test(rule.declarations.get('outline') || '')
  )),
  'Increase Contrast must provide a 3px !important focus outline using --focus-ring',
);

const forcedBlocks = [
  ...blocksMatching(appCss, /@media\s*\(forced-colors:\s*active\)\s*\{/giu),
  ...blocksMatching(settingsCss, /@media\s*\(forced-colors:\s*active\)\s*\{/giu),
];
assert.ok(forcedBlocks.length >= 1, 'renderer styles need a forced-colors media query');
const forcedCss = forcedBlocks.map((block) => block.body).join('\n');
const forcedRules = styleRules(forcedCss);

assert.match(
  forcedCss,
  /\b(?:Canvas|CanvasText|ButtonFace|ButtonText|Highlight|HighlightText|LinkText|GrayText)\b/u,
  'forced colors must use operating-system color keywords',
);
const customForcedColorRules = forcedRules.filter((rule) => (
  /^none(?:\s*!important)?$/iu.test(rule.declarations.get('forced-color-adjust') || '')
));
for (const rule of customForcedColorRules) {
  assert.ok(
    rule.selectors.every((selector) => (
      !/^(?:\*|html|body|#root|:root|button|input|textarea|select)$/iu.test(selector)
    )),
    `forced-color-adjust:none must stay scoped to a concrete state, received ${rule.selectors.join(', ')}`,
  );
}
assert.ok(
  forcedRules.some((rule) => (
    rule.selectors.some((selector) => /:checked|\.is-(?:active|selected)|\[aria-(?:pressed|selected)=["']true["']\]/u.test(selector))
    && [...rule.declarations.values()].some((value) => /\bHighlight\b/u.test(value))
    && [...rule.declarations.values()].some((value) => /\bHighlightText\b/u.test(value))
  )),
  'forced colors must expose selected or checked state with Highlight and HighlightText',
);

for (const [property, systemColor] of [
  ['--evidence-color', /^(?:Highlight|CanvasText|ButtonText)$/u],
  ['--evidence-soft', /^Canvas$/u],
  ['--step-color', /^(?:Highlight|CanvasText|ButtonText)$/u],
  ['--step-soft', /^Canvas$/u],
]) {
  assert.ok(
    forcedRules.some((rule) => systemColor.test((rule.declarations.get(property) || '').replace(/\s*!important$/u, '').trim())),
    `forced colors must remap dynamic ${property} to a system color`,
  );
}

for (const selector of criticalBackdrops) {
  const declarations = declarationsForSelector(forcedRules, selector);
  assert.ok(declarations.length > 0, `${selector} must be covered by forced colors`);
  assert.ok(
    declarations.some((rule) => /^none\s*!important$/iu.test(rule.get('backdrop-filter') || '')),
    `${selector} must remove backdrop blur with !important under forced colors`,
  );
}

assert.ok(
  forcedRules.some((rule) => (
    rule.selectors.some((selector) => selector.includes(':focus'))
    && /^3px\s+solid\s+Highlight\s*!important$/u.test(rule.declarations.get('outline') || '')
  )),
  'forced colors must provide a 3px !important system Highlight focus outline',
);

for (const rule of styleRules(combinedCss)) {
  const background = rule.declarations.get('background')
    || rule.declarations.get('background-color')
    || '';
  const color = rule.declarations.get('color') || '';
  assert.ok(
    !/^var\(--(?:accent|error|warning)\)$/u.test(background)
      || !/^(?:#fff(?:fff)?|white)$/iu.test(color),
    `${rule.selectors.join(', ')} pairs a reversible semantic background with hard-coded white text`,
  );
}
assert.doesNotMatch(
  combinedRendererSource,
  /background:\s*['"]var\(--(?:accent|error|warning)\)['"][^}\n]*color:\s*['"](?:#fff(?:fff)?|white)['"]/giu,
  'inline semantic fills must not pair reversible colors with hard-coded white text',
);

console.log('Contrast preference static checks passed.');
console.log('Covered: semantic tokens, Increase Contrast, forced colors, focus, modal blur, dynamic evidence, and token contrast.');
