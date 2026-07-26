import React, { useState } from 'react';
import { ArrowRight, Check, LockKey, Translate } from '@phosphor-icons/react';
import constants from '../../shared/constants';
import { SETUP_MODES } from '../utils/setupReadiness.mjs';
import './SetupGate.css';

const { LLM_BACKENDS, MODEL_IDS } = constants;

export default function SetupGate({ settingsController, onConfigureFull, loading = false }) {
  const { updateMultipleSettings, saveError } = settingsController;
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState('');

  if (loading) {
    return (
      <main className="setup-gate setup-gate--loading" aria-busy="true" aria-label="正在读取设置">
        <div className="setup-loading-mark" aria-hidden="true">S</div>
        <p>正在准备 Slipstream…</p>
      </main>
    );
  }

  const chooseTranslationOnly = async () => {
    setSaving(true);
    setLocalError('');
    try {
      await updateMultipleSettings({
        setupMode: SETUP_MODES.TRANSLATION_ONLY,
        activeBackend: LLM_BACKENDS.FREE_TRANSLATE,
        activeModel: MODEL_IDS[LLM_BACKENDS.FREE_TRANSLATE][0],
        languageHint: 'en',
      });
    } catch {
      setLocalError('暂时无法保存选择，请重试。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="setup-gate">
      <section className="setup-card" aria-labelledby="setup-title">
        <header className="setup-header">
          <span className="setup-eyebrow">首次使用</span>
          <h1 id="setup-title">先选择你希望获得哪种帮助</h1>
          <p>Slipstream V1 读取英文并用中文说明。开始前，请明确选择完整分析或只做基础翻译。</p>
        </header>

        <div className="setup-choice-grid">
          <article className="setup-choice setup-choice--recommended">
            <span className="setup-choice-badge">推荐</span>
            <div className="setup-choice-icon" aria-hidden="true"><Check size={22} weight="bold" /></div>
            <div>
              <h2>完整分析</h2>
              <p>不只翻译，还会告诉你接下来具体该做什么。</p>
            </div>
            <ul>
              <li><Check size={15} />完整中文翻译</li>
              <li><Check size={15} />行动步骤、材料与日期</li>
              <li><Check size={15} />陌生术语与社会流程解释</li>
              <li><Check size={15} />每条结论指回英文原文</li>
            </ul>
            <button type="button" className="setup-primary" onClick={onConfigureFull}>
              配置完整分析 <ArrowRight size={17} />
            </button>
            <small>需要连接你已有的在线或本地智能分析服务。</small>
          </article>

          <article className="setup-choice setup-choice--basic">
            <div className="setup-choice-icon" aria-hidden="true"><Translate size={22} /></div>
            <div>
              <h2>只用基础翻译</h2>
              <p>无需配置即可翻译，但不会生成完整行动简报。</p>
            </div>
            <div className="setup-limit" role="note">
              不包含行动步骤、材料清单、截止日期、术语解释或流程说明。
            </div>
            <button type="button" className="setup-secondary" disabled={saving} onClick={chooseTranslationOnly}>
              {saving ? '正在保存…' : '我明确选择只用基础翻译'}
            </button>
          </article>
        </div>

        {(localError || saveError) && <p className="setup-error" role="alert">{localError || '设置保存失败，请重试。'}</p>}

        <footer className="setup-privacy">
          <LockKey size={15} />
          <span>完整分析会发送给你选择的服务；基础翻译会发送给 Google / MyMemory。只有你主动处理的内容才会发送，剪贴板自动检测默认关闭。</span>
        </footer>
      </section>
    </main>
  );
}
