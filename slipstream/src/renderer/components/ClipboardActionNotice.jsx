import React from 'react';
import {
  Clock,
  ShieldCheck,
  WarningCircle,
  X,
} from '../phosphorIcons';

export default function ClipboardActionNotice({
  notice,
  onAcknowledge,
  onDismiss,
  inline = false,
}) {
  if (!notice || notice.status === 'idle' || notice.dismissed === true) return null;
  const acknowledgementAvailable = typeof onAcknowledge === 'function';
  const actionable = ['copied', 'outdated', 'retained', 'copy-error'].includes(notice.status)
    && typeof notice.consequenceId === 'string'
    && acknowledgementAvailable;
  const writing = notice.status === 'copying';
  const acknowledging = notice.acknowledgementPending === true;
  const pending = acknowledging || writing;
  const assertive = ['copy-error', 'open-error'].includes(notice.status)
    || Boolean(notice.acknowledgementError);
  const isWarning = [
    'copy-error',
    'open-error',
    'outdated',
    'retained',
  ].includes(notice.status);
  const Icon = writing ? Clock : isWarning ? WarningCircle : ShieldCheck;
  return (
    <div
      className={`clipboard-privacy-notice clipboard-privacy-notice--${notice.status}${inline ? ' is-inline' : ''}`}
      data-clipboard-kind={notice.kind || 'unknown'}
      data-clipboard-status={notice.status}
      role={assertive ? 'alert' : 'status'}
      aria-live={assertive ? 'assertive' : 'polite'}
      aria-busy={pending}
    >
      <Icon size={19} weight="fill" aria-hidden="true" />
      <span>
        <strong>{notice.message}</strong>
        <small>{notice.detail}</small>
        {actionable && (
          <small>
            请先在其他位置复制一段不敏感的文字覆盖，再确认；此按钮不会读取或更改剪贴板。
          </small>
        )}
        {notice.acknowledgementError && <small role="alert">{notice.acknowledgementError}</small>}
      </span>
      <span className="clipboard-privacy-notice__actions">
        {acknowledgementAvailable && actionable && (
          <button
            type="button"
            data-clipboard-consequence-ack
            onClick={onAcknowledge}
            disabled={pending}
            aria-busy={acknowledging}
          >
            {acknowledging ? '正在确认…' : '我已手动覆盖'}
          </button>
        )}
        <button
          type="button"
          className="clipboard-privacy-notice__dismiss"
          onClick={onDismiss}
          aria-label="暂时收起操作提示"
        >
          <X size={15} />
        </button>
      </span>
    </div>
  );
}
