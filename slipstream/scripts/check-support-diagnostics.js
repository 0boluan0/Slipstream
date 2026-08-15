const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSupportDiagnostics } = require('../src/main/support-diagnostics');
const { BUILD_IDENTITIES } = require('../src/main/build-identity');
const { DEFAULTS } = require('../src/shared/constants.cjs');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function main() {
  const diagnostics = createSupportDiagnostics({
    appVersion: '1.0.0',
    buildIdentity: BUILD_IDENTITIES.LOCAL_ADHOC,
    systemVersion: '15.5',
    arch: 'arm64',
    screenRecordingStatus: 'denied',
    shortcutRegistrationStatus: {
      clipboard: { accelerator: 'Alt+C', registered: true },
      screenshot: { accelerator: 'F2', registered: false },
    },
    savedTermCount: 3,
    generatedAt: '2026-07-27T12:00:00.000Z',
    settings: {
      setupMode: 'full',
      activeBackend: 'openai',
      activeModel: 'gpt-4o-mini',
      clipboardMonitoring: false,
      verificationPolicy: 'ask',
      clipboardShortcut: 'Alt+C',
      screenshotShortcut: 'F2',
      openaiApiKey: 'sk-private-diagnostic-secret',
      customEndpointUrl: 'https://internal.example/private-path',
      savedTerms: [{ term: 'private customer phrase', evidence: 'private evidence' }],
      sourceText: 'private source text',
      clipboardText: 'private clipboard text',
    },
  });

  assert.equal(diagnostics.appVersion, '1.0.0');
  assert.equal(diagnostics.buildIdentity, BUILD_IDENTITIES.LOCAL_ADHOC);
  assert.equal(diagnostics.buildKind, '本地测试包 · 临时签名 · 未公证');
  assert.equal(diagnostics.buildTrust, '仅用于本地测试，不是公开发布版本。');
  assert.equal(diagnostics.isPublicDistribution, false);
  assert.equal(diagnostics.system.architectureLabel, 'Apple 芯片（arm64）');
  assert.equal(diagnostics.screenRecording.status, 'denied');
  assert.equal(diagnostics.screenRecording.label, '未允许');
  assert.equal(diagnostics.mode.label, '完整分析');
  assert.equal(diagnostics.analysis.label, '在线 · OpenAI · gpt-4o-mini');
  assert.equal(diagnostics.analysis.processingLocation, 'online');
  assert.equal(diagnostics.savedTermCount, 3);
  assert.equal(diagnostics.shortcuts.clipboardRegistered, true);
  assert.equal(diagnostics.shortcuts.screenshotRegistered, false);
  assert.match(diagnostics.summaryText, /截图 F2（不可用）/);
  assert.match(diagnostics.summaryText, /构建信任：仅用于本地测试，不是公开发布版本。/);
  assert.doesNotMatch(diagnostics.summaryText, /正式安装包/);
  assert.match(diagnostics.summaryText, /已保存术语：3 条（不包含术语内容）/);
  assert.match(diagnostics.summaryText, /不会自动发送/);
  assert.deepEqual(diagnostics.privacy, {
    includesCredentials: false,
    includesServiceAddresses: false,
    includesSourceText: false,
    includesTermContent: false,
    includesClipboardContent: false,
    automaticallySent: false,
  });

  const serialized = JSON.stringify(diagnostics);
  for (const privateValue of [
    'sk-private-diagnostic-secret',
    'internal.example',
    'private customer phrase',
    'private evidence',
    'private source text',
    'private clipboard text',
  ]) {
    assert.equal(serialized.includes(privateValue), false, `diagnostics must exclude ${privateValue}`);
  }

  const normalized = createSupportDiagnostics({
    appVersion: ' 1.0.0\nprivate ',
    systemVersion: ' 15.5\t ',
    arch: 'mips',
    screenRecordingStatus: 'invented',
    savedTermCount: 999,
    settings: {
      setupMode: 'invented',
      activeBackend: 'invented',
      activeModel: ' model\nname ',
      verificationPolicy: 'invented',
      clipboardShortcut: '',
      screenshotShortcut: '',
    },
  });
  assert.equal(normalized.appVersion, '1.0.0 private');
  assert.equal(normalized.buildIdentity, BUILD_IDENTITIES.PACKAGED_UNKNOWN);
  assert.equal(normalized.buildKind, '未知构建身份的安装包');
  assert.equal(normalized.isPublicDistribution, false);
  assert.equal(normalized.system.arch, 'unknown');
  assert.equal(normalized.screenRecording.status, 'unknown');
  assert.equal(normalized.mode.value, 'unconfigured');
  assert.equal(normalized.analysis.backend, 'free_translate');
  assert.equal(normalized.analysis.model, '模型名称未披露');
  assert.equal(normalized.analysis.processingLocation, 'online');
  assert.equal(normalized.verification.value, 'ask');
  assert.equal(normalized.shortcuts.clipboard, DEFAULTS.CLIPBOARD_SHORTCUT);
  assert.equal(normalized.shortcuts.screenshot, DEFAULTS.SCREENSHOT_SHORTCUT);
  assert.match(normalized.summaryText, /截图 Option\+Shift\+S/);
  assert.equal(normalized.savedTermCount, 50);

  const developerIdDiagnostics = createSupportDiagnostics({
    buildIdentity: BUILD_IDENTITIES.DEVELOPER_ID,
  });
  assert.equal(developerIdDiagnostics.buildKind, 'Developer ID 签名构建');
  assert.equal(developerIdDiagnostics.isPublicDistribution, false);
  assert.match(developerIdDiagnostics.buildTrust, /不能证明 Apple 公证状态或 Gatekeeper 信任/);
  assert.doesNotMatch(developerIdDiagnostics.summaryText, /已公证|Gatekeeper 已通过|正式安装包/);

  const unknownPackagedDiagnostics = createSupportDiagnostics({
    buildIdentity: 'unrecognized-packaged-build',
  });
  assert.equal(unknownPackagedDiagnostics.buildIdentity, BUILD_IDENTITIES.PACKAGED_UNKNOWN);
  assert.equal(unknownPackagedDiagnostics.isPublicDistribution, false);
  assert.match(unknownPackagedDiagnostics.buildTrust, /不能视为可信或公开发布版本/);

  for (const unsafeModel of [
    'sk-private-model-marker-secret',
    'https://models.example/private/v1',
    'Please upload the unredacted bank statement tomorrow.',
    'x'.repeat(81),
  ]) {
    const protectedDiagnostics = createSupportDiagnostics({
      settings: { activeBackend: 'openai', activeModel: unsafeModel },
    });
    assert.equal(protectedDiagnostics.analysis.model, '模型名称未披露');
    assert.equal(JSON.stringify(protectedDiagnostics).includes(unsafeModel), false,
      'an arbitrary activeModel must not cross the credential/source-free diagnostics boundary');
  }

  const localCustom = createSupportDiagnostics({
    settings: {
      setupMode: 'full',
      activeBackend: 'custom',
      activeModel: 'local-model',
      customEndpointUrl: 'HTTP://127.42.8.9:8000/v1',
    },
  });
  assert.equal(localCustom.analysis.backend, 'custom');
  assert.equal(localCustom.analysis.processingLocation, 'local-loopback');
  assert.equal(localCustom.analysis.label, '本机兼容服务 · 回环 · local-model');
  assert.match(localCustom.summaryText, /分析方式：本机兼容服务 · 回环 · local-model/);
  assert.doesNotMatch(JSON.stringify(localCustom), /127\.42\.8\.9|8000|\/v1/);

  const remoteCustom = createSupportDiagnostics({
    settings: {
      setupMode: 'full',
      activeBackend: 'custom',
      activeModel: 'remote-model',
      customEndpointUrl: 'https://custom.example.com/v1',
    },
  });
  assert.equal(remoteCustom.analysis.processingLocation, 'online');
  assert.equal(remoteCustom.analysis.label, '在线 · 自定义服务 · remote-model');
  assert.doesNotMatch(JSON.stringify(remoteCustom), /custom\.example\.com|\/v1/);

  const invalidCustom = createSupportDiagnostics({
    settings: {
      setupMode: 'full',
      activeBackend: 'custom',
      activeModel: 'untrusted-model',
      customEndpointUrl: 'http://public.example.com/private-path',
    },
  });
  assert.equal(invalidCustom.analysis.processingLocation, 'unknown');
  assert.equal(invalidCustom.analysis.label, '位置未确认 · 自定义服务 · untrusted-model');
  assert.doesNotMatch(JSON.stringify(invalidCustom), /public\.example\.com|private-path/);

  const ollama = createSupportDiagnostics({
    settings: {
      setupMode: 'full',
      activeBackend: 'ollama',
      activeModel: 'qwen2.5',
      ollamaBaseUrl: 'http://localhost:11434',
    },
  });
  assert.equal(ollama.analysis.processingLocation, 'local');
  assert.equal(ollama.analysis.label, '本机 · Ollama · qwen2.5');
  assert.doesNotMatch(JSON.stringify(ollama), /localhost|11434/);

  const untrustedOllama = createSupportDiagnostics({
    settings: {
      setupMode: 'full',
      activeBackend: 'ollama',
      activeModel: 'qwen2.5',
      ollamaBaseUrl: 'https://ollama.example.com',
    },
  });
  assert.equal(untrustedOllama.analysis.processingLocation, 'unknown');
  assert.equal(untrustedOllama.analysis.label, '位置未确认 · Ollama · qwen2.5');
  assert.doesNotMatch(JSON.stringify(untrustedOllama), /ollama\.example\.com/);

  const constants = source('src/shared/constants.cjs');
  const preload = source('preload.js');
  const mainProcess = source('src/main/main.js');
  const app = source('src/renderer/App.jsx');
  const settingsPanel = source('src/renderer/components/SettingsPanel.jsx');
  const useIpc = source('src/renderer/hooks/useIpc.js');
  assert.match(constants, /support:diagnostics-get/);
  assert.match(preload, /support:diagnostics-get/);
  assert.match(mainProcess, /IPC_CHANNELS\.SUPPORT_DIAGNOSTICS_GET/);
  assert.match(mainProcess, /settings: getSafeSettings\(\)/);
  assert.match(mainProcess, /shortcutRegistrationStatus/);
  assert.match(mainProcess, /buildIdentity: runtimeBuildIdentity/);
  assert.match(mainProcess, /app\.setAboutPanelOptions\(createAboutPanelOptions\(/);
  assert.match(mainProcess, /installAboutPanel\(\);[\s\S]{0,100}installApplicationMenu\(\);/);
  assert.doesNotMatch(mainProcess, /SUPPORT_DIAGNOSTICS_GET[\s\S]{0,600}settings: store\.getAllSettings/);
  assert.doesNotMatch(mainProcess, /SUPPORT_DIAGNOSTICS_GET[\s\S]{0,600}isPackaged:/);
  assert.match(settingsPanel, /预览将复制的诊断摘要/);
  assert.match(settingsPanel, /也不会自动发送/);
  assert.match(settingsPanel, /data-build-identity=\{supportData\.buildIdentity\}/);
  assert.match(settingsPanel, /supportData\.system\.architectureLabel\} · \{supportData\.buildKind/);
  assert.match(settingsPanel, /onWriteClipboard/,
    'Settings must receive clipboard authority as a callback');
  assert.match(settingsPanel, /await onWriteClipboard\('diagnostics', summaryText\)/,
    'diagnostics must flow through the App clipboard coordinator');
  assert.doesNotMatch(settingsPanel, /IPC_CHANNELS\.CLIPBOARD_WRITE|clipboard:write|navigator\.clipboard/,
    'Settings must not own a native clipboard write path');
  assert.match(app, /<SettingsPanel[\s\S]*?onWriteClipboard=\{handleWriteClipboard\}/,
    'App must supply the diagnostics clipboard callback');
  assert.match(settingsPanel, /<ClipboardActionNotice[\s\S]*?notice=\{clipboardNotice\}/,
    'diagnostics must display the App-owned success or failure notice');
  assert.match(settingsPanel, /授权后返回这里刷新状态/);
  assert.match(settingsPanel, /preserveCurrent \? supportRefreshButtonRef\.current : supportRetryButtonRef\.current/);
  assert.match(settingsPanel, /target\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(settingsPanel, /supportCopyButtonRef\.current\?\.focus/);
  assert.match(useIpc, /buildIdentity: 'development'/);
  assert.match(useIpc, /构建信任：从源码运行的开发预览，不是安装包或公开发布版本。/);

  console.log('Support diagnostics checks passed.');
}

main();
