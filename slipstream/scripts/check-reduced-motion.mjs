import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REDUCED_MOTION_QUERY,
  preferredScrollBehavior,
} from '../src/renderer/utils/motionPreference.mjs';

const queriedPreferences = [];
assert.equal(
  REDUCED_MOTION_QUERY,
  '(prefers-reduced-motion: reduce)',
  'the helper must use the standard Reduced Motion media query',
);
assert.equal(
  preferredScrollBehavior((query) => {
    queriedPreferences.push(query);
    return { matches: true };
  }),
  'auto',
  'Reduced Motion must disable animated programmatic scrolling',
);
assert.equal(
  preferredScrollBehavior((query) => {
    queriedPreferences.push(query);
    return { matches: false };
  }),
  'smooth',
  'the ordinary motion preference must retain smooth navigation',
);
assert.deepEqual(
  queriedPreferences,
  [REDUCED_MOTION_QUERY, REDUCED_MOTION_QUERY],
  'the helper must query the operating-system Reduced Motion preference',
);
assert.equal(
  preferredScrollBehavior(null),
  'auto',
  'an unavailable matchMedia implementation must fail safely without animation',
);
assert.equal(
  preferredScrollBehavior(() => {
    throw new Error('matchMedia unavailable');
  }),
  'auto',
  'a matchMedia failure must fail safely without animation',
);

const rendererRoot = fileURLToPath(new URL('../src/renderer/', import.meta.url));
const helperPath = fileURLToPath(
  new URL('../src/renderer/utils/motionPreference.mjs', import.meta.url),
);
const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs']);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return sourceExtensions.has(extname(entry.name)) ? [entryPath] : [];
  });
}

for (const sourcePath of sourceFiles(rendererRoot)) {
  if (sourcePath === helperPath) continue;
  const source = readFileSync(sourcePath, 'utf8');
  assert.doesNotMatch(
    source,
    /behavior\s*:\s*(['"])smooth\1/,
    `${sourcePath} must use the shared motion preference instead of forced smooth scrolling`,
  );
}

const resultSource = readFileSync(
  new URL('../src/renderer/components/ResultDisplay.jsx', import.meta.url),
  'utf8',
);
const settingsSource = readFileSync(
  new URL('../src/renderer/components/SettingsPanel.jsx', import.meta.url),
  'utf8',
);

assert.match(
  resultSource,
  /import \{ preferredScrollBehavior \} from '\.\.\/utils\/motionPreference\.mjs\?workspace=result';/,
  'result navigation must import its query-distinct instance of the shared motion preference',
);
assert.equal(
  (resultSource.match(/behavior:\s*preferredScrollBehavior\(\)/g) || []).length,
  3,
  'all three result navigation paths must honor Reduced Motion',
);
assert.match(
  settingsSource,
  /import \{ preferredScrollBehavior \} from '\.\.\/utils\/motionPreference\.mjs\?workspace=settings';/,
  'Settings recovery must import its query-distinct instance of the shared motion preference',
);
assert.equal(
  (settingsSource.match(/behavior:\s*preferredScrollBehavior\(\)/g) || []).length,
  1,
  'the animated Settings recovery path must honor Reduced Motion',
);

const appCss = readFileSync(new URL('../src/renderer/App.css', import.meta.url), 'utf8');
const reducedMotionBlockStart = appCss.lastIndexOf('@media (prefers-reduced-motion: reduce)');
assert.notEqual(
  reducedMotionBlockStart,
  -1,
  'App.css must keep a global Reduced Motion media query',
);
const reducedMotionBlock = appCss.slice(reducedMotionBlockStart);
assert.match(
  reducedMotionBlock,
  /\*,\s*\*::before,\s*\*::after\s*\{/,
  'the global Reduced Motion rule must cover elements and pseudo-elements',
);
assert.match(reducedMotionBlock, /scroll-behavior:\s*auto\s*!important;/);
assert.match(reducedMotionBlock, /animation-duration:\s*0\.01ms\s*!important;/);
assert.match(reducedMotionBlock, /animation-iteration-count:\s*1\s*!important;/);
assert.match(reducedMotionBlock, /transition-duration:\s*0\.01ms\s*!important;/);

console.log('Reduced Motion checks passed.');
