const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow } = require('electron');
const katex = require('katex');
const definitions = [
  ['fraction', String.raw`F=\frac{QK^{T}}{\sqrt{d}}`],
  ['accent', String.raw`\widehat{m}_{t}=\frac{m_t}{1-\beta^{t}}`],
  ['expectation', String.raw`E[U\mid X]=0,\quad \theta_0=1`],
];
async function createFormulaFixtures(directory) {
  const win = new BrowserWindow({ show: false, width: 920, height: 240,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
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
      await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
      const file = path.join(directory, name + '.png');
      fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG()); files.push({ name, file });
    }
    return files;
  } finally { win.destroy(); }
}
module.exports = { createFormulaFixtures };
