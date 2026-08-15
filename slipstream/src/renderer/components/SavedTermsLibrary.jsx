import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowCounterClockwise,
  ArrowClockwise,
  BookOpen,
  CheckCircle,
  CircleNotch,
  Copy,
  DownloadSimple,
  MagnifyingGlass,
  ShieldCheck,
  UploadSimple,
  WarningCircle,
  X,
} from '../phosphorIcons';
import {
  filterSavedTerms,
  getSavedTermCopyText,
  getSavedTermMetadata,
  savedTermKey,
} from '../utils/savedTerms.mjs';
import {
  createSavedTermRemovalState,
  SAVED_TERM_REMOVAL_PHASES,
  transitionSavedTermRemoval,
} from '../utils/savedTermRemoval.mjs';
import { inferTextLanguageTag } from '../utils/languageBoundary.mjs';
import ClipboardActionNotice from './ClipboardActionNotice';
import savedTermsLibraryStylesheetUrl from './SavedTermsLibrary.css?url&no-inline';
import {
  getSavedTermsStylesheetAttempt,
  loadSavedTermsWorkspaceStylesheet,
} from './savedTermsWorkspaceStylesheet.mjs';

const savedTermsLibraryModuleUrl = new URL(import.meta.url);
const savedTermsLibraryStylesheetHref = new URL(
  savedTermsLibraryStylesheetUrl,
  document.baseURI,
);
if (
  import.meta.env.DEV
  && savedTermsLibraryModuleUrl.searchParams.get('workspace-load')
    === 'saved-terms-style-fixture-primary'
) {
  savedTermsLibraryStylesheetHref.searchParams.set(
    'workspace-load',
    'saved-terms-style-fixture-primary',
  );
}
export const savedTermsWorkspaceStylesheetReady = loadSavedTermsWorkspaceStylesheet({
  attempt: getSavedTermsStylesheetAttempt(import.meta.url),
  href: savedTermsLibraryStylesheetHref.href,
});

const COPY_LABELS = Object.freeze({
  term: '术语',
  explanation: '解释',
  combined: '术语与解释',
});

const COPY_KINDS = Object.freeze({
  term: 'saved-term',
  explanation: 'saved-term-explanation',
  combined: 'saved-term-combined',
});

const RECONCILIATION_REQUIRED_LOAD_ERRORS = new Set([
  'saved-terms-mutation-unconfirmed',
  'saved-terms-invalid-mutation-response',
  'saved-terms-invalid-import-response',
]);

const IMPORT_MUTATION_UNCONFIRMED_MESSAGE = '无法确认导入是否完成；这次导入可能已经完成，也可能没有完成。请重新读取术语库后核对。';

function isClipboardWritePendingError(error) {
  return error?.code === 'clipboard-write-pending'
    || error?.message === 'clipboard-write-pending';
}

function importFailureMessage(code) {
  if (code === 'file-too-large') return '这个备份超过 1 MB，没有读取；术语库没有变化。';
  if (code === 'no-usable-terms') return '这个备份里没有可导入的术语；术语库没有变化。';
  if (code === 'read-failed') return '暂时无法读取这个文件；术语库没有变化，可以重新选择。';
  if (code === 'preview-expired') return '这次导入预览已经失效；术语库没有变化，请重新选择文件。';
  if (code === 'commit-failed') return IMPORT_MUTATION_UNCONFIRMED_MESSAGE;
  return '这个文件不是可用的 Slipstream 术语备份；术语库没有变化。';
}

