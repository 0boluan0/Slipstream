const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { BrowserWindow, screen } = require('electron');
const katex = require('katex');
const definitions = [
  ['fraction', String.raw`F=\frac{QK^{T}}{\sqrt{d}}`],
  ['accent', String.raw`\widehat{m}_{t}=\frac{m_t}{1-\beta^{t}}`],
  ['expectation', String.raw`E[U\mid X]=0,\quad \theta_0=1`],
];
function createFormulaFixtureWindow(width, height) {
  const zoomFactor = 2 / screen.getPrimaryDisplay().scaleFactor;
  // Keep both the CSS layout and output pixel density stable across displays.
  // This affects authored inputs only, not the reader's actual capture windows.
  return new BrowserWindow({ show: false, frame: false, useContentSize: true,
    width: Math.round(width * zoomFactor), height: Math.round(height * zoomFactor),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false, zoomFactor } });
}
async function createFormulaFixtures(directory) {
  const win = createFormulaFixtureWindow(920, 208);
  try {
    const files = [];
    for (const [name, tex] of definitions) {
      const cssFile = require.resolve('katex/dist/katex.min.css');
      const base = require('node:url').pathToFileURL(path.dirname(cssFile) + path.sep).href;
      const rendered = katex.renderToString(tex, { displayMode: true, throwOnError: true, trust: false });
      const html = '<!doctype html><meta charset="utf-8"><base href="' + base + '"><style>'
        + fs.readFileSync(require.resolve('katex/dist/katex.min.css'), 'utf8')
        + '</style><body style="margin:0;padding:24px;background:white;color:black;font:24px Georgia">'
        + '<p>Consider the following mathematical expression.</p>' + rendered + '</body>';
      const htmlFile = path.join(directory, name + '.html');
      fs.writeFileSync(htmlFile, html); await win.loadFile(htmlFile);
      // Request the fonts used by this layout before waiting for them; hidden
      // windows can otherwise capture a font-display block with missing glyphs.
      const layout = await win.webContents.executeJavaScript(`(async () => {
        document.body.getBoundingClientRect();
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { width: innerWidth, height: innerHeight };
      })()`);
      assert.deepEqual(layout, { width: 920, height: 208 });
      const file = path.join(directory, name + '.png');
      const png = (await win.webContents.capturePage()).toPNG();
      assert.equal(png.readUInt32BE(16), 1840, 'formula fixture must have a fixed 2x pixel width');
      assert.equal(png.readUInt32BE(20), 416, 'formula fixture must preserve its recorded pixel height');
      fs.writeFileSync(file, png); files.push({ name, file });
    }
    return files;
  } finally { win.destroy(); }
}
module.exports = { createFormulaFixtures, createFormulaFixtureWindow };
