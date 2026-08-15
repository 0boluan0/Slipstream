import React, { useEffect, useId, useRef } from 'react';
import { CircleNotch, WarningCircle } from '../phosphorIcons';
import { hasActiveAppTopLayer } from '../utils/modalOwnership.mjs';
import { authoritativeRadioTarget } from '../utils/radioGroupNavigation.mjs';

const ENABLED_CONTROL_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const SAFE_CONTROL_SELECTOR = [
  '[data-settings-transition-safe]',
  '[data-settings-connection-safe]',
  '[data-settings-draft-safe]',
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

function joinClassNames(...classNames) {
  return classNames.filter(Boolean).join(' ');
}

function focusAndReveal(target) {
  if (!target) return;
  target.focus({ preventScroll: true });
  if (document.activeElement !== target) return;
  target.scrollIntoView({
    behavior: 'auto',
    block: 'nearest',
    inline: 'nearest',
  });
}

export default function SettingsTransitionDialog({
  id: providedId,
  className = '',
  backdropClassName = '',
  status = 'idle',
  busy = false,
  error = '',
  notice = '',
  title,
  description,
  icon,
  safeLabel = '留在设置',
  confirmLabel = '',
  busyLabel = '正在处理…',
  safeAriaLabel,
  confirmAriaLabel,
  onCancel,
  onConfirm,
  returnFocusRef,
  committedRef,
  suppressRestoreRef,
  actions,
}) {
  const generatedId = useId();
  const dialogId = providedId || `settings-transition-${generatedId}`;
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;
  const noticeId = `${dialogId}-notice`;
  const errorId = `${dialogId}-error`;
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);
  const safeButtonRef = useRef(null);
  const descriptionRef = useRef(null);
  const noticeRef = useRef(null);
  const errorRef = useRef(null);
  const previousFocusRef = useRef(null);
  const busyRef = useRef(busy);
  const submissionLockRef = useRef(false);
  const cancelRef = useRef(onCancel);
  const confirmRef = useRef(onConfirm);
  const returnFocusRefRef = useRef(returnFocusRef);
  const committedRefRef = useRef(committedRef);
  const suppressRestoreRefRef = useRef(suppressRestoreRef);
  const restoreFocusRef = useRef(true);

  busyRef.current = busy;
  cancelRef.current = onCancel;
  confirmRef.current = onConfirm;
  returnFocusRefRef.current = returnFocusRef;
  committedRefRef.current = committedRef;
  suppressRestoreRefRef.current = suppressRestoreRef;

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

    previousFocusRef.current = document.activeElement;
    siblingState.forEach(({ node }) => {
      node.inert = true;
      node.setAttribute('aria-hidden', 'true');
    });

    const getSafeTarget = () => safeButtonRef.current || dialog?.querySelector(SAFE_CONTROL_SELECTOR);

    const focusInsideDialog = (reverse = false) => {
      if (!dialog) return;
      if (busyRef.current || submissionLockRef.current) {
        dialog.focus({ preventScroll: true });
        return;
      }
      const enabledControls = [...dialog.querySelectorAll(ENABLED_CONTROL_SELECTOR)];
      const target = reverse
        ? enabledControls[enabledControls.length - 1]
        : getSafeTarget() || enabledControls[0] || dialog;
      if (target === dialog) dialog.focus({ preventScroll: true });
      else focusAndReveal(target);
    };

    const handleKeyDown = (event) => {
      if (!['Escape', 'Tab'].includes(event.key)) return;
      if (hasActiveAppTopLayer(document)) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!busyRef.current && !submissionLockRef.current) cancelRef.current?.();
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
      const statusFocusTargets = [
        descriptionRef.current,
        noticeRef.current,
        errorRef.current,
      ].filter(Boolean);
      if (statusFocusTargets.includes(activeElement)) {
        const actionContainer = dialog.querySelector('.settings-transition-dialog__actions');
        const enabledActions = actionContainer
          ? [...actionContainer.querySelectorAll(ENABLED_CONTROL_SELECTOR)]
          : [];
        const directionalAction = event.shiftKey
          ? enabledActions[enabledActions.length - 1] || last
          : enabledActions[0] || first;
        event.preventDefault();
        event.stopImmediatePropagation();
        focusAndReveal(directionalAction);
      } else if (!dialog.contains(activeElement)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        focusAndReveal(event.shiftKey ? last : getSafeTarget() || first);
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        event.stopImmediatePropagation();
        focusAndReveal(last);
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        event.stopImmediatePropagation();
        focusAndReveal(first);
      }
    };

    const handleFocusIn = (event) => {
      if (!dialog || dialog.contains(event.target) || hasActiveAppTopLayer(document)) return;
      focusInsideDialog(false);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('focusin', handleFocusIn, true);
    let initialFocusFrame = null;
    let initialFocusObserver = null;
    const focusInitialTarget = () => {
      if (hasActiveAppTopLayer(document)) {
        if (initialFocusObserver) return;
        initialFocusObserver = new MutationObserver(() => {
          if (hasActiveAppTopLayer(document)) return;
          initialFocusObserver?.disconnect();
          initialFocusObserver = null;
          initialFocusFrame = window.requestAnimationFrame(focusInitialTarget);
        });
        initialFocusObserver.observe(document.documentElement, {
          attributes: true,
          childList: true,
          subtree: true,
          attributeFilter: ['data-app-top-layer'],
        });
        return;
      }
      const target = busyRef.current ? dialog : getSafeTarget() || dialog;
      if (target === dialog) dialog?.focus({ preventScroll: true });
      else focusAndReveal(target);
    };
    initialFocusFrame = window.requestAnimationFrame(focusInitialTarget);

    return () => {
      if (initialFocusFrame !== null) window.cancelAnimationFrame(initialFocusFrame);
      initialFocusObserver?.disconnect();
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('focusin', handleFocusIn, true);
      siblingState.forEach(({ node, inert, ariaHidden }) => {
        node.inert = inert;
        if (ariaHidden === null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', ariaHidden);
      });

      const committed = committedRefRef.current?.current === true;
      const externallySuppressed = suppressRestoreRefRef.current?.current === true;
      if (committedRefRef.current) committedRefRef.current.current = false;
      if (suppressRestoreRefRef.current) suppressRestoreRefRef.current.current = false;
      if (!restoreFocusRef.current || committed || externallySuppressed) return;

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (hasActiveAppTopLayer(document)) return;
          const exactTrigger = authoritativeRadioTarget(previousFocusRef.current);
          const liveTrigger = authoritativeRadioTarget(returnFocusRefRef.current?.current);
          const fallback = panel?.querySelector?.(
            'button[aria-label="返回主面板"], button[aria-label="返回首次使用选择"]',
          );
          const target = canRestoreFocus(exactTrigger)
            ? exactTrigger
            : canRestoreFocus(liveTrigger)
              ? liveTrigger
              : canRestoreFocus(fallback) ? fallback : null;
          target?.focus({ preventScroll: true });
        });
      });
    };
  }, []);

  useEffect(() => {
    if (!busy) return undefined;
    let focusFrame = null;
    let topLayerObserver = null;
    const focusBusyRoot = () => {
      if (hasActiveAppTopLayer(document)) {
        if (topLayerObserver) return;
        topLayerObserver = new MutationObserver(() => {
          if (hasActiveAppTopLayer(document)) return;
          topLayerObserver?.disconnect();
          topLayerObserver = null;
          focusFrame = window.requestAnimationFrame(focusBusyRoot);
        });
        topLayerObserver.observe(document.documentElement, {
          attributes: true,
          childList: true,
          subtree: true,
          attributeFilter: ['data-app-top-layer'],
        });
        return;
      }
      dialogRef.current?.focus({ preventScroll: true });
    };
    focusBusyRoot();
    return () => {
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame);
      topLayerObserver?.disconnect();
    };
  }, [busy]);

  const shouldFocusNotice = Boolean(error || notice || status === 'error' || status === 'completed');
  useEffect(() => {
    if (!shouldFocusNotice || busy) return undefined;
    restoreFocusRef.current = true;
    let firstFrame = null;
    let secondFrame = null;
    let thirdFrame = null;
    let topLayerObserver = null;

    const observeUntilTopLayerLeaves = () => {
      if (topLayerObserver) return;
      topLayerObserver = new MutationObserver(() => {
        if (hasActiveAppTopLayer(document)) return;
        topLayerObserver?.disconnect();
        topLayerObserver = null;
        focusNoticeAfterSettledLayers();
      });
      topLayerObserver.observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ['data-app-top-layer'],
      });
    };

    const focusNoticeAfterSettledLayers = () => {
      if (hasActiveAppTopLayer(document)) {
        observeUntilTopLayerLeaves();
        return false;
      }
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          thirdFrame = window.requestAnimationFrame(() => {
            if (hasActiveAppTopLayer(document)) {
              observeUntilTopLayerLeaves();
              return;
            }
            const target = errorRef.current || noticeRef.current || descriptionRef.current;
            focusAndReveal(target);
          });
        });
      });
      return true;
    };

    focusNoticeAfterSettledLayers();

    return () => {
      topLayerObserver?.disconnect();
      if (firstFrame !== null) window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
      if (thirdFrame !== null) window.cancelAnimationFrame(thirdFrame);
    };
  }, [busy, error, notice, shouldFocusNotice, status]);

  const requestCancel = () => {
    if (busyRef.current || submissionLockRef.current) return;
    cancelRef.current?.();
  };

  const beginConfirmation = (overrideAction) => {
    if (busyRef.current || submissionLockRef.current) return;

    // Own the transition synchronously so a same-frame second click, Escape,
    // or programmatic focus change cannot start or dismiss another transaction.
    submissionLockRef.current = true;
    busyRef.current = true;
    restoreFocusRef.current = false;
    if (!hasActiveAppTopLayer(document)) {
      dialogRef.current?.focus({ preventScroll: true });
    }

    const action = typeof overrideAction === 'function' ? overrideAction : confirmRef.current;
    let actionResult;
    try {
      actionResult = action?.();
    } catch {
      submissionLockRef.current = false;
      busyRef.current = false;
      restoreFocusRef.current = true;
      return;
    }

    Promise.resolve(actionResult)
      .then((succeeded) => {
        if (succeeded === true) return;
        submissionLockRef.current = false;
        busyRef.current = false;
        restoreFocusRef.current = true;
      })
      .catch(() => {
        submissionLockRef.current = false;
        busyRef.current = false;
        restoreFocusRef.current = true;
      });
  };

  const safeActionProps = {
    ref: safeButtonRef,
    type: 'button',
    className: 'settings-draft-exit-safe',
    'data-settings-transition-safe': true,
    'data-settings-draft-safe': true,
    onClick: requestCancel,
    disabled: busy,
  };
  const confirmActionProps = {
    type: 'button',
    className: 'settings-draft-exit-discard',
    onClick: () => beginConfirmation(),
    disabled: busy,
  };
  const actionSlot = typeof actions === 'function'
    ? actions({
      safeActionProps,
      confirmActionProps,
      beginConfirmation,
      busy,
      status,
    })
    : actions;
  const describedBy = [
    description ? descriptionId : '',
    notice ? noticeId : '',
    error ? errorId : '',
  ]
    .filter(Boolean)
    .join(' ') || undefined;
  const defaultIcon = busy
    ? <CircleNotch className="settings-connection-exit-spinner" size={21} weight="bold" />
    : <WarningCircle size={21} weight="fill" />;

  return (
    <div
      ref={backdropRef}
      className={joinClassNames('settings-draft-exit-backdrop', backdropClassName)}
    >
      <section
        ref={dialogRef}
        id={dialogId}
        className={joinClassNames('settings-draft-exit-dialog', className)}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        aria-busy={busy}
        data-status={status}
        tabIndex={-1}
      >
        <span className="settings-draft-exit-dialog__icon" aria-hidden="true">
          {icon || defaultIcon}
        </span>
        <div className="settings-transition-dialog__body">
          <strong id={titleId}>{title}</strong>
          {description && (
            <p
              ref={status === 'error' || status === 'completed' ? descriptionRef : undefined}
              id={descriptionId}
              role={!error && status === 'error' ? 'alert' : status === 'completed' ? 'status' : undefined}
              tabIndex={status === 'error' || status === 'completed' ? -1 : undefined}
            >
              {description}
            </p>
          )}
          {notice && (
            <div
              ref={noticeRef}
              id={noticeId}
              className={joinClassNames('settings-transition-dialog__notice', `is-${status}`)}
              role={status === 'error' ? 'alert' : 'status'}
              tabIndex={-1}
            >
              {notice}
            </div>
          )}
          {error && (
            <div
              ref={errorRef}
              id={errorId}
              className="settings-transition-dialog__notice is-error"
              role="alert"
              tabIndex={-1}
            >
              <WarningCircle size={17} weight="fill" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
        </div>
        <footer className="settings-transition-dialog__actions">
          {actionSlot || (
            <>
              {safeLabel && (
                <button {...safeActionProps} aria-label={safeAriaLabel}>
                  {safeLabel}
                </button>
              )}
              {confirmLabel && (
                <button {...confirmActionProps} aria-label={confirmAriaLabel || (busy ? busyLabel : confirmLabel)}>
                  {busy && (
                    <CircleNotch
                      className="settings-connection-exit-spinner"
                      size={16}
                      aria-hidden="true"
                    />
                  )}
                  {busy ? busyLabel : confirmLabel}
                </button>
              )}
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
