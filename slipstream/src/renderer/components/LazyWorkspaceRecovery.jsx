import React, { useEffect, useLayoutEffect, useRef } from 'react';
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  BookOpen,
  CircleNotch,
  PencilSimpleLine,
  WarningCircle,
  X,
} from '../phosphorIcons';
import { isLazyWorkspaceLoadError } from '../utils/retryableLazyImport.mjs';

export class LazyWorkspaceBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, loadFailure: false };
  }

  static getDerivedStateFromError(error) {
    return {
      failed: true,
      loadFailure: isLazyWorkspaceLoadError(error),
    };
  }

  render() {
    if (this.state.failed) {
      return React.cloneElement(this.props.fallback, {
        failureKind: this.state.loadFailure ? 'load' : 'unexpected',
        retryAvailable: this.state.loadFailure
          && this.props.fallback.props.retryAvailable,
      });
    }
    return this.props.children;
  }
}

function useRecoveryFocus(targetRef) {
  useEffect(() => {
    let cancelled = false;
    let observer = null;
    let outerFrame = null;
    let innerFrame = null;
    const topLayerSelector = '[aria-modal="true"], [data-app-top-layer]';

    const focusWhenAvailable = () => {
      outerFrame = null;
      innerFrame = window.requestAnimationFrame(() => {
        innerFrame = null;
        const target = targetRef.current;
        if (
          cancelled
          || document.querySelector(topLayerSelector)
          || !target?.isConnected
          || target.disabled
          || target.closest('[inert]')
        ) return;
        // Recovery owns both focus and its reveal. At large text sizes the
        // first safe action can start below the compact viewport; reveal the
        // exact focused action with enough room for its full focus ring.
        target.focus({ preventScroll: true });
        if (document.activeElement === target) {
          target.scrollIntoView({
            behavior: 'auto',
            block: 'center',
            inline: 'nearest',
          });
        }
        if (document.activeElement === target) observer?.disconnect();
      });
    };

    const scheduleFocus = () => {
      if (cancelled || outerFrame !== null || innerFrame !== null) return;
      outerFrame = window.requestAnimationFrame(focusWhenAvailable);
    };

    observer = new MutationObserver(() => {
      if (!document.querySelector(topLayerSelector)) scheduleFocus();
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['aria-modal', 'data-app-top-layer', 'hidden', 'inert', 'style', 'class'],
      childList: true,
      subtree: true,
    });
    scheduleFocus();

    return () => {
      cancelled = true;
      observer.disconnect();
      if (outerFrame !== null) window.cancelAnimationFrame(outerFrame);
      if (innerFrame !== null) window.cancelAnimationFrame(innerFrame);
    };
  }, [targetRef]);
}

