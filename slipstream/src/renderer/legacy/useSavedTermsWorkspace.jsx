// Frozen action-workspace term library ("术语库"): electron-store saved terms,
// their lazy drawer and import/export transactions. The reading product uses
// the Markdown card box instead; this module only serves restored results.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  LazyWorkspaceBoundary,
  SavedTermsWorkspaceFallback,
  SavedTermsWorkspaceRecovery,
} from '../components/LazyWorkspaceRecovery';
import {
  hasSavedTerm,
  isCanonicalSavedTerm,
  isCanonicalSavedTerms,
  savedTermKey,
  upsertSavedTerm,
} from '../utils/savedTerms.mjs';
import {
  createRetryableLazyImport,
  importRetryableWorkspaceAsset,
} from '../utils/retryableLazyImport.mjs';
import { IPC_CHANNELS } from '../../shared/constants';

const SAVED_TERMS_DEFERRAL_FIXTURE = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('run') === 'saved-terms-deferral-native';
function waitForSavedTermsWorkspaceStyles(moduleLoader) {
  return moduleLoader().then((savedTermsModule) => (
    Promise.resolve(savedTermsModule.savedTermsWorkspaceStylesheetReady)
      .then(() => savedTermsModule)
  ));
}

const savedTermsLibraryImport = createRetryableLazyImport(
  import.meta.env.DEV
    ? [
      SAVED_TERMS_DEFERRAL_FIXTURE
        ? () => waitForSavedTermsWorkspaceStyles(
          () => import('../components/SavedTermsLibrary?workspace-load=saved-terms-fixture-primary'),
        )
        : () => waitForSavedTermsWorkspaceStyles(() => import('../components/SavedTermsLibrary')),
      () => waitForSavedTermsWorkspaceStyles(
        () => import('../components/SavedTermsLibrary?workspace-load=saved-terms-retry&workspace-attempt=1'),
      ),
    ]
    : [
      () => waitForSavedTermsWorkspaceStyles(() => import('../components/SavedTermsLibrary')),
      () => waitForSavedTermsWorkspaceStyles(
        () => importRetryableWorkspaceAsset('SavedTermsLibrary.js', 1),
      ),
    ],
);

function preloadSavedTermsLibrary() {
  return savedTermsLibraryImport.load();
}

function prepareSavedTermsLibrary() {
  void preloadSavedTermsLibrary().catch(() => false);
}

function createSavedTermsLibrary() {
  return React.lazy(preloadSavedTermsLibrary);
}

export const SAVED_TERMS_LOAD_STATUS = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error',
});
const SAVED_TERMS_RECONCILIATION_ERROR_CODES = new Set([
  'saved-terms-mutation-unconfirmed',
  'saved-terms-invalid-mutation-response',
  'saved-terms-invalid-import-response',
]);
// Import validation ships with the lazy SavedTermsLibrary chunk; the drawer is
// already loaded whenever a reader can start an import.
async function loadSavedTermsImportValidation() {
  return (await preloadSavedTermsLibrary()).savedTermsImportValidation;
}

function createSavedTermsLoadError(code = 'saved-terms-load-failed') {
  const error = new Error(code);
  error.code = code;
  return error;
}

