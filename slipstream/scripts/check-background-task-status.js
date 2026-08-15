'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createBackgroundTaskPresentation,
  createCompletedTaskState,
} = require('../src/main/background-task-status');

const idle = createBackgroundTaskPresentation();
assert.equal(idle.trayTitle, '');
assert.equal(idle.statusLabel, 'Slipstream 已就绪');
assert.equal(idle.notification, null);

const captureProcessing = createBackgroundTaskPresentation({
  phase: 'processing',
  kind: 'capture',
});
assert.equal(captureProcessing.trayTitle, '…');
assert.equal(captureProcessing.statusLabel, '正在等待框选截图…');
assert.match(captureProcessing.tooltip, /框选截图/);
assert.equal(captureProcessing.notification, null);

const ocrProcessing = createBackgroundTaskPresentation({
  phase: 'processing',
  kind: 'ocr',
});
assert.equal(ocrProcessing.trayTitle, '…');
assert.equal(ocrProcessing.statusLabel, '正在识别截图文字（仅在本机）…');
assert.match(ocrProcessing.tooltip, /正在识别截图文字/);
assert.match(ocrProcessing.tooltip, /仅在本机/);
assert.equal(ocrProcessing.notification, null);

const analysisProcessing = createBackgroundTaskPresentation({
  phase: 'processing',
  kind: 'analysis',
  sourceText: 'private source must be ignored',
});
assert.equal(analysisProcessing.trayTitle, '…');
assert.match(analysisProcessing.statusLabel, /正在处理原文/);
assert.equal(analysisProcessing.notification, null);

const verificationProcessing = createBackgroundTaskPresentation({
  phase: 'processing',
  kind: 'verification',
});
assert.equal(verificationProcessing.trayTitle, '…');
assert.match(verificationProcessing.statusLabel, /核验官方来源/);

const success = createBackgroundTaskPresentation({
  phase: 'completed',
  kind: 'analysis',
  outcome: 'success',
  sourceText: 'CONFIDENTIAL_SOURCE_TEXT',
  result: 'CONFIDENTIAL_ANALYSIS_RESULT',
  apiKey: 'sk-private-key',
});
assert.equal(success.trayTitle, '✓');
assert.match(success.notification.body, /不包含原文或分析内容/);

const failure = createBackgroundTaskPresentation({
  phase: 'completed',
  kind: 'verification',
  outcome: 'failure',
});
assert.equal(failure.trayTitle, '!');
assert.match(failure.statusLabel, /没有完成/);
assert.match(failure.notification.body, /不包含原文/);

for (const kind of ['capture', 'ocr']) {
  const kindSuccess = createBackgroundTaskPresentation({
    phase: 'completed',
    kind,
    outcome: 'success',
  });
  assert.equal(kindSuccess.trayTitle, '✓');
  assert.match(kindSuccess.statusLabel, kind === 'capture' ? /截图已获取/ : /截图文字识别完成/);
  assert.match(kindSuccess.notification.body, /不包含截图/);

  const kindFailure = createBackgroundTaskPresentation({
    phase: 'completed',
    kind,
    outcome: 'failure',
  });
  assert.equal(kindFailure.trayTitle, '!');
  assert.match(kindFailure.statusLabel, /没有完成/);
  assert.match(kindFailure.notification.body, /不包含截图/);

  const kindCancelled = createBackgroundTaskPresentation({
    phase: 'completed',
    kind,
    outcome: 'cancelled',
  });
  assert.equal(kindCancelled.trayTitle, '');
  assert.equal(kindCancelled.statusLabel, 'Slipstream 已就绪');
  assert.equal(kindCancelled.notification, null);
}

const cancelled = createBackgroundTaskPresentation({
  phase: 'completed',
  kind: 'analysis',
  outcome: 'cancelled',
});
assert.equal(cancelled.trayTitle, '');
assert.equal(cancelled.notification, null);

