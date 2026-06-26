import React, { useState, useEffect } from 'react';
import { STATUS } from '../../shared/constants';

const colorMap = {
  [STATUS.IDLE]: { bg: 'var(--text-tertiary)', label: 'idle' },
  [STATUS.PROCESSING]: { bg: 'var(--accent)', label: 'processing' },
  [STATUS.DONE]: { bg: 'var(--success)', label: 'done' },
  [STATUS.ERROR]: { bg: 'var(--error)', label: 'error' },
};

export default function StatusBar({ status, error, processingTimeMs, clipboardMonitoring }) {
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

  const dotStyle = {
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: colors.bg,
    flexShrink: 0,
  };

  const dotClassName = isProcessing ? 'slipstream-pulse' : undefined;

  return (
    <div
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
        <span style={{ color: 'var(--text-tertiary)', fontSize: 10, marginRight: 8 }}>
          {'●'} 剪贴板监听中
        </span>
      )}
      <div style={dotStyle} className={dotClassName} />
      <span style={{ flex: 1 }}>
        {isError && error ? error : (colors.label === 'idle' ? '就绪' : (status === STATUS.DONE && processingTimeMs != null ? `完成 · ${(processingTimeMs / 1000).toFixed(1)}s` : colors.label))}
      </span>
      {!isOnline && (
        <span style={{ color: 'var(--error)', fontSize: 11, marginRight: 8 }}>⚠ 离线</span>
      )}
    </div>
  );
}
