import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ArrowClockwise,
  CheckCircle,
  HardDrives,
  ShieldCheck,
  WarningCircle,
} from '../phosphorIcons';
import { shouldHandleBackgroundEscape } from '../utils/modalOwnership.mjs';
import './StartupRecovery.css';

const ERROR_DETAILS = Object.freeze({
  'corrupt-json': {
    title: '本机设置文件无法解析',
    detail: '设置文件的内容已损坏或不完整。Slipstream 已停止启动，避免把空白设置写回原文件。',
  },
  'schema-invalid': {
    title: '本机设置格式无法安全使用',
    detail: '读取到的设置不符合当前版本要求。Slipstream 没有猜测或替换其中的值。',
  },
  'migration-failed': {
    title: '本机设置升级没有完成',
    detail: '旧版设置未能安全迁移到当前格式。原设置没有被当作可用配置继续加载。',
  },
  unavailable: {
    title: '暂时无法读取本机设置',
    detail: '本机设置服务当前不可用，Slipstream 无法安全确认你之前的配置。',
  },
  timeout: {
    title: '读取本机设置超时',
    detail: '本机设置在 2 秒内没有返回，可能是应用刚启动或磁盘暂时繁忙。',
  },
  'invalid-response': {
    title: '本机设置返回了无效内容',
    detail: '读取到的设置不完整，Slipstream 已拒绝使用默认值代替你的真实配置。',
  },
});

