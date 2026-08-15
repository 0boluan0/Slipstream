import React, { useEffect, useId, useRef } from 'react';
import { CircleNotch, ShieldCheck, WarningCircle } from '../phosphorIcons';
import { hasActiveAppTopLayer } from '../utils/modalOwnership.mjs';

const ENABLED_CONTROL_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function canRestoreFocus(target) {
  return Boolean(
    target
    && target !== document.body
    && target !== document.documentElement
    && target.isConnected
    && !target.matches?.(':disabled, [aria-disabled="true"]')
    && !target.closest?.('[inert]'),
  );
}

export default function CredentialRemovalDialog({
  id: providedId,
  busy = false,
  error = '',
  title,
  busyTitle = '正在删除凭据',
  description,
  reassurance,
  cancelLabel = '保留凭据',
  confirmLabel = '删除凭据',
  busyLabel = '正在删除…',
  onCancel,
  onConfirm,
  returnFocusRef,
}) {
  const generatedId = useId();
  const dialogId = providedId || `credential-removal-${generatedId}`;
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;
  const reassuranceId = `${dialogId}-reassurance`;
  const errorId = `${dialogId}-error`;
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);
  const safeButtonRef = useRef(null);
  const errorRef = useRef(null);
  const previousFocusRef = useRef(null);
  const busyRef = useRef(busy);
  const cancelRef = useRef(onCancel);
  const confirmRef = useRef(onConfirm);
  const returnFocusRefRef = useRef(returnFocusRef);
  const restoreFocusRef = useRef(true);

  busyRef.current = busy;
  cancelRef.current = onCancel;
  confirmRef.current = onConfirm;
  returnFocusRefRef.current = returnFocusRef;

  useEffect(() => {
    const backdrop = backdropRef.current;
    const dialog = dialogRef.current;
    const panel = backdrop?.parentElement;
    const siblingState = panel
      ? [...panel.children]
        .filter((node) => node !== backdrop)
        .map((node) => ({
          node,
          inert: node.inert,
          ariaHidden: node.getAttribute('aria-hidden'),
        }))
      : [];

    previousFocusRef.current = returnFocusRefRef.current?.current || document.activeElement;
    siblingState.forEach(({ node }) => {
      node.inert = true;
      node.setAttribute('aria-hidden', 'true');
    });

    const focusInsideDialog = (reverse = false) => {
      if (!dialog) return;
      const enabledControls = [...dialog.querySelectorAll(ENABLED_CONTROL_SELECTOR)];
      const target = enabledControls.length
        ? reverse ? enabledControls[enabledControls.length - 1] : enabledControls[0]
        : dialog;
      target?.focus({ preventScroll: true });
    };

    const handleKeyDown = (event) => {
      if (!['Escape', 'Tab'].includes(event.key)) return;
      if (hasActiveAppTopLayer(document)) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!busyRef.current) cancelRef.current?.();
        return;
      }

      if (!dialog) return;
      const enabledControls = [...dialog.querySelectorAll(ENABLED_CONTROL_SELECTOR)];
      if (enabledControls.length === 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = enabledControls[0];
      const last = enabledControls[enabledControls.length - 1];
      const activeElement = document.activeElement;
      if (!dialog.contains(activeElement)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        event.stopImmediatePropagation();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        event.stopImmediatePropagation();
        first.focus({ preventScroll: true });
      }
    };

    const handleFocusIn = (event) => {
      if (!dialog || dialog.contains(event.target) || hasActiveAppTopLayer(document)) return;
      focusInsideDialog(false);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('focusin', handleFocusIn, true);
    const initialFocusFrame = window.requestAnimationFrame(() => {
      if (hasActiveAppTopLayer(document)) return;
      const target = busyRef.current ? dialog : safeButtonRef.current;
      target?.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(initialFocusFrame);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('focusin', handleFocusIn, true);
      siblingState.forEach(({ node, inert, ariaHidden }) => {
        node.inert = inert;
        if (ariaHidden === null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', ariaHidden);
      });

      if (!restoreFocusRef.current) return;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (hasActiveAppTopLayer(document)) return;
          const previousFocus = previousFocusRef.current;
          const trigger = returnFocusRefRef.current?.current;
          const fallback = panel?.querySelector?.('button[aria-label="返回主面板"], button[aria-label="返回首次使用选择"]');
          const target = canRestoreFocus(previousFocus)
            ? previousFocus
            : canRestoreFocus(trigger)
              ? trigger
              : canRestoreFocus(fallback) ? fallback : null;
          target?.focus({ preventScroll: true });
        });
      });
    };
  }, []);

  useEffect(() => {
    if (!busy || hasActiveAppTopLayer(document)) return;
    dialogRef.current?.focus({ preventScroll: true });
  }, [busy]);

  useEffect(() => {
    if (!error) return undefined;
    restoreFocusRef.current = true;
    let firstFrame = null;
    let secondFrame = null;
    let thirdFrame = null;
    let topLayerObserver = null;

    const focusErrorAfterSettledLayers = () => {
      if (hasActiveAppTopLayer(document)) return false;
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          thirdFrame = window.requestAnimationFrame(() => {
            if (hasActiveAppTopLayer(document)) return;
            errorRef.current?.focus({ preventScroll: true });
          });
        });
      });
      return true;
    };

    if (!focusErrorAfterSettledLayers()) {
      topLayerObserver = new MutationObserver(() => {
        if (!focusErrorAfterSettledLayers()) return;
        topLayerObserver?.disconnect();
        topLayerObserver = null;
      });
      topLayerObserver.observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ['data-app-top-layer'],
      });
    }

    return () => {
      topLayerObserver?.disconnect();
      if (firstFrame !== null) window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
      if (thirdFrame !== null) window.cancelAnimationFrame(thirdFrame);
    };
  }, [error]);

  const beginConfirmation = () => {
    if (busyRef.current) return;

    // Own the destructive action synchronously so a same-frame second click,
    // Escape, or focus change cannot start or dismiss another transaction.
    busyRef.current = true;
    restoreFocusRef.current = false;
    if (!hasActiveAppTopLayer(document)) {
      dialogRef.current?.focus({ preventScroll: true });
    }

    Promise.resolve(confirmRef.current?.())
      .then((succeeded) => {
        if (succeeded === true) return;
        busyRef.current = false;
        restoreFocusRef.current = true;
      })
      .catch(() => {
        busyRef.current = false;
        restoreFocusRef.current = true;
      });
  };

  return (
    <div ref={backdropRef} className="credential-removal-backdrop">
      <section
        ref={dialogRef}
        id={dialogId}
        className="credential-removal-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId} ${reassuranceId}`}
        aria-errormessage={error ? errorId : undefined}
        aria-busy={busy}
        tabIndex={-1}
      >
        <span className="credential-removal-dialog__icon" aria-hidden="true">
          {busy
            ? <CircleNotch className="credential-removal-spinner" size={24} weight="bold" />
            : <WarningCircle size={24} weight="fill" />}
        </span>
        <div className="credential-removal-dialog__body">
          <span className="credential-removal-dialog__eyebrow">不可撤销操作</span>
          <strong id={titleId}>{busy ? busyTitle : title}</strong>
          <p id={descriptionId}>{description}</p>
          <p id={reassuranceId} className="credential-removal-dialog__reassurance">
            <ShieldCheck size={17} weight="fill" aria-hidden="true" />
            <span>{reassurance}</span>
          </p>
          {error && (
            <div
              ref={errorRef}
              id={errorId}
              className="credential-removal-error"
              role="alert"
              tabIndex={-1}
            >
              <WarningCircle size={17} weight="fill" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
        </div>
        <footer className="credential-removal-actions">
          <button
            ref={safeButtonRef}
            type="button"
            className="credential-removal-cancel"
            data-credential-removal-safe
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="credential-removal-confirm"
            onClick={beginConfirmation}
            disabled={busy}
            aria-label={busy ? busyLabel : confirmLabel}
          >
            {busy && <CircleNotch className="credential-removal-spinner" size={16} aria-hidden="true" />}
            {busy ? busyLabel : confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