// `onOpen` runs before the drawer opens so the panel can hold foreground
// capture decisions while the drawer owns the window.
export function useSavedTermsWorkspace({ invoke, visible, onOpen }) {
  const [savedTerms, setSavedTerms] = useState([]);
  const [savedTermsLoadStatus, setSavedTermsLoadStatus] = useState(SAVED_TERMS_LOAD_STATUS.IDLE);
  const [savedTermsLoadError, setSavedTermsLoadError] = useState('');
  const [savedTermsLoadErrorCode, setSavedTermsLoadErrorCode] = useState('');
  const [savedTermsDrawerOpen, setSavedTermsDrawerOpen] = useState(false);
  const [savedTermsWorkspaceMounted, setSavedTermsWorkspaceMounted] = useState(false);
  const [savedTermsSessionGeneration, setSavedTermsSessionGeneration] = useState(0);
  const [savedTermsWorkspace, setSavedTermsWorkspace] = useState(() => ({
    attempt: 0,
    Component: createSavedTermsLibrary(),
  }));
  const savedTermsTriggerRef = useRef(null);
  const savedTermsDrawerOpenRef = useRef(false);
  const savedTermsWorkspaceMountedRef = useRef(false);
  const savedTermsRef = useRef([]);
  const savedTermsImportPreviewRef = useRef(null);
  const savedTermsLoadRef = useRef({
    epoch: 0,
    status: SAVED_TERMS_LOAD_STATUS.IDLE,
    promise: null,
    error: null,
  });
  const savedTermsMutationRef = useRef(null);
  const savedTermsReconciliationErrorCodeRef = useRef('');

  const updateSavedTerms = useCallback((nextOrUpdater) => {
    const current = savedTermsRef.current;
    const next = typeof nextOrUpdater === 'function'
      ? nextOrUpdater(current)
      : nextOrUpdater;
    const normalized = Array.isArray(next) ? next : [];
    savedTermsRef.current = normalized;
    setSavedTerms(normalized);
    return normalized;
  }, []);

  const setSavedTermsLoadState = useCallback((status, {
    epoch = savedTermsLoadRef.current.epoch,
    promise = null,
    error = null,
  } = {}) => {
    let resolvedError = error;
    if (status === SAVED_TERMS_LOAD_STATUS.READY) {
      savedTermsReconciliationErrorCodeRef.current = '';
    } else if (status === SAVED_TERMS_LOAD_STATUS.ERROR) {
      const incomingCode = error?.code || '';
      if (SAVED_TERMS_RECONCILIATION_ERROR_CODES.has(incomingCode)) {
        savedTermsReconciliationErrorCodeRef.current = incomingCode;
      } else if (savedTermsReconciliationErrorCodeRef.current) {
        resolvedError = createSavedTermsLoadError(
          savedTermsReconciliationErrorCodeRef.current,
        );
      }
    }
    savedTermsLoadRef.current = { epoch, status, promise, error: resolvedError };
    setSavedTermsLoadStatus(status);
    const errorCode = status === SAVED_TERMS_LOAD_STATUS.ERROR
      ? resolvedError?.code || ''
      : '';
    setSavedTermsLoadErrorCode(errorCode);
    setSavedTermsLoadError(status === SAVED_TERMS_LOAD_STATUS.ERROR
      ? SAVED_TERMS_RECONCILIATION_ERROR_CODES.has(errorCode)
        ? '无法确认最近一次术语更改是否完成。请重新读取这台 Mac 上的术语后再继续。'
        : '暂时无法读取已保存术语。已保存内容仍保留在这台 Mac。'
      : '');
    return resolvedError;
  }, []);

  const ensureSavedTermsLoaded = useCallback(({ force = false } = {}) => {
    const current = savedTermsLoadRef.current;
    if (!force && current.status === SAVED_TERMS_LOAD_STATUS.READY) {
      return Promise.resolve(savedTermsRef.current);
    }
    if (!force && current.status === SAVED_TERMS_LOAD_STATUS.LOADING && current.promise) {
      return current.promise;
    }
    if (!force && current.status === SAVED_TERMS_LOAD_STATUS.ERROR) {
      return Promise.reject(current.error || createSavedTermsLoadError());
    }

    const epoch = current.epoch + 1;
    const request = invoke(IPC_CHANNELS.TERMS_GET)
      .then((terms) => {
        if (!isCanonicalSavedTerms(terms)) {
          throw createSavedTermsLoadError('saved-terms-invalid-response');
        }
        if (savedTermsLoadRef.current.epoch !== epoch) {
          throw createSavedTermsLoadError('saved-terms-load-stale');
        }
        const normalized = updateSavedTerms(terms);
        setSavedTermsLoadState(SAVED_TERMS_LOAD_STATUS.READY, { epoch });
        return normalized;
      })
      .catch((cause) => {
        if (savedTermsLoadRef.current.epoch !== epoch) {
          throw createSavedTermsLoadError('saved-terms-load-stale');
        }
        const error = typeof cause?.code === 'string' && cause.code.startsWith('saved-terms-')
          ? cause
          : createSavedTermsLoadError();
        const publishedError = setSavedTermsLoadState(
          SAVED_TERMS_LOAD_STATUS.ERROR,
          { epoch, error },
        );
        throw publishedError || error;
      });

    setSavedTermsLoadState(SAVED_TERMS_LOAD_STATUS.LOADING, { epoch, promise: request });
    return request;
  }, [invoke, setSavedTermsLoadState, updateSavedTerms]);

  const retrySavedTermsLoad = useCallback(
    () => ensureSavedTermsLoaded({ force: true }),
    [ensureSavedTermsLoaded],
  );

  const invalidateSavedTermsLoadRequest = useCallback(() => {
    const current = savedTermsLoadRef.current;
    savedTermsLoadRef.current = {
      ...current,
      epoch: current.epoch + 1,
      promise: null,
    };
  }, []);

  const runSavedTermsMutation = useCallback(async (kind, operation, commit) => {
    if (savedTermsMutationRef.current) {
      const error = new Error('saved-terms-operation-pending');
      error.code = 'saved-terms-operation-pending';
      throw error;
    }
    if (savedTermsLoadRef.current.status !== SAVED_TERMS_LOAD_STATUS.READY) {
      throw createSavedTermsLoadError();
    }

    invalidateSavedTermsLoadRequest();
    const owner = {
      epoch: savedTermsLoadRef.current.epoch,
      kind,
    };
    savedTermsMutationRef.current = owner;
    try {
      const response = await operation();
      if (
        savedTermsMutationRef.current !== owner
        || savedTermsLoadRef.current.epoch !== owner.epoch
      ) {
        throw createSavedTermsLoadError('saved-terms-operation-stale');
      }
      commit?.(response);
      return response;
    } catch (cause) {
      if (
        savedTermsMutationRef.current === owner
        && savedTermsLoadRef.current.epoch === owner.epoch
      ) {
        const error = SAVED_TERMS_RECONCILIATION_ERROR_CODES.has(cause?.code)
          ? cause
          : createSavedTermsLoadError('saved-terms-mutation-unconfirmed');
        setSavedTermsLoadState(SAVED_TERMS_LOAD_STATUS.ERROR, {
          epoch: owner.epoch,
          error,
        });
        throw error;
      }
      throw cause;
    } finally {
      if (savedTermsMutationRef.current === owner) savedTermsMutationRef.current = null;
    }
  }, [invalidateSavedTermsLoadRequest, setSavedTermsLoadState]);

  const commitSavedTermResponse = useCallback((savedTerm, expected = {}) => {
    const expectedKey = savedTermKey(expected.term);
    const responseMatchesRequest = (!expectedKey || savedTermKey(savedTerm) === expectedKey)
      && (expected.id == null || savedTerm?.id === expected.id);
    if (!isCanonicalSavedTerm(savedTerm) || !responseMatchesRequest) {
      const error = createSavedTermsLoadError('saved-terms-invalid-mutation-response');
      setSavedTermsLoadState(SAVED_TERMS_LOAD_STATUS.ERROR, {
        epoch: savedTermsLoadRef.current.epoch,
        error,
      });
      throw error;
    }
    updateSavedTerms((terms) => upsertSavedTerm(terms, savedTerm));
  }, [setSavedTermsLoadState, updateSavedTerms]);

  useEffect(() => {
    if (!visible) return;
    void ensureSavedTermsLoaded().catch(() => false);
  }, [ensureSavedTermsLoaded, visible]);

  useEffect(() => {
    if (!visible) {
      savedTermsDrawerOpenRef.current = false;
      setSavedTermsDrawerOpen(false);
    }
  }, [visible]);

  const isSavedTermsMutationPending = useCallback(() => Boolean(savedTermsMutationRef.current), []);

  // The saved-terms part of a full data reset: forget local state, keep files.
  const purgeSavedTermsSession = useCallback(() => {
    savedTermsImportPreviewRef.current = null;
    invalidateSavedTermsLoadRequest();
    setSavedTermsLoadState(SAVED_TERMS_LOAD_STATUS.IDLE, {
      epoch: savedTermsLoadRef.current.epoch,
    });
    savedTermsDrawerOpenRef.current = false;
    setSavedTermsDrawerOpen(false);
    setSavedTermsSessionGeneration((current) => current + 1);
  }, [invalidateSavedTermsLoadRequest, setSavedTermsLoadState]);

  const confirmSavedTermsPersistentReset = useCallback(() => {
    savedTermsImportPreviewRef.current = null;
    invalidateSavedTermsLoadRequest();
    updateSavedTerms([]);
    setSavedTermsLoadState(SAVED_TERMS_LOAD_STATUS.READY, {
      epoch: savedTermsLoadRef.current.epoch,
    });
    return { status: 'ready-empty' };
  }, [invalidateSavedTermsLoadRequest, setSavedTermsLoadState, updateSavedTerms]);

  const recoverSavedTermsAfterResetFailure = useCallback(async () => {
    savedTermsReconciliationErrorCodeRef.current = 'saved-terms-mutation-unconfirmed';
    try {
      return await retrySavedTermsLoad();
    } catch {
      const error = createSavedTermsLoadError('saved-terms-mutation-unconfirmed');
      setSavedTermsLoadState(SAVED_TERMS_LOAD_STATUS.ERROR, {
        epoch: savedTermsLoadRef.current.epoch,
        error,
      });
      throw error;
    }
  }, [retrySavedTermsLoad, setSavedTermsLoadState]);

  const handleSaveTerm = useCallback(async (term) => {
    const knownTerms = await ensureSavedTermsLoaded({
      force: savedTermsLoadRef.current.status === SAVED_TERMS_LOAD_STATUS.ERROR,
    });
    if (hasSavedTerm(knownTerms, term?.surface)) {
      return { status: 'already-saved', term };
    }
    const firstEvidence = term?.provenance?.evidence?.[0];
    const savedTerm = await runSavedTermsMutation(
      'save',
      () => invoke(IPC_CHANNELS.TERMS_SAVE, {
        term: term.surface,
        termKind: term.kind,
        provenanceKind: term.provenance?.kind,
        definition: term.explanation,
        evidence: firstEvidence?.quote || '',
      }),
      (response) => commitSavedTermResponse(response, { term: term.surface }),
    );
    return { status: 'saved', term: savedTerm };
  }, [commitSavedTermResponse, ensureSavedTermsLoaded, invoke, runSavedTermsMutation]);

  const handleDeleteTerm = useCallback(async (term) => {
    return runSavedTermsMutation(
      'delete',
      async () => {
        const deleted = await invoke(IPC_CHANNELS.TERMS_DELETE, term.id);
        if (deleted !== true) throw new Error('saved-terms-delete-unconfirmed');
        return term;
      },
      () => updateSavedTerms((terms) => terms.filter((item) => item.id !== term.id)),
    );
  }, [invoke, runSavedTermsMutation, updateSavedTerms]);

  const handleRestoreTerm = useCallback(async (term) => {
    return runSavedTermsMutation(
      'restore',
      () => invoke(IPC_CHANNELS.TERMS_SAVE, {
        id: term.id,
        createdAt: term.createdAt,
        term: term.term,
        termKind: term.termKind,
        provenanceKind: term.provenanceKind,
        definition: term.explanation,
        evidence: term.evidence,
      }),
      (response) => commitSavedTermResponse(response, { id: term.id, term: term.term }),
    );
  }, [commitSavedTermResponse, invoke, runSavedTermsMutation]);

  const handleExportTerms = useCallback(() => invoke(IPC_CHANNELS.TERMS_EXPORT), [invoke]);

  const handlePreviewTermImport = useCallback(async () => {
    const validation = await loadSavedTermsImportValidation();
    const response = await invoke(IPC_CHANNELS.TERMS_IMPORT_PREVIEW);
    if (validation.isValidSavedTermsImportPreview(response, savedTermsRef.current)) {
      savedTermsImportPreviewRef.current = {
        previewId: response.previewId,
        fileName: response.fileName,
        summary: { ...response.summary },
        planTerms: response.planTerms.map((term) => ({ ...term })),
      };
      return Object.fromEntries(
        Object.entries(response).filter(([key]) => key !== 'planTerms'),
      );
    }
    savedTermsImportPreviewRef.current = null;
    if (response?.status === 'cancelled') return response;
    if (
      response?.status === 'failed'
      && validation.SAVED_TERMS_IMPORT_PREVIEW_FAILURE_CODES.has(response?.code)
    ) {
      return response;
    }
    throw createSavedTermsLoadError('saved-terms-invalid-import-preview-response');
  }, [invoke]);

  const handleCommitTermImport = useCallback(async (previewId) => {
    const preview = savedTermsImportPreviewRef.current;
    const existingTerms = savedTermsRef.current.map((term) => ({ ...term }));
    try {
      const validation = await loadSavedTermsImportValidation();
      return await runSavedTermsMutation(
        'import',
        () => invoke(IPC_CHANNELS.TERMS_IMPORT_COMMIT, previewId),
        (response) => {
          if (response?.status === 'imported') {
            if (preview?.previewId !== previewId
              || !validation.isValidSavedTermsImportCommit(response, existingTerms, preview)) {
              const error = createSavedTermsLoadError('saved-terms-invalid-import-response');
              setSavedTermsLoadState(SAVED_TERMS_LOAD_STATUS.ERROR, {
                epoch: savedTermsLoadRef.current.epoch,
                error,
              });
              throw error;
            }
            updateSavedTerms(response.savedTerms);
            return;
          }
          if (
            response?.status !== 'failed'
            || !validation.SAVED_TERMS_CONFIRMED_IMPORT_NOOP_CODES.has(response?.code)
          ) {
            throw createSavedTermsLoadError('saved-terms-invalid-import-response');
          }
        },
      );
    } finally {
      if (savedTermsImportPreviewRef.current?.previewId === previewId) {
        savedTermsImportPreviewRef.current = null;
      }
    }
  }, [invoke, runSavedTermsMutation, setSavedTermsLoadState, updateSavedTerms]);

  const resetSavedTermsWorkspace = useCallback(() => {
    if (!savedTermsLibraryImport.reset()) return false;
    setSavedTermsWorkspace((current) => ({
      attempt: current.attempt + 1,
      Component: createSavedTermsLibrary(),
    }));
    return true;
  }, []);

  const openSavedTerms = useCallback(() => {
    onOpen?.();
    void ensureSavedTermsLoaded().catch(() => false);
    savedTermsDrawerOpenRef.current = true;
    if (!savedTermsWorkspaceMountedRef.current) {
      savedTermsWorkspaceMountedRef.current = true;
      setSavedTermsWorkspaceMounted(true);
    }
    setSavedTermsDrawerOpen(true);
  }, [ensureSavedTermsLoaded, onOpen]);

  const prepareSavedTermsAccess = useCallback(() => {
    prepareSavedTermsLibrary();
    void ensureSavedTermsLoaded().catch(() => false);
  }, [ensureSavedTermsLoaded]);

  const closeSavedTerms = useCallback(() => {
    savedTermsDrawerOpenRef.current = false;
    setSavedTermsDrawerOpen(false);
  }, []);

  const savedTermsTriggerLabel = savedTermsLoadStatus === SAVED_TERMS_LOAD_STATUS.READY
    ? `打开术语库，已保存 ${savedTerms.length} 个术语`
    : savedTermsLoadStatus === SAVED_TERMS_LOAD_STATUS.ERROR
      ? '打开术语库，暂时无法读取已保存术语，可打开后重试'
      : savedTermsLoadStatus === SAVED_TERMS_LOAD_STATUS.LOADING
        ? '打开术语库，正在读取已保存术语'
        : '打开术语库，尚未读取已保存术语';

  return {
    savedTerms,
    savedTermsLoadStatus,
    savedTermsLoadError,
    savedTermsLoadErrorCode,
    savedTermsDrawerOpen,
    savedTermsDrawerOpenRef,
    savedTermsTriggerRef,
    savedTermsTriggerLabel,
    savedTermsWorkspaceMounted,
    savedTermsWorkspaceAttempt: savedTermsWorkspace.attempt,
    savedTermsSessionGeneration,
    SavedTermsLibrary: savedTermsWorkspace.Component,
    retrySavedTermsLoad,
    resetSavedTermsWorkspace,
    openSavedTerms,
    prepareSavedTermsAccess,
    closeSavedTerms,
    handleSaveTerm,
    handleDeleteTerm,
    handleRestoreTerm,
    handleExportTerms,
    handlePreviewTermImport,
    handleCommitTermImport,
    isSavedTermsMutationPending,
    purgeSavedTermsSession,
    confirmSavedTermsPersistentReset,
    recoverSavedTermsAfterResetFailure,
  };
}

