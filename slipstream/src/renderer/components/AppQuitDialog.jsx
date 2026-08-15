import React, { useEffect, useRef } from 'react';
import { CircleNotch, WarningCircle } from '../phosphorIcons';
import { describeQuitRisk } from '../utils/quitSafety.mjs';

export default function AppQuitDialog({
  risk,
  pending = false,
  error = '',
  onCancel,
  onConfirm,
}) {
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  const pendingRef = useRef(pending);
  const cancelRef = useRef(onCancel);
  const copy = describeQuitRisk(risk);

  pendingRef.current = pending;
  cancelRef.current = onCancel;

  useEffect(() => {
    const dialog = dialogRef.current;
    const root = dialog?.closest('.app-root');
    const backdrop = dialog?.closest('.app-quit-backdrop');
    const hiddenSiblings = root ? [...root.children].filter((node) => node !== backdrop) : [];
    const previousAria = hiddenSiblings.map((node) => node.getAttribute('aria-hidden'));
    const previousInert = hiddenSiblings.map((node) => node.inert);
    previousFocusRef.current = document.activeElement;
    hiddenSiblings.forEach((node) => {
      node.inert = true;
      node.setAttribute('aria-hidden', 'true');
    });

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!pendingRef.current) cancelRef.current();
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
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.requestAnimationFrame(() => dialog?.querySelector('[data-quit-safe]')?.focus());
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      hiddenSiblings.forEach((node, index) => {
        node.inert = previousInert[index];
        if (previousAria[index] === null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', previousAria[index]);
      });
      const previousFocus = previousFocusRef.current;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const fallback = document.querySelector('[data-quit-return-focus], textarea, button:not([disabled])');
          const target = previousFocus && document.contains(previousFocus) ? previousFocus : fallback;
          target?.focus({ preventScroll: true });
        });
      });
    };
  }, []);

  useEffect(() => {
    if (!pending) return undefined;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pending]);

  const handleConfirm = () => {
    if (pending || copy.busy) return;
    onConfirm();
  };

  return (
    <div className="app-quit-backdrop" data-app-top-layer="quit">
      <section
        ref={dialogRef}
        className="app-quit-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="app-quit-title"
        aria-describedby="app-quit-description app-quit-consequences app-quit-privacy"
        aria-busy={pending || copy.busy}
        tabIndex={-1}
      >
        <span className="app-quit-dialog__icon" aria-hidden="true">
          {pending ? <CircleNotch className="app-quit-dialog__spinner" size={23} weight="bold" /> : <WarningCircle size={23} weight="fill" />}
        </span>
        <div className="app-quit-dialog__body">
          <strong id="app-quit-title">
            {pending ? '正在确认退出' : copy.title}
          </strong>
          <p id="app-quit-description">
            {pending
              ? 'Slipstream 正在把你的选择交给应用；完成前会保持当前会话。'
              : '请先确认这次退出会停止、丢失或放弃哪些当前内容与恢复入口。'}
          </p>
          <ul id="app-quit-consequences" aria-label="退出后会发生的变化">
            {copy.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <small id="app-quit-privacy">退出确认不会复制、记录或发送原文、结果、API Key 或服务地址。</small>
          {copy.busy && (
            <p className="app-quit-dialog__busy" role="status">
              {copy.busyMessage}
            </p>
          )}
          {error && <p className="app-quit-dialog__error" role="alert">{error}</p>}
        </div>
        <footer>
          <button
            type="button"
            className="app-quit-dialog__safe"
            data-quit-safe
            onClick={onCancel}
            disabled={pending}
          >
            {copy.safeLabel}
          </button>
          <button
            type="button"
            className="app-quit-dialog__confirm"
            onClick={handleConfirm}
            disabled={pending || copy.busy}
          >
            {pending ? '正在确认…' : copy.confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
