import React from 'react';
import constants from '../../shared/constants';

const { DEFAULT_PROMPTS } = constants;

const defaultPromptPreview = DEFAULT_PROMPTS.explain?.userPromptTemplate
  ? DEFAULT_PROMPTS.explain.userPromptTemplate.substring(0, 60) + '...'
  : '自定义提示词模板';

export default function PromptEditor({ value, onChange }) {
  const charCount = value ? value.length : 0;

  const textareaStyle = {
    width: '100%',
    minHeight: 120,
    padding: '8px 10px',
    fontSize: 12,
    border: '1px solid var(--border-secondary)',
    borderRadius: 8,
    outline: 'none',
    resize: 'vertical',
    fontFamily: 'monospace',
    lineHeight: 1.5,
    boxSizing: 'border-box',
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
        自定义提示词
      </label>
      <div style={{ position: 'relative' }}>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="(使用默认提示词)"
          style={textareaStyle}
          onFocus={(e) => {
            e.target.style.borderColor = 'var(--accent)';
            e.target.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent)';
          }}
          onBlur={(e) => {
            e.target.style.borderColor = 'var(--border-secondary)';
            e.target.style.boxShadow = 'none';
          }}
        />
        <span
          style={{
            position: 'absolute',
            bottom: 6,
            right: 8,
            fontSize: 10,
            color: 'var(--text-tertiary)',
            pointerEvents: 'none',
          }}
        >
          {charCount}
        </span>
      </div>
      <p
        style={{
          fontSize: 10,
          color: 'var(--text-tertiary)',
          margin: '3px 0 0 0',
          lineHeight: 1.4,
        }}
      >
        使用 {'{{text}}'} 作为原文占位符，{'{{languageHint}}'} 作为语言提示
      </p>
    </div>
  );
}
