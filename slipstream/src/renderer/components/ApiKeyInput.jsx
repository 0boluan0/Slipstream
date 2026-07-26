import React, { useState, useEffect, useId } from 'react';
import { Eye, EyeSlash } from '@phosphor-icons/react';

const LABEL_MAP = {
  anthropic: 'Anthropic API Key',
  openai: 'OpenAI API Key',
  deepseek: 'DeepSeek API Key',
  ollama: 'Ollama 服务地址',
  custom: '自定义 API 地址',
  custom_api_key: '自定义 API Key',
};

const PLACEHOLDER_MAP = {
  anthropic: 'sk-ant-...',
  openai: 'sk-...',
  deepseek: 'sk-...',
  ollama: 'http://localhost:11434',
  custom: 'https://api.example.com/v1',
  custom_api_key: 'sk-...',
};

export default function ApiKeyInput({
  backend,
  value,
  onChange,
  onDelete,
  onDraftStateChange,
  isSaved = false,
}) {
  const [showKey, setShowKey] = useState(false);
  const [draft, setDraft] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const inputId = useId();
  const isUrlType = backend === 'ollama' || backend === 'custom';

  const label = LABEL_MAP[backend] || 'API Key';
  const placeholder = PLACEHOLDER_MAP[backend] || (isUrlType ? '输入 URL...' : '输入 API Key...');
  const visiblePlaceholder = !isUrlType && isSaved ? '已保存，输入新值可替换' : placeholder;

  useEffect(() => {
    setDraft(isUrlType ? (value || '') : '');
    setIsDirty(false);
    setSaveFailed(false);
    onDraftStateChange?.(false);
  }, [backend, isUrlType, onDraftStateChange, value]);

  const updateDraft = (nextDraft) => {
    setDraft(nextDraft);
    const normalized = nextDraft.trim();
    const dirty = isUrlType
      ? normalized !== String(value || '').trim()
      : Boolean(normalized);
    setIsDirty(dirty);
    setSaveFailed(false);
    onDraftStateChange?.(dirty);
  };

  const commit = async () => {
    const nextValue = draft.trim();
    if (isSaving || !isDirty || (!isUrlType && !nextValue)) return false;
    setIsSaving(true);
    setSaveFailed(false);
    try {
      const saved = await onChange(nextValue);
      if (saved === false) throw new Error('save-failed');
      if (!isUrlType) setDraft('');
      else setDraft(nextValue);
      setIsDirty(false);
      onDraftStateChange?.(false);
      return true;
    } catch {
      // Keep the draft visible so the user can correct or retry it.
      setSaveFailed(true);
      onDraftStateChange?.(true);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaveFailed(false);
    try {
      await onDelete();
      setDraft('');
      setIsDirty(false);
      onDraftStateChange?.(false);
    } catch {
      setSaveFailed(true);
    }
  };

  const hasSavedValue = isUrlType ? Boolean(String(value || '').trim()) : isSaved;
  const statusText = saveFailed
    ? '保存失败，请重试'
    : isSaving
      ? '正在保存…'
      : isDirty
        ? '有未保存的更改'
        : hasSavedValue
          ? (isUrlType ? '已保存' : '已安全保存')
          : '尚未保存';

  const inputStyle = {
    width: '100%',
    padding: '8px 10px',
    fontSize: 13,
    border: '1px solid var(--border-secondary)',
    borderRadius: 8,
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: isUrlType ? 'inherit' : 'monospace',
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <label
        htmlFor={inputId}
        style={{
          display: 'block',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 4,
        }}
      >
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          id={inputId}
          type={showKey && !isUrlType ? 'text' : isUrlType ? 'text' : 'password'}
          value={draft}
          onChange={(e) => updateDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={visiblePlaceholder}
          style={inputStyle}
          onFocus={(e) => {
            e.target.style.borderColor = 'var(--accent)';
            e.target.style.boxShadow = '0 0 0 3px var(--accent-light)';
          }}
          onBlur={(e) => {
            e.target.style.borderColor = 'var(--border-secondary)';
            e.target.style.boxShadow = 'none';
          }}
        />
        {!isUrlType && (
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 16,
              padding: '2px 4px',
              lineHeight: 1,
            }}
            aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
          >
            {showKey ? <EyeSlash size={18} /> : <Eye size={18} />}
          </button>
        )}
      </div>
      <div className="setting-editor-actions">
        <span
          className={saveFailed ? 'setting-save-status is-error' : isDirty ? 'setting-save-status is-dirty' : 'setting-save-status'}
          role="status"
          aria-live="polite"
        >
          {statusText}
        </span>
        <div>
          {!isUrlType && isSaved && !draft && (
            <button type="button" className="setting-delete-button" onClick={handleDelete}>
              删除凭据
            </button>
          )}
          <button
            type="button"
            className="setting-save-button"
            disabled={!isDirty || isSaving || (!isUrlType && !draft.trim())}
            onClick={commit}
          >
            {isSaving ? '正在保存…' : isDirty ? (hasSavedValue ? '保存更改' : '保存') : hasSavedValue ? '已保存' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
