import React, { useState, useEffect } from 'react';
import { STATUS } from '../../shared/constants';

const colorMap = {
  [STATUS.IDLE]: { bg: '#9CA3AF', label: 'idle' },
  [STATUS.PROCESSING]: { bg: '#3B82F6', label: 'processing' },
  [STATUS.DONE]: { bg: '#10B981', label: 'done' },
  [STATUS.ERROR]: { bg: '#EF4444', label: 'error' },
};

export default function StatusBar({ status, error }) {
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
        borderTop: '1px solid #E5E7EB',
        backgroundColor: isError ? '#FEF2F2' : '#F9FAFB',
        fontSize: 11,
        color: isError ? '#DC2626' : '#6B7280',
        minHeight: 24,
        flexShrink: 0,
      }}
    >
      <div style={dotStyle} className={dotClassName} />
      <span style={{ flex: 1 }}>
        {isError && error ? error : (colors.label === 'idle' ? '就绪' : colors.label)}
      </span>
      {!isOnline && (
        <span style={{ color: 'var(--error)', fontSize: 11, marginRight: 8 }}>⚠ 离线</span>
      )}
    </div>
  );
}
