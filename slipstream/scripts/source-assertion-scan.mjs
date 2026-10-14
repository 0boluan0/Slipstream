// Finds assertions that inspect product source text instead of behavior, such
// as `assert.match(appSource, /const showSetupGate = .../)`. They fail on
// harmless renames and pass when behavior breaks, so their count may only
// fall. Static checks that must read source (CSP strings, forbidden imports)
// stay countable here and keep their budget.
import fs from 'node:fs';
import path from 'node:path';

const PRODUCT_PATH = /(?:^|[/'"`])(?:src\/|preload\.js|package\.json)|['"`](?:\.{1,2}\/)*(?:src|renderer|components|hooks|utils|main|shared)(?:['"`]|\/)/u;
// readFile/readFileSync and project helpers such as read(), readSource() or readRenderer().
const READ_CALL = /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:fs\.)?(?:promises\.)?(?:readFile(?:Sync)?|read(?!dir)\w*)\(([^;]*?)\)\s*(?:[;,\n]|\.)/gu;

// `const panelPath = new URL('../src/...')` followed by `readFile(panelPath)`.
const PATH_VARIABLE = /(?:const|let)\s+(\w+)\s*=\s*([^;]*?);/gu;

function sourceVariables(text) {
  const pathVariables = new Set([...text.matchAll(PATH_VARIABLE)]
    .filter((match) => PRODUCT_PATH.test(match[2]) && !/read\w*\(/u.test(match[2]))
    .map((match) => match[1]));
  const names = new Set();
  for (const match of text.matchAll(READ_CALL)) {
    const argument = match[2].trim().split(/[\s,]/u)[0];
    if (PRODUCT_PATH.test(match[2]) || pathVariables.has(argument)) names.add(match[1]);
  }
  return names;
}

function escape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function countSourceAssertions(text) {
  let count = 0;
  for (const name of sourceVariables(text)) {
    const id = escape(name);
    count += text.match(new RegExp(`assert\\.(?:match|doesNotMatch)\\(\\s*${id}\\b`, 'gu'))?.length || 0;
    count += text.match(new RegExp(`assert(?:\\.ok|\\.equal)?\\(\\s*!?\\s*${id}\\.(?:includes|match|test|indexOf)\\(`, 'gu'))?.length || 0;
    count += text.match(new RegExp(`\\.test\\(\\s*${id}\\s*\\)`, 'gu'))?.length || 0;
  }
  return count;
}

export function scanSourceAssertions(scriptsDirectory) {
  const counts = {};
  for (const name of fs.readdirSync(scriptsDirectory).sort()) {
    if (!/\.(?:c?js|mjs)$/u.test(name) || name === 'source-assertion-scan.mjs') continue;
    const count = countSourceAssertions(fs.readFileSync(path.join(scriptsDirectory, name), 'utf8'));
    if (count) counts[name] = count;
  }
  return counts;
}
