import assert from 'node:assert/strict';
import test from 'node:test';
import { countSourceAssertions } from '../scripts/source-assertion-scan.mjs';

test('counts regex assertions against a product source file read into a variable', () => {
  const script = `
    const appSource = fs.readFileSync(path.join(root, 'src/renderer/App.jsx'), 'utf8');
    assert.match(appSource, /const showSetupGate/);
    assert.doesNotMatch(appSource, /legacy/);
    assert.ok(appSource.includes('hidden={!showPanel}'));
    assert(/visible=/.test(appSource));
  `;
  assert.equal(countSourceAssertions(script), 4);
});

test('recognizes source paths assembled from path segments and helper readers', () => {
  const script = `
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
    const panel = read('src/renderer/components/FloatingPanel.jsx');
    assert.match(mainSource, /ipcMain/);
    assert.match(panel, /useState/);
  `;
  assert.equal(countSourceAssertions(script), 2);
});

test('recognizes project-specific reader helpers with directory-relative paths', () => {
  const script = `
    const panelSource = readRenderer('components/FloatingPanel.jsx');
    const listing = fs.readdirSync(path.join(root, 'src'));
    assert.match(panelSource, /React\\.lazy/);
    assert.ok(listing.includes('main'));
  `;
  assert.equal(countSourceAssertions(script), 1);
});

test('follows a product path stored in a variable before reading it', () => {
  const script = `
    const panelPath = new URL('../src/renderer/components/FloatingPanel.jsx', import.meta.url);
    const panelSource = await readFile(panelPath, 'utf8');
    const outputPath = path.join(work, 'report.json');
    const report = await readFile(outputPath, 'utf8');
    assert.match(panelSource, /useCallback/);
    assert.match(report, /ok/);
  `;
  assert.equal(countSourceAssertions(script), 1);
});

test('ignores assertions on behavior and on non-product files', () => {
  const script = `
    const fixture = fs.readFileSync(path.join(work, 'output.json'), 'utf8');
    const result = await processReadingText({ text });
    assert.match(result.translation, /标准正交/);
    assert.match(fixture, /ok/);
    assert.equal(result.terms.length, 0);
  `;
  assert.equal(countSourceAssertions(script), 0);
});
