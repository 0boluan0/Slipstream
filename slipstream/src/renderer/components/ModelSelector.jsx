import React, { useEffect, useId, useState } from 'react';
import constants from '../../shared/constants';

const { MODEL_IDS } = constants;
const EMPTY_MODELS = [];

export default function ModelSelector({ backend, value, onChange, onDraftStateChange }) {
  const models = MODEL_IDS[backend] || EMPTY_MODELS;
  const [draft, setDraft] = useState(value || models[0] || '');
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const inputId = useId();
  const listId = useId();

  useEffect(() => {
    setDraft(value || models[0] || '');
    setIsDirty(false);
    setSaveFailed(false);
    onDraftStateChange?.(false);
  }, [backend, models, onDraftStateChange, value]);

  const commit = async () => {
    const model = draft.trim();
    if (!model || !isDirty || isSaving) return false;
    setIsSaving(true);
    setSaveFailed(false);
    try {
      const saved = await onChange(model);
      if (saved === false) throw new Error('save-failed');
      setDraft(model);
      setIsDirty(false);
      onDraftStateChange?.(false);
      return true;
    } catch {
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
        onChange={(event) => {
          const nextDraft = event.target.value;
          const dirty = nextDraft.trim() !== String(value || '').trim();
          setDraft(nextDraft);
          setIsDirty(dirty);
          setSaveFailed(false);
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
          role="status"
          aria-live="polite"
        >
          {saveFailed
            ? '保存失败，请重试'
            : isSaving
              ? '正在保存…'
              : isDirty
                ? '有未保存的更改'
                : value
                  ? '已保存'
                  : '尚未保存'}
        </span>
        <button
          type="button"
          className="setting-save-button"
          disabled={!isDirty || isSaving || !draft.trim()}
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
