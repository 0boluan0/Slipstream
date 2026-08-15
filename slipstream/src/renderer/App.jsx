import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FloatingPanel from './components/FloatingPanel';
import ClipboardResidueRiskNotice from './components/ClipboardResidueRiskNotice';
import ClipboardActionNotice from './components/ClipboardActionNotice';
import AppQuitDialog from './components/AppQuitDialog';
import SetupGate from './components/SetupGate';
import StartupRecovery from './components/StartupRecovery';
import {
  LazyWorkspaceBoundary,
  SettingsWorkspaceRecovery,
} from './components/LazyWorkspaceRecovery';
import { useSettings } from './hooks/useSettings';
import { useIpc } from '@renderer-ipc';
import { isSetupComplete } from './utils/setupReadiness.mjs';
import {
  createRetryableLazyImport,
  importRetryableWorkspaceAsset,
} from './utils/retryableLazyImport.mjs';
import {
  EMPTY_QUIT_RISK,
  hasQuitRisk,
  mergeQuitRisks,
  normalizeQuitRisk,
} from './utils/quitSafety.mjs';
import { FULL_DATA_RESET_ERROR_CODES } from './utils/fullDataResetErrorCodes.mjs';
import {
  beginClipboardCopy,
  clipboardCopyConsequenceId,
  dismissClipboardNotice,
  hasClipboardCopyConsequence,
  settleClipboardCopyFailure,
  settleClipboardCopySuccess,
} from './utils/clipboardNotice.mjs';
import {
  CLIPBOARD_RESIDUE_RISK_COPY,
  clipboardResidueAcknowledgementSucceeded,
  clipboardResidueRiskFromRecoveryStatus,
  clipboardResidueRiskMatches,
  normalizeClipboardResidueRisk,
} from './utils/clipboardResidueRisk.mjs';
import constants from '../shared/constants';

const { IPC_CHANNELS } = constants;

const workspaceFixtureRun = new URLSearchParams(window.location.search).get('run');
const LAZY_WORKSPACE_RECOVERY_FIXTURE = import.meta.env.DEV
  && workspaceFixtureRun === 'lazy-workspace-recovery-native';
const SETTINGS_STYLESHEET_RECOVERY_FIXTURE = import.meta.env.DEV
  && [
    'result-stylesheet-recovery-native',
    'settings-stylesheet-collision-native',
  ].includes(workspaceFixtureRun);
function waitForSettingsWorkspaceStyles(moduleLoader) {
  return moduleLoader().then((settingsModule) => (
    Promise.resolve(settingsModule.settingsWorkspaceStylesheetReady)
      .then(() => settingsModule)
  ));
}

const settingsPanelImport = createRetryableLazyImport(
  import.meta.env.DEV
    ? [
      LAZY_WORKSPACE_RECOVERY_FIXTURE
        ? () => waitForSettingsWorkspaceStyles(
          () => import('./components/SettingsPanel?workspace-load=settings-fixture-primary'),
        )
        : SETTINGS_STYLESHEET_RECOVERY_FIXTURE
          ? () => waitForSettingsWorkspaceStyles(
            () => import('./components/SettingsPanel?workspace-load=settings-style-fixture-primary'),
          )
          : () => waitForSettingsWorkspaceStyles(
            () => import('./components/SettingsPanel'),
          ),
      () => waitForSettingsWorkspaceStyles(
        () => import('./components/SettingsPanel?workspace-load=settings-style-retry&workspace-attempt=1'),
      ),
    ]
    : [
      () => waitForSettingsWorkspaceStyles(() => import('./components/SettingsPanel')),
      () => waitForSettingsWorkspaceStyles(
        () => importRetryableWorkspaceAsset('SettingsPanel.js', 1),
      ),
    ],
);

function preloadSettingsPanel() {
  return settingsPanelImport.load();
}

function prepareSettingsPanel() {
  void preloadSettingsPanel().catch(() => false);
}

function createSettingsPanel() {
  return React.lazy(preloadSettingsPanel);
}

