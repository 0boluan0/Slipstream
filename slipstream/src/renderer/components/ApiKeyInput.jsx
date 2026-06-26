import React, { useState } from 'react';

const LABEL_MAP = {
  anthropic: 'Anthropic API Key',
  openai: 'OpenAI API Key',
  ollama: 'Ollama 服务地址',
  custom: '自定义 API 地址',
  custom_api_key: '自定义 API Key',
};

const PLACEHOLDER_MAP = {
  anthropic: 'sk-ant-...',
  openai: 'sk-...',
  ollama: 'http://localhost:11434',
  custom: 'https://api.example.com/v1',
  custom_api_key: 'sk-...',
};

export default function ApiKeyInput({ backend, value, onChange }) {
  const [showKey, setShowKey] = useState(false);
  const isUrlType = backend === 'ollama' || backend === 'custom';

  const label = LABEL_MAP[backend] || 'API Key';
  const placeholder = PLACEHOLDER_MAP[backend] || (isUrlType ? '输入 URL...' : '输入 API Key...');

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
          type={showKey && !isUrlType ? 'text' : isUrlType ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={inputStyle}
          onFocus={(e) => {
            e.target.style.borderColor = 'var(--accent)';
            e.target.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent)';
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
            tabIndex={-1}
            aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
          >
            {showKey ? '🙈' : '👁'}
          </button>
        )}
      </div>
    </div>
  );
}
