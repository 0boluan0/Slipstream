'use strict';

// Renders an authored evaluation passage (prose with $...$ / $$...$$ math) to
// a PNG data URL in a hidden sandboxed window, so image-reading cases need no
// screenshots of copyrighted pages.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { mathRanges } = require('../shared/reading-math.cjs');

const WIDTH = 840;

function escapeHtml(value) {
  return value.replace(/[&<>"]/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
}

function evalSourceHtml(source, katex) {
  let body = '';
  let cursor = 0;
  const prose = (text) => escapeHtml(text).replace(/\n{2,}/gu, '</p><p>').replace(/\n/gu, ' ');
  for (const range of mathRanges(source)) {
    body += prose(source.slice(cursor, range.start));
    body += katex.renderToString(range.tex, { displayMode: Boolean(range.display), throwOnError: false });
    cursor = range.end;
  }
  body += prose(source.slice(cursor));
  return `<p>${body}</p>`;
}

// One hidden window is reused for every case: recreating windows back to back
// can race Chromium's network service and fail the next file:// load.
function createEvalImageRenderer({ BrowserWindow, workDirectory }) {
  const katex = require('katex');
  const css = pathToFileURL(path.join(path.dirname(require.resolve('katex/package.json')), 'dist/katex.min.css')).href;
  let window;

  async function load(file) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await window.loadFile(file);
      } catch (error) {
        if (error?.code !== 'ERR_FAILED' || attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
  }

  async function render(source) {
    window ??= new BrowserWindow({ width: WIDTH, height: 400, show: false, useContentSize: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const page = `<!doctype html><html><meta charset="utf-8"><link rel="stylesheet" href="${css}">`
      + `<body style="margin:0;background:white;color:#17241f"><main id="passage" style="display:flow-root;`
      + `padding:20px 36px;width:${WIDTH - 72}px;font:21px/1.6 Georgia,serif">${evalSourceHtml(source, katex)}</main></body></html>`;
    const file = path.join(workDirectory, `eval-${crypto.randomUUID()}.html`);
    fs.writeFileSync(file, page);
    try {
      await load(file);
      const height = Math.min(Math.max(await window.webContents.executeJavaScript(
        'document.fonts.ready.then(() => Math.ceil(document.getElementById("passage").getBoundingClientRect().bottom))'), 60), 2400);
      window.setContentSize(WIDTH, Math.max(height, 400));
      await new Promise((resolve) => setTimeout(resolve, 120));
      // Crop to the passage, like a reader's tight selection.
      return (await window.webContents.capturePage({ x: 0, y: 0, width: WIDTH, height })).toDataURL();
    } finally {
      fs.rmSync(file, { force: true });
    }
  }

  return { render, dispose: () => { if (window && !window.isDestroyed()) window.destroy(); window = null; } };
}

module.exports = { createEvalImageRenderer, evalSourceHtml };
