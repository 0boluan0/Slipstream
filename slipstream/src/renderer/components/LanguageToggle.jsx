import React from 'react';
import { ArrowRight, LockSimple } from '../phosphorIcons';

export default function LanguageToggle() {
  return (
    <div style={{ marginBottom: 12 }}>
      <span
        style={{
          display: 'block',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 4,
        }}
      >
        语言方向
      </span>
      <div
        role="status"
        aria-label="当前版本固定将英文解释为中文"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '9px 10px',
          border: '1px solid var(--border-secondary)',
          borderRadius: 8,
          background: 'var(--bg-tertiary)',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)', fontSize: 12, fontWeight: 650 }}>
          英文 <ArrowRight size={14} /> 中文
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-tertiary)', fontSize: 10 }}>
          <LockSimple size={12} /> V1 固定
        </span>
      </div>
      <p style={{ marginTop: 4, color: 'var(--text-tertiary)', fontSize: 10, lineHeight: 1.45 }}>
        当前版本只处理英文原文，并始终用中文输出结果。
      </p>
    </div>
  );
}
