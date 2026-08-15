import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createSourceOpenFailureNotice,
  createSourceOpenPendingNotice,
  createSourceOpenSuccessNotice,
} from '../src/renderer/utils/sourceActionNotice.mjs';
import {
  createClipboardCopyFailureNotice,
  createCopiedClipboardNotice,
} from '../src/renderer/utils/clipboardNotice.mjs';

const pending = createSourceOpenPendingNotice();
assert.equal(pending.status, 'open-pending');
assert.match(pending.message, /正在交给默认浏览器/);
assert.match(pending.detail, /当前结果不会改变/);
assert.deepEqual(Object.keys(pending).sort(), ['detail', 'kind', 'message', 'status']);

const opened = createSourceOpenSuccessNotice();
assert.equal(opened.status, 'opened');
assert.match(opened.message, /已交给默认浏览器/);
assert.match(opened.detail, /不代表页面内容已经核验/);
assert.deepEqual(Object.keys(opened).sort(), ['detail', 'kind', 'message', 'status']);

const failed = createSourceOpenFailureNotice();
assert.equal(failed.status, 'open-error');
assert.match(failed.message, /没有打开官方来源/);
assert.match(failed.detail, /重试.*复制链接/s);
assert.deepEqual(Object.keys(failed).sort(), ['detail', 'kind', 'message', 'status']);

const copiedSource = createCopiedClipboardNotice('source-link', {
  success: true,
  consequenceId: 'source-link-consequence',
});
assert.match(copiedSource.message, /官方来源链接已复制/);
assert.equal(copiedSource.consequenceId, 'source-link-consequence');
assert.match(copiedSource.detail, /手动覆盖/);
assert.match(createClipboardCopyFailureNotice('source-link').detail, /剪贴板没有因这次操作改变/);

const componentSource = await readFile(new URL('../src/renderer/components/ResultDisplay.jsx', import.meta.url), 'utf8');
const panelSource = await readFile(new URL('../src/renderer/components/FloatingPanel.jsx', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../src/renderer/App.jsx', import.meta.url), 'utf8');
assert.match(componentSource, /const opened = await onOpenExternal\(url\)[\s\S]*?opened !== true[\s\S]*?createSourceOpenSuccessNotice/,
  'opening a source may report success only after the main process confirms it');
assert.match(componentSource, /catch \{[\s\S]*?createSourceOpenFailureNotice/,
  'external-open failures must become visible recovery feedback');
assert.match(componentSource, /handleCopySourceLink[\s\S]*?await writeClipboard\(url, 'source-link'\)[\s\S]*?setClipboardNotice\(settledNotice\)/,
  'source-link copying must publish the App coordinator settlement and consequence feedback');
assert.match(componentSource, /handleCopySourceLink[\s\S]*?sourceActionBusy \|\| clipboardWritePending/,
  'source-link copying must not overlap any unsettled App-authored write');
assert.match(componentSource, /data-source-link-copy-action[\s\S]*?disabled=\{sourceActionBusy \|\| clipboardWritePending\}/,
  'source-link copy controls must expose the cross-entry clipboard lock');
assert.match(panelSource, /handleWriteClipboard[\s\S]*?clipboardOperationPending \|\| replyCopyRequestRef\.current[\s\S]*?onClipboardCopy\(\{ kind, text \}\)/,
  'copy actions must route through the App serialization boundary instead of raw IPC');
assert.match(appSource, /const handleClipboardCopy = useCallback[\s\S]*?await invoke\(IPC_CHANNELS\.CLIPBOARD_WRITE, text\)/,
  'the App coordinator must be the native source-link write owner');
assert.match(componentSource, /await writeClipboard\(url, 'source-link'\)[\s\S]*?setSourceAction\(\{ kind: 'copy', url, status: 'success' \}\)/,
  'a source link may report copied only after the App coordinator confirms settlement');
assert.match(componentSource, /if \(!error\?\.clipboardManaged\)[\s\S]*?createClipboardCopyFailureNotice\('source-link', current\)/,
  'a locally unavailable writer may report failure without overwriting App-managed authority');
assert.match(componentSource, /aria-busy=.*sourceAction\.status === 'opening'/,
  'the active source-open control must expose its pending state');
assert.match(componentSource, /打开失败 · 重试/);
assert.match(componentSource, /复制失败 · 重试/);

const ipcSource = await readFile(new URL('../src/renderer/hooks/useIpc.js', import.meta.url), 'utf8');
assert.match(ipcSource, /get\('external'\)/);
assert.match(ipcSource, /demoExternalOpenCode === 'fail'/);
assert.match(ipcSource, /demoExternalOpenFailuresRemaining/,
  'the local preview must reproduce one-time external-open failure and recovery');

const appStyles = await readFile(new URL('../src/renderer/App.css', import.meta.url), 'utf8');
assert.match(componentSource, /className="text-button source-action-button"/,
  'every official-source action must opt into the larger visible target treatment');
assert.match(appStyles, /\.source-action-button \{[\s\S]*?min-height: 32px;[\s\S]*?padding: 6px 9px;/,
  'official-source actions must exceed the 24px minimum target-size floor');
assert.match(appStyles, /\.source-(?:citation|receipt) \.citation-actions \{[\s\S]*?flex-wrap: wrap;/,
  'source actions must wrap instead of compressing the source content');
assert.match(appStyles, /@media \(max-width: 520px\)[\s\S]*?\.source-receipt \.citation-actions \{[\s\S]*?justify-content: flex-start;/,
  'narrow source actions must align with the readable content edge');

console.log('Official source action feedback and recovery checks passed.');
