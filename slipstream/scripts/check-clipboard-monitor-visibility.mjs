import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createClipboardMonitoringTrayPresentation } = require('../src/main/clipboard-monitoring-status');
const {
  ENDPOINT_LOCATION_KINDS,
  ENDPOINT_UI_LOCATIONS,
} = require('../src/shared/endpoint-location.cjs');

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const readSource = (relativePath) => readFileSync(path.join(projectRoot, relativePath), 'utf8');

const monitorOff = createClipboardMonitoringTrayPresentation({
  clipboardMonitoring: false,
  activeBackend: 'openai',
});
assert.equal(monitorOff.enabled, false);
assert.equal(monitorOff.statusLabel, '自动检测已关闭');

for (const [backend, destination, processingLocation] of [
  ['openai', 'OpenAI', ENDPOINT_UI_LOCATIONS.ONLINE],
  ['anthropic', 'Anthropic', ENDPOINT_UI_LOCATIONS.ONLINE],
  ['deepseek', 'DeepSeek', ENDPOINT_UI_LOCATIONS.ONLINE],
  ['free_translate', 'Google / MyMemory', ENDPOINT_UI_LOCATIONS.ONLINE],
  ['ollama', '这台 Mac', ENDPOINT_UI_LOCATIONS.LOCAL],
]) {
  const presentation = createClipboardMonitoringTrayPresentation({
    clipboardMonitoring: true,
    activeBackend: backend,
    ...(backend === 'ollama' ? { ollamaBaseUrl: 'http://localhost:11434' } : {}),
  });
  assert.equal(presentation.enabled, true);
  assert.equal(presentation.destination, destination);
  assert.equal(presentation.processingLocation, processingLocation);
  assert.match(presentation.statusLabel, new RegExp(destination));
  assert.equal(presentation.actionLabel, '关闭自动检测');
}

const localCustom = createClipboardMonitoringTrayPresentation({
  clipboardMonitoring: true,
  activeBackend: 'custom',
  customEndpointUrl: 'http://localhost.:8000/v1',
});
assert.equal(localCustom.processingLocation, ENDPOINT_LOCATION_KINDS.LOCAL_LOOPBACK);
assert.equal(localCustom.destination, '本机兼容服务（回环）');
assert.equal(localCustom.statusLabel, '自动检测已开启 · 本机兼容服务（回环）');
assert.doesNotMatch(localCustom.statusLabel, /在线/);
assert.doesNotMatch(JSON.stringify(localCustom), /localhost|8000|\/v1/);

const remoteCustom = createClipboardMonitoringTrayPresentation({
  clipboardMonitoring: true,
  activeBackend: 'custom',
  customEndpointUrl: 'https://custom.example.com/v1',
});
assert.equal(remoteCustom.processingLocation, ENDPOINT_UI_LOCATIONS.ONLINE);
assert.equal(remoteCustom.destination, '自定义在线服务');
assert.equal(remoteCustom.statusLabel, '自动检测已开启 · 自定义在线服务');
assert.doesNotMatch(JSON.stringify(remoteCustom), /custom\.example\.com|\/v1/);

const invalidCustom = createClipboardMonitoringTrayPresentation({
  clipboardMonitoring: true,
  activeBackend: 'custom',
  customEndpointUrl: 'http://public.example.com/private-path',
});
assert.equal(invalidCustom.processingLocation, ENDPOINT_UI_LOCATIONS.UNKNOWN);
assert.equal(invalidCustom.destination, '自定义服务（位置未确认）');
assert.equal(invalidCustom.statusLabel, '自动检测已开启 · 自定义服务（位置未确认）');
assert.doesNotMatch(JSON.stringify(invalidCustom), /public\.example\.com|private-path/);

