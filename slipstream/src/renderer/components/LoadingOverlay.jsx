import React from 'react';

export default function LoadingOverlay({ visible, message }) {
  if (!visible) return null;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-primary)',
        zIndex: 50,
        backdropFilter: 'blur(2px)',
        gap: 12,
      }}
    >
      <div className="slipstream-spinner" />
      {message && (
        <span
          style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            userSelect: 'none',
          }}
        >
          {message}
        </span>
      )}
    </div>
  );
}
