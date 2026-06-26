import React from 'react';
import { DEFAULT_PROMPTS } from '../../shared/constants';

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
    border: '1px solid #D1D5DB',
    borderRadius: 8,
    outline: 'none',
    resize: 'vertical',
    fontFamily: 'monospace',
    lineHeight: 1.5,
    boxSizing: 'border-box',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <label
        style={{
          display: 'block',
          fontSize: 12,
          fontWeight: 600,
          color: '#374151',
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
            e.target.style.borderColor = '#3B82F6';
            e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.15)';
          }}
          onBlur={(e) => {
            e.target.style.borderColor = '#D1D5DB';
            e.target.style.boxShadow = 'none';
          }}
        />
        <span
          style={{
            position: 'absolute',
            bottom: 6,
            right: 8,
            fontSize: 10,
            color: '#9CA3AF',
            pointerEvents: 'none',
          }}
        >
          {charCount}
        </span>
      </div>
      <p
        style={{
          fontSize: 10,
          color: '#9CA3AF',
          margin: '3px 0 0 0',
          lineHeight: 1.4,
        }}
      >
        使用 {'{{text}}'} 作为原文占位符，{'{{languageHint}}'} 作为语言提示
      </p>
    </div>
  );
}
