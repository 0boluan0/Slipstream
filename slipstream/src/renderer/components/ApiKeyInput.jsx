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

export default function ApiKeyInput({ backend, value, onChange, onDelete, isSaved = false }) {
  const [showKey, setShowKey] = useState(false);
  const [draft, setDraft] = useState('');
  const inputId = useId();
  const isUrlType = backend === 'ollama' || backend === 'custom';

  const label = LABEL_MAP[backend] || 'API Key';
  const placeholder = PLACEHOLDER_MAP[backend] || (isUrlType ? '输入 URL...' : '输入 API Key...');
  const visiblePlaceholder = !isUrlType && isSaved ? '已保存，输入新值可替换' : placeholder;

  useEffect(() => {
    setDraft(isUrlType ? (value || '') : '');
  }, [backend, isSaved, isUrlType, value]);

  const commit = async () => {
    const nextValue = draft.trim();
    if ((!isUrlType && !nextValue) || (isUrlType && nextValue === (value || ''))) return;
    try {
      await onChange(nextValue);
      if (!isUrlType) setDraft('');
    } catch {
      // Keep the draft visible so the user can correct or retry it.
    }
  };

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
          onChange={(e) => setDraft(e.target.value)}
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
            commit();
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
      {!isUrlType && isSaved && !draft && (
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)' }}>
          <span>已安全保存</span>
          <button type="button" onClick={onDelete} style={{ border: 0, background: 'none', color: 'var(--error)', cursor: 'pointer', padding: '4px 8px' }}>
            删除凭据
          </button>
        </div>
      )}
    </div>
  );
}
