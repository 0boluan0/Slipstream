const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createTaskSettlement,
  waitForTaskSettlements,
} = require('../src/main/task-cancellation');

async function main() {
  assert.equal(await waitForTaskSettlements([]), true);

  const first = createTaskSettlement();
  const second = createTaskSettlement();
  const confirmed = waitForTaskSettlements([first.promise, second.promise], 1000);
  assert.equal(first.resolve(), true);
  assert.equal(first.resolve(), false, 'settlement resolution must be idempotent');
  second.resolve();
  assert.equal(await confirmed, true, 'cancellation confirms only after every captured task settles');

  const stillRunning = createTaskSettlement();
  assert.equal(
    await waitForTaskSettlements([stillRunning.promise], 10),
    false,
    'a task that ignores abort must not be reported as stopped',
  );
  stillRunning.resolve();

  assert.equal(
    await waitForTaskSettlements([Promise.reject(new Error('task failed while stopping'))], 1000),
    true,
    'a rejected task is still settled and no longer running',
  );

  const projectRoot = path.join(__dirname, '..');
  const mainSource = fs.readFileSync(path.join(projectRoot, 'src/main/main.js'), 'utf8');
  const panelSource = fs.readFileSync(
    path.join(projectRoot, 'src/renderer/components/FloatingPanel.jsx'),
    'utf8',
  );
  const demoSource = fs.readFileSync(path.join(projectRoot, 'src/renderer/hooks/useIpc.js'), 'utf8');

  const cancelHandlerStart = mainSource.indexOf('ipcMain.handle(IPC_CHANNELS.LLM_CANCEL');
  const processHandlerStart = mainSource.indexOf('ipcMain.handle(IPC_CHANNELS.LLM_PROCESS', cancelHandlerStart);
  const cancelHandler = mainSource.slice(cancelHandlerStart, processHandlerStart);
  assert.match(cancelHandler, /async \(event, options\)/,
    'the main cancellation handler must be able to await task settlement');
  assert.match(cancelHandler, /const activeTasks = \[/);
  assert.match(cancelHandler, /llmRequestSettlement\?\.promise/);
  assert.match(cancelHandler, /verificationRequestSettlement\?\.promise/);
  assert.match(cancelHandler, /captureRequestSettlement\?\.promise/);
  assert.match(cancelHandler, /return waitForTaskSettlements\(activeTasks\)/,
    'the renderer acknowledgement must represent settled work, not only an abort signal');

  assert.match(panelSource, /acknowledged !== true\) handleUnconfirmedCancellation\(\)/,
    'official lookup cancellation must recover when the main process reports still running');
  assert.match(panelSource, /cancelRequested: false,[\s\S]*setIsCancellingVerification\(false\)[\s\S]*VERIFICATION_CANCEL_FAILED_NOTICE/,
    'an unconfirmed lookup stop must restore a retryable cancel action and visible warning');
  assert.match(demoSource, /demoCancelCode === 'still-running'[\s\S]*resolve\(false\)/,
    'the product preview must reproduce an unacknowledged cancellation without rejecting IPC');

  console.log('task cancellation settlement checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
