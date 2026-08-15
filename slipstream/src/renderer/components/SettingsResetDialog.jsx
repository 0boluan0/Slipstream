import React, { useEffect, useRef } from 'react';
import { CircleNotch, ShieldCheck, WarningCircle } from '../phosphorIcons';
import { hasActiveAppTopLayer } from '../utils/modalOwnership.mjs';

const ENABLED_BUTTON_SELECTOR = 'button:not([disabled])';

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

export default function SettingsResetDialog({
  busy = false,
  error = '',
  sessionAlreadyCleared = false,
  description,
  clipboardDescription,
  cancelLabel,
  cancelAriaLabel,
  preserveLabel,
  retryLabel,
  onCancel,
  onReset,
  returnFocusRef,
}) {
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);
  const safeButtonRef = useRef(null);
  const errorRef = useRef(null);
  const previousFocusRef = useRef(null);
  const busyRef = useRef(busy);
  const cancelRef = useRef(onCancel);
  const resetRef = useRef(onReset);
  const returnFocusRefRef = useRef(returnFocusRef);
  const restoreFocusRef = useRef(true);

  busyRef.current = busy;
  cancelRef.current = onCancel;
  resetRef.current = onReset;
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
      const enabledButtons = [...dialog.querySelectorAll(ENABLED_BUTTON_SELECTOR)];
      if (enabledButtons.length === 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = enabledButtons[0];
      const last = enabledButtons[enabledButtons.length - 1];
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

    window.addEventListener('keydown', handleKeyDown, true);
    const initialFocusFrame = window.requestAnimationFrame(() => {
      if (hasActiveAppTopLayer(document)) return;
      const target = busyRef.current ? dialog : safeButtonRef.current;
      target?.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(initialFocusFrame);
      window.removeEventListener('keydown', handleKeyDown, true);
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
          const fallback = panel?.querySelector?.('button[aria-label="返回主面板"]');
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

  const beginReset = (clipboardMode) => {
    if (busyRef.current) return;

    // Lock keyboard ownership before React can commit the busy render.
    busyRef.current = true;
    restoreFocusRef.current = false;
    if (!hasActiveAppTopLayer(document)) {
      dialogRef.current?.focus({ preventScroll: true });
    }

    Promise.resolve(resetRef.current?.(clipboardMode))
      .then((succeeded) => {
        if (succeeded !== true) restoreFocusRef.current = true;
      })
      .catch(() => {
        restoreFocusRef.current = true;
      });
  };

  const dangerLabel = busy
    ? sessionAlreadyCleared
      ? '正在重试剩余清除…'
      : '正在保留剪贴板内容并清除…'
    : error ? retryLabel : preserveLabel;
  const dangerAriaLabel = busy
    ? sessionAlreadyCleared
      ? '正在保留系统剪贴板内容并重试剩余应用内数据清除'
      : '正在保留系统剪贴板内容并清除全部应用内数据'
    : error ? retryLabel : '保留系统剪贴板内容后清除全部应用内数据';

  return (
    <div ref={backdropRef} className="settings-reset-backdrop">
      <section
        ref={dialogRef}
        id="settings-reset-dialog"
        className="settings-reset-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="settings-reset-title"
        aria-describedby="settings-reset-description settings-reset-clipboard-description"
        aria-errormessage={error ? 'settings-reset-error' : undefined}
        aria-busy={busy}
        tabIndex={-1}
      >
        <span className="settings-reset-dialog__icon" aria-hidden="true">
          {busy
            ? <CircleNotch className="settings-reset-spinner" size={24} weight="bold" />
            : <WarningCircle size={24} weight="fill" />}
        </span>
        <div className="settings-reset-dialog__body">
          <span className="settings-reset-dialog__eyebrow">不可撤销操作</span>
          <strong id="settings-reset-title">
            {busy
              ? sessionAlreadyCleared
                ? '正在保留剪贴板内容并重试剩余清除'
                : '正在保留剪贴板内容并清除应用内数据'
              : '确认保留剪贴板内容后清除全部应用内数据？'}
          </strong>
          <p id="settings-reset-description">{description}</p>
          <p id="settings-reset-clipboard-description" className="settings-reset-dialog__privacy">
            <ShieldCheck size={17} weight="fill" aria-hidden="true" />
            <span>{clipboardDescription}</span>
          </p>
          {error && (
            <div
              ref={errorRef}
              id="settings-reset-error"
              className="settings-reset-error"
              role="alert"
              tabIndex={-1}
            >
              <WarningCircle size={17} weight="fill" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
          {sessionAlreadyCleared && (
            <p className="settings-reset-dialog__partial" role="note">
              本次会话内容已经清除；接下来只会重试尚未确认的凭据、术语与设置清除。
            </p>
          )}
        </div>
        <footer className="settings-reset-actions">
          <button
            ref={safeButtonRef}
            type="button"
            className="settings-reset-cancel"
            data-settings-reset-safe
            onClick={onCancel}
            disabled={busy}
            aria-label={cancelAriaLabel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="settings-reset-danger"
            onClick={() => beginReset('preserve')}
            disabled={busy}
            aria-label={dangerAriaLabel}
          >
            {busy
              && <CircleNotch className="settings-reset-spinner" size={16} aria-hidden="true" />}
            {dangerLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
