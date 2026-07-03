import React from 'react';
import constants from '../../shared/constants';

const { LANGUAGES } = constants;

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
          color: 'var(--text-primary)',
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
          border: '1px solid var(--border-secondary)',
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
                backgroundColor: isSelected ? 'var(--accent)' : 'var(--bg-tertiary)',
                color: isSelected ? '#FFF' : 'var(--text-primary)',
                transition: 'background-color 0.15s, color 0.15s',
                outline: 'none',
                minWidth: 52,
                textAlign: 'center',
              }}
              onMouseEnter={(e) => {
                if (!isSelected) e.target.style.backgroundColor = 'var(--accent-light)';
              }}
              onMouseLeave={(e) => {
                if (!isSelected) e.target.style.backgroundColor = 'var(--bg-tertiary)';
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