const unknownKind = createBackgroundTaskPresentation({
  phase: 'processing',
  kind: 'untrusted-kind',
});
assert.equal(unknownKind.statusLabel, analysisProcessing.statusLabel);
assert.equal(unknownKind.tooltip, analysisProcessing.tooltip);

const unknownKindSuccess = createBackgroundTaskPresentation({
  phase: 'completed',
  kind: 'untrusted-kind',
  outcome: 'success',
});
assert.equal(unknownKindSuccess.statusLabel, success.statusLabel);
assert.deepEqual(unknownKindSuccess.notification, success.notification);

assert.deepEqual(createCompletedTaskState({
  kind: 'analysis',
  outcome: 'success',
  windowHidden: true,
}), { phase: 'completed', kind: 'analysis', outcome: 'success' });
assert.deepEqual(createCompletedTaskState({
  kind: 'verification',
  outcome: 'failure',
  windowHidden: true,
}), { phase: 'completed', kind: 'verification', outcome: 'failure' });
assert.deepEqual(createCompletedTaskState({
  kind: 'capture',
  outcome: 'success',
  windowHidden: true,
}), { phase: 'completed', kind: 'capture', outcome: 'success' });
assert.deepEqual(createCompletedTaskState({
  kind: 'ocr',
  outcome: 'failure',
  windowHidden: true,
}), { phase: 'completed', kind: 'ocr', outcome: 'failure' });
assert.deepEqual(createCompletedTaskState({
  kind: 'untrusted-kind',
  outcome: 'success',
  windowHidden: true,
}), { phase: 'completed', kind: 'analysis', outcome: 'success' });
assert.deepEqual(createCompletedTaskState({
  kind: 'analysis',
  outcome: 'success',
  windowHidden: false,
}), { phase: 'idle', kind: 'analysis', outcome: null });
assert.deepEqual(createCompletedTaskState({
  kind: 'analysis',
  outcome: 'cancelled',
  windowHidden: true,
}), { phase: 'idle', kind: 'analysis', outcome: null });
assert.deepEqual(createCompletedTaskState({
  kind: 'capture',
  outcome: 'cancelled',
  windowHidden: true,
}), { phase: 'idle', kind: 'capture', outcome: null });
assert.deepEqual(createCompletedTaskState({
  kind: 'analysis',
  outcome: 'success',
  windowHidden: true,
  appQuitting: true,
}), { phase: 'idle', kind: 'analysis', outcome: null });

const serializedPresentations = JSON.stringify({
  idle,
  captureProcessing,
  ocrProcessing,
  analysisProcessing,
  verificationProcessing,
  success,
  failure,
  cancelled,
  unknownKind,
  unknownKindSuccess,
});
for (const secret of [
  'CONFIDENTIAL_SOURCE_TEXT',
  'CONFIDENTIAL_ANALYSIS_RESULT',
  'sk-private-key',
  'private source must be ignored',
]) {
  assert.equal(serializedPresentations.includes(secret), false, `presentation leaked ${secret}`);
}

const privacyInputs = Object.freeze({
  sourceText: 'PRIVATE_ORIGINAL_TEXT',
  result: 'PRIVATE_RESULT_TEXT',
  apiKey: 'sk-private-api-key',
  error: 'PRIVATE_PROVIDER_ERROR',
  screenshot: 'PRIVATE_SCREENSHOT_BYTES',
  capture: { text: 'PRIVATE_CAPTURE_TEXT' },
});
const privacyPresentations = [];
for (const kind of ['capture', 'ocr', 'analysis', 'verification', 'PRIVATE_KIND']) {
  for (const state of [
    { phase: 'processing' },
    { phase: 'completed', outcome: 'success' },
    { phase: 'completed', outcome: 'failure' },
    { phase: 'completed', outcome: 'cancelled' },
  ]) {
    privacyPresentations.push(createBackgroundTaskPresentation({
      ...privacyInputs,
      ...state,
      kind,
    }));
  }
}
const serializedPrivacyPresentations = JSON.stringify(privacyPresentations);
for (const secret of [
  ...Object.values(privacyInputs).filter((value) => typeof value === 'string'),
  privacyInputs.capture.text,
  'PRIVATE_KIND',
]) {
  assert.equal(
    serializedPrivacyPresentations.includes(secret),
    false,
    `presentation leaked untrusted input: ${secret}`,
  );
}

