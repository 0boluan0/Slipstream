import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CLIPBOARD_MONITORING_OFF_DETAIL,
  describeClipboardMonitoring,
} from '../src/renderer/utils/clipboardMonitoringConsent.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const readSource = (relativePath) => readFileSync(path.join(projectRoot, relativePath), 'utf8');
const require = createRequire(import.meta.url);
const { transitionClipboardMonitoring } = require('../src/main/clipboard-monitoring-transition');

function createTransitionHarness({ active = false, persisted = false } = {}) {
  const events = [];
  return {
    events,
    get active() { return active; },
    get persisted() { return persisted; },
    options: {
      isActive: () => active,
      start: () => { events.push('start'); active = true; },
      stop: () => { events.push('stop'); active = false; },
      persist: (value) => { events.push(`persist:${value}`); persisted = value; },
      onDisabled: () => events.push('disabled'),
      onRollbackError: () => events.push('rollback-error'),
    },
  };
}

{
  const harness = createTransitionHarness();
  transitionClipboardMonitoring({ ...harness.options, enabled: true });
  assert.deepEqual(harness.events, ['start', 'persist:true']);
  assert.equal(harness.active, true);
  assert.equal(harness.persisted, true);
}

{
  const harness = createTransitionHarness();
  harness.options.persist = () => {
    harness.events.push('persist:true');
    throw new Error('write failed');
  };
  assert.throws(
    () => transitionClipboardMonitoring({ ...harness.options, enabled: true }),
    /write failed/,
  );
  assert.deepEqual(harness.events, ['start', 'persist:true', 'stop']);
  assert.equal(harness.active, false);
  assert.equal(harness.persisted, false);
}

{
  const harness = createTransitionHarness({ active: true, persisted: true });
  harness.options.persist = () => {
    harness.events.push('persist:false');
    throw new Error('write failed');
  };
  assert.throws(
    () => transitionClipboardMonitoring({ ...harness.options, enabled: false }),
    /write failed/,
  );
  assert.deepEqual(harness.events, ['stop', 'persist:false', 'start']);
  assert.equal(harness.active, true);
  assert.equal(harness.persisted, true);
}

{
  const harness = createTransitionHarness({ active: true, persisted: true });
  transitionClipboardMonitoring({ ...harness.options, enabled: false });
  assert.deepEqual(harness.events, ['stop', 'persist:false', 'disabled']);
  assert.equal(harness.active, false);
  assert.equal(harness.persisted, false);
}

const local = describeClipboardMonitoring({
  setupMode: 'full',
  activeBackend: 'ollama',
  ollamaBaseUrl: 'http://localhost:11434',
});
assert.equal(local.kind, 'local');
assert.equal(local.destination, '这台 Mac');
assert.match(local.title, /自动处理今后复制的文字/);
assert.match(local.detail, /无需再点击生成或按快捷键/);
assert.match(local.consequences.join(' '), /不会发送给模型服务商/);
assert.match(local.consequences.join(' '), /敏感文字也可能被自动处理/);
assert.match(local.confirmLabel, /本机自动分析/);
assert.match(local.activeTitle, /这台 Mac/);

for (const [backend, destination] of [
  ['openai', 'OpenAI'],
  ['anthropic', 'Anthropic'],
  ['deepseek', 'DeepSeek'],
]) {
  const online = describeClipboardMonitoring({ setupMode: 'full', activeBackend: backend });
  assert.equal(online.kind, 'online');
  assert.equal(online.destination, destination);
  assert.match(online.title, /自动发送今后复制的文字/);
  assert.match(online.detail, new RegExp(destination));
  assert.match(online.consequences.join(' '), /调用费用/);
  assert.match(online.consequences.join(' '), /密码、验证码、身份标识/);
  assert.match(online.confirmLabel, /自动发送/);
  assert.match(online.activeTitle, new RegExp(destination));
}

const remoteCustom = describeClipboardMonitoring({
  setupMode: 'full',
  activeBackend: 'custom',
  customEndpointUrl: 'https://api.example.com/v1',
});
assert.equal(remoteCustom.kind, 'online');
assert.equal(remoteCustom.destination, '远程自定义服务');
assert.match(remoteCustom.detail, /远程自定义服务/);
assert.match(remoteCustom.consequences.join(' '), /调用费用/);

const localCustom = describeClipboardMonitoring({
  setupMode: 'full',
  activeBackend: 'custom',
  customEndpointUrl: 'http://127.0.0.1:8000/v1',
});
assert.equal(localCustom.kind, 'local-custom');
assert.equal(localCustom.destination, '这台 Mac 上的兼容服务');
assert.match(localCustom.detail, /本机回环地址/);
assert.match(localCustom.consequences.join(' '), /是否联网、转发或留存取决于它的配置/);
assert.doesNotMatch(localCustom.activeTitle, /在线/);

