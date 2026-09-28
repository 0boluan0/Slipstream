'use strict';

// Retypeset, self-authored OCR control; no captured paper or personal pixels.

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const katex = require('katex');
const katexCss = fs.readFileSync(require.resolve('katex/dist/katex.min.css'), 'utf8');

const output = path.resolve(process.argv[3] || path.join(__dirname, 'fixtures', 'authored-softmax-formula-prose.png'));
const lineHeight = Number(process.argv[2] || 34);
if (!Number.isInteger(lineHeight) || lineHeight < 24 || lineHeight > 40) throw new Error('Invalid line height');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  app.dock?.hide();
  const window = new BrowserWindow({ width: 1110, height: 218, show: false,
    useContentSize: true, webPreferences: { sandbox: true } });
  const inline = (latex) => katex.renderToString(latex, { throwOnError: true, output: 'html' });
  const equation = katex.renderToString(
    'q_i=\\frac{\\mathit{exp}(z_i/T)}{\\sum_j\\mathit{exp}(z_j/T)}',
    { throwOnError: true, displayMode: true, output: 'html' });
  const html = [
    '<!doctype html><meta charset="utf-8"><style>', katexCss,
    'html,body{width:1110px;height:218px;margin:0;background:#fff;color:#111;overflow:hidden}',
    '.prose{position:absolute;left:24px;top:17px;font:26px/' + lineHeight + 'px "Times New Roman",serif;white-space:nowrap}',
    '.prose .katex{font-size:1em}',
    '.equation{position:absolute;left:395px;top:104px;width:310px;font-size:26px}',
    '.number{position:absolute;right:31px;top:126px;font:26px "Times New Roman",serif}',
    '</style><div class="prose">',
    'A classifier converts raw scores into class probabilities by using a “softmax” output layer that<br>',
    'compares the logit, ', inline('z_i'),
    ', for each class with all other logits before producing ', inline('q_i'), '.',
    '</div><div class="equation">', equation, '</div><div class="number">(1)</div>',
  ].join('');
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const png = (await window.webContents.capturePage()).resize({ width: 1110,
    height: 218, quality: 'best' }).toPNG();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, png);
  console.log(output + ' ' + png.length + ' bytes');
  window.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
