import React from 'react';
import { LANGUAGES } from '../../shared/constants';

const OPTIONS = [
  { label: '英文', value: LANGUAGES.EN },
  { label: '中文', value: LANGUAGES.ZH },
  { label: '自动', value: LANGUAGES.AUTO },
];

export default function LanguageToggle({ value, onChange }) {
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
        源语言
      </label>
      <div
        style={{
          display: 'inline-flex',
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid #D1D5DB',
        }}
      >
        {OPTIONS.map((opt) => {
          const isSelected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              style={{
                padding: '6px 16px',
                fontSize: 12,
                fontWeight: isSelected ? 600 : 400,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: isSelected ? '#3B82F6' : '#F3F4F6',
                color: isSelected ? '#FFF' : '#374151',
                transition: 'background-color 0.15s, color 0.15s',
                outline: 'none',
                minWidth: 52,
                textAlign: 'center',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
