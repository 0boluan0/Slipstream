'use strict';

const { createHash } = require('node:crypto');

function captureSource(window) {
  if (typeof window?.bundleId !== 'string' || typeof window.title !== 'string') return null;
  const bundleId = window.bundleId.trim();
  const title = window.title.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!bundleId || !title || title.length > 512 || /^Slipstream(?:\s|·)/iu.test(title)
    || /^(?:Untitled|New Tab|新建文稿|无标题)$/iu.test(title)) return null;
  return { key: createHash('sha256').update(`${bundleId}\0${title}`).digest('hex'), title };
}

function paperForCapture(data, source) {
  if (!source) return null;
  return data.papers.find((paper) => paper.sourceKey === source.key)?.id || null;
}

function titleForCapture(source) {
  return source?.title.replace(/\.pdf$/iu, '').slice(0, 120) || `阅读 · ${new Date().toLocaleDateString('zh-CN')}`;
}

module.exports = { captureSource, paperForCapture, titleForCapture };