function useSavedTermsModalIsolation({
  dialogRef,
  initialFocusRef,
  onClose,
  open,
  openStateRef,
  triggerRef,
}) {
  const openRef = useRef(open);
  openRef.current = open;

  useLayoutEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    const trigger = triggerRef?.current;
    const shell = dialog?.closest('.slipstream-shell');
    const hiddenSiblings = new Map();
    const hideBackgroundSibling = (node) => {
      if (
        !(node instanceof HTMLElement)
        || node.parentElement !== shell
        || node.classList.contains('saved-terms-drawer-backdrop')
        || hiddenSiblings.has(node)
      ) return;
      hiddenSiblings.set(node, {
        ariaHidden: node.getAttribute('aria-hidden'),
        inert: node.inert,
      });
      node.inert = true;
      node.setAttribute('aria-hidden', 'true');
    };
    if (shell) [...shell.children].forEach(hideBackgroundSibling);
    const backgroundObserver = shell
      ? new MutationObserver((records) => {
        records.forEach((record) => record.addedNodes.forEach(hideBackgroundSibling));
      })
      : null;
    backgroundObserver?.observe(shell, { childList: true });

    const topLayerOwnsInteraction = () => Boolean(document.querySelector('[data-app-top-layer]'));
    const isVisibleFocusTarget = (node) => (
      !node.hasAttribute('hidden')
      && node.getClientRects().length > 0
      && window.getComputedStyle(node).visibility !== 'hidden'
    );
    const focusInsideDialog = () => {
      if (topLayerOwnsInteraction()) return;
      const target = (!initialFocusRef.current?.disabled && initialFocusRef.current)
        || dialog;
      if (!target?.isConnected || target.closest('[inert]')) return;
      target.focus({ preventScroll: true });
    };
    const handleFocusIn = (event) => {
      if (!dialog || dialog.contains(event.target) || topLayerOwnsInteraction()) return;
      focusInsideDialog();
    };
    const handleKeyDown = (event) => {
      if (topLayerOwnsInteraction()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )].filter(isVisibleFocusTarget);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    let topLayerWasPresent = topLayerOwnsInteraction();
    let topLayerFocusFrame = null;
    const topLayerObserver = document.body
      ? new MutationObserver(() => {
        const topLayerPresent = topLayerOwnsInteraction();
        if (topLayerWasPresent && !topLayerPresent) {
          if (topLayerFocusFrame !== null) {
            window.cancelAnimationFrame(topLayerFocusFrame);
          }
          topLayerFocusFrame = window.requestAnimationFrame(focusInsideDialog);
        }
        topLayerWasPresent = topLayerPresent;
      })
      : null;
    topLayerObserver?.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['data-app-top-layer'],
    });

    dialog?.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn);
    const focusFrame = window.requestAnimationFrame(focusInsideDialog);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      dialog?.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);
      backgroundObserver?.disconnect();
      topLayerObserver?.disconnect();
      if (topLayerFocusFrame !== null) {
        window.cancelAnimationFrame(topLayerFocusFrame);
      }
      hiddenSiblings.forEach((previous, node) => {
        node.inert = previous.inert;
        if (previous.ariaHidden === null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', previous.ariaHidden);
      });
      // Ownership may reopen before cleanup; use the live ref instead of a stale capture.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (openStateRef?.current ?? openRef.current) return;
      window.requestAnimationFrame(() => {
        if (
          document.querySelector('[data-app-top-layer]')
          || !trigger?.isConnected
          || trigger.disabled
          || trigger.closest('[inert]')
        ) return;
        trigger.focus({ preventScroll: true });
      });
    };
  }, [dialogRef, initialFocusRef, onClose, open, openStateRef, triggerRef]);
}

function SavedTermsWorkspaceModal({
  children,
  dataAttribute,
  description,
  eyebrow,
  initialFocusRef,
  onClose,
  open,
  openStateRef,
  title,
  titleId,
  triggerRef,
}) {
  const dialogRef = useRef(null);
  useSavedTermsModalIsolation({
    dialogRef,
    initialFocusRef,
    onClose,
    open,
    openStateRef,
    triggerRef,
  });

  if (!open) return null;
  return (
    <div
      className="saved-terms-drawer-backdrop"
      {...dataAttribute}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        id="saved-terms-drawer"
        ref={dialogRef}
        className="saved-terms-drawer saved-terms-workspace-state"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="saved-terms-drawer__header">
          <span className="saved-terms-drawer__icon" aria-hidden="true">
            <BookOpen size={22} weight="fill" />
          </span>
          <span>
            <span className="eyebrow">{eyebrow}</span>
            <h2 id={titleId}>{title}</h2>
            <p>{description}</p>
          </span>
          <button type="button" onClick={onClose} aria-label="关闭术语库">
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="saved-terms-drawer__body saved-terms-workspace-state__body">
          {children}
        </div>
      </section>
    </div>
  );
}

export function SavedTermsWorkspaceFallback({
  open,
  openStateRef,
  onClose,
  triggerRef,
}) {
  const headingRef = useRef(null);
  return (
    <SavedTermsWorkspaceModal
      open={open}
      openStateRef={openStateRef}
      onClose={onClose}
      triggerRef={triggerRef}
      initialFocusRef={headingRef}
      titleId="saved-terms-workspace-loading-title"
      title="正在准备术语库…"
      eyebrow="随时回访"
      description="已保存术语和当前任务仍保留在本机。"
      dataAttribute={{ 'data-workspace-loading': 'saved-terms' }}
    >
      <div className="saved-terms-workspace-state__notice" role="status" aria-live="polite">
        <CircleNotch size={20} className="spin" aria-hidden="true" />
        <span>
          <strong ref={headingRef} tabIndex={-1}>正在载入术语库界面</strong>
          <span>不会读取或改动术语，也不会操作剪贴板、文件或模型。</span>
        </span>
      </div>
    </SavedTermsWorkspaceModal>
  );
}

