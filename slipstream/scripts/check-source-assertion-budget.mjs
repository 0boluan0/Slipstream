// Ratchet: assertions on product source text may be removed or replaced by
// behavioral tests, never added. `--update` lowers the recorded budget after
// a replacement; it refuses to raise any entry.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSourceAssertions } from './source-assertion-scan.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const budgetFile = path.join(scripts, 'source-assertion-budget.json');
const budget = JSON.parse(fs.readFileSync(budgetFile, 'utf8'));
const actual = scanSourceAssertions(scripts);
const total = (counts) => Object.values(counts).reduce((sum, value) => sum + value, 0);

const grown = Object.entries(actual)
  .filter(([name, count]) => count > (budget.scripts[name] || 0))
  .map(([name, count]) => `${name}: ${budget.scripts[name] || 0} → ${count}`);
assert.deepEqual(grown, [], 'New assertions on product source text. Test the behavior instead '
  + '(see test/README.md); keep static source reads for genuine static contracts only.');

if (process.argv.includes('--update')) {
  fs.writeFileSync(budgetFile, JSON.stringify({ ...budget, total: total(actual), scripts: actual }, null, 2) + '\n');
  console.log(`Source-assertion budget lowered: ${budget.total} → ${total(actual)}.`);
} else {
  const slack = total(budget.scripts) - total(actual);
  console.log(`Source-text assertions: ${total(actual)} (budget ${budget.total}).`
    + (slack > 0 ? ` ${slack} replaced; run with --update to lower the budget.` : ''));
}
