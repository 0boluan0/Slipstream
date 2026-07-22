import React, { useState, useEffect } from 'react';
import { Circle, WarningCircle } from '@phosphor-icons/react';
import constants from '../../shared/constants';

const { STATUS } = constants;

const colorMap = {
  [STATUS.IDLE]: { bg: 'var(--text-tertiary)', label: '就绪' },
  [STATUS.PROCESSING]: { bg: 'var(--accent)', label: '处理中' },
  [STATUS.DONE]: { bg: 'var(--success)', label: '完成' },
  [STATUS.ERROR]: { bg: 'var(--error)', label: '出错' },
};

export default function StatusBar({ status, error, warning, processingTimeMs, clipboardMonitoring, backend }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const colors = colorMap[status] || colorMap[STATUS.IDLE];
  const isProcessing = status === STATUS.PROCESSING;
  const isError = status === STATUS.ERROR;
  const message = isError && error
    ? (warning ? `${error} · ${warning}` : error)
    : warning || (status === STATUS.DONE && processingTimeMs != null ? `完成 · ${(processingTimeMs / 1000).toFixed(1)}s` : colors.label);

  const dotClassName = isProcessing ? 'slipstream-pulse' : undefined;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 12px',
        borderTop: '1px solid var(--border-primary)',
        backgroundColor: isError ? 'var(--error-bg)' : 'var(--bg-tertiary)',
        fontSize: 11,
        color: isError ? 'var(--error)' : 'var(--text-secondary)',
        minHeight: 24,
        flexShrink: 0,
      }}
    >
      {status === STATUS.IDLE && clipboardMonitoring && (
        <span style={{ color: 'var(--text-tertiary)', fontSize: 10, marginRight: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Circle size={8} weight="fill" /> 剪贴板监听中
        </span>
      )}
      <Circle size={8} weight="fill" color={colors.bg} className={dotClassName} />
      <span style={{ flex: 1 }}>
        {message}
      </span>
      {!isOnline && (
        <span style={{ color: 'var(--error)', fontSize: 11, marginRight: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}><WarningCircle size={14} />离线</span>
      )}
      <span title="当前处理后端" style={{ color: 'var(--text-tertiary)' }}>{backend}</span>
    </div>
  );
}
