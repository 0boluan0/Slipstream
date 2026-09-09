'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const katex = path.join(path.dirname(require.resolve('katex/package.json')), 'dist');
const files = [path.join(katex, 'katex.min.js'), path.join(katex, 'katex.min.css'),
  ...fs.readdirSync(path.join(katex, 'fonts')).filter((file) => /\.woff2?$/u.test(file)).map((file) => path.join(katex, 'fonts', file)),
  path.join(__dirname, '../shared/reading-math.cjs'),
  path.join(__dirname, 'reading-math/view.js'), path.join(__dirname, 'reading-math/style.css')];
module.exports = { mathAssetUrls: files.map((file) => pathToFileURL(file).href) };
