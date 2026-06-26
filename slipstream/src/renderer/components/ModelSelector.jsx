import React, { useCallback } from 'react';
import { MODEL_IDS } from '../../shared/constants';

export default function ModelSelector({ backend, value, onChange }) {
  const models = MODEL_IDS[backend] || MODEL_IDS['anthropic'];

  // When backend changes, auto-select first model if current selection isn't valid
  const handleChange = useCallback(
    (e) => {
      onChange(e.target.value);
    },
    [onChange]
  );

  // Validate selection against current backend's model list
  const isValidSelection = models.includes(value);

  const selectStyle = {
    width: '100%',
    padding: '8px 10px',
    fontSize: 13,
    border: '1px solid #D1D5DB',
    borderRadius: 8,
    outline: 'none',
    backgroundColor: '#FFF',
    cursor: 'pointer',
    boxSizing: 'border-box',
    WebkitAppearance: 'none',
    MozAppearance: 'none',
    appearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 10px center',
    paddingRight: 30,
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
        模型选择
      </label>
      <select
        value={isValidSelection ? value : models[0] || ''}
        onChange={(e) => {
          // If backend changed and selection was invalid, first model is auto-selected
          onChange(e.target.value);
        }}
        style={selectStyle}
        onFocus={(e) => {
          e.target.style.borderColor = '#3B82F6';
          e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.15)';
        }}
        onBlur={(e) => {
          e.target.style.borderColor = '#D1D5DB';
          e.target.style.boxShadow = 'none';
        }}
      >
        {models.map((model) => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
      </select>
    </div>
  );
}