export default function SavedTermsLibrary({
  open,
  openStateRef,
  onClose,
  triggerRef,
  savedTerms,
  loadStatus = 'idle',
  loadError = '',
  loadErrorCode = '',
  onRetryLoad,
  onDeleteTerm,
  onRestoreTerm,
  onExportTerms,
  onPreviewImport,
  onCommitImport,
  onWriteClipboard,
  clipboardWritePending = false,
  clipboardNotice,
  onAcknowledgeClipboardConsequence,
  onDismissClipboardNotice,
}) {
  const [query, setQuery] = useState('');
  const [copyState, setCopyState] = useState({ id: null, kind: null, status: 'idle', message: '' });
  const [removal, setRemoval] = useState(createSavedTermRemovalState);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [transfer, setTransfer] = useState({ mode: 'idle', status: 'idle', message: '', preview: null });
  const dialogRef = useRef(null);
  const searchInputRef = useRef(null);
  const closeButtonRef = useRef(null);
  const loadRetryButtonRef = useRef(null);
  const loadRetryInFlightRef = useRef(false);
  const emptyImportButtonRef = useRef(null);
  const undoButtonRef = useRef(null);
  const copyTimerRef = useRef(null);
  const removalRef = useRef(removal);
  const queryRef = useRef('');
  const transferModeRef = useRef('idle');
  const transferPendingRef = useRef(false);
  const transferPrimaryRef = useRef(null);
  const importTrustReviewRef = useRef(null);
  const transferPreviewIdRef = useRef(null);
  const exportActionButtonRef = useRef(null);
  const importActionButtonRef = useRef(null);
  const lastTransferActionRef = useRef(null);
  const lastTransferActionKindRef = useRef(null);
  const previousTransferModeRef = useRef('idle');
  const previousTransferPendingRef = useRef(false);
  const normalizedLoadStatus = ['idle', 'loading', 'error', 'ready'].includes(loadStatus)
    ? loadStatus
    : 'idle';
  const termsReady = normalizedLoadStatus === 'ready';
  const termsLoading = normalizedLoadStatus === 'loading';
  const termsLoadError = normalizedLoadStatus === 'error';
  const reconciliationRequired = termsLoadError
    && RECONCILIATION_REQUIRED_LOAD_ERRORS.has(loadErrorCode);
  const previousLoadStatusRef = useRef(normalizedLoadStatus);
  const reconciliationPendingRef = useRef(reconciliationRequired);
  if (reconciliationRequired) reconciliationPendingRef.current = true;
  const terms = useMemo(
    () => (termsReady && Array.isArray(savedTerms) ? savedTerms : []),
    [savedTerms, termsReady],
  );
  const filteredTerms = useMemo(() => filterSavedTerms(terms, query), [query, terms]);
  const hasQuery = Boolean(query.trim());
  queryRef.current = termsReady ? query : '';
  transferModeRef.current = termsReady ? transfer.mode : 'idle';
  transferPreviewIdRef.current = transfer.preview?.previewId || null;
  const transferPending = termsReady && transfer.status === 'pending';
  transferPendingRef.current = transferPending;
  removalRef.current = removal;
  const removedTerm = removal.phase === SAVED_TERM_REMOVAL_PHASES.UNDO
    || removal.phase === SAVED_TERM_REMOVAL_PHASES.RESTORING
    ? removal.term
    : null;
  const removalBusy = removal.phase === SAVED_TERM_REMOVAL_PHASES.DELETING
    || removal.phase === SAVED_TERM_REMOVAL_PHASES.RESTORING;
  const removalPending = removal.phase !== SAVED_TERM_REMOVAL_PHASES.IDLE;

  const dispatchRemoval = useCallback((action) => {
    const current = removalRef.current;
    const next = transitionSavedTermRemoval(current, action);
    if (next === current) return false;
    removalRef.current = next;
    setRemoval(next);
    return true;
  }, []);

  const focusRemoveControl = useCallback((termId = null) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const controls = [...(dialogRef.current?.querySelectorAll('[data-saved-term-remove-id]') || [])];
        const exactControl = termId === null
          ? null
          : controls.find((node) => node.dataset.savedTermRemoveId === String(termId));
        const target = exactControl || controls.find((node) => !node.disabled)
          || searchInputRef.current || closeButtonRef.current;
        target?.focus();
      });
    });
  }, []);

  useEffect(() => () => {
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
  }, []);

  useEffect(() => {
    if (removal.phase !== SAVED_TERM_REMOVAL_PHASES.UNDO
      || !removedTerm
      || !terms.some((term) => savedTermKey(term) === savedTermKey(removedTerm))) return;
    dispatchRemoval({ type: 'sync-restored' });
    setError('');
  }, [dispatchRemoval, removal.phase, removedTerm, terms]);

  useEffect(() => {
    if (open) return;
    transferModeRef.current = 'idle';
    transferPendingRef.current = false;
    transferPreviewIdRef.current = null;
    previousTransferModeRef.current = 'idle';
    previousTransferPendingRef.current = false;
    lastTransferActionRef.current = null;
    lastTransferActionKindRef.current = null;
    setTransfer((current) => (
      current.mode === 'idle'
        && current.status === 'idle'
        && !current.message
        && !current.preview
        ? current
        : { mode: 'idle', status: 'idle', message: '', preview: null }
    ));
  }, [open, transfer]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    setQuery('');
    setError('');
    setAnnouncement('');
    setCopyState({ id: null, kind: null, status: 'idle', message: '' });
    setTransfer({ mode: 'idle', status: 'idle', message: '', preview: null });
    const dialog = dialogRef.current;
    const trigger = triggerRef?.current;
    const shell = dialog?.closest('.slipstream-shell');
    const hiddenSiblings = new Map();
    const hideBackgroundSibling = (node) => {
      if (!(node instanceof HTMLElement)
        || node.parentElement !== shell
        || node.classList.contains('saved-terms-drawer-backdrop')
        || hiddenSiblings.has(node)) return;
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

    const isVisibleFocusTarget = (node) => (
      !node.hasAttribute('hidden')
      && node.getClientRects().length > 0
      && window.getComputedStyle(node).visibility !== 'hidden'
    );

    const topLayerOwnsInteraction = () => Boolean(
      document.querySelector('[data-app-top-layer]'),
    );

    const restoreDialogFocus = () => {
      if (topLayerOwnsInteraction()) return;
      const target = (!searchInputRef.current?.disabled && searchInputRef.current)
        || (!loadRetryButtonRef.current?.disabled && loadRetryButtonRef.current)
        || (!emptyImportButtonRef.current?.disabled && emptyImportButtonRef.current)
        || (!closeButtonRef.current?.disabled && closeButtonRef.current)
        || dialog;
      if (!target?.isConnected || target.closest('[inert]')) return;
      target.focus();
      const visualTarget = target === searchInputRef.current
        ? target?.closest('.saved-term-search__field')
        : target;
      window.requestAnimationFrame(() => {
        if (
          !dialog?.isConnected
          || !visualTarget?.isConnected
          || document.activeElement !== target
        ) return;
        const dialogRect = dialog.getBoundingClientRect();
        const targetRect = visualTarget.getBoundingClientRect();
        const focusExtent = 5;
        const visibleTop = dialogRect.top + dialog.clientTop;
        const visibleBottom = visibleTop + dialog.clientHeight;
        if (targetRect.bottom + focusExtent > visibleBottom) {
          dialog.scrollTop += targetRect.bottom + focusExtent - visibleBottom;
        } else if (targetRect.top - focusExtent < visibleTop) {
          dialog.scrollTop -= visibleTop - (targetRect.top - focusExtent);
        }
      });
    };

    const handleFocusIn = (event) => {
      if (!dialog || dialog.contains(event.target) || topLayerOwnsInteraction()) return;
      restoreDialogFocus();
    };

    const handleDialogKeyDown = (event) => {
      if (topLayerOwnsInteraction()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (transferPendingRef.current) return;
        if (queryRef.current) {
          setQuery('');
          return;
        }
        if (transferModeRef.current !== 'idle') {
          setTransfer({
            mode: 'idle',
            status: 'idle',
            message: '已取消这一步；术语库没有变化。',
            preview: null,
          });
          return;
        }
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
        .filter(isVisibleFocusTarget);
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

    let topLayerWasPresent = topLayerOwnsInteraction();
    let topLayerFocusFrame = null;
    const topLayerObserver = document.body
      ? new MutationObserver(() => {
        const topLayerPresent = topLayerOwnsInteraction();
        if (topLayerWasPresent && !topLayerPresent) {
          if (topLayerFocusFrame !== null) {
            window.cancelAnimationFrame(topLayerFocusFrame);
          }
          topLayerFocusFrame = window.requestAnimationFrame(restoreDialogFocus);
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

    dialog?.addEventListener('keydown', handleDialogKeyDown);
    document.addEventListener('focusin', handleFocusIn);
    window.requestAnimationFrame(() => {
      restoreDialogFocus();
    });

    return () => {
      dialog?.removeEventListener('keydown', handleDialogKeyDown);
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
      if (openStateRef?.current) return;
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
  }, [onClose, open, openStateRef, triggerRef]);

  useEffect(() => {
    if (!open || transfer.mode === 'idle') return undefined;
    const expectedMode = transfer.mode;
    const expectedPreviewId = transfer.preview?.previewId || null;
    let secondFrame = null;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (transferModeRef.current !== expectedMode) return;
        if (expectedMode === 'import-preview'
          && transferPreviewIdRef.current !== expectedPreviewId) return;
        const target = expectedMode === 'import-preview'
          ? importTrustReviewRef.current
          : transferPrimaryRef.current;
        target?.focus();
        target?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
    };
  }, [open, transfer.mode, transfer.preview?.previewId]);

  useEffect(() => {
    const exitedConfirmation = previousTransferModeRef.current !== 'idle' && transfer.mode === 'idle';
    const finishedPendingAction = previousTransferPendingRef.current && !transferPending;
    previousTransferModeRef.current = transfer.mode;
    previousTransferPendingRef.current = transferPending;
    if (!open || !termsReady || transfer.mode !== 'idle' || (!exitedConfirmation && !finishedPendingAction)) return;
    window.requestAnimationFrame(() => {
      const matchingFallbacks = lastTransferActionKindRef.current === 'export'
        ? [exportActionButtonRef.current]
        : [emptyImportButtonRef.current, importActionButtonRef.current];
      const candidates = [
        lastTransferActionRef.current,
        ...matchingFallbacks,
        searchInputRef.current,
        closeButtonRef.current,
        dialogRef.current,
      ];
      const target = candidates.find((candidate) => (
        candidate?.isConnected
        && !candidate.disabled
        && !candidate.closest('[inert]')
      ));
      target?.focus({ preventScroll: true });
    });
  }, [open, termsReady, transfer.mode, transferPending]);

  const handleCopy = useCallback(async (term, kind) => {
    if (!onWriteClipboard || clipboardWritePending) return;
    const text = getSavedTermCopyText(term, kind);
    if (!text) return;
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    setCopyState({ id: term.id, kind, status: 'pending', message: '' });
    try {
      await onWriteClipboard(COPY_KINDS[kind], text);
      const boundary = kind === 'term'
        ? '已包含类型与可信度；未包含解释或原文片段'
        : kind === 'explanation'
          ? '已包含类型与可信度；未包含术语或原文片段'
          : '已包含类型与可信度；未包含原文片段';
      const message = `已复制${COPY_LABELS[kind]}；${boundary}。`;
      setCopyState({ id: term.id, kind, status: 'success', message });
      copyTimerRef.current = window.setTimeout(() => {
        setCopyState({ id: null, kind: null, status: 'idle', message: '' });
        copyTimerRef.current = null;
      }, 2200);
    } catch (copyError) {
      if (isClipboardWritePendingError(copyError)) {
        setCopyState({ id: null, kind: null, status: 'idle', message: '' });
        return;
      }
      const message = `没有复制“${term.term}”；剪贴板内容没有改变。可以重试，或选中文本手动复制。`;
      setCopyState({ id: term.id, kind, status: 'error', message });
    }
  }, [clipboardWritePending, onWriteClipboard]);

  const handleDelete = useCallback(async (term) => {
    if (!onDeleteTerm || clipboardWritePending || transferPendingRef.current || transferModeRef.current !== 'idle') return;
    if (!dispatchRemoval({ type: 'delete-start', term })) return;
    setError('');
    try {
      await onDeleteTerm(term);
      if (!dispatchRemoval({ type: 'delete-success' })) return;
      setAnnouncement(`已移除术语 ${term.term}；先撤销或保留这次删除，再移除其他术语或使用备份。`);
      window.requestAnimationFrame(() => undoButtonRef.current?.focus());
    } catch {
      dispatchRemoval({ type: 'delete-failure' });
      const message = `无法确认是否已移除“${term.term}”；这次更改可能已经完成，也可能没有完成。请重新读取术语库后核对。`;
      setError(message);
      setAnnouncement(message);
    }
  }, [clipboardWritePending, dispatchRemoval, onDeleteTerm]);

  const handleRestore = useCallback(async () => {
    if (!onRestoreTerm || clipboardWritePending || transferPendingRef.current || transferModeRef.current !== 'idle') return;
    const term = removalRef.current.term;
    if (!term || !dispatchRemoval({ type: 'restore-start' })) return;
    setError('');
    try {
      await onRestoreTerm(term);
      dispatchRemoval({ type: 'restore-success' });
      setAnnouncement(`已恢复术语 ${term.term}`);
      focusRemoveControl(term.id);
    } catch {
      dispatchRemoval({ type: 'restore-failure' });
      const message = `无法确认是否已恢复“${term.term}”；这次更改可能已经完成，也可能没有完成。请重新读取术语库后核对。`;
      setError(message);
      setAnnouncement(message);
    }
  }, [clipboardWritePending, dispatchRemoval, focusRemoveControl, onRestoreTerm]);

  const handleKeepDeletion = useCallback(() => {
    if (clipboardWritePending) return;
    const term = removalRef.current.term;
    if (!term || !dispatchRemoval({ type: 'dismiss' })) return;
    setError('');
    setAnnouncement(`已保留“${term.term}”的删除；可以继续管理其他术语。`);
    focusRemoveControl();
  }, [clipboardWritePending, dispatchRemoval, focusRemoveControl]);

  const cancelTransfer = useCallback((message = '') => {
    if (transferPendingRef.current) return;
    setTransfer({ mode: 'idle', status: 'idle', message, preview: null });
  }, []);

  const prepareExport = useCallback(() => {
    if (clipboardWritePending || transferPending || terms.length === 0 || removalRef.current.phase !== SAVED_TERM_REMOVAL_PHASES.IDLE) return;
    lastTransferActionRef.current = exportActionButtonRef.current;
    lastTransferActionKindRef.current = 'export';
    setTransfer({ mode: 'export-confirm', status: 'idle', message: '', preview: null });
  }, [clipboardWritePending, terms.length, transferPending]);

  const confirmExport = useCallback(async () => {
    if (!onExportTerms || clipboardWritePending || transferPending) return;
    setTransfer((current) => ({ ...current, status: 'pending', message: '' }));
    try {
      const response = await onExportTerms();
      if (response?.status === 'saved') {
        const message = `已导出 ${response.count} 条术语到“${response.fileName}”；文件不含原文证据。`;
        setTransfer({ mode: 'idle', status: 'success', message, preview: null });
      } else if (response?.status === 'cancelled') {
        const message = '已取消导出；没有创建或覆盖文件。';
        setTransfer({ mode: 'idle', status: 'idle', message, preview: null });
      } else {
        const message = response?.code === 'no-terms'
          ? '当前没有可导出的术语；没有创建文件。'
          : '导出没有完成；没有写入或覆盖文件，可以重试。';
        setTransfer({ mode: 'idle', status: 'error', message, preview: null });
      }
    } catch {
      const message = '导出没有完成；没有写入或覆盖文件，可以重试。';
      setTransfer({ mode: 'idle', status: 'error', message, preview: null });
    }
  }, [clipboardWritePending, onExportTerms, transferPending]);

  const previewImport = useCallback(async (initiator = null) => {
    if (!onPreviewImport || clipboardWritePending || transferPending || removalRef.current.phase !== SAVED_TERM_REMOVAL_PHASES.IDLE) return;
    lastTransferActionRef.current = initiator
      || emptyImportButtonRef.current
      || importActionButtonRef.current;
    lastTransferActionKindRef.current = 'import';
    setTransfer({ mode: 'idle', status: 'pending', message: '正在选择并检查备份…', preview: null });
    try {
      const response = await onPreviewImport();
      if (response?.status === 'ready') {
        setTransfer({ mode: 'import-preview', status: 'idle', message: '', preview: response });
      } else if (response?.status === 'cancelled') {
        const message = '已取消导入；术语库没有变化。';
        setTransfer({ mode: 'idle', status: 'idle', message, preview: null });
      } else {
        const message = importFailureMessage(response?.code);
        setTransfer({ mode: 'idle', status: 'error', message, preview: null });
      }
    } catch {
      const message = '暂时无法读取这个文件；术语库没有变化，可以重新选择。';
      setTransfer({ mode: 'idle', status: 'error', message, preview: null });
    }
  }, [clipboardWritePending, onPreviewImport, transferPending]);

  const confirmImport = useCallback(async () => {
    const previewId = transfer.preview?.previewId;
    if (!onCommitImport || !previewId || clipboardWritePending || transferPending) return;
    setTransfer((current) => ({ ...current, status: 'pending', message: '' }));
    try {
      const response = await onCommitImport(previewId);
      if (response?.status === 'imported') {
        const summary = response.summary || {};
        const message = `导入完成：新增 ${summary.newCount || 0} 条，更新 ${summary.updatedCount || 0} 条；现在共 ${summary.totalAfter || 0} 条。`;
        setTransfer({ mode: 'idle', status: 'success', message, preview: null });
      } else {
        const message = importFailureMessage(response?.code);
        setTransfer({ mode: 'idle', status: 'error', message, preview: null });
      }
    } catch {
      setTransfer({
        mode: 'idle',
        status: 'error',
        message: IMPORT_MUTATION_UNCONFIRMED_MESSAGE,
        preview: null,
      });
    }
  }, [clipboardWritePending, onCommitImport, transfer.preview?.previewId, transferPending]);

  const handleRetryLoad = useCallback(() => {
    if (!onRetryLoad) return;
    loadRetryInFlightRef.current = true;
    void Promise.resolve()
      .then(() => onRetryLoad())
      .catch(() => false);
  }, [onRetryLoad]);

  useEffect(() => {
    const previousLoadStatus = previousLoadStatusRef.current;
    previousLoadStatusRef.current = normalizedLoadStatus;
    if (!open) return undefined;

    const retryInFlight = loadRetryInFlightRef.current;
    if (retryInFlight && normalizedLoadStatus === 'loading') {
      const frame = window.requestAnimationFrame(() => {
        const dialog = dialogRef.current;
        const activeElement = document.activeElement;
        if (!dialog?.isConnected || (
          activeElement !== document.body
          && activeElement !== dialog
          && activeElement !== closeButtonRef.current
          && dialog.contains(activeElement)
        )) return;
        closeButtonRef.current?.focus({ preventScroll: true });
      });
      return () => window.cancelAnimationFrame(frame);
    }

    const retrySettled = retryInFlight && ['ready', 'error'].includes(normalizedLoadStatus);
    if (retrySettled) loadRetryInFlightRef.current = false;
    const loadingBecameReady = previousLoadStatus === 'loading'
      && normalizedLoadStatus === 'ready';
    const loadingBecameError = previousLoadStatus === 'loading'
      && normalizedLoadStatus === 'error';
    const readyBecameError = previousLoadStatus === 'ready'
      && normalizedLoadStatus === 'error';
    if (!loadingBecameReady && !loadingBecameError && !readyBecameError && !retrySettled) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog?.isConnected) return;
      const activeElement = document.activeElement;
      if (normalizedLoadStatus === 'ready') {
        if (
          activeElement !== document.body
          && activeElement !== closeButtonRef.current
          && activeElement !== dialog
        ) return;
        const target = searchInputRef.current
          || emptyImportButtonRef.current
          || closeButtonRef.current;
        if (target?.isConnected && !target.disabled) target.focus({ preventScroll: true });
        return;
      }

      if (normalizedLoadStatus !== 'error') return;
      const focusAlreadyInVisibleErrorShell = dialog.contains(activeElement);
      if (
        focusAlreadyInVisibleErrorShell
        && (readyBecameError || (
          activeElement !== dialog
          && activeElement !== closeButtonRef.current
        ))
      ) return;
      const target = (!loadRetryButtonRef.current?.disabled && loadRetryButtonRef.current)
        || closeButtonRef.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [normalizedLoadStatus, open]);

  const importSummary = transfer.preview?.summary || {};
  const importHasChanges = (importSummary.newCount || 0) + (importSummary.updatedCount || 0) > 0;
  const importConfirmDescriptionIds = [
    'term-import-trust-summary',
    (importSummary.downgradedProvenanceCount || 0) > 0 ? 'term-import-downgrade-warning' : null,
    (importSummary.capacitySkippedCount || 0) > 0 ? 'term-import-capacity-warning' : null,
  ].filter(Boolean).join(' ');
  const transferActive = termsReady && transfer.mode !== 'idle';
  const showTransferFooter = termsReady && (
    terms.length > 0
    || transfer.mode !== 'idle'
    || transfer.status !== 'idle'
    || Boolean(transfer.message)
  );

  useLayoutEffect(() => {
    if (!open || !termsReady || !reconciliationPendingRef.current) return;
    reconciliationPendingRef.current = false;
    setError('');
    setAnnouncement('');
    setTransfer((current) => (
      current.message === IMPORT_MUTATION_UNCONFIRMED_MESSAGE
        ? { mode: 'idle', status: 'idle', message: '', preview: null }
        : current
    ));
  }, [open, termsReady]);

  const headerSummary = termsReady
    ? `已保存 ${terms.length} 个术语`
    : termsLoadError
      ? '暂时无法读取本机术语'
      : termsLoading
        ? '正在读取本机术语…'
        : '准备读取本机术语…';
  const safeLoadError = typeof loadError === 'string' ? loadError.trim() : '';

  if (!open) return null;

  return (
    <div className="saved-terms-drawer-backdrop" onMouseDown={(event) => {
      if (event.target !== event.currentTarget || transferPending) return;
      if (transferActive) cancelTransfer('已取消这一步；术语库没有变化。');
      else onClose();
    }}>
      <section
        id="saved-terms-drawer"
        ref={dialogRef}
        className="saved-terms-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-terms-drawer-title"
        tabIndex={-1}
      >
        <header className="saved-terms-drawer__header">
          <span className="saved-terms-drawer__icon"><BookOpen size={22} weight="fill" /></span>
          <div>
            <p className="eyebrow">随时回访</p>
            <h2 id="saved-terms-drawer-title">术语库</h2>
            <p>{headerSummary}</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} disabled={transferPending} aria-label="关闭术语库">
            <X size={19} />
          </button>
        </header>

        <div className="saved-terms-drawer__privacy" role="note">
          <ShieldCheck size={17} weight="fill" />
          <span>仅在本机保留术语、解释、类型、可信度与最短原文片段；复制时会带上类型和可信度，不会带上原文片段。</span>
        </div>

        <div
          className={`saved-terms-drawer__body${termsReady ? '' : ' saved-terms-workspace-state__body'}${termsReady && terms.length > 0 ? ' saved-terms-drawer__body--populated' : ''}`}
          aria-busy={termsLoading ? 'true' : undefined}
        >
          {!termsReady ? (
            termsLoadError ? (
              <>
                <div
                  className="saved-terms-workspace-state__notice saved-terms-workspace-state__notice--error"
                  role="alert"
                >
                  <WarningCircle size={20} weight="fill" aria-hidden="true" />
                  <span>
                    <strong>{reconciliationRequired ? '无法确认上一次更改' : '没有读到术语库'}</strong>
                    <span id="saved-terms-load-error-description">
                      {reconciliationRequired
                        ? '上一次更改可能已经完成，也可能没有完成；当前无法安全显示术语库。请重试，重新读取这台 Mac 上的术语并核对实际状态。'
                        : (
                          <>
                            没有读取到任何术语，也没有新增、删除或更改术语。
                            {safeLoadError ? ` ${safeLoadError}` : ' 本机存储暂时无法访问。'}
                          </>
                        )}
                    </span>
                  </span>
                </div>
                <div className="saved-terms-workspace-state__actions">
                  <button
                    id="saved-terms-retry-load"
                    ref={loadRetryButtonRef}
                    type="button"
                    className="primary-button"
                    data-saved-terms-retry-load="true"
                    onClick={handleRetryLoad}
                    disabled={!onRetryLoad}
                    aria-describedby="saved-terms-load-error-description"
                  >
                    <ArrowClockwise size={17} weight="bold" aria-hidden="true" />
                    重试读取
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    data-saved-terms-return-to-task="true"
                    onClick={onClose}
                    aria-label="关闭术语库，返回当前任务"
                  >
                    <ArrowCounterClockwise size={17} weight="bold" aria-hidden="true" />
                    返回当前任务
                  </button>
                </div>
                <p className="saved-terms-workspace-state__hint">
                  {reconciliationRequired
                    ? '重试会重新读取这台 Mac 上的术语，用来核对上一次更改的实际结果；不会调用模型或读取剪贴板。'
                    : '重试只会再次读取这台 Mac 上的术语，不会调用模型或读取剪贴板。'}
                </p>
              </>
            ) : (
              <div className="saved-terms-workspace-state__notice" role="status" aria-live="polite">
                {termsLoading
                  ? <CircleNotch size={20} className="spin" aria-hidden="true" />
                  : <BookOpen size={20} weight="duotone" aria-hidden="true" />}
                <span>
                  <strong>{termsLoading ? '正在读取这台 Mac 上的术语' : '准备读取这台 Mac 上的术语'}</strong>
                  <span>这一步不会调用模型、读取剪贴板，也不会新增、删除或更改术语。</span>
                </span>
              </div>
            )
          ) : terms.length > 0 ? (
            <>
              <div className="saved-term-search" role="search">
                <label htmlFor="saved-term-drawer-search">搜索已保存术语</label>
                <div className="saved-term-search__field">
                  <MagnifyingGlass size={16} aria-hidden="true" />
                  <input
                    ref={searchInputRef}
                    id="saved-term-drawer-search"
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索术语、解释或原文"
                    autoComplete="off"
                    spellCheck="false"
                    aria-controls="saved-term-drawer-list"
                    aria-describedby="saved-term-drawer-search-status"
                  />
                  {hasQuery && (
                    <button type="button" className="saved-term-search__clear" onClick={() => setQuery('')} aria-label="清除术语搜索">
                      <X size={14} />
                    </button>
                  )}
                </div>
                <p
                  id="saved-term-drawer-search-status"
                  aria-live={hasQuery ? 'polite' : 'off'}
                  aria-atomic={hasQuery ? 'true' : undefined}
                >
                  {hasQuery
                    ? `找到 ${filteredTerms.length} 条，共 ${terms.length} 条`
                    : `共 ${terms.length} 条，最新保存的排在前面`}
                </p>
              </div>

              <div id="saved-term-drawer-list" className="saved-term-library">
                {filteredTerms.length > 0 ? filteredTerms.map((term, termIndex) => {
                  const deleting = removal.phase === SAVED_TERM_REMOVAL_PHASES.DELETING
                    && String(removal.term?.id) === String(term.id);
                  const termCopyState = copyState.id === term.id ? copyState : null;
                  const explanationAvailable = Boolean(getSavedTermCopyText(term, 'explanation'));
                  const metadata = getSavedTermMetadata(term);
                  const termNameId = `saved-term-name-${termIndex}`;
                  return (
                    <article key={term.id} className="saved-term-card" aria-labelledby={termNameId}>
                      <div className="saved-term-card__content">
                        <strong
                          id={termNameId}
                          role="heading"
                          aria-level="3"
                          lang={inferTextLanguageTag(term.term)}
                        >
                          {term.term}
                        </strong>
                        <p aria-label={`类型：${metadata.termKindLabel}；可信度：${metadata.provenanceLabel}`}>
                          类型：{metadata.termKindLabel} · 可信度：{metadata.provenanceLabel}
                        </p>
                        <p>{term.explanation || '没有保存可显示的解释。'}</p>
                        {term.evidence && (
                          <q>
                            <span>保存时的原文片段：</span>
                            <span lang={inferTextLanguageTag(term.evidence)}>{term.evidence}</span>
                          </q>
                        )}
                        <div
                          className="saved-term-copy-actions"
                          role="group"
                          aria-label="复制选项"
                          aria-describedby={termNameId}
                        >
                          {['term', 'explanation', 'combined'].map((kind) => {
                            const activeCopy = termCopyState?.kind === kind;
                            const disabled = !onWriteClipboard
                              || clipboardWritePending
                              || copyState.status === 'pending'
                              || removalBusy
                              || (kind !== 'term' && !explanationAvailable);
                            return (
                              <button
                                key={kind}
                                type="button"
                                data-saved-term-copy-action={kind}
                                onClick={() => handleCopy(term, kind)}
                                disabled={disabled}
                                aria-busy={activeCopy && termCopyState.status === 'pending'}
                              >
                                {activeCopy && termCopyState.status === 'success'
                                  ? <CheckCircle size={14} weight="fill" />
                                  : <Copy size={14} />}
                                {activeCopy && termCopyState.status === 'pending'
                                  ? '正在复制…'
                                  : activeCopy && termCopyState.status === 'success'
                                    ? `${COPY_LABELS[kind]}已复制`
                                    : kind === 'combined' ? '术语 + 解释' : `复制${COPY_LABELS[kind]}`}
                              </button>
                            );
                          })}
                        </div>
                        {termCopyState?.message && (
                          <p className={`saved-term-copy-status saved-term-copy-status--${termCopyState.status}`}>
                            {termCopyState.message}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        className="saved-term-card__remove"
                        data-saved-term-remove-id={term.id}
                        onClick={() => handleDelete(term)}
                        disabled={removalPending || transferPending || transferActive || clipboardWritePending}
                        aria-busy={deleting}
                        aria-describedby={termNameId}
                      >
                        {deleting ? '正在移除…' : '移除'}
                      </button>
                    </article>
                  );
                }) : (
                  <div className="saved-term-empty">
                    <MagnifyingGlass size={21} aria-hidden="true" />
                    <div>
                      <strong>没有找到匹配的术语</strong>
                      <p>可以搜索术语、中文解释或保存的原文片段。</p>
                    </div>
                    <button type="button" onClick={() => setQuery('')}>清除搜索</button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="saved-terms-drawer__empty">
              <BookOpen size={28} weight="duotone" />
              <div>
                <strong>还没有保存术语</strong>
                <p>完成一次完整分析后，在“词语与术语”里保存需要反复使用的词；以后可以从这里直接搜索和复制。</p>
                <p id="saved-term-empty-import-boundary">如果已有 Slipstream 术语备份，可以现在从备份恢复。</p>
              </div>
              <button
                ref={emptyImportButtonRef}
                type="button"
                className="primary-button"
                onClick={(event) => previewImport(event.currentTarget)}
                disabled={!onPreviewImport || transferPending || transferActive || removalPending || clipboardWritePending}
                aria-describedby="saved-term-empty-import-boundary"
              >
                <UploadSimple size={16} aria-hidden="true" />
                导入已有备份
              </button>
            </div>
          )}

          {termsReady && removedTerm && (
            <div className="saved-term-undo" role="status">
              <span>
                已移除“<span id="saved-term-removed-name" lang={inferTextLanguageTag(removedTerm.term)}>{removedTerm.term}</span>”；先撤销或保留这次删除，再移除其他术语或使用备份。
              </span>
              <button
                ref={undoButtonRef}
                type="button"
                onClick={handleRestore}
                disabled={removal.phase === SAVED_TERM_REMOVAL_PHASES.RESTORING || transferPending || transferActive || clipboardWritePending}
                aria-busy={removal.phase === SAVED_TERM_REMOVAL_PHASES.RESTORING}
              >
                <ArrowCounterClockwise size={15} />
                {removal.phase === SAVED_TERM_REMOVAL_PHASES.RESTORING ? '正在恢复…' : '撤销删除'}
              </button>
              <button
                type="button"
                className="saved-term-undo__keep"
                onClick={handleKeepDeletion}
                disabled={removal.phase === SAVED_TERM_REMOVAL_PHASES.RESTORING || clipboardWritePending}
                aria-describedby="saved-term-removed-name"
              >
                保留删除
              </button>
            </div>
          )}

          {termsReady && error && <p className="saved-term-error" role="alert">{error}</p>}
        </div>

        {termsReady && (
          <ClipboardActionNotice
            notice={clipboardNotice}
            onAcknowledge={onAcknowledgeClipboardConsequence}
            onDismiss={onDismissClipboardNotice}
          />
        )}

        {termsReady && <footer className="saved-term-transfer" hidden={!showTransferFooter}>
          {terms.length > 0 && <div className="saved-term-transfer__actions" role="group" aria-label="术语备份">
            <button
              ref={exportActionButtonRef}
              type="button"
              onClick={prepareExport}
              disabled={terms.length === 0 || transferPending || transferActive || removalPending || clipboardWritePending}
              aria-describedby="saved-term-transfer-boundary"
            >
              <DownloadSimple size={16} />
              导出备份
            </button>
            <button
              ref={importActionButtonRef}
              type="button"
              onClick={(event) => previewImport(event.currentTarget)}
              disabled={!onPreviewImport || transferPending || transferActive || removalPending || clipboardWritePending}
              aria-describedby="saved-term-transfer-boundary"
            >
              <UploadSimple size={16} />
              导入备份
            </button>
            <p id="saved-term-transfer-boundary">备份只包含术语、解释、类型与可信度，不包含原文证据。</p>
          </div>}

          {transfer.mode === 'export-confirm' && (
            <div className="saved-term-transfer__confirm" role="group" aria-labelledby="term-export-title">
              <div className="saved-term-transfer__heading">
                <DownloadSimple size={19} weight="duotone" />
                <div>
                  <strong id="term-export-title">导出 {terms.length} 条术语</strong>
                  <span>选择保存位置前，请确认备份边界。</span>
                </div>
              </div>
              <div className="saved-term-transfer__boundary">
                <span><CheckCircle size={15} weight="fill" />包含：术语、解释、类型与可信度</span>
                <span><ShieldCheck size={15} weight="fill" />不包含：原文证据、设置、API Key</span>
                <span>可信度用于说明导出时状态；重新导入时，缺少证据的可信标记会安全降级。</span>
              </div>
              <div className="saved-term-transfer__confirm-actions">
                <button type="button" className="secondary" onClick={() => cancelTransfer('已取消导出；没有创建文件。')} disabled={transferPending}>取消</button>
                <button ref={transferPrimaryRef} type="button" className="primary" onClick={confirmExport} disabled={transferPending || clipboardWritePending} aria-busy={transferPending}>
                  {transferPending ? '正在保存…' : '选择保存位置'}
                </button>
              </div>
            </div>
          )}

          {transfer.mode === 'import-preview' && transfer.preview && (
            <div className="saved-term-transfer__confirm" role="group" aria-labelledby="term-import-title">
              <div className="saved-term-transfer__heading">
                <UploadSimple size={19} weight="duotone" />
                <div>
                  <h3 id="term-import-title">确认导入“{transfer.preview.fileName}”</h3>
                  <span>确认前，术语库还没有变化。</span>
                </div>
              </div>
              <div className="saved-term-import-summary" aria-label="导入预览摘要">
                <span><strong>{importSummary.newCount || 0}</strong> 新增</span>
                <span><strong>{importSummary.updatedCount || 0}</strong> 更新内容 / 标记</span>
                <span><strong>{importSummary.unchangedCount || 0}</strong> 保持不变</span>
                <span><strong>{importSummary.totalAfter || terms.length}</strong> 导入后总数</span>
              </div>
              {transfer.preview.examples?.length > 0 && (
                <div className="saved-term-import-examples" aria-label="备份中的术语示例">
                  {transfer.preview.examples.map((term) => <span key={term}>{term}</span>)}
                </div>
              )}
              {!importHasChanges && (
                <div className="saved-term-transfer__status saved-term-transfer__status--success">
                  <CheckCircle size={15} weight="fill" aria-hidden="true" />
                  没有可安全应用的变化；本机术语库不会改变。
                </div>
              )}
              <div
                id="term-import-trust-review"
                ref={importTrustReviewRef}
                className="saved-term-transfer__boundary saved-term-import-trust-review"
                role="note"
                tabIndex={-1}
                aria-labelledby="term-import-trust-title"
                aria-describedby="term-import-trust-summary"
              >
                <div className="saved-term-import-trust-review__heading">
                  <ShieldCheck size={16} weight="fill" aria-hidden="true" />
                  <h4 id="term-import-trust-title">先核对导入的可信度</h4>
                </div>
                <p id="term-import-trust-summary">
                  不会导入原文证据；本机已有证据会保留。无法由备份证明的可信标记会按“来源状态未知”处理。
                </p>
                <ul className="saved-term-import-trust-review__details">
                  <li>备份无法重新证明“原文明示 / 基于原文推断 / 官方核验”；这些标记会按“来源状态未知”导入。</li>
                  <li>旧版备份会按“其他词语 / 来源状态未知”导入，不会自动提升可信度。</li>
                  <li>
                    已过滤：无效 {importSummary.invalidCount || 0} 条、重复 {importSummary.duplicateCount || 0} 条、原文证据 {importSummary.ignoredEvidenceCount || 0} 条。
                  </li>
                </ul>
                {(importSummary.downgradedProvenanceCount || 0) > 0 && (
                  <p id="term-import-downgrade-warning" className="saved-term-transfer__warning"><WarningCircle size={15} weight="fill" aria-hidden="true" />备份中 {importSummary.downgradedProvenanceCount} 条缺少证据的可信标记已按“来源状态未知”参与预览；确认后仍会保留本机更强记录并遵守容量限制。</p>
                )}
                {(importSummary.capacitySkippedCount || 0) > 0 && (
                  <p id="term-import-capacity-warning" className="saved-term-transfer__warning"><WarningCircle size={15} weight="fill" aria-hidden="true" />容量已满，将跳过 {importSummary.capacitySkippedCount} 条，不会删除本机术语。</p>
                )}
              </div>
              <div className="saved-term-transfer__confirm-actions">
                {importHasChanges ? (
                  <>
                    <button type="button" className="secondary" onClick={() => cancelTransfer('已取消导入；术语库没有变化。')} disabled={transferPending}>取消</button>
                    <button
                      ref={transferPrimaryRef}
                      type="button"
                      className="primary"
                      onClick={confirmImport}
                      disabled={transferPending || clipboardWritePending}
                      aria-busy={transferPending}
                      aria-describedby={importConfirmDescriptionIds}
                    >
                      {transferPending ? '正在导入…' : '确认导入'}
                    </button>
                  </>
                ) : (
                  <button
                    ref={transferPrimaryRef}
                    type="button"
                    className="primary"
                    onClick={() => cancelTransfer('没有可安全应用的变化；术语库没有变化。')}
                    aria-describedby="term-import-trust-summary"
                  >
                    返回术语库
                  </button>
                )}
              </div>
            </div>
          )}

          {transfer.message && (
            <p
              className={`saved-term-transfer__status saved-term-transfer__status--${transfer.status}`}
              role={transfer.status === 'error' ? 'alert' : 'status'}
              aria-live={transfer.status === 'error' ? 'assertive' : 'polite'}
              aria-atomic="true"
            >
              {transfer.status === 'error' && <WarningCircle size={15} weight="fill" />}
              {transfer.status === 'success' && <CheckCircle size={15} weight="fill" />}
              {transfer.message}
            </p>
          )}
        </footer>}

        <p className="result-a11y-live" role="status" aria-live="polite">{announcement}</p>
      </section>
    </div>
  );
}