export default function StartupRecovery({ status, errorCode, onRetry, onRecoverFresh }) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);
  const [pendingAction, setPendingAction] = useState('');
  const [actionError, setActionError] = useState('');
  const retryButtonRef = useRef(null);
  const freshRecoveryButtonRef = useRef(null);
  const confirmationHeadingRef = useRef(null);
  const errorRef = useRef(null);
  const actionPendingRef = useRef(false);
  const focusIntentRef = useRef('retry');
  const detail = ERROR_DETAILS[errorCode] || ERROR_DETAILS.unavailable;
  const isRetrying = status === 'retrying' || pendingAction === 'retry';
  const isRecovering = status === 'recovering' || pendingAction === 'recover';
  const isPending = isRetrying || isRecovering;

  useEffect(() => {
    if (
      status !== 'error'
      || actionError
      || confirmationOpen
      || focusIntentRef.current !== 'retry'
    ) return undefined;
    const frame = window.requestAnimationFrame(() => {
      retryButtonRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [actionError, confirmationOpen, status]);

  useEffect(() => {
    if (status !== 'error') return undefined;
    const focusTarget = confirmationOpen
      ? confirmationHeadingRef.current
      : focusIntentRef.current === 'fresh'
        ? freshRecoveryButtonRef.current
        : null;
    if (!focusTarget) return undefined;
    const frame = window.requestAnimationFrame(() => {
      focusTarget.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [confirmationOpen, status]);

  useEffect(() => {
    if (!actionError) return undefined;
    const frame = window.requestAnimationFrame(() => {
      errorRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [actionError]);

  const handleRetry = async () => {
    if (actionPendingRef.current || isPending) return;
    actionPendingRef.current = true;
    setPendingAction('retry');
    setActionError('');
    try {
      const recovered = await onRetry?.();
      if (!recovered) setActionError('仍然无法安全读取本机设置。你可以再次重试，或按下方步骤使用全新设置恢复。');
    } finally {
      actionPendingRef.current = false;
      setPendingAction('');
    }
  };

  const showRecoveryConfirmation = () => {
    if (actionPendingRef.current || isPending) return;
    focusIntentRef.current = 'confirmation';
    setActionError('');
    setRecoveryConfirmed(false);
    setConfirmationOpen(true);
  };

  const cancelRecoveryConfirmation = useCallback(() => {
    if (actionPendingRef.current || isPending) return;
    focusIntentRef.current = 'fresh';
    setRecoveryConfirmed(false);
    setConfirmationOpen(false);
  }, [isPending]);

  useEffect(() => {
    if (!confirmationOpen || isPending) return undefined;
    const handleKeyDown = (event) => {
      if (!shouldHandleBackgroundEscape(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelRecoveryConfirmation();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [cancelRecoveryConfirmation, confirmationOpen, isPending]);

  const handleRecoverFresh = async () => {
    if (!confirmationOpen || !recoveryConfirmed || actionPendingRef.current || isPending) return;
    actionPendingRef.current = true;
    setPendingAction('recover');
    setActionError('');
    try {
      const recovered = await onRecoverFresh?.();
      if (!recovered) {
        setActionError('没有完成全新恢复。原设置仍保持在安全阻止状态；请重试读取或稍后再次恢复。');
      }
    } finally {
      actionPendingRef.current = false;
      setPendingAction('');
    }
  };

  return (
    <main className="startup-recovery" aria-labelledby="startup-recovery-title">
      <section className="startup-recovery-card">
        <div className="startup-recovery-icon" aria-hidden="true">
          <WarningCircle size={26} weight="fill" />
        </div>

        <header>
          <span className="startup-recovery-eyebrow">启动保护</span>
          <h1 id="startup-recovery-title">{detail.title}</h1>
          <p>
            为避免覆盖已有配置，Slipstream 没有进入首次使用，也没有保存任何新设置。
          </p>
        </header>

        <div className="startup-recovery-status" role={isPending ? 'status' : 'alert'} aria-live="polite">
          <HardDrives size={19} aria-hidden="true" />
          <span>
            <strong>
              {isRecovering
                ? '正在归档并建立全新设置…'
                : isRetrying
                  ? '正在重新读取…'
                  : '当前停在安全状态'}
            </strong>
            {isRecovering
              ? '完成并验证新设置前，不会进入应用。'
              : isRetrying
                ? '正在重新连接本机设置；完成前不会进入应用。'
                : detail.detail}
          </span>
        </div>

        <ul className="startup-recovery-guardrails" aria-label="当前保护措施">
          <li><CheckCircle size={17} weight="fill" />这次启动没有修改设置、API Key 或已保存术语</li>
          <li><ShieldCheck size={17} weight="fill" />不会把空白默认值误当成你的真实配置</li>
        </ul>

        {actionError && (
          <div
            ref={errorRef}
            className="startup-recovery-action-error"
            role="alert"
            aria-live="assertive"
            tabIndex={-1}
          >
            <WarningCircle size={17} weight="fill" aria-hidden="true" />
            <span><strong>操作没有完成</strong>{actionError}</span>
          </div>
        )}

        {!confirmationOpen ? (
          <div className="startup-recovery-actions">
            <button
              ref={retryButtonRef}
              type="button"
              className="startup-recovery-retry"
              onClick={handleRetry}
              disabled={isPending}
              aria-busy={isRetrying}
            >
              <ArrowClockwise size={18} weight="bold" className={isRetrying ? 'is-spinning' : ''} />
              {isRetrying ? '正在重新读取…' : '重试读取本机设置'}
            </button>
            <button
              ref={freshRecoveryButtonRef}
              type="button"
              className="startup-recovery-fresh"
              onClick={showRecoveryConfirmation}
              disabled={isPending}
            >
              使用全新设置恢复
            </button>
          </div>
        ) : (
          <section className="startup-recovery-confirm" aria-labelledby="startup-recovery-confirm-title">
            <span className="startup-recovery-confirm-step">全新恢复 · 第 2 步</span>
            <h2
              ref={confirmationHeadingRef}
              id="startup-recovery-confirm-title"
              tabIndex={-1}
            >
              确认旧数据将不再生效
            </h2>
            <p>
              继续后，之前的设置、API Key 和已保存术语将不再生效。现有的原设置文件会先归档在本机，整个恢复过程不会上传任何内容。
            </p>
            <label className="startup-recovery-confirm-check">
              <input
                type="checkbox"
                checked={recoveryConfirmed}
                onChange={(event) => setRecoveryConfirmed(event.target.checked)}
                disabled={isPending}
              />
              <span>我明白旧数据不会自动恢复，并确认使用全新设置。</span>
            </label>
            <div className="startup-recovery-confirm-actions">
              <button
                type="button"
                className="startup-recovery-cancel"
                onClick={cancelRecoveryConfirmation}
                disabled={isPending}
              >
                返回
              </button>
              <button
                type="button"
                className="startup-recovery-confirm-button"
                onClick={handleRecoverFresh}
                disabled={!recoveryConfirmed || isPending}
                aria-busy={isRecovering}
              >
                {isRecovering ? '正在全新恢复…' : '确认归档并全新开始'}
              </button>
            </div>
          </section>
        )}

        <p className="startup-recovery-help">
          你也可以先重新启动 Slipstream；再次打开时仍会停在这个安全状态，不会自动重置数据。
        </p>
      </section>
    </main>
  );
}
