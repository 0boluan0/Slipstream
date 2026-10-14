import React from 'react';
import {
  Camera,
  CircleNotch,
  ClipboardText,
  CloudArrowUp,
  ShieldCheck,
  WarningCircle,
  X,
} from '../phosphorIcons';
import { inferTextLanguageTag } from '../utils/languageBoundary.mjs';

// Pending capture requests and background status shown above the panel. The
// panel owns every decision; this component only renders them in priority order.
// `quiet` mutes live announcements while the clipboard residue dialog speaks.
export default function ForegroundStatusCenter({
  pendingCount,
  operationalCount,
  hasWarning,
  quiet,
  screenshot,
  clipboard,
  runtimeAlerts,
  shortcutCopy,
  onOpenShortcutSettings,
  monitoring,
}) {
  if (pendingCount <= 0 && operationalCount <= 0) return null;
  return (
    <section
      className="foreground-status-center"
      aria-labelledby="foreground-status-center-title"
      data-pending-capture-count={pendingCount}
      data-operational-status-count={operationalCount}
    >
      <header className="foreground-status-center__summary">
        {hasWarning
          ? <WarningCircle size={17} weight="fill" aria-hidden="true" />
          : <ShieldCheck size={17} weight="fill" aria-hidden="true" />}
        <span>
          <strong id="foreground-status-center-title">
            {pendingCount > 0
              ? `${pendingCount} 项捕获请求待处理`
              : `${operationalCount} 项运行状态`}
          </strong>
          <small>
            {pendingCount > 0 && operationalCount > 0
              ? `先处理捕获请求；下方还有 ${operationalCount} 项运行状态。`
              : pendingCount > 0
                ? '当前内容保持不变；按优先顺序处理下方请求。'
                : '这些状态不会替你开始新的处理。'}
          </small>
        </span>
      </header>

      {screenshot.request && (
        <div className="clipboard-monitor-queue-region">
          <section
            className="clipboard-monitor-queue is-screenshot-request"
            role="region"
            aria-labelledby="pending-screenshot-title"
            aria-describedby="pending-screenshot-detail"
            aria-busy={screenshot.stopping}
          >
            {screenshot.stopping
              ? <CircleNotch className="pending-screenshot-spinner" size={19} weight="bold" aria-hidden="true" />
              : <Camera size={19} weight="fill" aria-hidden="true" />}
            <span className="clipboard-monitor-queue__body">
              <strong
                ref={screenshot.statusRef}
                id="pending-screenshot-title"
                tabIndex={-1}
                aria-describedby="pending-screenshot-detail"
              >
                {screenshot.copy?.title}
              </strong>
              <small id="pending-screenshot-detail">{screenshot.copy?.detail}</small>
            </span>
            <span className="clipboard-monitor-queue__actions">
              <button
                type="button"
                className="clipboard-monitor-queue__accept"
                onClick={screenshot.onProceed}
                disabled={
                  screenshot.cancelling
                  || screenshot.stillBlocking
                  || screenshot.copy?.actionDisabled
                }
                aria-busy={screenshot.cancelling}
              >
                {screenshot.copy?.actionLabel}
              </button>
              {screenshot.copy?.showIgnoreAction && (
                <button
                  type="button"
                  onClick={screenshot.onIgnore}
                  disabled={screenshot.stillBlocking}
                >
                  {screenshot.copy.ignoreLabel}
                </button>
              )}
            </span>
          </section>
        </div>
      )}

      {clipboard.item && clipboard.copy && (
        <div className="clipboard-monitor-queue-region">
          <section
            className="clipboard-monitor-queue"
            role="region"
            aria-labelledby="clipboard-monitor-queue-title"
            aria-describedby="clipboard-monitor-queue-detail clipboard-monitor-queue-preview"
          >
            <ClipboardText size={19} weight="fill" aria-hidden="true" />
            <span className="clipboard-monitor-queue__body">
              <strong
                ref={clipboard.statusRef}
                id="clipboard-monitor-queue-title"
                tabIndex={-1}
                aria-describedby="clipboard-monitor-queue-detail clipboard-monitor-queue-preview"
              >
                {clipboard.copy.title}
              </strong>
              <small id="clipboard-monitor-queue-detail">{clipboard.copy.detail}</small>
              <span
                id="clipboard-monitor-queue-preview"
                className="clipboard-monitor-queue__preview"
                lang={inferTextLanguageTag(clipboard.preview)}
              >
                “{clipboard.preview}”
              </span>
            </span>
            <span className="clipboard-monitor-queue__actions">
              <button
                type="button"
                className="clipboard-monitor-queue__accept"
                onClick={clipboard.onProcess}
                disabled={clipboard.busy || clipboard.stillBlocking}
                aria-describedby="clipboard-monitor-queue-detail"
              >
                {clipboard.copy.actionLabel}
              </button>
              <button
                type="button"
                onClick={clipboard.onIgnore}
                disabled={clipboard.stillBlocking}
              >
                {clipboard.copy.ignoreLabel}
              </button>
            </span>
          </section>
        </div>
      )}

      {Array.isArray(runtimeAlerts) && runtimeAlerts.length > 0 && (
        <div
          className="app-runtime-alert foreground-runtime-alert"
          role={quiet ? 'note' : 'alert'}
          aria-live={quiet ? undefined : 'assertive'}
        >
          <strong>部分后台功能没有启动</strong>
          <span>{runtimeAlerts.join(' ')}</span>
        </div>
      )}

      {shortcutCopy && (
        <div className="shortcut-readiness-region">
          <section
            className="shortcut-readiness-alert"
            role={quiet ? 'note' : 'alert'}
            aria-labelledby="shortcut-readiness-title"
            aria-describedby="shortcut-readiness-detail"
          >
            <WarningCircle size={19} weight="fill" aria-hidden="true" />
            <span>
              <strong id="shortcut-readiness-title">{shortcutCopy.title}</strong>
              <small id="shortcut-readiness-detail">{shortcutCopy.detail}</small>
            </span>
            <button type="button" onClick={onOpenShortcutSettings}>修改快捷键</button>
          </section>
        </div>
      )}

      {monitoring.enabled && (
        <div className="clipboard-monitoring-live-region">
          <div
            className={`clipboard-monitoring-live is-${monitoring.copy.kind}${monitoring.stopError ? ' is-error' : ''}`}
            role={monitoring.stopError ? 'alert' : 'status'}
            aria-live={quiet
              ? 'off'
              : monitoring.stopError ? 'assertive' : 'polite'}
          >
            {monitoring.copy.kind === 'local'
              ? <ShieldCheck size={19} weight="fill" aria-hidden="true" />
              : <CloudArrowUp size={19} weight="fill" aria-hidden="true" />}
            <span
              ref={monitoring.statusRef}
              className="clipboard-monitoring-live__body"
              tabIndex={-1}
            >
              <strong>{monitoring.copy.activeTitle}</strong>
              <small>
                {monitoring.stopError
                  || `${monitoring.copy.activeDetail} 关闭只影响今后复制；已经开始的任务仍会继续。`}
              </small>
            </span>
            <button
              type="button"
              onClick={monitoring.onStop}
              disabled={monitoring.stopStatus === 'stopping' || monitoring.saving}
              aria-busy={monitoring.stopStatus === 'stopping'}
            >
              {monitoring.stopStatus === 'stopping'
                ? '正在关闭…'
                : monitoring.stopError ? '重试关闭' : '关闭自动检测'}
            </button>
          </div>
        </div>
      )}

      {!monitoring.enabled && monitoring.offNotice && (
        <div className="clipboard-monitoring-live-region">
          <div className="clipboard-monitoring-stopped" role="status">
            <ShieldCheck size={18} weight="fill" aria-hidden="true" />
            <span ref={monitoring.statusRef} tabIndex={-1}>{monitoring.offNotice}</span>
            <button type="button" onClick={monitoring.onDismissOffNotice} aria-label="关闭自动检测已关闭提示">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
