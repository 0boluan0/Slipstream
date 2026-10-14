import assert from 'node:assert/strict';
import test from 'node:test';
import { loadComponent, render } from './helpers/render-component.mjs';

const { default: ForegroundStatusCenter } = await loadComponent('src/renderer/components/ForegroundStatusCenter.jsx');

const idle = {
  pendingCount: 0,
  operationalCount: 0,
  hasWarning: false,
  quiet: false,
  screenshot: { request: null },
  clipboard: { item: null, copy: null },
  runtimeAlerts: [],
  shortcutCopy: null,
  onOpenShortcutSettings: () => {},
  monitoring: { enabled: false, offNotice: '' },
};
const screenshotCopy = { title: '截图请求等待处理', detail: '当前任务结束后再截图。', actionLabel: '停止当前任务并截图',
  showIgnoreAction: true, ignoreLabel: '忽略这次截图' };
const clipboardCopy = { title: '复制的文字等待处理', detail: '不会自动开始。', actionLabel: '处理这段文字', ignoreLabel: '忽略' };
const monitoringCopy = { kind: 'cloud', activeTitle: '自动检测复制已开启', activeDetail: '复制的英文会发送给所选服务。' };
const screenshotRequest = (overrides = {}) => ({ request: { id: 'shot-1' }, copy: screenshotCopy, stopping: false,
  cancelling: false, stillBlocking: false, statusRef: null, ...overrides });
const buttons = (html) => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/gu)]
  .map(([, attributes, label]) => ({ label: label.replace(/<[^>]+>/gu, ''), disabled: /\sdisabled=""/u.test(attributes), attributes }));

test('nothing is rendered when there is no pending request or status', () => {
  assert.equal(render(ForegroundStatusCenter, idle), '');
});