const root = path.join(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8');
const overlaySource = fs.readFileSync(
  path.join(root, 'src/renderer/components/LoadingOverlay.jsx'),
  'utf8',
);
const panelSource = fs.readFileSync(
  path.join(root, 'src/renderer/components/FloatingPanel.jsx'),
  'utf8',
);

assert.match(mainSource, /backgroundTask = beginBackgroundTask\('capture'\)/,
  'screenshot selection must own a background task before the window is hidden');
assert.match(mainSource, /handoffBackgroundTask\(backgroundTask, 'ocr'\)/,
  'selection must hand the same task to local OCR without an intermediate completion');
assert.match(mainSource, /createBackgroundTaskHandoffRegistry\(\{[\s\S]*?onTimeout: \(\{ task \}\) => finishBackgroundTask\(task, 'success'\)/,
  'the bounded OCR handoff timeout must settle the exact OCR task as successful');
assert.match(mainSource, /backgroundTaskHandoffRegistry\.arm\(\{[\s\S]*?sourceText: textPayload\.text,[\s\S]*?task: backgroundTask/,
  'successful OCR must wait briefly for analysis ownership before publishing completion');
assert.match(mainSource, /backgroundTaskHandoffRegistry\.claim\(\{[\s\S]*?sourceKind: request\.source,[\s\S]*?sourceText: request\.text,[\s\S]*?handoffBackgroundTask\(pendingOcrHandoff\.task, 'analysis'\)/,
  'a matching OCR result must hand the same task to analysis atomically');
assert.match(mainSource, /if \(!backgroundTask\) backgroundTask = beginBackgroundTask\('analysis'\)/,
  'ordinary processing must still create an analysis background task');
assert.match(mainSource, /const backgroundTask = beginBackgroundTask\('verification'\)/);
assert.match(mainSource, /finishBackgroundTask\(backgroundTask, taskOutcome\)/);
assert.match(mainSource, /cancelForSender\(event\.sender\.id\)[\s\S]*?finishBackgroundTask\(cancelledHandoff\.task, 'cancelled'\)/,
  'cancelling during the bounded OCR handoff must clear the tray task without a false completion');
assert.match(mainSource, /const windowHidden = [^;]*!mainWindow\.isVisible\(\)/);
assert.match(mainSource, /createCompletedTaskState\(\{[\s\S]*?windowHidden,[\s\S]*?appQuitting: app\.isQuitting/);
assert.match(mainSource, /new Notification\(\{[\s\S]*?silent: true/);
assert.match(mainSource, /notification\.on\('click', showMainWindow\)/);
assert.match(mainSource, /clearCompletedTaskPresentation\(\);[\s\S]*?mainWindow\.show\(\)/);
assert.match(mainSource, /tray\.setTitle\(backgroundTaskPresentation\.phase === 'processing'[\s\S]*?pending\.trayTitle \|\| presentation\.trayTitle\)/);
assert.match(mainSource, /ipcMain\.handle\(IPC_CHANNELS\.WINDOW_HIDE,[\s\S]*?hideMainWindowForUser\(\)/);

assert.match(overlaySource, /可以先隐藏窗口，任务会继续/);
assert.match(overlaySource, /提醒也不会包含原文或分析内容/);
assert.match(panelSource, /隐藏窗口，任务会继续/);
assert.match(panelSource, /aria-label=\{hideWindowLabel\}/);

console.log('Background task status checks passed.');