function SettingsWorkspaceFallback() {
  const fallbackRef = useRef(null);

  useEffect(() => {
    fallbackRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <main
      ref={fallbackRef}
      className="setup-gate setup-gate--loading"
      aria-busy="true"
      aria-labelledby="settings-workspace-loading-title"
      tabIndex={-1}
    >
      <div className="setup-loading-mark" aria-hidden="true">S</div>
      <p id="settings-workspace-loading-title" role="status" aria-live="polite">
        正在打开设置…当前任务和输入仍保留。
      </p>
    </main>
  );
}

export default function App() {
  const [view, setView] = useState('panel');
  const [panelSessionStarted, setPanelSessionStarted] = useState(false);
  const [settingsEntryNotice, setSettingsEntryNotice] = useState('');
  const [settingsEntryTarget, setSettingsEntryTarget] = useState('');
  const [settingsCaptureRequest, setSettingsCaptureRequest] = useState(null);
  const [approvedSettingsCapture, setApprovedSettingsCapture] = useState(null);
  const [panelQuitRisk, setPanelQuitRisk] = useState(EMPTY_QUIT_RISK);
  const [settingsQuitRisk, setSettingsQuitRisk] = useState(EMPTY_QUIT_RISK);
  const [clipboardNotice, setClipboardNoticeState] = useState({ status: 'idle' });
  const [clipboardOperation, setClipboardOperation] = useState(null);
  const [rendererRecovered, setRendererRecovered] = useState(false);
  const [clipboardResidueRisk, setClipboardResidueRiskState] = useState(null);
  const [clipboardResidueAcknowledgement, setClipboardResidueAcknowledgement] = useState(null);
  const [clipboardResidueAcknowledgementError, setClipboardResidueAcknowledgementError] = useState('');
  const [panelSessionRecoveryPending, setPanelSessionRecoveryPending] = useState(false);
  const [settingsMenuRequest, setSettingsMenuRequest] = useState(null);
  const [quitRequestId, setQuitRequestIdState] = useState(null);
  const [quitDecisionPending, setQuitDecisionPending] = useState(false);
  const [quitDecisionError, setQuitDecisionError] = useState('');
  const [quitPreviewNotice, setQuitPreviewNotice] = useState('');
  const [quitDialogVisible, setQuitDialogVisible] = useState(false);
  const [settingsWorkspace, setSettingsWorkspace] = useState(() => ({
    attempt: 0,
    Component: createSettingsPanel(),
  }));
  const SettingsPanel = settingsWorkspace.Component;
  const settingsController = useSettings();
  const { invoke, on } = useIpc();
  const setupWindowActiveRef = useRef(false);
  const settingsWorkspaceReadyRef = useRef(false);
  const quitRiskRef = useRef(EMPTY_QUIT_RISK);
  const panelQuitRiskRef = useRef(EMPTY_QUIT_RISK);
  const settingsQuitRiskRef = useRef(EMPTY_QUIT_RISK);
  const quitRequestIdRef = useRef(null);
  const quitDecisionRef = useRef(null);
  const lastSettledQuitRequestIdRef = useRef(null);
  const clipboardNoticeRef = useRef(clipboardNotice);
  const clipboardResidueRiskRef = useRef(clipboardResidueRisk);
  const clipboardResidueRiskMutationRef = useRef(0);
  const clipboardResidueAcknowledgementRef = useRef(null);
  const rendererRecoveryStatusRequestedRef = useRef(false);
  const settingsMenuRequestIdRef = useRef(null);
  const settingsMenuAcknowledgementRef = useRef(null);
  const settingsMenuAcknowledgementTimerRef = useRef(null);
  const clipboardOperationRef = useRef(null);
  const clipboardOperationSequenceRef = useRef(0);
  const fullDataResetControllerRef = useRef(null);
  const setupComplete = isSetupComplete(settingsController.settings);
  const settingsReady = settingsController.loadStatus === 'ready';
  const runtimeStatus = settingsController.settings.runtimeStatus || {};
  const runtimeDegraded = settingsReady && (
    runtimeStatus.trayAvailable === false
    || runtimeStatus.clipboardMonitoringDisabled === true
    || runtimeStatus.clipboardMonitoringDisablePersistFailed === true
  );
  const runtimeMessages = [
    runtimeStatus.trayAvailable === false
      ? '菜单栏入口暂时不可用，当前窗口会保持可访问；请重新打开 Slipstream 后再试。'
      : '',
    runtimeStatus.clipboardMonitoringDisabled === true
      ? '剪贴板自动检测已安全保持关闭，可在设置中重新开启。'
      : '',
    runtimeStatus.clipboardMonitoringDisablePersistFailed === true
      ? '本次自动检测没有启动，但关闭状态未能保存；重新打开后请先检查设置。'
      : '',
  ].filter(Boolean);
  const setClipboardNotice = useCallback((nextOrUpdater) => {
    const current = clipboardNoticeRef.current;
    const next = typeof nextOrUpdater === 'function'
      ? nextOrUpdater(current)
      : nextOrUpdater;
    clipboardNoticeRef.current = next;
    setClipboardNoticeState(next);
    return next;
  }, []);
  const publishClipboardResidueRisk = useCallback((nextOrUpdater) => {
    const current = clipboardResidueRiskRef.current;
    const candidate = typeof nextOrUpdater === 'function'
      ? nextOrUpdater(current)
      : nextOrUpdater;
    const next = normalizeClipboardResidueRisk(candidate);
    clipboardResidueRiskMutationRef.current += 1;
    clipboardResidueRiskRef.current = next;
    setClipboardResidueRiskState(next);
    if (!next) {
      clipboardResidueAcknowledgementRef.current = null;
      setClipboardResidueAcknowledgement(null);
      setClipboardResidueAcknowledgementError('');
    }
    return next;
  }, []);
  const publishQuitRequestId = useCallback((requestId) => {
    const next = typeof requestId === 'string' ? requestId : null;
    quitRequestIdRef.current = next;
    setQuitRequestIdState(next);
    return next;
  }, []);
  const clearCurrentQuitRequest = useCallback((requestId) => {
    if (quitRequestIdRef.current !== requestId) return false;
    publishQuitRequestId(null);
    setQuitDialogVisible(false);
    return true;
  }, [publishQuitRequestId]);
  const beginQuitDecision = useCallback((requestId) => {
    if (quitRequestIdRef.current !== requestId || quitDecisionRef.current) return null;
    const decision = Object.freeze({ requestId });
    quitDecisionRef.current = decision;
    setQuitDecisionPending(true);
    return decision;
  }, []);
  const finishQuitDecision = useCallback((decision) => {
    if (quitDecisionRef.current !== decision) return false;
    quitDecisionRef.current = null;
    setQuitDecisionPending(false);
    return true;
  }, []);
  const supersedeQuitDecision = useCallback((requestId) => {
    const current = quitDecisionRef.current;
    if (!current || current.requestId === requestId) return false;
    quitDecisionRef.current = null;
    setQuitDecisionPending(false);
    return true;
  }, []);
  const clipboardOperationPending = Boolean(clipboardOperation);
  const clipboardWritePending = clipboardOperation?.type === 'write';
  const clipboardAcknowledgementPending = clipboardOperation?.type === 'acknowledge';
  const hasClipboardConsequence = hasClipboardCopyConsequence(clipboardNotice);
  const hasClipboardResidueRisk = Boolean(clipboardResidueRisk);
  const clipboardQuitRisk = useMemo(() => normalizeQuitRisk({
    hasPendingClipboardWrite: clipboardWritePending,
    hasPendingClipboardAcknowledgement: clipboardAcknowledgementPending,
    hasClipboardCopyConsequence: hasClipboardConsequence,
    hasClipboardResidueRisk,
  }), [
    clipboardAcknowledgementPending,
    clipboardWritePending,
    hasClipboardConsequence,
    hasClipboardResidueRisk,
  ]);
  const mergedQuitRisk = useMemo(
    () => mergeQuitRisks(panelQuitRisk, settingsQuitRisk, clipboardQuitRisk),
    [clipboardQuitRisk, panelQuitRisk, settingsQuitRisk]
  );
  const quitDialogRisk = mergedQuitRisk;

  const refreshImmediateQuitRisk = useCallback(() => {
    const operation = clipboardOperationRef.current;
    quitRiskRef.current = mergeQuitRisks(
      panelQuitRiskRef.current,
      settingsQuitRiskRef.current,
      {
        hasPendingClipboardWrite: operation?.type === 'write',
        hasPendingClipboardAcknowledgement: operation?.type === 'acknowledge',
        hasClipboardCopyConsequence: hasClipboardCopyConsequence(clipboardNoticeRef.current),
        hasClipboardResidueRisk: Boolean(clipboardResidueRiskRef.current),
      },
    );
    return quitRiskRef.current;
  }, []);

  const handlePanelQuitRiskChange = useCallback((risk) => {
    const next = normalizeQuitRisk(risk);
    panelQuitRiskRef.current = next;
    refreshImmediateQuitRisk();
    setPanelQuitRisk(next);
  }, [refreshImmediateQuitRisk]);
  const handleSettingsQuitRiskChange = useCallback((risk) => {
    const next = normalizeQuitRisk(risk);
    settingsQuitRiskRef.current = next;
    refreshImmediateQuitRisk();
    setSettingsQuitRisk(next);
  }, [refreshImmediateQuitRisk]);
  const handleFullDataResetControllerChange = useCallback((controller) => {
    fullDataResetControllerRef.current = controller;
  }, []);

  const acknowledgeClipboardResidueRisk = useCallback(async () => {
    const risk = clipboardResidueRiskRef.current;
    if (!risk) return { status: 'not-applicable' };
    if (clipboardResidueAcknowledgementRef.current) return { status: 'busy' };

    const operation = Object.freeze({ id: risk.id });
    clipboardResidueAcknowledgementRef.current = operation;
    setClipboardResidueAcknowledgement(operation);
    setClipboardResidueAcknowledgementError('');
    try {
      const response = await invoke(IPC_CHANNELS.APP_CLIPBOARD_RESIDUE_RISK_ACK, {
        id: operation.id,
      });
      if (!clipboardResidueRiskMatches(clipboardResidueRiskRef.current, operation)) {
        return response;
      }
      if (!clipboardResidueAcknowledgementSucceeded(response)) {
        setClipboardResidueAcknowledgementError(
          CLIPBOARD_RESIDUE_RISK_COPY.acknowledgementError,
        );
        return response;
      }
      publishClipboardResidueRisk(null);
      return response;
    } catch (cause) {
      if (clipboardResidueRiskMatches(clipboardResidueRiskRef.current, operation)) {
        setClipboardResidueAcknowledgementError(
          CLIPBOARD_RESIDUE_RISK_COPY.acknowledgementError,
        );
      }
      return { status: 'error', cause };
    } finally {
      if (clipboardResidueAcknowledgementRef.current === operation) {
        clipboardResidueAcknowledgementRef.current = null;
        setClipboardResidueAcknowledgement(null);
      }
    }
  }, [invoke, publishClipboardResidueRisk]);

  useEffect(() => {
    if (rendererRecoveryStatusRequestedRef.current) return;
    rendererRecoveryStatusRequestedRef.current = true;
    const mutationAtRequest = clipboardResidueRiskMutationRef.current;
    invoke(IPC_CHANNELS.APP_RENDERER_RECOVERY_STATUS_GET)
      .then((response) => {
        if (response?.recovered === true) setRendererRecovered(true);
        const recoveredRisk = clipboardResidueRiskFromRecoveryStatus(response);
        // A confirmed write or an explicit settlement while this request was
        // in flight must not be overwritten by stale recovery metadata.
        if (
          recoveredRisk
          && clipboardResidueRiskMutationRef.current === mutationAtRequest
        ) {
          publishClipboardResidueRisk(recoveredRisk);
        }
      })
      .catch(() => false);
  }, [invoke, publishClipboardResidueRisk]);

  const canAutomaticallyConfirmQuit = useCallback((requestId) => {
    if (quitRequestIdRef.current !== requestId) return false;
    const operation = clipboardOperationRef.current;
    const hasCurrentConsequence = hasClipboardCopyConsequence(clipboardNoticeRef.current);
    const currentRisk = normalizeQuitRisk({
      ...quitRiskRef.current,
      hasPendingClipboardWrite: operation?.type === 'write',
      hasPendingClipboardAcknowledgement: operation?.type === 'acknowledge',
      hasClipboardCopyConsequence: hasCurrentConsequence,
      hasClipboardResidueRisk: Boolean(clipboardResidueRiskRef.current),
    });
    return !operation
      && !hasCurrentConsequence
      && !hasQuitRisk(currentRisk);
  }, []);

  const confirmQuitRequestAutomatically = useCallback(async (requestId) => {
    if (!canAutomaticallyConfirmQuit(requestId)) return false;
    const decision = beginQuitDecision(requestId);
    if (!decision) return false;
    setQuitDecisionError('');
    try {
      const response = await invoke(IPC_CHANNELS.APP_QUIT_DECISION, {
        requestId,
        confirmed: true,
      });
      if (quitRequestIdRef.current !== requestId) return false;
      if (response?.status === 'clipboard-consequence-unconfirmed') {
        const recoveredRisk = clipboardResidueRiskFromRecoveryStatus({
          clipboardResidueRisk: response.clipboardConsequence,
        });
        if (recoveredRisk) publishClipboardResidueRisk(recoveredRisk);
        setQuitDialogVisible(true);
        setQuitDecisionError(
          '应用刚刚补回了上次复制的剪贴板后果；不会自动退出。请检查说明后，明确选择保留当前剪贴板并退出。',
        );
        return true;
      }
      if (response?.status === 'preview-confirmed') {
        setQuitPreviewNotice('预览状态：真实应用此时会安全退出。');
      }
      if (response?.status === 'confirmed' || response?.status === 'preview-confirmed') {
        setSettingsCaptureRequest(null);
        setApprovedSettingsCapture(null);
        lastSettledQuitRequestIdRef.current = requestId;
        clearCurrentQuitRequest(requestId);
      } else {
        setQuitDialogVisible(true);
        setQuitDecisionError(response?.status === 'invalid'
          ? '这次退出请求已经失效；当前会话仍保留，请重新从菜单栏退出。'
          : '没有收到应用的退出确认；当前会话仍保留，可以重试。');
      }
      return true;
    } catch {
      if (quitRequestIdRef.current === requestId) {
        setQuitDialogVisible(true);
        setQuitDecisionError('没有收到应用的退出确认；当前会话仍保留，可以重试。');
      }
      return false;
    } finally {
      finishQuitDecision(decision);
    }
  }, [
    beginQuitDecision,
    canAutomaticallyConfirmQuit,
    clearCurrentQuitRequest,
    finishQuitDecision,
    invoke,
    publishClipboardResidueRisk,
  ]);

  // The ref is the synchronous cross-entry mutex; React state only presents its
  // metadata. The operation record never stores copied plaintext.
  const handleClipboardCopy = useCallback(async ({
    kind,
    text,
    onBegin,
    onSuccess,
    onFailure,
  } = {}) => {
    if (typeof kind !== 'string' || !kind || typeof text !== 'string' || !text.trim()) {
      const error = new Error('clipboard-copy-invalid');
      error.code = 'clipboard-copy-invalid';
      throw error;
    }
    if (clipboardOperationRef.current) {
      const error = new Error('clipboard-write-pending');
      error.code = 'clipboard-write-pending';
      throw error;
    }

    const requestId = clipboardOperationSequenceRef.current + 1;
    clipboardOperationSequenceRef.current = requestId;
    const operation = { id: requestId, type: 'write', kind };
    clipboardOperationRef.current = operation;
    setClipboardOperation(operation);
    invoke(IPC_CHANNELS.APP_SESSION_RISK_UPDATE, { hasRisk: true }).catch(() => false);
    let began = false;

    try {
      const previousNotice = clipboardNoticeRef.current;
      const pendingNotice = onBegin
        ? onBegin({ requestId, previousNotice })
        : beginClipboardCopy({ kind, requestId, previousNotice });
      if (!pendingNotice) {
        const error = new Error('clipboard-copy-invalid');
        error.code = 'clipboard-copy-invalid';
        throw error;
      }
      began = true;
      setClipboardNotice(pendingNotice);

      const response = await invoke(IPC_CHANNELS.CLIPBOARD_WRITE, text);
      // A confirmed App write replaces the prior metadata-only consequence.
      // Failed writes must leave the prior consequence and recovery warning intact.
      publishClipboardResidueRisk(null);
      const currentNotice = clipboardNoticeRef.current;
      const settledNotice = onSuccess
        ? onSuccess({ requestId, response, notice: currentNotice })
        : settleClipboardCopySuccess(currentNotice, response, { requestId });
      setClipboardNotice(settledNotice || currentNotice);
      return settledNotice || currentNotice;
    } catch (cause) {
      if (began) {
        const currentNotice = clipboardNoticeRef.current;
        const settledNotice = onFailure
          ? onFailure({ requestId, error: cause, notice: currentNotice })
          : settleClipboardCopyFailure(currentNotice, { requestId });
        setClipboardNotice(settledNotice || currentNotice);
      }
      const error = new Error('clipboard-write-failed');
      error.code = cause?.code === 'clipboard-copy-invalid'
        ? 'clipboard-copy-invalid'
        : 'clipboard-write-failed';
      error.clipboardManaged = began;
      throw error;
    } finally {
      if (clipboardOperationRef.current?.id === requestId) {
        clipboardOperationRef.current = null;
        setClipboardOperation(null);
      }
    }
  }, [invoke, publishClipboardResidueRisk, setClipboardNotice]);

  const acknowledgeClipboardCopyConsequence = useCallback(async (expectedId = null) => {
    if (clipboardOperationRef.current) return { status: 'busy' };
    if (clipboardResidueRiskRef.current) return { status: 'residue-risk' };
    const currentNotice = clipboardNoticeRef.current;
    const consequenceId = clipboardCopyConsequenceId(currentNotice);
    const requestedId = typeof expectedId === 'string' ? expectedId : null;
    if (!consequenceId || (requestedId && requestedId !== consequenceId)) {
      return { status: 'invalid' };
    }

    const requestId = clipboardOperationSequenceRef.current + 1;
    clipboardOperationSequenceRef.current = requestId;
    const operation = {
      id: requestId,
      type: 'acknowledge',
      kind: currentNotice.kind,
      consequenceId,
    };
    clipboardOperationRef.current = operation;
    setClipboardOperation(operation);
    invoke(IPC_CHANNELS.APP_SESSION_RISK_UPDATE, { hasRisk: true }).catch(() => false);
    setClipboardNotice((notice) => (
      clipboardCopyConsequenceId(notice) === consequenceId
        ? { ...notice, acknowledgementPending: true, acknowledgementError: '', dismissed: false }
        : notice
    ));

    try {
      const response = await invoke(IPC_CHANNELS.APP_CLIPBOARD_RESIDUE_RISK_ACK, {
        id: consequenceId,
      });
      setClipboardNotice((notice) => (
        clipboardCopyConsequenceId(notice) === consequenceId
          ? response?.status === 'acknowledged'
            ? {
              kind: notice.kind,
              status: 'acknowledged',
              dismissed: false,
              message: '已确认你在其他位置复制了新内容',
              detail: 'Slipstream 没有读取、清除或覆盖系统剪贴板。',
            }
            : {
              ...notice,
              acknowledgementPending: false,
              acknowledgementError: '没有确认这次手动覆盖；提示会继续保留，请重试。',
              dismissed: false,
            }
          : notice
      ));
      return response;
    } catch (cause) {
      setClipboardNotice((notice) => (
        clipboardCopyConsequenceId(notice) === consequenceId
          ? {
            ...notice,
            acknowledgementPending: false,
            acknowledgementError: '没有确认这次手动覆盖；提示会继续保留，请重试。',
            dismissed: false,
          }
          : notice
      ));
      return { status: 'error', cause };
    } finally {
      if (clipboardOperationRef.current?.id === requestId) {
        clipboardOperationRef.current = null;
        setClipboardOperation(null);
      }
    }
  }, [invoke, setClipboardNotice]);

  const handleWriteClipboard = useCallback((kind, text) => (
    handleClipboardCopy({ kind, text })
  ), [handleClipboardCopy]);

  const handleDismissClipboardNotice = useCallback(() => {
    setClipboardNotice((current) => dismissClipboardNotice(current));
  }, [setClipboardNotice]);

  const acknowledgeSettingsMenuRequest = useCallback((requestId) => {
    if (
      typeof requestId !== 'string'
      || settingsMenuRequestIdRef.current !== requestId
    ) return;
    // Claim the request synchronously before any blocker can disappear. This
    // prevents an asynchronous ACK from turning a no-op into delayed Settings
    // navigation after the user resolves a higher-priority decision.
    setSettingsMenuRequest((current) => (
      current?.requestId === requestId && current.handled !== true
        ? { ...current, handled: true }
        : current
    ));
    if (settingsMenuAcknowledgementRef.current === requestId) return;
    settingsMenuAcknowledgementRef.current = requestId;
    const clearRetryTimer = () => {
      if (settingsMenuAcknowledgementTimerRef.current !== null) {
        window.clearTimeout(settingsMenuAcknowledgementTimerRef.current);
        settingsMenuAcknowledgementTimerRef.current = null;
      }
    };
    const scheduleRetry = () => {
      if (
        settingsMenuRequestIdRef.current !== requestId
        || settingsMenuAcknowledgementRef.current !== requestId
      ) return;
      clearRetryTimer();
      settingsMenuAcknowledgementTimerRef.current = window.setTimeout(attempt, 250);
    };
    const attempt = () => {
      clearRetryTimer();
      invoke(IPC_CHANNELS.APP_SETTINGS_REQUEST_HANDLED, { requestId })
        .then((response) => {
          if (
            settingsMenuRequestIdRef.current === requestId
            && settingsMenuAcknowledgementRef.current === requestId
            && ['acknowledged', 'invalid'].includes(response?.status)
          ) {
            settingsMenuRequestIdRef.current = null;
            settingsMenuAcknowledgementRef.current = null;
            setSettingsMenuRequest(null);
            return;
          }
          scheduleRetry();
        })
        .catch(scheduleRetry);
    };
    attempt();
  }, [invoke]);

  useEffect(() => () => {
    if (settingsMenuAcknowledgementTimerRef.current !== null) {
      window.clearTimeout(settingsMenuAcknowledgementTimerRef.current);
      settingsMenuAcknowledgementTimerRef.current = null;
    }
  }, []);

  const openSettings = (notice = '', target = '') => {
    settingsWorkspaceReadyRef.current = false;
    prepareSettingsPanel();
    setSettingsEntryNotice(typeof notice === 'string' ? notice : '');
    setSettingsEntryTarget(typeof target === 'string' ? target : '');
    setView('settings');
  };
  const closeSettings = () => {
    settingsWorkspaceReadyRef.current = false;
    setSettingsEntryNotice('');
    setSettingsEntryTarget('');
    setView(setupComplete || panelSessionStarted ? 'panel' : 'setup');
  };

  useEffect(() => {
    const requestId = settingsMenuRequest?.requestId;
    if (!requestId || settingsController.loadStatus === 'loading') return;
    if (
      !settingsReady
      || quitRequestId
      || clipboardResidueRisk
      || panelSessionRecoveryPending
      || view === 'settings'
    ) {
      // Startup recovery, clipboard recovery, app quit, and an existing
      // Settings workspace keep ownership. A native menu action never queues a
      // surprise navigation behind those decisions.
      acknowledgeSettingsMenuRequest(requestId);
    }
  }, [
    acknowledgeSettingsMenuRequest,
    clipboardResidueRisk,
    panelSessionRecoveryPending,
    quitRequestId,
    settingsController.loadStatus,
    settingsMenuRequest,
    settingsReady,
    view,
  ]);

  const resetSettingsWorkspace = useCallback(() => {
    if (!settingsPanelImport.reset()) return false;
    setSettingsWorkspace((current) => ({
      attempt: current.attempt + 1,
      Component: createSettingsPanel(),
    }));
    return true;
  }, []);

  const returnFromSettingsFailure = () => {
    resetSettingsWorkspace();
    setSettingsCaptureRequest((current) => current?.origin === 'settings' ? null : current);
    setApprovedSettingsCapture((current) => current?.origin === 'settings' ? null : current);
    closeSettings();
  };

  const handleSettingsWorkspaceReadyChange = useCallback((ready) => {
    settingsWorkspaceReadyRef.current = ready === true;
  }, []);

  const handleHiddenCaptureRequest = useCallback((request) => {
    if (!request?.id || !request?.kind) return;
    const origin = !setupComplete && !panelSessionStarted ? 'setup' : 'settings';
    setSettingsCaptureRequest({
      ...request,
      origin,
      deferredFromSettingsWorkspace: origin === 'settings'
        && view === 'settings'
        && !settingsWorkspaceReadyRef.current,
    });
  }, [panelSessionStarted, setupComplete, view]);

  const handleSettingsCaptureApproved = useCallback((request) => {
    if (!request?.id || !['clipboard', 'screenshot'].includes(request.kind)) return;
    setApprovedSettingsCapture(request);
    setSettingsEntryNotice('');
    setSettingsEntryTarget('');
    setView('panel');
  }, []);

  const settleSettingsCaptureRequest = useCallback((request) => {
    const matches = (current) => Boolean(
      current
      && (
        (request?.id && current.id === request.id)
        || (!request?.id && request?.kind && current.kind === request.kind)
      )
    );
    setApprovedSettingsCapture((current) => matches(current) ? null : current);
    setSettingsCaptureRequest((current) => matches(current) ? null : current);
  }, []);

  const handleApprovedCaptureConsumed = useCallback((request) => {
    settleSettingsCaptureRequest(request);
  }, [settleSettingsCaptureRequest]);

  const dismissSettingsCaptureRequest = useCallback((requestId) => {
    setSettingsCaptureRequest((current) => current?.id === requestId ? null : current);
  }, []);

  useEffect(() => {
    if (
      !settingsCaptureRequest?.deferredFromSettingsWorkspace
      || settingsCaptureRequest.origin !== 'settings'
      || !['clipboard', 'screenshot'].includes(settingsCaptureRequest.kind)
      || quitRequestIdRef.current
      || quitDecisionRef.current
      || approvedSettingsCapture?.id === settingsCaptureRequest.id
    ) return;
    handleSettingsCaptureApproved(settingsCaptureRequest);
  }, [
    approvedSettingsCapture,
    handleSettingsCaptureApproved,
    quitRequestId,
    settingsCaptureRequest,
  ]);

  const purgeRendererSessionForReset = useCallback(async () => {
    const response = await fullDataResetControllerRef.current?.purge?.();
    if (response?.status !== 'cleared') return response;
    setSettingsEntryNotice('');
    setSettingsEntryTarget('');
    setSettingsCaptureRequest(null);
    setApprovedSettingsCapture(null);
    return response;
  }, []);

  const handleResetAllData = useCallback(async ({
    clipboardMode = 'none',
    resetTransaction,
    sessionAlreadyCleared = false,
  } = {}) => {
    if (clipboardOperationRef.current) {
      const error = new Error(FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_OPERATION_PENDING);
      error.code = FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_OPERATION_PENDING;
      error.sessionCleared = Boolean(sessionAlreadyCleared);
      throw error;
    }
    if (typeof resetTransaction !== 'function') {
      const error = new Error(FULL_DATA_RESET_ERROR_CODES.RESET_TRANSACTION_UNAVAILABLE);
      error.code = FULL_DATA_RESET_ERROR_CODES.RESET_TRANSACTION_UNAVAILABLE;
      error.sessionCleared = Boolean(sessionAlreadyCleared);
      throw error;
    }

    const resetHasClipboardCopyConsequence = hasClipboardCopyConsequence(clipboardNoticeRef.current);
    const resetHasClipboardResidueRisk = Boolean(clipboardResidueRiskRef.current);
    const consequenceId = clipboardResidueRiskRef.current?.id
      || clipboardCopyConsequenceId(clipboardNoticeRef.current);
    let result;
    try {
      result = await resetTransaction({
        clipboardMode,
        hasClipboardCopyConsequence: resetHasClipboardCopyConsequence,
        hasClipboardResidueRisk: resetHasClipboardResidueRisk,
        consequenceId,
        sessionAlreadyCleared,
        prepareReset: (payload) => invoke(IPC_CHANNELS.USER_DATA_RESET_PREPARE, payload),
        abortReset: (payload) => invoke(IPC_CHANNELS.USER_DATA_RESET_ABORT, payload),
        purgeSession: purgeRendererSessionForReset,
        resetPersistentData: settingsController.resetSettings,
      });
    } catch (error) {
      const currentMainConsequence = normalizeClipboardResidueRisk(error?.clipboardConsequence);
      if (currentMainConsequence) {
        publishClipboardResidueRisk(currentMainConsequence);
      } else if (Object.hasOwn(error || {}, 'clipboardConsequence')) {
        publishClipboardResidueRisk(null);
        setClipboardNotice((notice) => hasClipboardCopyConsequence(notice)
          ? {
            kind: notice.kind,
            status: 'copy-error',
            consequenceId: null,
            dismissed: false,
            message: '系统剪贴板没有被这次清除操作更改',
            detail: '应用内已没有可核对的复制后果；如内容敏感，请在其他位置复制一段不敏感文字手动覆盖。',
          }
          : notice);
      }
      if (error?.sessionCleared === true) {
        await fullDataResetControllerRef.current
          ?.recoverAfterPersistentResetFailure?.()
          .catch(() => false);
      }
      throw error;
    }

    // Main consumed a one-shot reset ticket whose clipboard snapshot was
    // pinned before renderer session data was touched.
    fullDataResetControllerRef.current?.confirmPersistentReset?.();
    publishClipboardResidueRisk(null);
    setPanelSessionStarted(false);
    panelQuitRiskRef.current = EMPTY_QUIT_RISK;
    settingsQuitRiskRef.current = EMPTY_QUIT_RISK;
    refreshImmediateQuitRisk();
    setPanelQuitRisk(EMPTY_QUIT_RISK);
    setSettingsQuitRisk(EMPTY_QUIT_RISK);
    setSettingsEntryNotice('');
    setSettingsEntryTarget('');
    setSettingsCaptureRequest(null);
    setApprovedSettingsCapture(null);
    setClipboardNotice({ status: 'idle' });
    setView('setup');
    return result;
  }, [
    invoke,
    publishClipboardResidueRisk,
    purgeRendererSessionForReset,
    refreshImmediateQuitRisk,
    setClipboardNotice,
    settingsController.resetSettings,
  ]);

  useEffect(() => {
    if (!settingsReady) return;
    if (setupComplete) setPanelSessionStarted(true);
  }, [settingsReady, setupComplete]);

  useEffect(() => {
    if (!settingsReady || !settingsController.recoveryNotice) return;
    setPanelSessionStarted(false);
    setSettingsEntryNotice('');
    setSettingsEntryTarget('');
    setSettingsCaptureRequest(null);
    setApprovedSettingsCapture(null);
    setView('setup');
  }, [settingsController.recoveryNotice, settingsReady]);

  useEffect(() => {
    if (!setupComplete) return;
    setSettingsCaptureRequest((current) => current?.origin === 'setup' ? null : current);
  }, [setupComplete]);

  useEffect(() => {
    if (!settingsReady) return;
    if (!setupComplete && !panelSessionStarted && view !== 'settings') {
      setupWindowActiveRef.current = true;
      invoke(IPC_CHANNELS.WINDOW_SET_MODE, 'setup').catch(() => false);
      return;
    }
    if ((setupComplete || panelSessionStarted) && setupWindowActiveRef.current) {
      setupWindowActiveRef.current = false;
      invoke(IPC_CHANNELS.WINDOW_SET_MODE, 'capture').catch(() => false);
    }
  }, [invoke, panelSessionStarted, settingsReady, setupComplete, view]);

  useEffect(() => {
    const currentRisk = refreshImmediateQuitRisk();
    invoke(IPC_CHANNELS.APP_SESSION_RISK_UPDATE, {
      hasRisk: hasQuitRisk(currentRisk),
    }).catch(() => false);
  }, [invoke, quitDialogRisk, refreshImmediateQuitRisk]);

  useEffect(() => {
    let active = true;
    const receiveSettingsRequest = (payload) => {
      if (!active) return;
      const requestId = payload?.requestId;
      if (typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 100) return;
      settingsMenuRequestIdRef.current = requestId;
      setSettingsMenuRequest((current) => ({
        requestId,
        delivery: current?.requestId === requestId ? current.delivery + 1 : 1,
        handled: current?.requestId === requestId ? current.handled === true : false,
      }));
    };
    // Subscribe before announcing readiness so a Command+, pressed during the
    // first renderer frames is replayed with the same opaque request id.
    const unsubscribe = on(IPC_CHANNELS.APP_SETTINGS_REQUESTED, receiveSettingsRequest);
    let readyRetryTimer = null;
    const announceReady = () => {
      invoke(IPC_CHANNELS.APP_SETTINGS_LISTENER_READY).catch(() => {
        if (!active) return;
        readyRetryTimer = window.setTimeout(announceReady, 250);
      });
    };
    announceReady();
    return () => {
      active = false;
      if (readyRetryTimer !== null) window.clearTimeout(readyRetryTimer);
      unsubscribe();
    };
  }, [invoke, on]);

  useEffect(() => {
    let active = true;
    const scheduledFrames = new Set();
    const receiveQuitRequest = (payload) => {
      if (!active) return;
      const requestId = payload?.requestId;
      if (typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 100) return;
      if (lastSettledQuitRequestIdRef.current === requestId) return;
      if (quitRequestIdRef.current === requestId) return;
      supersedeQuitDecision(requestId);
      publishQuitRequestId(requestId);
      setQuitDialogVisible(false);
      setQuitDecisionError('');
      setQuitPreviewNotice('');

      const firstFrame = window.requestAnimationFrame(() => {
        scheduledFrames.delete(firstFrame);
        const secondFrame = window.requestAnimationFrame(() => {
          scheduledFrames.delete(secondFrame);
          if (!active || quitRequestIdRef.current !== requestId) return;
          if (canAutomaticallyConfirmQuit(requestId)) {
            confirmQuitRequestAutomatically(requestId);
            return;
          }
          setQuitDialogVisible(true);
        });
        scheduledFrames.add(secondFrame);
      });
      scheduledFrames.add(firstFrame);
    };
    // Subscribe before announcing readiness. The main process replays any
    // pending request on this event channel so Command+Q cannot be lost during
    // the first render, without a late Promise re-injecting a settled id.
    const unsubscribe = on(IPC_CHANNELS.APP_QUIT_REQUESTED, receiveQuitRequest);
    invoke(IPC_CHANNELS.APP_QUIT_LISTENER_READY)
      .catch(() => false);

    return () => {
      active = false;
      scheduledFrames.forEach((frame) => window.cancelAnimationFrame(frame));
      unsubscribe();
    };
  }, [
    canAutomaticallyConfirmQuit,
    confirmQuitRequestAutomatically,
    invoke,
    on,
    publishQuitRequestId,
    supersedeQuitDecision,
  ]);

  const handleQuitDecision = useCallback(async (confirmed) => {
    const requestId = quitRequestId;
    if (!requestId || quitRequestIdRef.current !== requestId) return;
    const decision = beginQuitDecision(requestId);
    if (!decision) return;
    setQuitDecisionError('');
    try {
      const currentConsequenceId = clipboardResidueRiskRef.current?.id
        || clipboardCopyConsequenceId(clipboardNoticeRef.current);
      const response = await invoke(IPC_CHANNELS.APP_QUIT_DECISION, {
        requestId,
        confirmed,
        ...(confirmed && currentConsequenceId
          ? { clipboardConsequenceId: currentConsequenceId }
          : {}),
      });
      if (quitRequestIdRef.current !== requestId) return;
      if (response?.status === 'clipboard-consequence-unconfirmed') {
        const recoveredRisk = clipboardResidueRiskFromRecoveryStatus({
          clipboardResidueRisk: response.clipboardConsequence,
        });
        if (recoveredRisk) publishClipboardResidueRisk(recoveredRisk);
        setQuitDecisionError(
          '上次复制的剪贴板后果尚未确认；应用不会退出。请检查更新后的说明，再明确选择保留当前剪贴板并退出。',
        );
        return;
      }
      if (confirmed && response?.status === 'preview-confirmed') {
        setQuitPreviewNotice('预览状态：真实应用此时会按上述说明安全退出；本地预览保持打开。');
      }
      if (confirmed && ['confirmed', 'preview-confirmed'].includes(response?.status)) {
        setSettingsCaptureRequest(null);
        setApprovedSettingsCapture(null);
      }
      if (['cancelled', 'confirmed', 'preview-confirmed'].includes(response?.status)) {
        lastSettledQuitRequestIdRef.current = requestId;
        clearCurrentQuitRequest(requestId);
      } else if (response?.status === 'invalid') {
        setQuitDecisionError('这次退出请求已经失效；当前会话仍保留，请重新从菜单栏退出。');
      } else {
        setQuitDecisionError('没有收到有效的退出确认；当前会话仍保留，可以重试或继续使用。');
      }
    } catch {
      if (quitRequestIdRef.current === requestId) {
        setQuitDecisionError('没有收到应用的退出确认；当前会话仍保留，可以重试或继续使用。');
      }
    } finally {
      finishQuitDecision(decision);
    }
  }, [
    beginQuitDecision,
    clearCurrentQuitRequest,
    finishQuitDecision,
    invoke,
    publishClipboardResidueRisk,
    quitRequestId,
  ]);

  useEffect(() => {
    if (
      !quitRequestId
      || !quitDialogVisible
      || quitDecisionPending
      || quitDecisionError
      || hasQuitRisk(quitDialogRisk)
    ) return;
    confirmQuitRequestAutomatically(quitRequestId);
  }, [
    confirmQuitRequestAutomatically,
    quitDecisionError,
    quitDecisionPending,
    quitDialogRisk,
    quitDialogVisible,
    quitRequestId,
  ]);

  const style = {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'transparent',
  };

  let content;
  let panelOwnsGlobalNotices = false;
  if (settingsController.loadStatus === 'loading') {
    content = <SetupGate settingsController={settingsController} loading />;
  } else if (!settingsReady) {
    content = (
      <StartupRecovery
        status={settingsController.loadStatus}
        errorCode={settingsController.loadErrorCode}
        onRetry={settingsController.retrySettingsLoad}
        onRecoverFresh={settingsController.recoverFreshSettings}
      />
    );
  } else {
    const showSetupGate = !setupComplete && view !== 'settings' && !panelSessionStarted;
    const showPanel = view !== 'settings' && !showSetupGate;
    panelOwnsGlobalNotices = showPanel;
    content = (
      <>
        <div
          hidden={!showPanel}
          aria-hidden={!showPanel}
          style={{
            display: showPanel ? 'flex' : 'none',
            width: '100%',
            minWidth: 0,
            flex: 1,
            minHeight: 0,
          }}
        >
          <FloatingPanel
            visible={showPanel}
            captureDecisionBlocked={Boolean(quitRequestId)}
            onOpenSettings={openSettings}
            onPrepareSettings={prepareSettingsPanel}
            onQuitRiskChange={handlePanelQuitRiskChange}
            clipboardNotice={clipboardNotice}
            clipboardOperationPending={clipboardOperationPending}
            onClipboardNoticeChange={setClipboardNotice}
            onClipboardCopy={handleClipboardCopy}
            onAcknowledgeClipboardConsequence={hasClipboardResidueRisk
              ? null
              : acknowledgeClipboardCopyConsequence}
            onFullDataResetControllerChange={handleFullDataResetControllerChange}
            onHiddenCaptureRequest={handleHiddenCaptureRequest}
            onPendingCaptureSettled={settleSettingsCaptureRequest}
            approvedCaptureRequest={approvedSettingsCapture}
            onApprovedCaptureConsumed={handleApprovedCaptureConsumed}
            rendererRecovered={rendererRecovered}
            clipboardResidueRisk={clipboardResidueRisk}
            clipboardResidueRiskPending={Boolean(clipboardResidueAcknowledgement)}
            clipboardResidueRiskError={clipboardResidueAcknowledgementError}
            onAcknowledgeClipboardResidueRisk={acknowledgeClipboardResidueRisk}
            runtimeAlertMessages={runtimeDegraded ? runtimeMessages : []}
            onSessionRecoveryPendingChange={setPanelSessionRecoveryPending}
            settingsMenuRequest={showPanel
              && !quitRequestId
              && !clipboardResidueRisk
              && !panelSessionRecoveryPending
              && settingsMenuRequest?.handled !== true
              ? settingsMenuRequest
              : null}
            onSettingsMenuRequestHandled={acknowledgeSettingsMenuRequest}
            settingsController={settingsController}
          />
        </div>
        {showSetupGate && (
          <SetupGate
            settingsController={settingsController}
            onConfigureFull={() => openSettings()}
            onPrepareFull={prepareSettingsPanel}
            recoveryNotice={settingsController.recoveryNotice}
            onDismissRecoveryNotice={settingsController.dismissRecoveryNotice}
            settingsMenuRequest={!quitRequestId
              && !clipboardResidueRisk
              && !panelSessionRecoveryPending
              && settingsMenuRequest?.handled !== true
              ? settingsMenuRequest
              : null}
            onSettingsMenuRequestHandled={acknowledgeSettingsMenuRequest}
            captureRequest={settingsCaptureRequest?.origin === 'setup'
              ? settingsCaptureRequest
              : null}
          />
        )}
        {view === 'settings' && (
          <div style={{ display: 'flex', width: '100%', minWidth: 0, flex: 1, minHeight: 0 }}>
            <LazyWorkspaceBoundary
              key={settingsWorkspace.attempt}
              fallback={(
                <SettingsWorkspaceRecovery
                  onRetry={resetSettingsWorkspace}
                  onReturn={returnFromSettingsFailure}
                  retryAvailable={settingsPanelImport.canRetry()}
                  returnLabel={setupComplete || panelSessionStarted
                    ? '返回主面板'
                    : '返回首次使用选择'}
                />
              )}
            >
              <React.Suspense fallback={<SettingsWorkspaceFallback />}>
                <SettingsPanel
                  onClose={closeSettings}
                  onSetupComplete={() => setView('panel')}
                  onQuitRiskChange={handleSettingsQuitRiskChange}
                  entryNotice={settingsEntryNotice}
                  entryTarget={settingsEntryTarget}
                  captureRequest={settingsCaptureRequest}
                  appDecisionBlocked={Boolean(quitRequestId)}
                  onCaptureRequestApproved={handleSettingsCaptureApproved}
                  onCaptureRequestDismissed={dismissSettingsCaptureRequest}
                  clipboardNotice={clipboardNotice}
                  onWriteClipboard={handleWriteClipboard}
                  onAcknowledgeClipboardConsequence={hasClipboardResidueRisk
                    ? null
                    : acknowledgeClipboardCopyConsequence}
                  onDismissClipboardNotice={handleDismissClipboardNotice}
                  hasClipboardCopyConsequence={hasClipboardConsequence}
                  hasClipboardResidueRisk={hasClipboardResidueRisk}
                  clipboardWritePending={clipboardOperationPending}
                  onResetAllData={handleResetAllData}
                  settingsController={settingsController}
                  onWorkspaceReadyChange={handleSettingsWorkspaceReadyChange}
                />
              </React.Suspense>
            </LazyWorkspaceBoundary>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="app-root" style={style}>
      {runtimeDegraded && !panelOwnsGlobalNotices && (
        <div className="app-runtime-alert" role="alert" aria-live="assertive">
          <strong>部分后台功能没有启动</strong>
          <span>{runtimeMessages.join(' ')}</span>
        </div>
      )}
      {clipboardResidueRisk && !panelSessionRecoveryPending && !panelOwnsGlobalNotices && (
        <ClipboardResidueRiskNotice
          pending={Boolean(clipboardResidueAcknowledgement)}
          error={clipboardResidueAcknowledgementError}
          onAcknowledge={acknowledgeClipboardResidueRisk}
        />
      )}
      <div className="app-session-surface">{content}</div>
      {hasClipboardConsequence
        && clipboardNotice.dismissed === true
        && !hasClipboardResidueRisk && (
        <button
          type="button"
          className="app-clipboard-consequence-reminder"
          onClick={() => setClipboardNotice((current) => ({ ...current, dismissed: false }))}
          aria-label="重新打开系统剪贴板保留提示"
        >
          剪贴板内容可能仍保留 · 查看处理方式
        </button>
      )}
      {settingsReady && !setupComplete && !panelSessionStarted && view !== 'settings' && (
        <ClipboardActionNotice
          notice={clipboardNotice}
          onAcknowledge={hasClipboardResidueRisk
            ? null
            : () => acknowledgeClipboardCopyConsequence()}
          onDismiss={handleDismissClipboardNotice}
        />
      )}
      {quitPreviewNotice && <p className="app-quit-preview-notice" role="status">{quitPreviewNotice}</p>}
      {quitRequestId && quitDialogVisible && (
        <AppQuitDialog
          risk={quitDialogRisk}
          pending={quitDecisionPending}
          error={quitDecisionError}
          onCancel={() => handleQuitDecision(false)}
          onConfirm={() => handleQuitDecision(true)}
        />
      )}
    </div>
  );
}