export function SavedTermsDrawer({
  workspace,
  clipboardNotice,
  clipboardWritePending,
  onWriteClipboard,
  onAcknowledgeClipboardConsequence,
  onDismissClipboardNotice,
}) {
  const {
    SavedTermsLibrary,
    savedTermsDrawerOpen,
    savedTermsDrawerOpenRef,
    savedTermsTriggerRef,
    closeSavedTerms,
  } = workspace;
  if (!workspace.savedTermsWorkspaceMounted) return null;
  return (
    <LazyWorkspaceBoundary
      key={`saved-terms-workspace-${workspace.savedTermsWorkspaceAttempt}`}
      fallback={(
        <SavedTermsWorkspaceRecovery
          open={savedTermsDrawerOpen}
          openStateRef={savedTermsDrawerOpenRef}
          triggerRef={savedTermsTriggerRef}
          onRetry={workspace.resetSavedTermsWorkspace}
          onClose={closeSavedTerms}
          retryAvailable={savedTermsLibraryImport.canRetry()}
        />
      )}
    >
      <React.Suspense
        fallback={(
          <SavedTermsWorkspaceFallback
            open={savedTermsDrawerOpen}
            openStateRef={savedTermsDrawerOpenRef}
            triggerRef={savedTermsTriggerRef}
            onClose={closeSavedTerms}
          />
        )}
      >
        <SavedTermsLibrary
          key={`saved-terms-session-${workspace.savedTermsSessionGeneration}`}
          open={savedTermsDrawerOpen}
          openStateRef={savedTermsDrawerOpenRef}
          onClose={closeSavedTerms}
          triggerRef={savedTermsTriggerRef}
          savedTerms={workspace.savedTerms}
          loadStatus={workspace.savedTermsLoadStatus}
          loadError={workspace.savedTermsLoadError}
          loadErrorCode={workspace.savedTermsLoadErrorCode}
          onRetryLoad={workspace.retrySavedTermsLoad}
          onDeleteTerm={workspace.handleDeleteTerm}
          onRestoreTerm={workspace.handleRestoreTerm}
          onExportTerms={workspace.handleExportTerms}
          onPreviewImport={workspace.handlePreviewTermImport}
          onCommitImport={workspace.handleCommitTermImport}
          clipboardNotice={clipboardNotice}
          clipboardWritePending={clipboardWritePending}
          onWriteClipboard={onWriteClipboard}
          onAcknowledgeClipboardConsequence={onAcknowledgeClipboardConsequence}
          onDismissClipboardNotice={onDismissClipboardNotice}
        />
      </React.Suspense>
    </LazyWorkspaceBoundary>
  );
}
