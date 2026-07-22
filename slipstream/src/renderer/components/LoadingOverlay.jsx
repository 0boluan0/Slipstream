import React, { useEffect, useState } from 'react';
import { CheckCircle, LinkSimple, ListChecks, SpinnerGap, TextAa, X } from '@phosphor-icons/react';

const STAGES = [
  { label: '整理完整原文', detail: '保留段落、日期与材料名称', Icon: TextAa },
  { label: '提取行动与术语', detail: '区分原文明示与模型推断', Icon: ListChecks },
  { label: '建立证据映射', detail: '让每条结论都能回到原文', Icon: LinkSimple },
];

const TRANSLATION_STAGES = [
  { label: '读取完整原文', detail: '保留段落、日期与信息顺序', Icon: TextAa },
  { label: '生成基础翻译', detail: '逐句或逐段翻译，不做行动推断', Icon: ListChecks },
  { label: '整理译文顺序', detail: '检查是否遗漏明显段落', Icon: LinkSimple },
];

export default function LoadingOverlay({ visible, sourcePreview, onCancel, translationOnly = false }) {
  const [activeStage, setActiveStage] = useState(0);
  const stages = translationOnly ? TRANSLATION_STAGES : STAGES;

  useEffect(() => {
    if (!visible) return undefined;
    setActiveStage(0);
    const secondStage = window.setTimeout(() => setActiveStage(1), 900);
    const thirdStage = window.setTimeout(() => setActiveStage(2), 2100);
    return () => {
      window.clearTimeout(secondStage);
      window.clearTimeout(thirdStage);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <section className="processing-card" aria-live="polite" aria-label="处理进度">
      <div className="processing-card__header">
        <div>
          <p className="eyebrow">正在处理</p>
          <h2>{translationOnly ? '按原文顺序生成完整翻译' : '把原文整理成可追溯的行动结论'}</h2>
        </div>
        {onCancel && (
          <button type="button" className="icon-button" onClick={onCancel} aria-label="取消处理" title="取消处理">
            <X size={18} weight="bold" />
          </button>
        )}
      </div>

      {sourcePreview && <p className="processing-preview">{sourcePreview}</p>}

      <ol className="processing-steps">
        {stages.map(({ label, detail, Icon }, index) => {
          const complete = index < activeStage;
          const active = index === activeStage;
          return (
            <li key={label} className={`processing-step${active ? ' is-active' : ''}${complete ? ' is-complete' : ''}`}>
              <span className="processing-step__icon" aria-hidden="true">
                {complete ? (
                  <CheckCircle size={20} weight="fill" />
                ) : active ? (
                  <SpinnerGap size={20} className="spin" />
                ) : (
                  <Icon size={20} />
                )}
              </span>
              <span>
                <strong>{label}</strong>
                <small>{detail}</small>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export { STAGES as PROCESSING_STAGES };
