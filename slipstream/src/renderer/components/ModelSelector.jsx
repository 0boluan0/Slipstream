import React, { useEffect, useId, useState } from 'react';
import constants from '../../shared/constants';

const { MODEL_IDS } = constants;
const EMPTY_MODELS = [];

export default function ModelSelector({ backend, value, onChange }) {
  const models = MODEL_IDS[backend] || EMPTY_MODELS;
  const [draft, setDraft] = useState(value || models[0] || '');
  const inputId = useId();
  const listId = useId();

  useEffect(() => {
    setDraft(value || models[0] || '');
  }, [backend, value, models]);

  const commit = () => {
    const model = draft.trim();
    if (model && model !== value) onChange(model);
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
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        placeholder="输入或选择模型 ID"
      />
      <datalist id={listId}>
        {models.map((model) => <option key={model} value={model} />)}
      </datalist>
      {(backend === 'ollama' || backend === 'custom') && (
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-secondary)' }}>可直接输入服务端已有的模型 ID。</div>
      )}
    </div>
  );
}