export function SavedTermsWorkspaceRecovery({
  failureKind = 'load',
  onClose,
  onRetry,
  open,
  openStateRef,
  retryAvailable = true,
  triggerRef,
}) {
  const firstActionRef = useRef(null);
  const canRetry = failureKind === 'load' && retryAvailable;
  return (
    <SavedTermsWorkspaceModal
      open={open}
      openStateRef={openStateRef}
      onClose={onClose}
      triggerRef={triggerRef}
      initialFocusRef={firstActionRef}
      titleId="saved-terms-workspace-failure-title"
      title="暂时无法打开术语库"
      eyebrow="界面恢复"
      description="术语库界面没有载入；已保存术语和当前任务仍保持不变。"
      dataAttribute={{ 'data-workspace-load-failure': 'saved-terms' }}
    >
      <div className="saved-terms-workspace-state__notice saved-terms-workspace-state__notice--error" role="alert">
        <WarningCircle size={20} aria-hidden="true" />
        <span>
          <strong>{failureKind === 'unexpected'
            ? '术语库界面发生错误'
            : canRetry ? '没有执行任何术语操作' : '界面文件仍未载入'}</strong>
          <span>{failureKind === 'unexpected'
            ? '为了保护当前任务，已停止显示术语库。请安全关闭并重新启动应用。'
            : canRetry
              ? '重试只会用新的模块地址重新读取界面，不会读写术语、剪贴板或备份文件，也不会调用模型。'
              : '请安全关闭并重新启动应用；当前窗口不会自动刷新。'}</span>
        </span>
      </div>
      <div className="saved-terms-workspace-state__actions">
        {canRetry && (
          <button
            ref={firstActionRef}
            type="button"
            className="primary-button"
            data-workspace-retry="saved-terms"
            onClick={onRetry}
          >
            <ArrowClockwise size={17} weight="bold" aria-hidden="true" />
            重试打开术语库
          </button>
        )}
        <button
          ref={canRetry ? null : firstActionRef}
          type="button"
          className="secondary-button"
          data-workspace-return="saved-terms"
          onClick={onClose}
        >
          <ArrowCounterClockwise size={17} weight="bold" aria-hidden="true" />
          返回当前任务
        </button>
      </div>
      <p className="saved-terms-workspace-state__hint">
        {canRetry
          ? '如果重新读取仍不可用，可以安全返回当前任务。'
          : '关闭不会清除当前任务或已保存术语。'}
      </p>
    </SavedTermsWorkspaceModal>
  );
}

