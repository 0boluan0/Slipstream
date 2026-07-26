const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'src/renderer/components/FloatingPanel.jsx'), 'utf8');

const stableMessages = {
  'processing-busy': '已有任务正在处理，请稍候。',
  'processing-cancelled': '处理已取消。',
  'processing-invalid': '模型返回的内容未通过结构与证据校验。原文和上一份有效结果已保留，请重试或更换模型。',
  'processing-key-missing': '当前在线模型还没有配置 API Key。请打开设置添加后重试，原文已保留。',
  'processing-unauthorized': '当前服务拒绝了连接凭据。请在设置中重新保存并测试凭据；原文和上一份有效结果已保留。',
  'processing-rate-limited': '当前服务暂时限制了请求，或账户额度不足。请稍后重试并检查服务账户；原文和上一份有效结果已保留。',
  'processing-service-unavailable': '当前分析服务暂时不可用。请稍后重试；原文和上一份有效结果已保留。',
  'processing-unreachable': '无法连接当前分析服务。请检查网络或服务地址后重试；原文和上一份有效结果已保留。',
  'ollama-unavailable': '无法连接本机 Ollama。请确认 Ollama 已启动，并检查设置中的服务地址。',
  'ollama-runtime-failed': 'Ollama 已连接，但当前模型无法启动或生成结果。请更新 Ollama、释放内存或更换模型后重试；原文已保留。',
  'model-not-found': '当前模型不存在或尚未下载。请在设置中选择可用模型；使用 Ollama 时请先拉取该模型。',
  'processing-timeout': '模型响应超时。原文和上一份有效结果已保留，可直接重试或改用更快的模型。',
  'processing-failed': '处理失败。原文和上一份有效结果已保留，请检查模型设置和网络连接后重试。',
  'verification-busy': '已有官方核验任务正在处理，请稍候。',
  'verification-approval-invalid': '本次官方核验请求已失效，请重新分析原文后再试。',
  'verification-cancelled': '官方来源核验已取消。',
  'verification-failed': '官方来源核验失败，请稍后重试。',
  'screenshot-busy': '已有截图任务正在处理，请稍候。',
  'screenshot-empty': '没有识别到清晰文字，请重新截图并确保文字清晰。',
  'screenshot-permission-denied': '无法读取屏幕。请到“系统设置 → 隐私与安全性 → 屏幕录制”允许 Slipstream，然后重试。',
  'screenshot-ocr-failed': '截图已完成，但文字识别失败。请重新框选清晰文字；若仍失败，请检查应用安装是否完整。',
  'screenshot-failed': '截图失败。请重新尝试；如果系统没有出现框选光标，请检查屏幕录制权限。',
};
const PROCESSING_FALLBACK = stableMessages['processing-failed'];

for (const [code, message] of Object.entries(stableMessages)) {
  assert.ok(mainSource.includes(`code: '${code}'`), `main process is missing error code ${code}`);
  assert.ok(mainSource.includes(`message: '${message}'`) || mainSource.includes(`const OCR_FAILURE_MESSAGE = '${message}'`),
    `main process is missing stable message for ${code}`);
  assert.ok(rendererSource.includes(`'${code}': '${message}'`), `renderer is missing stable message for ${code}`);
}

assert.doesNotMatch(
  mainSource,
  /error\s*:\s*(?:error|err|exception)(?:\?\.)?\.message/,
  'main process must never return an exception message to the renderer',
);
assert.match(mainSource, /console\.error\('\[LLMProcess\] Error:', error\);/);
assert.match(mainSource, /console\.error\('\[VerificationRun\] Error:', error\);/);
assert.match(mainSource, /console\.error\('\[ScreenshotCapture\] Error:', error\);/);

