import React, { useEffect, useId, useRef, useState } from 'react';
import constants from '../../shared/constants';

const { MODEL_IDS } = constants;
const EMPTY_MODELS = [];

export default function ModelSelector({
  backend,
  settingKey,
  value,
  onChange,
  onDraftStateChange,
  disabled = false,
  resetEpoch = 0,
  retryReceipt = null,
  inputId: providedInputId,
}) {
  const models = MODEL_IDS[backend] || EMPTY_MODELS;
  const [draft, setDraft] = useState(value || models[0] || '');
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [operationNotice, setOperationNotice] = useState('');
  const generatedInputId = useId();
  const inputId = providedInputId || generatedInputId;
  const listId = useId();
  const draftRevisionRef = useRef(0);
  const failedDraftRevisionRef = useRef(null);
  const lastRetryReceiptIdRef = useRef(null);
  const latestValueRef = useRef(value);
  latestValueRef.current = value;

  useEffect(() => {
    draftRevisionRef.current += 1;
    failedDraftRevisionRef.current = null;
    setDraft(latestValueRef.current || models[0] || '');
    setIsDirty(false);
    setSaveFailed(false);
    setOperationNotice('');
    onDraftStateChange?.(false);
  }, [backend, models, onDraftStateChange, resetEpoch]);

  useEffect(() => {
    if (isDirty) return;
    setDraft(value || models[0] || '');
  }, [isDirty, models, value]);

  useEffect(() => {
    const receiptId = retryReceipt?.id;
    if (!Number.isSafeInteger(receiptId) || lastRetryReceiptIdRef.current === receiptId) return;
    lastRetryReceiptIdRef.current = receiptId;
    if (
      retryReceipt.status !== 'saved'
      || !settingKey
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
    setDraft(latestValueRef.current || models[0] || '');
    setIsDirty(false);
    onDraftStateChange?.(false);
  }, [models, onDraftStateChange, retryReceipt, settingKey]);

  const commit = async () => {
    const model = draft.trim();
    if (disabled || !model || !isDirty || isSaving) return false;
    const attemptedRevision = draftRevisionRef.current;
    setIsSaving(true);
    setSaveFailed(false);
    setOperationNotice('');
    try {
      const saved = await onChange(model);
      if (saved === false) throw new Error('save-failed');
      setDraft(model);
      draftRevisionRef.current += 1;
      failedDraftRevisionRef.current = null;
      setIsDirty(false);
      setOperationNotice('模型已保存。');
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

  return (
    <div style={{ marginBottom: 12 }}>
      <label htmlFor={inputId} style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
        模型
      </label>
      <input
        id={inputId}
        className="slipstream-input"
        list={listId}
        value={draft}
        disabled={disabled || isSaving}
        onChange={(event) => {
          const nextDraft = event.target.value;
          const dirty = nextDraft.trim() !== String(value || '').trim();
          draftRevisionRef.current += 1;
          failedDraftRevisionRef.current = null;
          setDraft(nextDraft);
          setIsDirty(dirty);
          setSaveFailed(false);
          setOperationNotice('');
          onDraftStateChange?.(dirty);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
        placeholder="输入或选择模型 ID"
      />
      <div className="setting-editor-actions">
        <span
          className={saveFailed ? 'setting-save-status is-error' : isDirty ? 'setting-save-status is-dirty' : 'setting-save-status'}
          role={saveFailed || operationNotice || isSaving ? 'status' : undefined}
          aria-live={saveFailed || operationNotice || isSaving ? 'polite' : undefined}
        >
          {saveFailed
            ? '保存失败，请重试'
            : operationNotice
              ? operationNotice
              : isSaving
                ? '正在保存…'
                : disabled
                  ? '当前操作期间已锁定'
                  : isDirty
                    ? '有未保存的更改'
                    : value
                      ? '已保存'
                      : '尚未保存'}
        </span>
        <button
          type="button"
          className="setting-save-button"
          disabled={disabled || !isDirty || isSaving || !draft.trim()}
          onClick={commit}
        >
          {isSaving ? '正在保存…' : isDirty ? '保存模型' : '已保存'}
        </button>
      </div>
      <datalist id={listId}>
        {models.map((model) => <option key={model} value={model} />)}
      </datalist>
      {(backend === 'ollama' || backend === 'custom') && (
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
          {backend === 'ollama'
            ? '优先选择能稳定遵循 JSON 指令的模型（如 qwen2.5）；推理模型可能无法生成可验证结果。'
            : '可直接输入服务端已有的模型 ID。'}
        </div>
      )}
    </div>
  );
}
