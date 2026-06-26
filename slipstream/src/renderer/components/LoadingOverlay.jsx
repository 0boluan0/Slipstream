import React from 'react';

export default function LoadingOverlay({ visible }) {
  if (!visible) return null;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.7)',
        zIndex: 50,
        backdropFilter: 'blur(2px)',
      }}
    >
      <div className="slipstream-spinner" />
    </div>
  );
}