assert.doesNotMatch(rendererSource, /\.message\b/, 'renderer must not display exception.message');
assert.doesNotMatch(rendererSource, /response\?*\.error\b/, 'renderer must not display raw IPC response errors');
assert.doesNotMatch(rendererSource, /screenshot\?*\.error\b/, 'renderer must not display raw screenshot errors');
assert.doesNotMatch(rendererSource, /setError\(clipboardEvent\.error\)/, 'renderer must not display raw clipboard event errors');
assert.match(
  rendererSource,
  /function userErrorMessage\(response, fallback\) \{\s*return USER_ERROR_MESSAGES\[response\?\.errorCode\] \|\| fallback;\s*\}/,
  'renderer must map IPC error codes to local stable copy',
);
assert.match(rendererSource, /catch \{\s*response = null;\s*\}/, 'LLM IPC failures need a stable renderer fallback');
assert.match(rendererSource, /catch \{[\s\S]*restoreLastGood\(SCREENSHOT_FAILURE_MESSAGE\)/, 'screenshot IPC failures need a stable renderer fallback');
assert.match(rendererSource, /catch \{[\s\S]*appendUniqueWarning\(current, VERIFICATION_FAILURE_MESSAGE\)/,
  'verification IPC failures need a stable renderer fallback');

const rendererHelpersSource = rendererSource.slice(
  rendererSource.indexOf('const USER_ERROR_MESSAGES'),
  rendererSource.indexOf('if (RESULT_DEMO)'),
);
const rendererContext = {};
vm.runInNewContext(
  `${rendererHelpersSource}\nglobalThis.helpers = { userErrorMessage, captureEventMessage };`,
  rendererContext,
);
const providerSecret = '401 Unauthorized: invalid API key sk-private-provider-detail';
assert.equal(
  rendererContext.helpers.userErrorMessage({ errorCode: 'unknown', error: providerSecret }, PROCESSING_FALLBACK),
  PROCESSING_FALLBACK,
);
assert.equal(
  rendererContext.helpers.userErrorMessage({ errorCode: 'processing-failed', error: providerSecret }, 'fallback'),
  stableMessages['processing-failed'],
);
assert.equal(
  rendererContext.helpers.captureEventMessage({ error: `Vision OCR failed at /private/path: ${providerSecret}` }),
  stableMessages['screenshot-failed'],
);
assert.equal(
  rendererContext.helpers.captureEventMessage({ error: `快捷键冲突：${providerSecret}` }),
  '快捷键被其他应用占用，请在设置里更换。',
);

const mainHelpersSource = mainSource.slice(
  mainSource.indexOf('const OCR_FAILURE_MESSAGE'),
  mainSource.indexOf('// --------------- State ---------------'),
);
const mainContext = {};
vm.runInNewContext(
  `${mainHelpersSource}\nglobalThis.helpers = { classifyProcessingError, classifyScreenshotError };`,
  mainContext,
);
assert.equal(mainContext.helpers.classifyProcessingError(new Error('需要先添加 API key'), 'openai').code, 'processing-key-missing');
assert.equal(mainContext.helpers.classifyProcessingError(new Error('fetch failed: ECONNREFUSED'), 'ollama').code, 'ollama-unavailable');
assert.equal(mainContext.helpers.classifyProcessingError(new Error('Ollama 服务错误：404 Not Found'), 'ollama').code, 'model-not-found');
assert.equal(mainContext.helpers.classifyProcessingError(new Error('Ollama 服务错误：500 Internal Server Error'), 'ollama').code, 'ollama-runtime-failed');
assert.equal(mainContext.helpers.classifyProcessingError(new Error('模型响应超时'), 'openai').code, 'processing-timeout');
assert.equal(mainContext.helpers.classifyProcessingError({ status: 401, message: providerSecret }, 'openai').code, 'processing-unauthorized');
assert.equal(mainContext.helpers.classifyProcessingError({ status: 429, message: providerSecret }, 'anthropic').code, 'processing-rate-limited');
assert.equal(mainContext.helpers.classifyProcessingError({ status: 503, message: providerSecret }, 'deepseek').code, 'processing-service-unavailable');
assert.equal(mainContext.helpers.classifyProcessingError({ code: 'ENOTFOUND', message: providerSecret }, 'openai').code, 'processing-unreachable');
assert.equal(mainContext.helpers.classifyProcessingError(new Error(providerSecret), 'openai').code, 'processing-failed');
assert.equal(mainContext.helpers.classifyScreenshotError(new Error('permission denied'), 'selection').code, 'screenshot-permission-denied');
assert.equal(mainContext.helpers.classifyScreenshotError(new Error(providerSecret), 'ocr').code, 'screenshot-ocr-failed');
assert.equal(mainContext.helpers.classifyScreenshotError(new Error(providerSecret), 'selection').code, 'screenshot-failed');

console.log('user-facing error redaction checks passed');
