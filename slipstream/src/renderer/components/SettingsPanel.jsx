import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ArrowLeft, ShieldCheck } from '@phosphor-icons/react';
import ApiKeyInput from './ApiKeyInput';
import ModelSelector from './ModelSelector';
import PromptEditor from './PromptEditor';
import LanguageToggle from './LanguageToggle';
import constants from '../../shared/constants';
import './SettingsPanel.css';
import {
  hasEndpointOriginChanged,
  isBackendReadyForFullAnalysis,
  modeLabel,
  SETUP_MODES,
} from '../utils/setupReadiness.mjs';

const { LLM_BACKENDS, MODEL_IDS } = constants;

const BACKEND_OPTIONS = [
  { label: '基础翻译', value: LLM_BACKENDS.FREE_TRANSLATE },
  { label: 'Anthropic', value: LLM_BACKENDS.ANTHROPIC },
  { label: 'OpenAI', value: LLM_BACKENDS.OPENAI },
  { label: 'DeepSeek', value: LLM_BACKENDS.DEEPSEEK },
  { label: 'Ollama', value: LLM_BACKENDS.OLLAMA },
  { label: '自定义', value: LLM_BACKENDS.CUSTOM },
];

const VERIFICATION_OPTIONS = [
  { value: 'ask', label: '每次询问', detail: '发现待核验内容时，先展示最小检索词与目标，再由你决定是否访问。' },
  { value: 'official-auto', label: '自动查找', detail: '自动查找并读取符合条件的官方页面；仅保留检索收据，不自动把结论标成已核验。' },
  { value: 'local-only', label: '仅本地', detail: '不访问外部来源，相关结论始终标记为待核验。' },
];

const CONNECTION_RESULT_COPY = Object.freeze({
  ok: ['元数据连接成功', '已读取所选模型的元数据；这不验证结构化输出兼容性，也不保证它能稳定生成完整行动简报。'],
  unsupported: ['无法确认', '这个自定义服务没有提供可识别的模型列表接口；未发送任何原文。'],
  'missing-credentials': ['缺少凭据', '请先保存当前服务所需的 API Key。'],
  'invalid-config': ['配置无效', '请检查服务、模型 ID 和服务地址后重试。'],
  'unsafe-endpoint': ['地址不安全', '只允许公开 HTTPS 地址，或指向本机回环地址的 HTTP 服务。'],
  unauthorized: ['凭据未通过', '服务拒绝了当前凭据，请检查或更换 API Key。'],
  'model-not-found': ['没有找到模型', '服务可访问，但模型列表中没有当前模型 ID。'],
  unreachable: ['无法连接服务', '请检查网络、服务地址，或确认本机服务已经启动。'],
  timeout: ['连接超时', '服务在 7 秒内没有完成元数据响应，请稍后重试。'],
  'invalid-response': ['响应无法确认', '服务没有返回可识别的 JSON 模型元数据。'],
  'response-too-large': ['响应超出限制', '模型元数据响应过大，Slipstream 已停止读取。'],
  'redirect-rejected': ['拒绝了重定向', '为避免把凭据发送到另一地址，连接测试不会跟随重定向。'],
  'rate-limited': ['请求受限', '服务暂时限制了请求，请稍后再试。'],
  'http-error': ['服务返回错误', '服务已响应，但没有完成这次模型元数据检查。'],
  busy: ['已有测试进行中', '请等待当前连接测试结束后再试。'],
  cancelled: ['测试已取消', '配置或输入发生变化，旧连接测试结果已丢弃。'],
  'settings-save-failed': ['设置尚未保存', '连接测试没有使用旧配置；请先修正上方的保存错误。'],
});

const IDLE_CONNECTION_TEST = Object.freeze({ status: 'idle', code: 'not-tested' });

