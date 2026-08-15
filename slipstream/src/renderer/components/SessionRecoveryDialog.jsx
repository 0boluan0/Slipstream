import React, { useEffect, useRef } from 'react';
import { ArrowCounterClockwise, ShieldCheck, Trash } from '../phosphorIcons';
import { describeSessionRecovery } from '../utils/sessionRecovery.mjs';
import { CLIPBOARD_RESIDUE_RISK_COPY } from '../utils/clipboardResidueRisk.mjs';

export default function SessionRecoveryDialog({
  record,
  clipboardResidueRisk = null,
  onRestore,
  onDiscard,
}) {
  const dialogRef = useRef(null);
  const restoreRef = useRef(null);
  const copy = describeSessionRecovery(record);
  const hasSafetyDetails = Boolean(
    copy?.taskDetail || copy?.approvalDetail || clipboardResidueRisk,
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    const shell = dialog?.closest('.slipstream-shell');
    const backdrop = dialog?.closest('.session-recovery-backdrop');
    const hiddenSiblings = shell ? [...shell.children].filter((node) => node !== backdrop) : [];
    const previousAria = hiddenSiblings.map((node) => node.getAttribute('aria-hidden'));
    hiddenSiblings.forEach((node) => {
      node.inert = true;
      node.setAttribute('aria-hidden', 'true');
    });

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        restoreRef.current?.focus({ preventScroll: true });
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
    window.requestAnimationFrame(() => restoreRef.current?.focus({ preventScroll: true }));
    return () => {
      dialog?.removeEventListener('keydown', handleKeyDown);
      hiddenSiblings.forEach((node, index) => {
        node.inert = false;
        if (previousAria[index] === null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', previousAria[index]);
      });
    };
  }, []);

  if (!copy) return null;

  return (
    <div className="session-recovery-backdrop">
      <section
        ref={dialogRef}
        className="session-recovery-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-recovery-title"
        aria-describedby={`session-recovery-description${hasSafetyDetails ? ' session-recovery-safety' : ''} session-recovery-privacy`}
        tabIndex={-1}
      >
        <span className="session-recovery-dialog__icon" aria-hidden="true">
          <ArrowCounterClockwise size={24} weight="bold" />
        </span>
        <div className="session-recovery-dialog__body">
          <span className="session-recovery-dialog__eyebrow">上次会话意外中断</span>
          <strong id="session-recovery-title">{copy.title}</strong>
          <p id="session-recovery-description">{copy.detail}</p>
          {hasSafetyDetails && (
            <ul id="session-recovery-safety" aria-label="恢复后的安全边界">
              {copy.taskDetail && <li>{copy.taskDetail}</li>}
              {copy.approvalDetail && <li>{copy.approvalDetail}</li>}
              {clipboardResidueRisk && (
                <li className="session-recovery-dialog__clipboard-risk">
                  <strong>{CLIPBOARD_RESIDUE_RISK_COPY.title}</strong>
                  <span>{CLIPBOARD_RESIDUE_RISK_COPY.detail}</span>
                </li>
              )}
            </ul>
          )}
          <small id="session-recovery-privacy">
            <ShieldCheck size={15} weight="fill" aria-hidden="true" />
            {copy.privacyDetail}
          </small>
        </div>
        <footer>
          <button
            ref={restoreRef}
            type="button"
            className="session-recovery-dialog__restore"
            onClick={onRestore}
          >
            <ArrowCounterClockwise size={16} weight="bold" aria-hidden="true" />
            {copy.restoreLabel}
          </button>
          <button
            type="button"
            className="session-recovery-dialog__discard"
            onClick={onDiscard}
          >
            <Trash size={16} aria-hidden="true" />
            丢弃临时内容
          </button>
        </footer>
      </section>
    </div>
  );
}
