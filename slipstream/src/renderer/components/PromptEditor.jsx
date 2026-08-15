import React, { useEffect, useId, useRef, useState } from 'react';

const MAX_PROMPT_LENGTH = 20000;

export default function PromptEditor({
  settingKey = 'customPrompt',
  value,
  onChange,
  onDraftStateChange,
  disabled = false,
  resetEpoch = 0,
  retryReceipt = null,
  inputId: providedInputId,
}) {
  const [draft, setDraft] = useState(value || '');
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [operationNotice, setOperationNotice] = useState('');
  const generatedInputId = useId();
  const generatedDescriptionId = useId();
  const inputId = providedInputId || generatedInputId;
  const descriptionId = `${providedInputId || generatedDescriptionId}-description`;
  const statusId = `${providedInputId || generatedDescriptionId}-status`;
  const draftRevisionRef = useRef(0);
  const failedDraftRevisionRef = useRef(null);
  const lastRetryReceiptIdRef = useRef(null);
  const latestValueRef = useRef(value);
  latestValueRef.current = value;

  useEffect(() => {
    draftRevisionRef.current += 1;
    failedDraftRevisionRef.current = null;
    setDraft(latestValueRef.current || '');
    setIsDirty(false);
    setIsSaving(false);
    setSaveFailed(false);
    setOperationNotice('');
    onDraftStateChange?.(false);
  }, [onDraftStateChange, resetEpoch]);

  useEffect(() => {
    if (isDirty) return;
    setDraft(value || '');
  }, [isDirty, value]);

  useEffect(() => {
    const receiptId = retryReceipt?.id;
    if (!Number.isSafeInteger(receiptId) || lastRetryReceiptIdRef.current === receiptId) return;
    lastRetryReceiptIdRef.current = receiptId;
    if (
      retryReceipt.status !== 'saved'
      || !retryReceipt.savedSettingKeys?.includes(settingKey)
    ) return;

    const failedRevision = failedDraftRevisionRef.current;
    if (failedRevision === null) return;
    failedDraftRevisionRef.current = null;
    setSaveFailed(false);
    setOperationNotice('');
    if (draftRevisionRef.current !== failedRevision) {
      setIsDirty(true);
      onDraftStateChange?.(true);
      return;
    }

    draftRevisionRef.current += 1;
    setDraft(latestValueRef.current || '');
    setIsDirty(false);
    setOperationNotice('高级分析说明已保存。');
    onDraftStateChange?.(false);
  }, [onDraftStateChange, retryReceipt, settingKey]);

  const updateDraft = (nextDraft) => {
    const dirty = nextDraft !== String(value || '');
    draftRevisionRef.current += 1;
    if (!dirty) failedDraftRevisionRef.current = null;
    setDraft(nextDraft);
    setIsDirty(dirty);
    setSaveFailed(false);
    setOperationNotice('');
    onDraftStateChange?.(dirty);
  };

  const commit = async () => {
    if (disabled || isSaving || !isDirty) return false;
    const attemptedRevision = draftRevisionRef.current;
    setIsSaving(true);
    setSaveFailed(false);
    setOperationNotice('');
    try {
      const saved = await onChange(draft);
      if (saved === false) throw new Error('save-failed');
      draftRevisionRef.current += 1;
      failedDraftRevisionRef.current = null;
      setIsDirty(false);
      setOperationNotice('高级分析说明已保存。');
      onDraftStateChange?.(false);
      return true;
    } catch {
      failedDraftRevisionRef.current = attemptedRevision;
      setSaveFailed(true);
      onDraftStateChange?.(true);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const charCount = draft.length;
  const ownsLiveStatus = Boolean(saveFailed || operationNotice || isSaving);
  const statusText = saveFailed
    ? '保存失败，请重试'
    : operationNotice
      ? operationNotice
      : isSaving
        ? '正在保存…'
        : isDirty
          ? '有未保存的更改'
          : disabled
            ? '当前操作期间已锁定'
            : value
              ? '已保存'
              : '使用默认分析说明';

  return (
    <div className="prompt-editor">
      <label className="prompt-editor__label" htmlFor={inputId}>
        自定义提示词
      </label>
      <div className="prompt-editor__field">
        <textarea
          id={inputId}
          className="slipstream-textarea prompt-editor__textarea"
          value={draft}
          disabled={disabled || isSaving}
          maxLength={MAX_PROMPT_LENGTH}
          onChange={(event) => updateDraft(event.target.value)}
          placeholder="（使用默认分析说明）"
          aria-busy={isSaving}
          aria-invalid={saveFailed || undefined}
          aria-describedby={`${descriptionId} ${statusId}`}
        />
        <span className="prompt-editor__count" aria-hidden="true">{charCount}</span>
      </div>
      <p id={descriptionId} className="prompt-editor__description">
        使用 {'{{text}}'} 作为原文占位符，{'{{languageHint}}'} 作为语言提示
      </p>
      <div className="setting-editor-actions">
        <span
          id={statusId}
          className={saveFailed
            ? 'setting-save-status is-error'
            : isDirty ? 'setting-save-status is-dirty' : 'setting-save-status'}
          role={ownsLiveStatus ? 'status' : undefined}
          aria-live={ownsLiveStatus ? 'polite' : undefined}
        >
          {statusText}
        </span>
        <button
          type="button"
          className="setting-save-button"
          disabled={disabled || !isDirty || isSaving}
          onClick={commit}
          aria-busy={isSaving}
        >
          {isSaving
            ? '正在保存…'
            : saveFailed
              ? '重试保存'
              : isDirty ? '保存说明' : '已保存'}
        </button>
      </div>
    </div>
  );
}