export default function SettingsPanel({ onClose, onSetupComplete, settingsController }) {
  const {
    settings,
    updateSettings,
    updateMultipleSettings,
    resetSettings,
    testProviderConnection,
    cancelProviderConnectionTest,
    saveError,
    settingsSaving,
    processingConfigGenerationRef,
  } = settingsController;
  const [confirmReset, setConfirmReset] = useState(false);
  const [shortcutDrafts, setShortcutDrafts] = useState({ clipboardShortcut: 'Alt+C', screenshotShortcut: 'F2' });
  const [connectionTest, setConnectionTest] = useState(IDLE_CONNECTION_TEST);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [hasUnsavedConnectionDraft, setHasUnsavedConnectionDraft] = useState(false);
  const connectionRevisionRef = useRef(0);
  const connectionDraftKeysRef = useRef(new Set());

  const resetConnectionTest = useCallback(() => {
    connectionRevisionRef.current += 1;
    setConnectionTest(IDLE_CONNECTION_TEST);
    setIsTestingConnection(false);
    cancelProviderConnectionTest();
  }, [cancelProviderConnectionTest]);

  const clearConnectionDrafts = useCallback(() => {
    connectionDraftKeysRef.current.clear();
    setHasUnsavedConnectionDraft(false);
  }, []);

  const updateConnectionDraftState = useCallback((key, dirty) => {
    const drafts = connectionDraftKeysRef.current;
    const changed = dirty ? !drafts.has(key) : drafts.has(key);
    if (!changed) return;
    if (dirty) drafts.add(key);
    else drafts.delete(key);
    setHasUnsavedConnectionDraft(drafts.size > 0);
    resetConnectionTest();
  }, [resetConnectionTest]);

  const handlePrimaryDraftState = useCallback(
    (dirty) => updateConnectionDraftState('primary', dirty),
    [updateConnectionDraftState]
  );
  const handleCustomKeyDraftState = useCallback(
    (dirty) => updateConnectionDraftState('custom-key', dirty),
    [updateConnectionDraftState]
  );
  const handleModelDraftState = useCallback(
    (dirty) => updateConnectionDraftState('model', dirty),
    [updateConnectionDraftState]
  );

  const hasCurrentSuccessfulConnectionTest = connectionTest.status === 'connected'
    && connectionTest.code === 'ok'
    && connectionTest.connectionRevision === connectionRevisionRef.current
    && connectionTest.processingConfigGeneration === processingConfigGenerationRef.current
    && !hasUnsavedConnectionDraft
    && !settingsSaving;

  useEffect(() => {
    setShortcutDrafts({
      clipboardShortcut: settings.clipboardShortcut || 'Alt+C',
      screenshotShortcut: settings.screenshotShortcut || 'F2',
    });
  }, [settings.clipboardShortcut, settings.screenshotShortcut]);

  const saveSetting = useCallback(
    (key, value) => updateSettings(key, value).catch(() => false),
    [updateSettings]
  );

  const handleBackendChange = useCallback(
    (backend) => {
      if (backend === settings.activeBackend) return;
      resetConnectionTest();
      clearConnectionDrafts();
      const models = MODEL_IDS[backend] || [];
      const activeModel = models.includes(settings.activeModel) ? settings.activeModel : models[0];
      updateMultipleSettings({
        setupMode: SETUP_MODES.UNCONFIGURED,
        activeBackend: backend,
        activeModel,
      }).catch(() => false);
    },
    [clearConnectionDrafts, resetConnectionTest, settings.activeBackend, settings.activeModel, updateMultipleSettings]
  );

  const handleModelChange = useCallback(
    async (model) => {
      resetConnectionTest();
      try {
        if (settings.setupMode === SETUP_MODES.FULL) {
          await updateSettings('setupMode', SETUP_MODES.UNCONFIGURED);
        }
        await updateSettings('activeModel', model);
        return true;
      } catch {
        // The persistent error banner explains what failed.
        return false;
      }
    },
    [resetConnectionTest, settings.setupMode, updateSettings]
  );

  const handlePromptChange = useCallback(
    (prompt) => {
      saveSetting('customPrompt', prompt);
    },
    [saveSetting]
  );

  const handleApiKeyChange = useCallback(
    async (value) => {
      resetConnectionTest();
      const keyMap = {
        [LLM_BACKENDS.ANTHROPIC]: 'anthropicApiKey',
        [LLM_BACKENDS.OPENAI]: 'openaiApiKey',
        [LLM_BACKENDS.DEEPSEEK]: 'deepseekApiKey',
        [LLM_BACKENDS.OLLAMA]: 'ollamaBaseUrl',
        [LLM_BACKENDS.CUSTOM]: 'customEndpointUrl',
      };
      const settingKey = keyMap[settings.activeBackend];
      if (settingKey) {
        if (settings.setupMode === SETUP_MODES.FULL) {
          await updateSettings('setupMode', SETUP_MODES.UNCONFIGURED);
        }
        const customOriginChanged = settingKey === 'customEndpointUrl'
          && hasEndpointOriginChanged(settings.customEndpointUrl, value);
        const saved = await updateSettings(settingKey, value);
        if (customOriginChanged) {
          // Main clears the secret when the trust boundary changes. Mirror that
          // write so the redacted renderer flag cannot keep saying “已保存”.
          await updateSettings('customEndpointApiKey', '');
        }
        return saved;
      }
    },
    [resetConnectionTest, settings, updateSettings]
  );

  const handleCustomApiKeyChange = useCallback(
    async (value) => {
      resetConnectionTest();
      if (settings.setupMode === SETUP_MODES.FULL) {
        await updateSettings('setupMode', SETUP_MODES.UNCONFIGURED);
      }
      return updateSettings('customEndpointApiKey', value);
    },
    [resetConnectionTest, settings.setupMode, updateSettings]
  );

  const handleCredentialDelete = useCallback(
    async (deleteCredential) => {
      // Invalidate a previously successful probe before the first persisted
      // write so a late response cannot briefly re-enable the old credential.
      resetConnectionTest();
      try {
        await updateSettings('setupMode', SETUP_MODES.UNCONFIGURED);
        await deleteCredential();
        return true;
      } catch {
        throw new Error('settings-save-failed');
      }
    },
    [resetConnectionTest, updateSettings]
  );

  const activateMode = useCallback(
    async (mode) => {
      const translationOnly = mode === SETUP_MODES.TRANSLATION_ONLY;
      if (
        !translationOnly &&
        (
          !isBackendReadyForFullAnalysis(settings) ||
          hasUnsavedConnectionDraft ||
          settingsSaving ||
          !hasCurrentSuccessfulConnectionTest ||
          connectionTest.connectionRevision !== connectionRevisionRef.current ||
          connectionTest.processingConfigGeneration !== processingConfigGenerationRef.current
        )
      ) return;
      try {
        await updateMultipleSettings(translationOnly ? {
          setupMode: mode,
          activeBackend: LLM_BACKENDS.FREE_TRANSLATE,
          activeModel: MODEL_IDS[LLM_BACKENDS.FREE_TRANSLATE][0],
        } : { setupMode: mode });
        onSetupComplete?.();
      } catch {
        // The persistent error banner explains what failed.
      }
    },
    [
      connectionTest,
      hasCurrentSuccessfulConnectionTest,
      hasUnsavedConnectionDraft,
      onSetupComplete,
      processingConfigGenerationRef,
      settings,
      settingsSaving,
      updateMultipleSettings,
    ]
  );

  const handleConnectionTest = useCallback(async () => {
    if (
      isTestingConnection ||
      hasUnsavedConnectionDraft ||
      settingsSaving ||
      !isBackendReadyForFullAnalysis(settings)
    ) return;
    const revision = connectionRevisionRef.current;
    const processingGeneration = processingConfigGenerationRef.current;
    setIsTestingConnection(true);
    setConnectionTest({ status: 'testing', code: 'testing' });
    const result = await testProviderConnection();
    if (
      connectionRevisionRef.current === revision &&
      processingConfigGenerationRef.current === processingGeneration
    ) {
      setConnectionTest({
        ...result,
        connectionRevision: revision,
        processingConfigGeneration: processingGeneration,
      });
      setIsTestingConnection(false);
    }
  }, [
    hasUnsavedConnectionDraft,
    isTestingConnection,
    processingConfigGenerationRef,
    settings,
    settingsSaving,
    testProviderConnection,
  ]);

  const handleClipboardToggle = useCallback(
    (e) => {
      saveSetting('clipboardMonitoring', e.target.checked);
    },
    [saveSetting]
  );

  const handleShortcutChange = useCallback(
    (key, value) => {
      const nextValue = value.trim();
      saveSetting(key, nextValue).then((saved) => {
        if (!saved) setShortcutDrafts((current) => ({ ...current, [key]: settings[key] }));
      });
    },
    [saveSetting, settings]
  );

  const handleReset = useCallback(async () => {
    if (confirmReset) {
      try {
        resetConnectionTest();
        clearConnectionDrafts();
        await resetSettings();
        setConfirmReset(false);
      } catch {
        // The persistent error banner explains what failed.
      }
    } else {
      setConfirmReset(true);
    }
  }, [clearConnectionDrafts, confirmReset, resetConnectionTest, resetSettings]);

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
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
          className="settings-return-button"
          type="button"
          autoFocus
          onClick={onClose}
          aria-label={settings.setupMode === SETUP_MODES.UNCONFIGURED ? '返回首次使用选择' : '返回主面板'}
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
          <ArrowLeft size={17} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          {settings.setupMode === SETUP_MODES.UNCONFIGURED ? '返回选择' : '返回'}
        </button>
      </div>

      {/* Scrollable content */}
      <div style={scrollStyle}>
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '10px 12px',
            marginBottom: 14,
            border: '1px solid var(--border-primary)',
            borderRadius: 9,
            background: settings.setupMode === SETUP_MODES.UNCONFIGURED ? 'var(--warning-bg)' : 'var(--surface-soft)',
          }}
        >
          <span style={{ display: 'grid', gap: 2 }}>
            <small style={{ color: 'var(--text-tertiary)', fontSize: 11, fontWeight: 700 }}>当前功能模式</small>
            <strong style={{ color: 'var(--text-primary)', fontSize: 12 }}>{modeLabel(settings.setupMode)}</strong>
          </span>
          <small style={{ maxWidth: 250, color: 'var(--text-secondary)', fontSize: 11, lineHeight: 1.5, textAlign: 'right' }}>
            {settings.setupMode === SETUP_MODES.FULL
              ? '会生成翻译、行动、材料、日期、术语与原文依据。'
              : settings.setupMode === SETUP_MODES.TRANSLATION_ONLY
                ? '只提供翻译，不生成行动简报。'
                : '完成下面的选择后才能开始使用。'}
          </small>
        </div>

        {/* Analysis service selector */}
        <div style={sectionTitleStyle}>1 选择处理方式</div>
        <div
          className="backend-options"
          style={{
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          {BACKEND_OPTIONS.map((opt) => {
            const isSelected = settings.activeBackend === opt.value;
            return (
              <button
                className="backend-option-button"
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

        {settings.activeBackend === LLM_BACKENDS.FREE_TRANSLATE && (
          <div style={{ padding: '11px 12px', marginBottom: 12, borderRadius: 9, background: 'var(--warning-bg)', color: 'var(--warning)', fontSize: 11, lineHeight: 1.5 }}>
            <strong style={{ display: 'block', marginBottom: 3 }}>基础翻译的范围有限</strong>
            不会生成行动步骤、材料清单、截止日期、术语解释或流程说明。
            {settings.setupMode !== SETUP_MODES.TRANSLATION_ONLY && (
              <button
                type="button"
                className="translation-only-confirm-button"
                onClick={() => activateMode(SETUP_MODES.TRANSLATION_ONLY)}
                style={{ display: 'block', width: '100%', marginTop: 9, padding: '8px 10px', border: '1px solid var(--warning)', borderRadius: 8, background: 'var(--surface-raised)', color: 'var(--warning)', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}
              >
                确认只用基础翻译
              </button>
            )}
          </div>
        )}

        {/* API Key section — hidden for free_translate */}
        {settings.activeBackend !== LLM_BACKENDS.FREE_TRANSLATE && (
          <>
            <div style={sectionTitleStyle}>2 保存连接信息</div>
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
              onDelete={() => handleCredentialDelete(() => handleApiKeyChange(''))}
              onDraftStateChange={handlePrimaryDraftState}
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
                onDelete={() => handleCredentialDelete(() => handleCustomApiKeyChange(''))}
                onDraftStateChange={handleCustomKeyDraftState}
                isSaved={settings.hasCustomEndpointApiKey}
              />
            )}

            {/* Model selector */}
            <div style={{ ...sectionTitleStyle, marginTop: 4 }}>分析模型</div>
            <ModelSelector
              backend={settings.activeBackend}
              value={settings.activeModel}
              onChange={handleModelChange}
              onDraftStateChange={handleModelDraftState}
            />

            <div style={{ ...sectionTitleStyle, marginTop: 12 }}>3 测试服务与模型</div>
            <div className="provider-connection-card">
              <strong style={{ display: 'block', marginBottom: 3 }}>
                {isBackendReadyForFullAnalysis(settings) ? '必需连接信息已填写，尚未验证' : '继续填写连接信息'}
              </strong>
              <p>
                {isBackendReadyForFullAnalysis(settings)
                  ? '你可以先检查凭据、服务和当前模型是否可访问。填写完成本身不代表已经连通。'
                  : '完成上方必需信息后，才能测试当前服务与模型。'}
              </p>
              <small className="provider-connection-privacy">
                测试只请求模型元数据，不会发送截图、剪贴板或任何待分析原文；不会检验结构化输出兼容性
              </small>
              <button
                type="button"
                className="provider-connection-test-button"
                disabled={
                  !isBackendReadyForFullAnalysis(settings) ||
                  hasUnsavedConnectionDraft ||
                  settingsSaving ||
                  isTestingConnection
                }
                onClick={handleConnectionTest}
                aria-busy={isTestingConnection}
              >
                {hasUnsavedConnectionDraft
                  ? '请先保存当前输入…'
                  : settingsSaving
                  ? '正在保存设置…'
                  : isTestingConnection
                    ? '正在测试模型元数据…'
                    : '测试服务与模型'}
              </button>
              {connectionTest.status !== 'idle' && connectionTest.status !== 'testing' && (
                <div
                  className="provider-connection-result"
                  data-status={connectionTest.status}
                  role="status"
                  aria-live="polite"
                >
                  <strong>{(CONNECTION_RESULT_COPY[connectionTest.code] || CONNECTION_RESULT_COPY['invalid-response'])[0]}</strong>
                  <span>{(CONNECTION_RESULT_COPY[connectionTest.code] || CONNECTION_RESULT_COPY['invalid-response'])[1]}</span>
                </div>
              )}
            </div>

            <div style={{ ...sectionTitleStyle, marginTop: 12 }}>4 启用完整分析</div>
            <div style={{ padding: '11px 12px', marginBottom: 12, borderRadius: 9, background: 'var(--accent-light)', color: 'var(--accent-ink)', fontSize: 11, lineHeight: 1.5 }}>
              <strong style={{ display: 'block', marginBottom: 3 }}>
                {settings.setupMode === SETUP_MODES.FULL ? '完整分析已启用' : '功能模式由你决定'}
              </strong>
              {settings.setupMode === SETUP_MODES.FULL
                ? '连接测试只检查当前配置，不会更改已经选择的功能模式。'
                : hasCurrentSuccessfulConnectionTest
                  ? '当前已保存配置通过了元数据连接测试。启用仍由你决定。'
                  : isBackendReadyForFullAnalysis(settings)
                    ? '第一次启用前，必须让当前已保存配置通过上方元数据连接测试。测试通过也不会自动启用。'
                  : '完成上方必需信息后，才能启用完整分析。'}
              {settings.setupMode !== SETUP_MODES.FULL && (
                <button
                  type="button"
                  className="full-analysis-enable-button"
                  disabled={
                    !isBackendReadyForFullAnalysis(settings) ||
                    hasUnsavedConnectionDraft ||
                    settingsSaving ||
                    !hasCurrentSuccessfulConnectionTest
                  }
                  onClick={() => activateMode(SETUP_MODES.FULL)}
                  style={{ display: 'block', width: '100%', marginTop: 9, padding: '8px 10px', border: 'none', borderRadius: 8, background: 'var(--accent)', color: '#fff', cursor: hasCurrentSuccessfulConnectionTest ? 'pointer' : 'not-allowed', opacity: hasCurrentSuccessfulConnectionTest ? 1 : 0.48, fontSize: 11, fontWeight: 700 }}
                >
                  {hasCurrentSuccessfulConnectionTest ? '完成配置并启用完整分析' : '请先通过当前配置的连接测试'}
                </button>
              )}
              {isBackendReadyForFullAnalysis(settings) && (
                <small style={{ display: 'block', marginTop: 7, color: 'var(--text-secondary)', fontSize: 11, lineHeight: 1.5 }}>
                  首次处理仍可能遇到服务、模型名称或网络错误；Slipstream 会明确提示，不会把基础翻译显示成完整结果。
                </small>
              )}
            </div>
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
            基础翻译无需配置，使用 Google / MyMemory 翻译接口。如需行动、材料、日期、术语和流程解释，请选择一种完整分析服务并完成连接。
          </div>
        )}

        {settings.activeBackend !== LLM_BACKENDS.OLLAMA && (
          <div style={{ padding: '10px 12px', marginTop: 8, fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', borderRadius: 8 }}>
            当前服务会收到你主动提交的文字。剪贴板监控默认关闭，开启后复制的新文字也会自动提交。
          </div>
        )}

        {saveError && <div role="alert" style={{ marginTop: 10, color: 'var(--error)', fontSize: 12 }}>{saveError}</div>}

        {/* Language hint */}
        <LanguageToggle />

        <details style={{ marginTop: 16 }}>
          <summary style={{ color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
            高级分析说明（可选）
          </summary>
          <div style={{ marginTop: 8 }}>
            <PromptEditor
              value={settings.customPrompt}
              onChange={handlePromptChange}
            />
          </div>
        </details>

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
              userSelect: 'none',
            }}
          >
            自动检测剪贴板
          </span>
          <label
            className="clipboard-monitor-toggle"
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
              aria-label="自动检测剪贴板"
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

        <div style={sectionTitleStyle}>官方来源核验</div>
        <div className="verification-policy" role="radiogroup" aria-label="官方来源核验策略">
          {VERIFICATION_OPTIONS.map((option) => {
            const selected = (settings.verificationPolicy || 'ask') === option.value;
            return (
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                key={option.value}
                className={selected ? 'is-selected' : ''}
                onClick={() => saveSetting('verificationPolicy', option.value)}
              >
                <ShieldCheck size={19} weight={selected ? 'fill' : 'regular'} />
                <span><strong>{option.label}</strong><small>{option.detail}</small></span>
              </button>
            );
          })}
        </div>

        <div style={sectionTitleStyle}>快捷键</div>
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
            剪贴板解释
          </span>
          <input
            className="slipstream-input"
            value={shortcutDrafts.clipboardShortcut}
            onChange={(e) => setShortcutDrafts((current) => ({ ...current, clipboardShortcut: e.target.value }))}
            onBlur={(e) => handleShortcutChange('clipboardShortcut', e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            placeholder="Alt+C"
          />
        </label>
        <label style={{ display: 'block' }}>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
            截图 OCR
          </span>
          <input
            className="slipstream-input"
            value={shortcutDrafts.screenshotShortcut}
            onChange={(e) => setShortcutDrafts((current) => ({ ...current, screenshotShortcut: e.target.value }))}
            onBlur={(e) => handleShortcutChange('screenshotShortcut', e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
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
              清除数据并恢复所有设置
            </button>
          ) : (
            <div role="alert" style={{ display: 'grid', gap: 9, padding: 11, border: '1px solid color-mix(in srgb, var(--error) 35%, var(--border-primary))', borderRadius: 9, background: 'var(--error-bg)', textAlign: 'left' }}>
              <p style={{ color: 'var(--error)', fontSize: 11, lineHeight: 1.55 }}>
                这会清除全部 API Key 和连接凭据、保存的术语及所有设置，并重新显示首次使用选择。此操作无法在应用内撤销。
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={handleReset}
                  aria-label="确认清除凭据、术语和全部设置"
                  style={{
                    padding: '8px 12px',
                    fontSize: 11,
                    border: 'none',
                    borderRadius: 8,
                    backgroundColor: 'var(--error)',
                    color: '#FFF',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  清除凭据、术语和设置
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  aria-label="取消清除"
                  style={{
                    padding: '8px 12px',
                    fontSize: 11,
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
