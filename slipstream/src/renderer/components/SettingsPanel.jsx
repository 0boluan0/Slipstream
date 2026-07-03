import React, { useState, useCallback } from 'react';
import ApiKeyInput from './ApiKeyInput';
import ModelSelector from './ModelSelector';
import PromptEditor from './PromptEditor';
import LanguageToggle from './LanguageToggle';
import { useSettings } from '../hooks/useSettings';
import constants from '../../shared/constants';

const { LLM_BACKENDS, LANGUAGES } = constants;

const BACKEND_OPTIONS = [
  { label: '免费翻译', value: LLM_BACKENDS.FREE_TRANSLATE },
  { label: 'Anthropic', value: LLM_BACKENDS.ANTHROPIC },
  { label: 'OpenAI', value: LLM_BACKENDS.OPENAI },
  { label: 'DeepSeek', value: LLM_BACKENDS.DEEPSEEK },
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
        [LLM_BACKENDS.DEEPSEEK]: 'deepseekApiKey',
        [LLM_BACKENDS.OLLAMA]: 'ollamaBaseUrl',
        [LLM_BACKENDS.CUSTOM]: 'customEndpointUrl',
      };
      const settingKey = keyMap[settings.activeBackend];
      if (settingKey) {
        if ((settingKey === 'anthropicApiKey' || settingKey === 'openaiApiKey' || settingKey === 'deepseekApiKey') && !value.trim()) return;
        return updateSettings(settingKey, value);
      }
    },
    [settings.activeBackend, updateSettings]
  );

  const handleCustomApiKeyChange = useCallback(
    (value) => {
      if (!value.trim()) return;
      return updateSettings('customEndpointApiKey', value);
    },
    [updateSettings]
  );

  const handleClipboardToggle = useCallback(
    (e) => {
      updateSettings('clipboardMonitoring', e.target.checked);
    },
    [updateSettings]
  );

  const handleShortcutChange = useCallback(
    (key, value) => {
      updateSettings(key, value.trim());
    },
    [updateSettings]
  );

  const handleReset = useCallback(() => {
    if (confirmReset) {
      resetSettings();
      setConfirmReset(false);
    } else {
      setConfirmReset(true);
    }
  }, [confirmReset, resetSettings]);

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: 'var(--bg-primary)',
    borderRadius: 12,
    border: '1px solid var(--border-primary)',
    overflow: 'hidden',
    boxShadow: 'var(--shadow)',
  };

  const scrollStyle = {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 16px 24px',
  };

  const sectionTitleStyle = {
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--text-tertiary)',
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
          borderBottom: '1px solid var(--border-primary)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>设置</span>
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
            color: 'var(--accent)',
            fontWeight: 500,
            padding: '4px 8px',
            borderRadius: 6,
            transition: 'background-color 0.15s',
          }}
          onMouseEnter={(e) => { e.target.style.backgroundColor = 'var(--accent-light)'; }}
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
            border: '1px solid var(--border-secondary)',
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
                  backgroundColor: isSelected ? 'var(--accent)' : 'var(--bg-tertiary)',
                  color: isSelected ? '#FFF' : 'var(--text-primary)',
                  fontWeight: isSelected ? 600 : 400,
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* API Key section — hidden for free_translate */}
        {settings.activeBackend !== LLM_BACKENDS.FREE_TRANSLATE && (
          <>
            <div style={sectionTitleStyle}>凭据</div>
            <ApiKeyInput
              backend={settings.activeBackend}
              value={
                settings.activeBackend === LLM_BACKENDS.ANTHROPIC
                  ? settings.anthropicApiKey
                  : settings.activeBackend === LLM_BACKENDS.OPENAI
                  ? settings.openaiApiKey
                  : settings.activeBackend === LLM_BACKENDS.DEEPSEEK
                  ? settings.deepseekApiKey
                  : settings.activeBackend === LLM_BACKENDS.OLLAMA
                  ? settings.ollamaBaseUrl
                  : settings.activeBackend === LLM_BACKENDS.CUSTOM
                  ? settings.customEndpointUrl
                  : ''
              }
              onChange={handleApiKeyChange}
              isSaved={
                settings.activeBackend === LLM_BACKENDS.ANTHROPIC
                  ? settings.hasAnthropicApiKey
                  : settings.activeBackend === LLM_BACKENDS.OPENAI
                  ? settings.hasOpenaiApiKey
                  : settings.activeBackend === LLM_BACKENDS.DEEPSEEK
                  ? settings.hasDeepseekApiKey
                  : false
              }
            />

            {/* Show API key field for custom backend */}
            {settings.activeBackend === LLM_BACKENDS.CUSTOM && (
              <ApiKeyInput
                backend="custom_api_key"
                value={settings.customEndpointApiKey}
                onChange={handleCustomApiKeyChange}
                isSaved={settings.hasCustomEndpointApiKey}
              />
            )}

            {/* Model selector */}
            <div style={{ ...sectionTitleStyle, marginTop: 4 }}>模型</div>
            <ModelSelector
              backend={settings.activeBackend}
              value={settings.activeModel}
              onChange={handleModelChange}
            />
          </>
        )}

        {settings.activeBackend === LLM_BACKENDS.FREE_TRANSLATE && (
          <div style={{
            padding: '10px 12px',
            marginTop: 8,
            marginBottom: 4,
            fontSize: 12,
            color: 'var(--text-secondary)',
            backgroundColor: 'var(--bg-tertiary)',
            borderRadius: 8,
            lineHeight: 1.5,
          }}>
            免费翻译无需配置，使用 Google / MyMemory 翻译接口。如需专有名词解释和术语解析，请切换到 LLM 后端并配置 API Key。
          </div>
        )}

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
          <span
            style={{
              fontSize: 13,
              color: 'var(--text-primary)',
              cursor: 'pointer',
              userSelect: 'none',
            }}
            onClick={handleClipboardToggle}
          >
            自动检测剪贴板
          </span>
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
                backgroundColor: settings.clipboardMonitoring ? 'var(--accent)' : 'var(--border-secondary)',
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

        <div style={sectionTitleStyle}>快捷键</div>
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
            剪贴板解释
          </span>
          <input
            className="slipstream-input"
            value={settings.clipboardShortcut || 'Alt+C'}
            onChange={(e) => handleShortcutChange('clipboardShortcut', e.target.value)}
            placeholder="Alt+C"
          />
        </label>
        <label style={{ display: 'block' }}>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
            截图 OCR
          </span>
          <input
            className="slipstream-input"
            value={settings.screenshotShortcut || 'F2'}
            onChange={(e) => handleShortcutChange('screenshotShortcut', e.target.value)}
            placeholder="F2"
          />
        </label>

        {/* Reset button */}
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          {!confirmReset ? (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              aria-label="恢复默认设置"
              style={{
                padding: '8px 20px',
                fontSize: 12,
                border: '1px solid var(--border-secondary)',
                borderRadius: 8,
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              恢复默认设置
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button
                type="button"
                onClick={handleReset}
                aria-label="确认恢复默认设置"
                style={{
                  padding: '8px 20px',
                  fontSize: 12,
                  border: 'none',
                  borderRadius: 8,
                  backgroundColor: 'var(--error)',
                  color: '#FFF',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                确认恢复
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                aria-label="取消恢复"
                style={{
                  padding: '8px 20px',
                  fontSize: 12,
                  border: '1px solid var(--border-secondary)',
                  borderRadius: 8,
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                取消
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
