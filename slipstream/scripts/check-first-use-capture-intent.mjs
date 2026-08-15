import assert from 'node:assert/strict';
import fs from 'node:fs';

import { describeSetupCaptureIntent } from '../src/renderer/utils/setupCaptureIntent.mjs';
import { describePendingScreenshotRequest } from '../src/renderer/utils/foregroundCaptureGuard.mjs';

const clipboard = describeSetupCaptureIntent({ kind: 'clipboard' });
assert.equal(clipboard.tone, 'waiting');
assert.match(clipboard.title, /已保留/);
assert.match(clipboard.detail, /当前窗口/);
assert.match(clipboard.detail, /不会发送/);
assert.match(clipboard.detail, /明确决定/);
assert.doesNotMatch(clipboard.detail, /原文|内容预览|API Key/);

const screenshot = describeSetupCaptureIntent({ kind: 'screenshot' });
assert.equal(screenshot.tone, 'waiting');
assert.match(screenshot.detail, /不会打开截图框选/);
assert.match(screenshot.detail, /明确决定/);

const empty = describeSetupCaptureIntent({ kind: 'clipboard-error' });
assert.equal(empty.tone, 'warning');
assert.match(empty.title, /没有可处理的文字/);
assert.match(empty.detail, /没有发送任何内容/);
assert.equal(describeSetupCaptureIntent({ kind: 'monitor' }), null);

const handedOffScreenshot = describePendingScreenshotRequest({ reason: 'setup', receivedCount: 1 });
assert.equal(handedOffScreenshot.title, '首次截图请求正在等待');
assert.match(handedOffScreenshot.detail, /处理方式已经选好/);
assert.equal(handedOffScreenshot.actionLabel, '开始截图');

const appSource = fs.readFileSync(new URL('../src/renderer/App.jsx', import.meta.url), 'utf8');
const setupSource = fs.readFileSync(
  new URL('../src/renderer/components/SetupGate.jsx', import.meta.url),
  'utf8',
);
const panelSource = fs.readFileSync(
  new URL('../src/renderer/components/FloatingPanel.jsx', import.meta.url),
  'utf8',
);
const ipcSource = fs.readFileSync(new URL('../src/renderer/hooks/useIpc.js', import.meta.url), 'utf8');

assert.match(appSource, /const showSetupGate = [^;]+;/);
assert.match(appSource, /const showPanel = view !== 'settings' && !showSetupGate;/);
assert.match(
  appSource,
  /<FloatingPanel[\s\S]*?visible=\{showPanel\}[\s\S]*?<SetupGate/,
  'the capture owner must mount before and remain mounted behind first-use setup',
);
assert.match(
  appSource,
  /const origin = !setupComplete && !panelSessionStarted \? 'setup' : 'settings';[\s\S]*?origin,/,
  'first-use capture intent must retain its explicit setup origin after App refactors',
);
assert.match(appSource, /current\?\.origin === 'setup' \? null : current/,
  'a setup notice must not leak into later Settings after the panel owns the waiting card');
assert.match(setupSource, /describeSetupCaptureIntent\(captureRequest\)/);
assert.match(setupSource, /role=\{captureIntentCopy\.tone === 'warning' \? 'alert' : 'status'\}/);
assert.doesNotMatch(setupSource, /captureRequest\.(text|sourceText|preview)/,
  'the first-use notice must never render captured text');
assert.match(panelSource, /const shouldHoldCapture = !visible \|\| shouldHoldClipboardCapture/);
assert.match(panelSource, /if \(!visible\)[\s\S]*?announceHiddenCaptureRequest\('screenshot'\)/);
assert.match(panelSource, /reason: setupIncomplete \? 'setup' : 'settings'/);
assert.match(panelSource, /放入一段完整英文[\s\S]*?确认下方发送位置[\s\S]*?生成后点彩色原文核对依据/,
  'the empty full-analysis view must explain the first successful path');
assert.match(panelSource, /载入安全示例（不会生成）/,
  'the safe sample action must state that loading does not generate');
assert.match(panelSource, /首次框选截图时，macOS 可能请求屏幕录制权限；截图和 OCR 都在本机进行。直接粘贴或读取剪贴板无需此权限/,
  'screenshot permission must be explained before the user requests capture');
assert.match(ipcSource, /demoActiveCaptureEventsCode === 'setup-clipboard'/);
assert.match(ipcSource, /demoActiveCaptureEventsCode === 'setup-empty'/);
assert.match(ipcSource, /'setup-screenshot'/);
assert.match(ipcSource, /demoActiveCaptureEventsCode !== 'setup-screenshot'/,
  'the screenshot fixture must not also emit a clipboard event');

console.log('First-use capture intent checks passed.');
