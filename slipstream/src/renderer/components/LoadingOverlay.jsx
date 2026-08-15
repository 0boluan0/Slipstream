import React, { useEffect, useState } from 'react';
import {
  Bell,
  CloudArrowUp,
  HardDrives,
  LinkSimple,
  ListChecks,
  ShieldCheck,
  SpinnerGap,
  TextAa,
  WarningCircle,
  X,
} from '../phosphorIcons';

const STAGES = [
  { label: '整理完整原文', detail: '保留段落、日期与材料名称', Icon: TextAa },
  { label: '提取行动与术语', detail: '区分原文明示与模型推断', Icon: ListChecks },
  { label: '建立证据映射', detail: '让每条结论都能回到原文', Icon: LinkSimple },
];

const TRANSLATION_STAGES = [
  { label: '读取完整原文', detail: '保留段落、日期与信息顺序', Icon: TextAa },
  { label: '生成基础翻译', detail: '逐句或逐段翻译，不做行动推断', Icon: ListChecks },
  { label: '整理译文顺序', detail: '检查是否遗漏明显段落', Icon: LinkSimple },
];

const CAPTURE_STAGES = [
  { label: '在系统界面框选区域', detail: '只读取你明确选择的屏幕范围', Icon: ListChecks },
  { label: '在本机识别文字', detail: 'OCR 在这台 Mac 上完成，不会上传截图', Icon: ShieldCheck },
  { label: '识别完成后进入分析', detail: '届时才按所选处理方式使用识别出的原文', Icon: LinkSimple },
];

export default function LoadingOverlay({
  visible,
  contextRef,
  sourceSummary,
  onCancel,
  privacyDisclosure,
  returnsToPreviousResult = false,
  isCancelling = false,
  cancelError = '',
  opensSettingsAfterCancel = false,
  translationOnly = false,
  phase = 'analysis',
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [announcedStatus, setAnnouncedStatus] = useState('');
  const isCapturePhase = phase === 'capture';
  const stages = isCapturePhase
    ? CAPTURE_STAGES
    : translationOnly ? TRANSLATION_STAGES : STAGES;
  const cancelLabel = returnsToPreviousResult
    ? '取消并返回上一份结果'
    : isCapturePhase ? '取消截图并保留当前内容' : '取消并保留原文';
  const retryCancelLabel = opensSettingsAfterCancel
    ? '重试停止并打开设置'
    : returnsToPreviousResult
      ? '重试停止并返回上一份结果'
      : '重试停止并保留原文';
  const visibleCancelLabel = isCancelling
    ? '正在确认停止…'
    : cancelError ? retryCancelLabel : cancelLabel;
  const statusMessage = isCancelling
    ? opensSettingsAfterCancel
      ? '正在等待停止确认；确认后会打开设置…'
      : '正在等待应用确认任务已经停止…'
    : isCapturePhase
      ? elapsedSeconds < 2
        ? '正在打开本机截图框选…'
        : elapsedSeconds < 20
          ? '正在等待框选并在本机识别文字…'
          : '本机仍在识别；你可以取消并返回。'
      : elapsedSeconds < 2
        ? '正在准备原文…'
        : elapsedSeconds < 20
          ? '正在等待所选服务返回…'
          : '仍在等待；你可以取消并检查模型设置。';

  useEffect(() => {
    if (!visible) return undefined;
    setElapsedSeconds(0);
    const timer = window.setInterval(() => setElapsedSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase, visible]);

  useEffect(() => {
    if (!visible) return undefined;
    const frame = window.requestAnimationFrame(() => setAnnouncedStatus(statusMessage));
    return () => window.cancelAnimationFrame(frame);
  }, [statusMessage, visible]);

  if (!visible) return null;

  return (
    <section className="processing-card" aria-label="处理进度">
      <div className="processing-card__header">
        <div>
          <p className="eyebrow">{isCapturePhase ? '正在捕获' : '正在处理'}</p>
          <h2 ref={contextRef} id="processing-context-title" tabIndex={-1}>
            {isCapturePhase
              ? '框选截图并在本机识别文字'
              : translationOnly ? '按原文顺序生成完整翻译' : '把原文整理成可追溯的行动结论'}
          </h2>
        </div>
        {onCancel && (
          <button
            type="button"
            className="processing-cancel-button"
            onClick={onCancel}
            aria-label={visibleCancelLabel}
            title={visibleCancelLabel}
            aria-busy={isCancelling}
            disabled={isCancelling}
          >
            <X size={18} weight="bold" />
            <span>{visibleCancelLabel}</span>
          </button>
        )}
      </div>

      {sourceSummary && (
        <div
          className="processing-source-summary"
          role="note"
          aria-label="处理中的原文"
        >
          <ShieldCheck size={19} weight="fill" aria-hidden="true" />
          <span>
            <strong>{sourceSummary.title}</strong>
            <small>{sourceSummary.detail}</small>
          </span>
        </div>
      )}

      {privacyDisclosure && (
        <div
          className={`processing-destination processing-destination--${privacyDisclosure.location}`}
          role="note"
          aria-label="当前处理位置"
        >
          {privacyDisclosure.location === 'local'
            ? <ShieldCheck size={19} weight="fill" aria-hidden="true" />
            : privacyDisclosure.location === 'local-loopback'
              ? <HardDrives size={19} weight="fill" aria-hidden="true" />
              : <CloudArrowUp size={19} weight="fill" aria-hidden="true" />}
          <span>
            <strong>{privacyDisclosure.activeTitle}</strong>
            <small>{privacyDisclosure.activeDetail}</small>
          </span>
        </div>
      )}

      <p className="processing-status">
        <SpinnerGap size={18} className="spin" aria-hidden="true" />
        <span aria-hidden="true">{statusMessage}</span>
        <span className="session-clear-undo__a11y">
          <span role="status" aria-live="polite" aria-atomic="true">
            {announcedStatus}
          </span>
        </span>
        <small aria-hidden="true">{elapsedSeconds} 秒</small>
      </p>

      {cancelError && (
        <div className="processing-cancel-error" role="alert">
          <WarningCircle size={19} weight="fill" aria-hidden="true" />
          <span>
            <strong>还没有确认停止</strong>
            <small>{cancelError}</small>
          </span>
        </div>
      )}

      <div className="processing-background-note" role="note">
        <span className="processing-background-note__icon" aria-hidden="true">
          <Bell size={18} weight="fill" />
        </span>
        <span>
          <strong>可以先隐藏窗口，任务会继续</strong>
          <small>
            {isCapturePhase
              ? '菜单栏会显示框选和本机 OCR 进度；若系统允许通知，提醒不会包含截图或识别文字。'
              : '菜单栏会显示进度和完成标记；若系统允许通知，提醒也不会包含原文或分析内容。'}
          </small>
        </span>
      </div>

      <p className="processing-plan-label">
        {isCapturePhase ? '截图会按这个顺序进行' : '返回后会检查这些内容'}
      </p>

      <ol className="processing-steps">
        {stages.map(({ label, detail, Icon }) => (
          <li key={label} className="processing-step is-planned">
            <span className="processing-step__icon" aria-hidden="true">
              <Icon size={20} />
            </span>
            <span>
              <strong>{label}</strong>
              <small>{detail}</small>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export { STAGES as PROCESSING_STAGES };
