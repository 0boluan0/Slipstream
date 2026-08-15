import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowClockwise,
  ArrowRight,
  Camera,
  Check,
  ClipboardText,
  HardDrives,
  LockKey,
  Translate,
  WarningCircle,
} from '../phosphorIcons';
import constants from '../../shared/constants';
import { SETUP_MODES } from '../utils/setupReadiness.mjs';
import { describeSetupCaptureIntent } from '../utils/setupCaptureIntent.mjs';
import {
  claimSetupChoice,
  releaseSetupChoice,
  SETUP_CHOICE_ACTIONS,
  TRANSLATION_ONLY_SETUP_KEYS,
} from '../utils/setupChoiceTransaction.mjs';
import './SetupGate.css';

const { LLM_BACKENDS, MODEL_IDS } = constants;

export default function SetupGate({
  settingsController,
  onConfigureFull,
  onPrepareFull,
  captureRequest = null,
  recoveryNotice = null,
  onDismissRecoveryNotice,
  settingsMenuRequest = null,
  onSettingsMenuRequestHandled,
  loading = false,
}) {
  const {
    discardFailedSettings,
    retryFailedSettings,
    saveError,
    updateMultipleSettings,
  } = settingsController;
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [switchingToFull, setSwitchingToFull] = useState(false);
  const [localError, setLocalError] = useState('');
  const choiceLockRef = useRef(null);
  const recoveryNoticeRef = useRef(null);
  const recoveryNoticeFocusedRef = useRef(false);
  const recommendedCtaRef = useRef(null);
  const recommendedCtaFocusClaimedRef = useRef(false);
  const settingsMenuActionRef = useRef(null);
  const captureIntentCopy = describeSetupCaptureIntent(captureRequest);

  useEffect(() => {
    if (!recoveryNotice) {
      recoveryNoticeFocusedRef.current = false;
      return undefined;
    }
    if (recoveryNoticeFocusedRef.current) return undefined;
    let cancelled = false;
    let innerFrame = null;
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => {
        const target = recoveryNoticeRef.current;
        if (cancelled || !target) return;
        target.focus({ preventScroll: true });
        recoveryNoticeFocusedRef.current = document.activeElement === target;
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(outerFrame);
      if (innerFrame !== null) window.cancelAnimationFrame(innerFrame);
    };
  }, [recoveryNotice]);

  useEffect(() => {
    if (
      loading
      || recoveryNotice
      || saving
      || retrying
      || switchingToFull
      || recommendedCtaFocusClaimedRef.current
    ) return undefined;

    let cancelled = false;
    let innerFrame = null;
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => {
        if (cancelled || document.querySelector('[aria-modal="true"]')) return;
        const target = recommendedCtaRef.current;
        if (!target || target.disabled || !target.isConnected || target.closest('[inert]')) return;
        const activeElement = document.activeElement;
        if (
          activeElement
          && activeElement !== document.body
          && activeElement !== document.documentElement
          && activeElement !== target
        ) return;
        target.focus({ preventScroll: true });
        recommendedCtaFocusClaimedRef.current = document.activeElement === target;
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(outerFrame);
      if (innerFrame !== null) window.cancelAnimationFrame(innerFrame);
    };
  }, [loading, recoveryNotice, retrying, saving, switchingToFull]);

  const configureFullAnalysis = useCallback(() => {
    const claim = claimSetupChoice(
      choiceLockRef,
      SETUP_CHOICE_ACTIONS.CONFIGURE_FULL,
    );
    if (!claim) return;
    setSwitchingToFull(true);
    setLocalError('');

    // A failed basic-translation transaction can contain already-confirmed
    // partial writes plus a retry that would later finish setupMode. Revoke
    // that retry before Settings becomes interactive so it cannot overwrite
    // the user's newer choice to configure full analysis.
    try {
      discardFailedSettings(TRANSLATION_ONLY_SETUP_KEYS);
      onConfigureFull();
    } catch {
      releaseSetupChoice(choiceLockRef, claim);
      setSwitchingToFull(false);
      setLocalError('暂时无法打开完整分析设置，请重试。');
    }
  }, [discardFailedSettings, onConfigureFull]);

  const choiceBusy = saving || retrying || switchingToFull;

  useEffect(() => {
    const requestId = settingsMenuRequest?.requestId;
    if (!requestId) return;
    if (settingsMenuActionRef.current === requestId) {
      onSettingsMenuRequestHandled?.(requestId);
      return;
    }
    settingsMenuActionRef.current = requestId;
    if (!loading && !captureRequest && !recoveryNotice && !choiceBusy) {
      configureFullAnalysis();
    }
    // A capture choice, recovery notice, or setup transaction keeps ownership.
    // Command+, is a no-op in those states instead of becoming a delayed jump.
    onSettingsMenuRequestHandled?.(requestId);
  }, [
    captureRequest,
    choiceBusy,
    configureFullAnalysis,
    loading,
    onSettingsMenuRequestHandled,
    recoveryNotice,
    settingsMenuRequest,
  ]);

  if (loading) {
    return (
      <main className="setup-gate setup-gate--loading" aria-busy="true" aria-label="正在读取设置">
        <div className="setup-loading-mark" aria-hidden="true">S</div>
        <p>正在准备 Slipstream…</p>
      </main>
    );
  }

  const chooseTranslationOnly = async () => {
    const claim = claimSetupChoice(
      choiceLockRef,
      SETUP_CHOICE_ACTIONS.SAVE_TRANSLATION_ONLY,
    );
    if (!claim) return;
    setSaving(true);
    setLocalError('');
    try {
      await updateMultipleSettings({
        setupMode: SETUP_MODES.TRANSLATION_ONLY,
        activeBackend: LLM_BACKENDS.FREE_TRANSLATE,
        activeModel: MODEL_IDS[LLM_BACKENDS.FREE_TRANSLATE][0],
        languageHint: 'en',
      });
    } catch {
      setLocalError('暂时无法保存选择，请重试。');
    } finally {
      releaseSetupChoice(choiceLockRef, claim);
      setSaving(false);
    }
  };

  const retrySave = async () => {
    const claim = claimSetupChoice(
      choiceLockRef,
      SETUP_CHOICE_ACTIONS.RETRY_TRANSLATION_ONLY,
    );
    if (!claim) return;
    setRetrying(true);
    setLocalError('');
    try {
      await retryFailedSettings();
    } catch {
      setLocalError('仍然无法保存选择，请检查磁盘状态后再次重试。');
    } finally {
      releaseSetupChoice(choiceLockRef, claim);
      setRetrying(false);
    }
  };

  return (
    <main className="setup-gate">
      <section className="setup-card" aria-labelledby="setup-title">
        <header className="setup-header">
          <span className="setup-eyebrow">首次使用</span>
          <h1 id="setup-title">先选择你希望获得哪种帮助</h1>
          <p>Slipstream V1 读取英文并用中文说明。开始前，请明确选择完整分析或只做基础翻译。</p>
        </header>

        {recoveryNotice && (
          <div
            ref={recoveryNoticeRef}
            className="setup-recovery-notice"
            role="status"
            aria-live="polite"
            tabIndex={-1}
          >
            <span className="setup-recovery-notice__icon" aria-hidden="true">
              <HardDrives size={20} weight="fill" />
            </span>
            <span className="setup-recovery-notice__copy">
              <strong>已使用全新本机设置恢复</strong>
              <small>
                {recoveryNotice.backupCreated
                  ? `原设置文件已在本机归档为“${recoveryNotice.backupFileName}”。`
                  : '本次恢复没有创建归档文件。'}
                之前的设置、API Key 和已保存术语不会自动恢复。
              </small>
            </span>
            {onDismissRecoveryNotice && (
              <button type="button" onClick={onDismissRecoveryNotice}>知道了</button>
            )}
          </div>
        )}

        {captureIntentCopy && (
          <div
            className={`setup-capture-intent is-${captureIntentCopy.tone}`}
            role={captureIntentCopy.tone === 'warning' ? 'alert' : 'status'}
            aria-live={captureIntentCopy.tone === 'warning' ? 'assertive' : 'polite'}
          >
            <span className="setup-capture-intent__icon" aria-hidden="true">
              {captureRequest.kind === 'screenshot'
                ? <Camera size={20} weight="fill" />
                : captureRequest.kind === 'clipboard-error'
                  ? <WarningCircle size={20} weight="fill" />
                  : <ClipboardText size={20} weight="fill" />}
            </span>
            <span>
              <strong>{captureIntentCopy.title}</strong>
              <small>{captureIntentCopy.detail}</small>
            </span>
          </div>
        )}

        <div className="setup-choice-grid">
          <article className="setup-choice setup-choice--recommended">
            <span className="setup-choice-badge">推荐</span>
            <div className="setup-choice-icon" aria-hidden="true"><Check size={22} weight="bold" /></div>
            <div>
              <h2>完整分析</h2>
              <p>不只翻译，还会告诉你接下来具体该做什么。</p>
            </div>
            <ul>
              <li><Check size={15} />完整中文翻译</li>
              <li><Check size={15} />行动步骤、材料与日期</li>
              <li><Check size={15} />陌生术语与社会流程解释</li>
              <li><Check size={15} />每条结论指回英文原文</li>
            </ul>
            <div className="setup-requirements" role="note">
              开始前需已有 API Key，或已安装并准备好 Ollama；在线服务可能收费。
            </div>
            <button
              ref={recommendedCtaRef}
              type="button"
              className="setup-primary"
              disabled={choiceBusy}
              onPointerEnter={onPrepareFull}
              onClick={configureFullAnalysis}
            >
              配置完整分析 <ArrowRight size={17} />
            </button>
          </article>

          <article className="setup-choice setup-choice--basic">
            <div className="setup-choice-icon" aria-hidden="true"><Translate size={22} /></div>
            <div>
              <h2>只用基础翻译</h2>
              <p>无需配置即可翻译，但不会生成完整行动简报。</p>
            </div>
            <div className="setup-limit" role="note">
              不包含行动步骤、材料清单、截止日期、术语解释或流程说明。
            </div>
            <button
              type="button"
              className="setup-secondary"
              disabled={choiceBusy}
              onClick={chooseTranslationOnly}
            >
              {saving ? '正在保存…' : '我明确选择只用基础翻译'}
            </button>
          </article>
        </div>

        {(localError || saveError) && (
          <div className="setup-error" role="alert">
            <span>
              <strong>选择尚未保存</strong>
              {localError || '你的选择仍保留在当前页面，可以直接重试。'}
            </span>
            <button type="button" onClick={retrySave} disabled={choiceBusy} aria-busy={retrying}>
              <ArrowClockwise size={15} weight="bold" />
              {retrying ? '正在重新保存…' : '重试保存'}
            </button>
          </div>
        )}

        <footer className="setup-privacy">
          <LockKey size={15} />
          <span>完整分析会发送给你选择的服务；基础翻译会发送给 Google / MyMemory。只有你主动处理的内容才会发送，剪贴板自动检测默认关闭。</span>
        </footer>
      </section>
    </main>
  );
}