export function SettingsWorkspaceRecovery({
  onRetry,
  onReturn,
  failureKind = 'load',
  retryAvailable = true,
  returnLabel,
}) {
  const firstActionRef = useRef(null);
  useRecoveryFocus(firstActionRef);

  return (
    <main
      className="setup-gate workspace-load-failure workspace-load-failure--settings"
      aria-labelledby="settings-workspace-failure-title"
      data-workspace-load-failure="settings"
    >
      <section className="setup-card workspace-load-failure__settings-card">
        <header className="workspace-load-failure__header setup-header">
          <span className="workspace-load-failure__icon" aria-hidden="true">
            <WarningCircle size={25} weight="fill" />
          </span>
          <span>
            <span className="setup-eyebrow">界面恢复</span>
            <h1 id="settings-workspace-failure-title">暂时无法打开设置</h1>
            <p>设置界面没有载入。当前窗口里的任务内容仍保留，也没有更改任何设置。</p>
          </span>
        </header>

        <div className="setup-error workspace-load-failure__notice" role="alert">
          <WarningCircle size={19} aria-hidden="true" />
          <span>
            <strong>{failureKind === 'unexpected'
              ? '设置界面发生错误'
              : retryAvailable ? '你的任务还在' : '界面仍不可用'}</strong>
            <span>{failureKind === 'unexpected'
              ? '为了保护当前任务，已停止显示设置。请返回任务并重新启动应用；没有更改任何设置。'
              : retryAvailable
                ? '重试会用新的模块地址重新读取设置界面，不会发送原文、调用模型或保存设置。'
                : '界面文件仍没有载入。请先返回任务并重新启动应用；当前窗口不会自动刷新。'}</span>
          </span>
        </div>

        <div className="workspace-load-failure__actions">
          {retryAvailable && (
            <button
              ref={firstActionRef}
              type="button"
              className="setup-primary"
              data-workspace-retry="settings"
              onClick={onRetry}
            >
              <ArrowClockwise size={17} weight="bold" aria-hidden="true" />
              重试打开设置
            </button>
          )}
          <button
            ref={retryAvailable ? null : firstActionRef}
            type="button"
            className="setup-secondary"
            data-workspace-return="settings"
            onClick={onReturn}
          >
            <ArrowCounterClockwise size={17} weight="bold" aria-hidden="true" />
            {returnLabel}
          </button>
        </div>

        <p className="workspace-load-failure__hint">
          {retryAvailable
            ? '如果重新读取仍不可用，可以安全返回任务。'
            : '重启前请先完成或保留当前任务；应用不会替你重复处理。'}
        </p>
      </section>
    </main>
  );
}

export function ResultWorkspaceRecovery({
  onRetry,
  onReviewSource,
  failureKind = 'load',
  retryAvailable = true,
  reviewSourceLabel = '返回修正原文',
}) {
  const firstActionRef = useRef(null);
  useRecoveryFocus(firstActionRef);

  return (
    <main
      className="capture-view workspace-load-failure workspace-load-failure--result"
      aria-labelledby="result-workspace-failure-title"
      data-workspace-load-failure="result"
    >
      <section className="processing-card workspace-load-failure__result-card">
        <header className="workspace-load-failure__header">
          <span className="workspace-load-failure__icon" aria-hidden="true">
            <WarningCircle size={25} weight="fill" />
          </span>
          <span>
            <span className="eyebrow">分析已完成</span>
            <h1 id="result-workspace-failure-title">暂时无法显示结果</h1>
            <p>结果界面没有载入，但原文和已完成的分析仍保留在当前窗口。</p>
          </span>
        </header>

        <div className="error-card workspace-load-failure__notice" role="alert">
          <WarningCircle size={19} aria-hidden="true" />
          <span>
            <strong>{failureKind === 'unexpected'
              ? '结果界面发生错误'
              : retryAvailable ? '不会重复处理' : '界面文件仍未载入'}</strong>
            <p>{failureKind === 'unexpected'
              ? '为了避免错误扩散，已停止显示本次结果。请返回原文并重新启动应用；不会再次请求分析。'
              : retryAvailable
                ? '重试会用新的模块地址重新读取结果界面，不会再次调用模型，也不会产生新的分析请求。'
                : '请返回原文并重新启动应用；当前窗口不会自动刷新，也不会再次请求分析。'}</p>
          </span>
        </div>

        <div className="workspace-load-failure__actions">
          {retryAvailable && (
            <button
              ref={firstActionRef}
              type="button"
              className="primary-button"
              data-workspace-retry="result"
              onClick={onRetry}
            >
              <ArrowClockwise size={17} weight="bold" aria-hidden="true" />
              重试载入结果
            </button>
          )}
          <button
            ref={retryAvailable ? null : firstActionRef}
            type="button"
            className="secondary-button"
            data-workspace-return="result"
            onClick={onReviewSource}
          >
            <PencilSimpleLine size={17} weight="bold" aria-hidden="true" />
            {reviewSourceLabel}
          </button>
        </div>

        <p className="workspace-load-failure__hint">
          {retryAvailable
            ? '已完成状态、行动进度和回复草稿保持不变。'
            : '返回原文不会清除当前任务，重启前仍可复制或修正原文。'}
        </p>
      </section>
    </main>
  );
}
