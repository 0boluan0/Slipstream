import React, { useEffect, useRef } from 'react';
import { CloudArrowUp, HardDrives, ShieldCheck } from '../phosphorIcons';

export default function ClipboardMonitoringConsentDialog({
  copy,
  saving = false,
  error = '',
  onCancel,
  onConfirm,
  returnFocusRef,
}) {
  const dialogRef = useRef(null);
  const safeButtonRef = useRef(null);
  const savingRef = useRef(saving);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    savingRef.current = saving;
    onCancelRef.current = onCancel;
  }, [onCancel, saving]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const panel = dialog?.closest('.settings-panel');
    const backdrop = dialog?.closest('.clipboard-monitor-consent-backdrop');
    const returnFocusTarget = returnFocusRef?.current;
    const hiddenSiblings = panel ? [...panel.children].filter((node) => node !== backdrop) : [];
    const previousAria = hiddenSiblings.map((node) => node.getAttribute('aria-hidden'));
    hiddenSiblings.forEach((node) => {
      node.inert = true;
      node.setAttribute('aria-hidden', 'true');
    });

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!savingRef.current) onCancelRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog?.addEventListener('keydown', handleKeyDown);
    window.requestAnimationFrame(() => safeButtonRef.current?.focus({ preventScroll: true }));
    return () => {
      dialog?.removeEventListener('keydown', handleKeyDown);
      hiddenSiblings.forEach((node, index) => {
        node.inert = false;
        if (previousAria[index] === null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', previousAria[index]);
      });
      window.requestAnimationFrame(() => returnFocusTarget?.focus({ preventScroll: true }));
    };
  }, [returnFocusRef]);

  const Icon = copy.kind === 'local' || copy.kind === 'local-custom'
    ? HardDrives
    : CloudArrowUp;
  return (
    <div className="settings-draft-exit-backdrop clipboard-monitor-consent-backdrop">
      <section
        ref={dialogRef}
        className="settings-draft-exit-dialog clipboard-monitor-consent-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="clipboard-monitor-consent-title"
        aria-describedby="clipboard-monitor-consent-description clipboard-monitor-consent-privacy"
        aria-busy={saving}
        tabIndex={-1}
      >
        <span className="settings-draft-exit-dialog__icon" aria-hidden="true">
          <Icon size={21} weight="fill" />
        </span>
        <div>
          <strong id="clipboard-monitor-consent-title">
            {saving ? '正在开启自动检测…' : copy.title}
          </strong>
          <p id="clipboard-monitor-consent-description">{copy.detail}</p>
          <ul aria-label="开启后的后果">
            {copy.consequences.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <small id="clipboard-monitor-consent-privacy">
            <ShieldCheck size={15} weight="fill" aria-hidden="true" />
            自动检测不会创建 Slipstream 历史；你可以随时在这里关闭。
          </small>
          {error && <p className="clipboard-monitor-consent-error" role="alert">{error}</p>}
        </div>
        <footer>
          <button
            ref={safeButtonRef}
            type="button"
            className="settings-draft-exit-safe"
            onClick={onCancel}
            disabled={saving}
          >
            保持关闭
          </button>
          <button
            type="button"
            className="clipboard-monitor-consent-confirm"
            onClick={onConfirm}
            disabled={saving}
          >
            {saving ? '正在开启…' : error ? `重试：${copy.confirmLabel}` : copy.confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
