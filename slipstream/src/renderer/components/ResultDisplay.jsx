import React, { useState, useCallback } from 'react';
import LoadingOverlay from './LoadingOverlay';
import { STATUS } from '../../shared/constants';

function renderMarkdown(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const elements = [];
  let inCodeBlock = false;
  let codeContent = '';
  let listItems = [];
  let inList = false;
  let numberedItems = [];
  let inNumberedList = false;

  function flushList() {
    if (listItems.length > 0) {
      elements.push(
        React.createElement(
          'ul',
          { key: `ul-${elements.length}`, style: { listStyle: 'disc', paddingLeft: 20, margin: '6px 0', lineHeight: 1.6 } },
          ...listItems.map((item, i) =>
            React.createElement('li', { key: i, style: { fontSize: 13, color: '#374151' } }, item)
          )
        )
      );
      listItems = [];
      inList = false;
    }
  }

  function flushNumberedList() {
    if (numberedItems.length > 0) {
      elements.push(
        React.createElement(
          'ol',
          { key: `ol-${elements.length}`, style: { listStyle: 'decimal', paddingLeft: 20, margin: '6px 0', lineHeight: 1.6 } },
          ...numberedItems.map((item, i) =>
            React.createElement('li', { key: i, style: { fontSize: 13, color: '#374151' } }, item)
          )
        )
      );
      numberedItems = [];
      inNumberedList = false;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          React.createElement(
            'pre',
            {
              key: `code-${i}`,
              style: {
                backgroundColor: '#F3F4F6',
                borderRadius: 6,
                padding: 10,
                margin: '6px 0',
                fontSize: 11,
                fontFamily: 'monospace',
                overflowX: 'auto',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              },
            },
            codeContent
          )
        );
        codeContent = '';
        inCodeBlock = false;
      } else {
        flushList();
        flushNumberedList();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent += (codeContent ? '\n' : '') + line;
      continue;
    }

    if (!line.trim()) {
      flushList();
      flushNumberedList();
      continue;
    }

    // Numbered list
    const numberedMatch = line.match(/^(\d+)\.\s+(.+)/);
    if (numberedMatch) {
      if (!inNumberedList) {
        flushList();
        inNumberedList = true;
      }
      numberedItems.push(numberedMatch[2]);
      continue;
    } else if (inNumberedList) {
      flushNumberedList();
    }

    // Bullet list
    const bulletMatch = line.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      if (!inList) {
        flushNumberedList();
        inList = true;
      }
      listItems.push(bulletMatch[1]);
      continue;
    } else if (inList) {
      flushList();
    }

    // Bold header — line starts and ends with bold markers (entire line is bold)
    if (line.match(/^\*\*.+\*\*$/) && !line.slice(2, -2).includes('**')) {
      const content = line.replace(/\*\*(.+?)\*\*/g, '$1');
      elements.push(
        React.createElement(
          'h3',
          {
            key: i,
            style: {
              fontSize: 14,
              fontWeight: 700,
              color: '#1F2937',
              marginTop: 12,
              marginBottom: 4,
            },
          },
          content
        )
      );
      continue;
    }

    // Inline code and bold
    const processedLine = line.split(/(`[^`]+`)/g).map((part, idx) => {
      if (part.startsWith('`') && part.endsWith('`')) {
        return React.createElement(
          'code',
          {
            key: idx,
            style: {
              backgroundColor: '#F3F4F6',
              padding: '1px 4px',
              borderRadius: 3,
              fontSize: 11,
              fontFamily: 'monospace',
              color: '#BE185D',
            },
          },
          part.slice(1, -1)
        );
      }
      // Handle inline bold within non-code segments
      const boldParts = part.split(/(\*\*.+?\*\*)/g).map((subPart, subIdx) => {
        if (subPart.startsWith('**') && subPart.endsWith('**') && subPart.length > 4) {
          return React.createElement(
            'strong',
            {
              key: `b-${idx}-${subIdx}`,
              style: { fontWeight: 600 },
            },
            subPart.slice(2, -2)
          );
        }
        return subPart;
      });
      return boldParts.length > 1 ? React.createElement(React.Fragment, { key: idx }, ...boldParts) : part;
    });

    // Normal paragraph
    elements.push(
      React.createElement(
        'p',
        {
          key: i,
          style: {
            fontSize: 13,
            color: '#374151',
            lineHeight: 1.7,
            margin: '3px 0',
          },
        },
        ...processedLine
      )
    );
  }

  flushList();
  flushNumberedList();
  if (inCodeBlock) {
    elements.push(
      React.createElement(
        'pre',
        {
          key: 'code-last',
          style: {
            backgroundColor: '#F3F4F6',
            borderRadius: 6,
            padding: 10,
            margin: '6px 0',
            fontSize: 11,
            fontFamily: 'monospace',
            overflowX: 'auto',
            lineHeight: 1.5,
          },
        },
        codeContent
      )
    );
  }

  return elements.length > 0 ? elements : React.createElement('p', { style: { fontSize: 13, color: '#374151' } }, text);
}

export default function ResultDisplay({ result, error, status }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Clipboard API may fail in Electron without proper permissions
    }
  }, [result]);

  const containerStyle = {
    position: 'relative',
    flex: 1,
    overflowY: 'auto',
    padding: 16,
    minHeight: 0,
  };

  // Idle / empty state
  if (status === STATUS.IDLE || (!result && status !== STATUS.ERROR && status !== STATUS.PROCESSING)) {
    return (
      <div style={containerStyle}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            minHeight: 120,
            color: '#D1D5DB',
            fontSize: 13,
            textAlign: 'center',
          }}
        >
          <span>处理结果将显示在这里...</span>
        </div>
      </div>
    );
  }

  // Processing state
  if (status === STATUS.PROCESSING) {
    return (
      <div style={containerStyle}>
        <LoadingOverlay visible />
      </div>
    );
  }

  // Error state
  if (status === STATUS.ERROR && error) {
    return (
      <div style={containerStyle}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: 12,
            backgroundColor: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: 8,
          }}
        >
          <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{'⚠️'}</span>
          <span style={{ fontSize: 13, color: '#DC2626', lineHeight: 1.5 }}>
            {error}
          </span>
        </div>
      </div>
    );
  }

  // Done state
  return (
    <div style={containerStyle}>
      {status === STATUS.DONE && result && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            onClick={handleCopy}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 10px',
              fontSize: 11,
              border: '1px solid var(--border-secondary)',
              borderRadius: 6,
              backgroundColor: 'transparent',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              transition: 'background-color 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.target.style.backgroundColor = 'var(--bg-tertiary)';
              e.target.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = 'transparent';
              e.target.style.color = 'var(--text-secondary)';
            }}
          >
            {copied ? '✓ 已复制' : '📋 复制'}
          </button>
        </div>
      )}
      {renderMarkdown(result)}
    </div>
  );
}