for (const ollamaBaseUrl of [
  '',
  'https://public-ollama.example/v1',
  'http://public-ollama.example:11434',
]) {
  const unsafeOllama = createClipboardMonitoringTrayPresentation({
    clipboardMonitoring: true,
    activeBackend: 'ollama',
    ollamaBaseUrl,
  });
  assert.equal(unsafeOllama.processingLocation, ENDPOINT_UI_LOCATIONS.UNKNOWN);
  assert.equal(unsafeOllama.destination, 'Ollama（位置未确认）');
  assert.equal(unsafeOllama.statusLabel, '自动检测已开启 · Ollama（位置未确认）');
  assert.doesNotMatch(unsafeOllama.statusLabel, /这台 Mac/);
  assert.doesNotMatch(JSON.stringify(unsafeOllama), /public-ollama\.example|11434|\/v1/);
}

const panelSource = readSource('src/renderer/components/FloatingPanel.jsx');
const panelCss = readSource('src/renderer/App.css');
const mainSource = readSource('src/main/main.js');
const packageSource = readSource('package.json');
const projectReadme = readSource('../README.md');
const developmentReadme = readSource('README.md');
const privacyDoc = readSource('../docs/PRIVACY.md');
const releaseDoc = readSource('../docs/RELEASE.md');

assert.match(panelSource, /settings\.clipboardMonitoring && \(/);
assert.match(panelSource, /clipboardMonitoringCopy\.activeTitle/);
assert.match(panelSource, /关闭只影响今后复制；已经开始的任务仍会继续/);
assert.match(panelSource, /await updateSettings\('clipboardMonitoring', false\)/);
assert.match(panelSource, /discardFailedSettings\(\['clipboardMonitoring'\]\)/);
assert.match(panelSource, /没有关闭自动检测；\$\{consequence\}/);
assert.match(panelSource, /自动检测已关闭；今后复制不会自动处理/);
assert.match(panelSource, /ref=\{clipboardMonitoringStatusRef\}/);
assert.match(panelSource, /role=\{clipboardMonitoringStopError \? 'alert' : 'status'\}/);
assert.match(panelSource, /disabled=\{clipboardMonitoringStopStatus === 'stopping' \|\| settingsController\.settingsSaving\}/);

assert.match(panelCss, /\.clipboard-monitoring-live-region/);
assert.match(panelCss, /\.clipboard-monitoring-live\.is-error/);
assert.match(panelCss, /@media \(max-width: 520px\)[\s\S]*?\.clipboard-monitoring-live/);

assert.match(mainSource, /createClipboardMonitoringTrayPresentation\(store\.getAllSettings\(\)\)/);
assert.match(mainSource, /label: monitoring\.statusLabel/);
assert.match(mainSource, /click: disableClipboardMonitoringFromTray/);
assert.match(mainSource, /关闭自动检测（当前任务继续）/);
assert.match(mainSource, /store\.setSetting\('clipboardMonitoring', false\);[\s\S]*?rendererClipboardPendingStatus = \{ pending: false, count: 0 \};\s+stopClipboardMonitoring\(\);\s+sendSafeSettingsToRenderer\(\)/);
assert.match(mainSource, /mainWindow\.webContents\.send\(IPC_CHANNELS\.SETTINGS_LOADED, getSafeSettings\(\)\)/);
assert.match(mainSource, /const tooltipParts = \[presentation\.tooltip\]/);
assert.match(mainSource, /if \(monitoring\.enabled\) tooltipParts\.push\(monitoring\.statusLabel\)/);
assert.match(mainSource, /function startClipboardMonitoring\(\)[\s\S]*?refreshTrayPresentation\(\)/);
assert.match(mainSource, /function stopClipboardMonitoring\(\)[\s\S]*?refreshTrayPresentation\(\)/);
assert.match(packageSource, /check:clipboard-monitor-visibility/);
assert.match(projectReadme, /main task surface and macOS menu keep the destination and a direct off action visible/);
assert.match(developmentReadme, /Closing monitoring stops future clipboard triggers,[^.]*does not cancel analysis already underway/);
assert.match(privacyDoc, /Closing monitoring prevents future clipboard triggers,[^.]*does not cancel an analysis already in progress/);
assert.match(releaseDoc, /active destination and off action stay visible on the main task surface and macOS menu/);

console.log('Clipboard monitoring visibility checks passed.');