test('simultaneous statuses are grouped in one labelled center with their counts', () => {
  const html = render(ForegroundStatusCenter, { ...idle, pendingCount: 2, operationalCount: 2, hasWarning: true,
    screenshot: screenshotRequest(),
    clipboard: { item: { id: 'clip-1' }, copy: clipboardCopy, preview: 'Copied text', statusRef: null },
    runtimeAlerts: ['OCR 没有启动。'], shortcutCopy: { title: '快捷键不可用', detail: '被占用。' },
    monitoring: { enabled: true, copy: monitoringCopy, stopStatus: 'idle', statusRef: null } });
  assert.match(html, /^<section class="foreground-status-center" aria-labelledby="foreground-status-center-title" data-pending-capture-count="2" data-operational-status-count="2">/u);
  assert.match(html, /2 项捕获请求待处理/u);
  assert.match(html, /先处理捕获请求；下方还有 2 项运行状态。/u);
  assert.equal((html.match(/<section class="clipboard-monitor-queue/gu) || []).length, 2, 'both capture requests are shown');
  const order = ['is-screenshot-request', 'clipboard-monitor-queue__preview', 'foreground-runtime-alert',
    'shortcut-readiness-alert', 'clipboard-monitoring-live'].map((marker) => html.indexOf(marker));
  assert.ok(order.every((position) => position >= 0), 'every status is rendered');
  assert.deepEqual([...order].sort((a, b) => a - b), order,
    'screenshot, clipboard, runtime alerts, shortcut readiness, then monitoring status');
});

test('a stopping screenshot request shows progress and cannot be confirmed twice', () => {
  const html = render(ForegroundStatusCenter, { ...idle, pendingCount: 1,
    screenshot: screenshotRequest({ stopping: true, cancelling: true }) });
  assert.match(html, /aria-busy="true"/u);
  assert.match(html, /pending-screenshot-spinner/u);
  const [proceed] = buttons(html);
  assert.equal(proceed.label, screenshotCopy.actionLabel);
  assert.equal(proceed.disabled, true);
});

test('the ignore action appears only when the request copy offers it', () => {
  const offered = buttons(render(ForegroundStatusCenter, { ...idle, pendingCount: 1, screenshot: screenshotRequest() }));
  assert.deepEqual(offered.map((button) => button.label), [screenshotCopy.actionLabel, screenshotCopy.ignoreLabel]);
  const withdrawn = buttons(render(ForegroundStatusCenter, { ...idle, pendingCount: 1,
    screenshot: screenshotRequest({ copy: { ...screenshotCopy, showIgnoreAction: false } }) }));
  assert.deepEqual(withdrawn.map((button) => button.label), [screenshotCopy.actionLabel]);
});

test('a pending clipboard item shows its quoted preview and blocks actions while a decision is open', () => {
  const html = render(ForegroundStatusCenter, { ...idle, pendingCount: 1,
    clipboard: { item: { id: 'clip-1' }, copy: clipboardCopy, preview: 'An eigenvector is nonzero.', busy: false,
      stillBlocking: true, statusRef: null } });
  assert.match(html, /“An eigenvector is nonzero\.”/u);
  assert.match(html, /lang="en"/u);
  assert.deepEqual(buttons(html).map(({ label, disabled }) => [label, disabled]),
    [[clipboardCopy.actionLabel, true], [clipboardCopy.ignoreLabel, true]]);
});

test('alerts are announced unless the clipboard residue dialog owns the announcement', () => {
  const props = { ...idle, operationalCount: 2, runtimeAlerts: ['OCR 没有启动。'], shortcutCopy: { title: '快捷键不可用', detail: '被占用。' } };
  const loud = render(ForegroundStatusCenter, props);
  assert.match(loud, /class="app-runtime-alert foreground-runtime-alert" role="alert" aria-live="assertive"/u);
  assert.match(loud, /<section class="shortcut-readiness-alert" role="alert"/u);
  assert.ok(buttons(loud).some((button) => button.label === '修改快捷键'), 'the shortcut alert offers a fix');
  const quiet = render(ForegroundStatusCenter, { ...props, quiet: true });
  assert.match(quiet, /class="app-runtime-alert foreground-runtime-alert" role="note"/u);
  assert.doesNotMatch(quiet, /aria-live="assertive"/u);
});

test('active clipboard monitoring explains its destination and how to stop it', () => {
  const props = { ...idle, operationalCount: 1, monitoring: { enabled: true, copy: monitoringCopy, stopStatus: 'idle',
    stopError: '', saving: false, statusRef: null } };
  const active = render(ForegroundStatusCenter, props);
  assert.match(active, /自动检测复制已开启/u);
  assert.match(active, /复制的英文会发送给所选服务。 关闭只影响今后复制；已经开始的任务仍会继续。/u);
  assert.deepEqual(buttons(active).map(({ label, disabled }) => [label, disabled]), [['关闭自动检测', false]]);

  const stopping = render(ForegroundStatusCenter, { ...props, monitoring: { ...props.monitoring, stopStatus: 'stopping' } });
  assert.deepEqual(buttons(stopping).map(({ label, disabled }) => [label, disabled]), [['正在关闭…', true]]);
  const saving = render(ForegroundStatusCenter, { ...props, monitoring: { ...props.monitoring, saving: true } });
  assert.deepEqual(buttons(saving).map(({ disabled }) => disabled), [true], 'no stop request while settings are saving');

  const failed = render(ForegroundStatusCenter, { ...props, monitoring: { ...props.monitoring, stopError: '关闭失败，请重试。' } });
  assert.match(failed, /class="clipboard-monitoring-live is-cloud is-error" role="alert" aria-live="assertive"/u);
  assert.deepEqual(buttons(failed).map(({ label }) => label), ['重试关闭']);

  const hidden = render(ForegroundStatusCenter, { ...props, monitoring: { ...props.monitoring, enabled: false } });
  assert.doesNotMatch(hidden, /自动检测复制已开启/u, 'monitoring status disappears once it is off');
});

test('a monitoring-off notice can be dismissed', () => {
  const html = render(ForegroundStatusCenter, { ...idle, operationalCount: 1,
    monitoring: { enabled: false, offNotice: '自动检测已关闭。', statusRef: null } });
  assert.match(html, /<div class="clipboard-monitoring-stopped" role="status">/u);
  assert.match(html, /aria-label="关闭自动检测已关闭提示"/u);
});
