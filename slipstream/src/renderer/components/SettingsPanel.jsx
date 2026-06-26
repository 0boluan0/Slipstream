import React, { useState, useCallback } from 'react';
import ApiKeyInput from './ApiKeyInput';
import ModelSelector from './ModelSelector';
import PromptEditor from './PromptEditor';
import LanguageToggle from './LanguageToggle';
import { useSettings } from '../hooks/useSettings';
import { LLM_BACKENDS, LANGUAGES } from '../../shared/constants';

const BACKEND_OPTIONS = [
  { label: 'Anthropic', value: LLM_BACKENDS.ANTHROPIC },
  { label: 'OpenAI', value: LLM_BACKENDS.OPENAI },
  { label: 'Ollama', value: LLM_BACKENDS.OLLAMA },
  { label: '自定义', value: LLM_BACKENDS.CUSTOM },
];

export default function SettingsPanel({ onClose }) {
  const { settings, updateSettings, resetSettings } = useSettings();
  const [confirmReset, setConfirmReset] = useState(false);

  const handleBackendChange = useCallback(
    (backend) => {
      updateSettings('activeBackend', backend);
    },
    [updateSettings]
  );

  const handleModelChange = useCallback(
    (model) => {
      updateSettings('activeModel', model);
    },
    [updateSettings]
  );

  const handlePromptChange = useCallback(
    (prompt) => {
      updateSettings('customPrompt', prompt);
    },
    [updateSettings]
  );

  const handleLanguageChange = useCallback(
    (lang) => {
      updateSettings('languageHint', lang);
    },
    [updateSettings]
  );

  const handleApiKeyChange = useCallback(
    (value) => {
      const keyMap = {
        [LLM_BACKENDS.ANTHROPIC]: 'anthropicApiKey',
        [LLM_BACKENDS.OPENAI]: 'openaiApiKey',
        [LLM_BACKENDS.OLLAMA]: 'ollamaBaseUrl',
        [LLM_BACKENDS.CUSTOM]: 'customEndpointUrl',
      };
      const settingKey = keyMap[settings.activeBackend];
      if (settingKey) {
        updateSettings(settingKey, value);
      }
    },
    [settings.activeBackend, updateSettings]
  );

  const handleCustomApiKeyChange = useCallback(
    (value) => {
      updateSettings('customEndpointApiKey', value);
    },
    [updateSettings]
  );

  const handleClipboardToggle = useCallback(
    (e) => {
      updateSettings('clipboardMonitoring', e.target.checked);
    },
    [updateSettings]
  );

  const handleReset = useCallback(() => {
    if (confirmReset) {
      resetSettings();
      setConfirmReset(false);
    } else {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 3000);
    }
  }, [confirmReset, resetSettings]);

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: '#FFF',
    borderRadius: 12,
    border: '1px solid #E5E7EB',
    overflow: 'hidden',
    boxShadow: '0 4px 24px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08)',
  };

  const scrollStyle = {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 16px 24px',
  };

  const sectionTitleStyle = {
    fontSize: 11,
    fontWeight: 700,
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 16,
  };

  const segmentBtnBase = {
    flex: 1,
    padding: '7px 6px',
    fontSize: 11,
    border: 'none',
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'background-color 0.15s, color 0.15s',
    outline: 'none',
  };

  return (
    <div style={containerStyle}>
      {/* Header — drag region */}
      <div
        style={{
          WebkitAppRegion: 'drag',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          borderBottom: '1px solid #E5E7EB',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700, color: '#1F2937' }}>设置</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="返回主面板"
          style={{
            WebkitAppRegion: 'no-drag',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 13,
            color: '#3B82F6',
            fontWeight: 500,
            padding: '4px 8px',
            borderRadius: 6,
            transition: 'background-color 0.15s',
          }}
          onMouseEnter={(e) => { e.target.style.backgroundColor = '#EFF6FF'; }}
          onMouseLeave={(e) => { e.target.style.backgroundColor = 'transparent'; }}
        >
          {'←'} 返回
        </button>
      </div>

      {/* Scrollable content */}
      <div style={scrollStyle}>
        {/* LLM Backend selector */}
        <div style={sectionTitleStyle}>LLM 后端</div>
        <div
          style={{
            display: 'flex',
            borderRadius: 8,
            overflow: 'hidden',
            border: '1px solid #D1D5DB',
            marginBottom: 16,
          }}
        >
          {BACKEND_OPTIONS.map((opt) => {
            const isSelected = settings.activeBackend === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleBackendChange(opt.value)}
                aria-label={`选择 ${opt.label}`}
                style={{
                  ...segmentBtnBase,
                  backgroundColor: isSelected ? '#3B82F6' : '#F3F4F6',
                  color: isSelected ? '#FFF' : '#374151',
                  fontWeight: isSelected ? 600 : 400,
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* API Key section */}
        <div style={sectionTitleStyle}>凭据</div>
        <ApiKeyInput
          backend={settings.activeBackend}
          value={
            settings.activeBackend === LLM_BACKENDS.ANTHROPIC
              ? settings.anthropicApiKey
              : settings.activeBackend === LLM_BACKENDS.OPENAI
              ? settings.openaiApiKey
              : settings.activeBackend === LLM_BACKENDS.OLLAMA
              ? settings.ollamaBaseUrl
              : settings.activeBackend === LLM_BACKENDS.CUSTOM
              ? settings.customEndpointUrl
              : ''
          }
          onChange={handleApiKeyChange}
        />

        {/* Show API key field for custom backend */}
        {settings.activeBackend === LLM_BACKENDS.CUSTOM && (
          <ApiKeyInput
            backend="custom_api_key"
            value={settings.customEndpointApiKey}
            onChange={handleCustomApiKeyChange}
          />
        )}

        {/* Model selector */}
        <div style={{ ...sectionTitleStyle, marginTop: 4 }}>模型</div>
        <ModelSelector
          backend={settings.activeBackend}
          value={settings.activeModel}
          onChange={handleModelChange}
        />

        {/* Language hint */}
        <LanguageToggle
          value={settings.languageHint}
          onChange={handleLanguageChange}
        />

        {/* Prompt editor */}
        <div style={sectionTitleStyle}>提示词</div>
        <PromptEditor
          value={settings.customPrompt}
          onChange={handlePromptChange}
        />

        {/* Clipboard monitoring toggle */}
        <div style={sectionTitleStyle}>行为</div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 0',
          }}
        >
          <label
            style={{
              fontSize: 13,
              color: '#374151',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            自动检测剪贴板
          </label>
          <label
            style={{
              position: 'relative',
              display: 'inline-block',
              width: 40,
              height: 22,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={settings.clipboardMonitoring}
              onChange={handleClipboardToggle}
              role="switch"
              aria-checked={settings.clipboardMonitoring}
              style={{
                opacity: 0,
                width: 0,
                height: 0,
                position: 'absolute',
              }}
            />
            <span
              style={{
                position: 'absolute',
                inset: 0,
                backgroundColor: settings.clipboardMonitoring ? '#3B82F6' : '#D1D5DB',
                borderRadius: 11,
                transition: 'background-color 0.2s',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  left: settings.clipboardMonitoring ? 20 : 2,
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  backgroundColor: '#FFF',
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }}
              />
            </span>
          </label>
        </div>

        {/* Reset button */}
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <button
            type="button"
            onClick={handleReset}
            aria-label="恢复默认设置"
            style={{
              padding: '8px 20px',
              fontSize: 12,
              border: `1px solid ${confirmReset ? '#EF4444' : '#D1D5DB'}`,
              borderRadius: 8,
              backgroundColor: confirmReset ? '#FEF2F2' : '#FFF',
              color: confirmReset ? '#DC2626' : '#6B7280',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {confirmReset ? '确认恢复默认设置？' : '恢复默认设置'}
          </button>
        </div>
      </div>
    </div>
  );
}
