import React, { useEffect, useRef } from 'react';
import { CircleNotch, WarningCircle } from '../phosphorIcons';
import { CLIPBOARD_RESIDUE_RISK_COPY } from '../utils/clipboardResidueRisk.mjs';
import { hasActiveAppTopLayer } from '../utils/modalOwnership.mjs';

export default function ClipboardResidueRiskNotice({
  pending = false,
  error = '',
  onAcknowledge,
}) {
  const noticeRef = useRef(null);

  useEffect(() => {
    let secondFrame = null;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (hasActiveAppTopLayer(document)) return;
        const target = noticeRef.current;
        target?.focus({ preventScroll: true });
        if (document.activeElement === target) {
          target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
    };
  }, []);

  return (
    <section
      className="clipboard-residue-risk"
      data-clipboard-residue-risk="true"
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      aria-labelledby="clipboard-residue-risk-title"
      aria-describedby={`clipboard-residue-risk-detail${error ? ' clipboard-residue-risk-error' : ''}`}
    >
      <WarningCircle size={21} weight="fill" aria-hidden="true" />
      <span className="clipboard-residue-risk__body">
        <strong ref={noticeRef} id="clipboard-residue-risk-title" tabIndex={-1}>
          {CLIPBOARD_RESIDUE_RISK_COPY.title}
        </strong>
        <small id="clipboard-residue-risk-detail">{CLIPBOARD_RESIDUE_RISK_COPY.detail}</small>
        {error && <small id="clipboard-residue-risk-error" className="clipboard-residue-risk__error">{error}</small>}
      </span>
      <button
        type="button"
        data-clipboard-residue-acknowledge
        onClick={onAcknowledge}
        disabled={pending}
        aria-busy={pending}
      >
        {pending && <CircleNotch className="clipboard-residue-risk__spinner" size={16} aria-hidden="true" />}
        {pending ? '正在确认…' : CLIPBOARD_RESIDUE_RISK_COPY.acknowledgeLabel}
      </button>
    </section>
  );
}