const unknownCustom = describeClipboardMonitoring({
  setupMode: 'full',
  activeBackend: 'custom',
  customEndpointUrl: 'http://example.com/v1',
});
assert.equal(unknownCustom.kind, 'unknown');
assert.match(unknownCustom.detail, /无法确认/);

const translation = describeClipboardMonitoring({
  setupMode: 'translation-only',
  activeBackend: 'free_translate',
});
assert.equal(translation.kind, 'online');
assert.equal(translation.destination, 'Google / MyMemory');
assert.match(translation.detail, /Google Translate/);
assert.match(translation.detail, /MyMemory/);
assert.match(translation.activeDetail, /在线基础翻译/);
assert.match(translation.consequences.join(' '), /免费端点.*限流/);
assert.doesNotMatch(translation.consequences.join(' '), /调用费用/);
assert.match(CLIPBOARD_MONITORING_OFF_DETAIL, /只有你主动/);

const panelSource = readSource('src/renderer/components/SettingsPanel.jsx');
const dialogSource = readSource('src/renderer/components/ClipboardMonitoringConsentDialog.jsx');
const settingsSource = readSource('src/renderer/hooks/useSettings.js');
const floatingPanelSource = readSource('src/renderer/components/FloatingPanel.jsx');
const demoSource = readSource('src/renderer/hooks/useIpc.js');
const projectReadme = readSource('../README.md');
const developmentReadme = readSource('README.md');
const privacyDoc = readSource('../docs/PRIVACY.md');
const releaseDoc = readSource('../docs/RELEASE.md');

assert.match(panelSource, /if \(event\.target\.checked\)[\s\S]*?setClipboardMonitoringIntent\(true\)/);
assert.match(panelSource, /onConfirm=\{\(\) => persistClipboardMonitoring\(true\)\}/);
assert.match(panelSource, /await updateSettings\('clipboardMonitoring', enabled\)/);
assert.match(panelSource, /await updateSettings\('clipboardMonitoring', enabled\);\s+loadSupportDiagnostics\(true\)/);
assert.match(panelSource, /没有开启自动检测；剪贴板内容仍不会自动处理/);
assert.match(panelSource, /没有关闭自动检测；\$\{consequence\}/);
assert.match(panelSource, /discardFailedSettings\(\['clipboardMonitoring'\]\)/);
assert.match(panelSource, /aria-describedby="clipboard-monitoring-description"/);
assert.match(panelSource, /!settings\.clipboardMonitoring && clipboardMonitoringCopy\.kind === 'unknown'/);
assert.match(panelSource, /clipboardMonitoringCopy\.activeTitle/);
assert.match(panelSource, /关闭自动检测/);
assert.match(panelSource, /role=\{clipboardMonitoringNotice\.status === 'error' \? 'alert' : 'status'\}/);

assert.match(dialogSource, /role="alertdialog"/);
assert.match(dialogSource, /aria-modal="true"/);
assert.match(dialogSource, /event\.key === 'Escape'/);
assert.match(dialogSource, /event\.key !== 'Tab'/);
assert.match(dialogSource, /node\.inert = true/);
assert.match(dialogSource, /safeButtonRef\.current\?\.focus/);
assert.match(dialogSource, /保持关闭/);
assert.match(dialogSource, /自动检测不会创建 Slipstream 历史/);
assert.match(dialogSource, /disabled=\{saving\}/);

assert.match(settingsSource, /const discardFailedSettings = useCallback/);
assert.match(settingsSource, /failedSettingKeysRef\.current\.delete\(key\)/);
assert.match(settingsSource, /failedSaveOperationRef\.current = removeFailedSaveOperationKeys\(/);
assert.match(settingsSource, /discardFailedSettings,/);
assert.match(floatingPanelSource, /isMonitoredClipboard && !clipboardMonitoringEnabledRef\.current/);
assert.match(floatingPanelSource, /shouldHoldClipboardCapture\(\{/);
assert.match(demoSource, /demoBackend === 'free_translate'/);
assert.match(demoSource, /\['custom-local', 'custom-online'\]\.includes\(demoBackend\)/);
assert.match(demoSource, /setupMode: 'translation-only'/);
assert.match(demoSource, /get\('monitor'\)/);
assert.match(demoSource, /demoClipboardMonitoringCode === 'on'/);
assert.match(demoSource, /clipboardMonitoring: true/);

assert.match(projectReadme, /Clipboard monitoring requires a destination-specific confirmation/);
assert.match(developmentReadme, /last confirmed state stays visible/);
assert.match(privacyDoc, /Clipboard monitoring is off by default/);
assert.match(privacyDoc, /passwords, one-time codes, identifiers/);
assert.match(releaseDoc, /failed enable\/disable writes preserve and explain the last confirmed state/);

console.log('Clipboard monitoring consent checks passed.');
