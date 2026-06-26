import React, { useState, useRef, useCallback, useEffect } from 'react';
import ResultDisplay from './ResultDisplay';
import StatusBar from './StatusBar';
import { useIpc } from '../hooks/useIpc';
import { useClipboard } from '../hooks/useClipboard';
import { useSettings } from '../hooks/useSettings';
import { STATUS, IPC_CHANNELS, DEFAULTS } from '../../shared/constants';

export default function FloatingPanel({ onOpenSettings }) {
  const [inputText, setInputText] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(STATUS.IDLE);
  const debounceRef = useRef(null);
  const processingRef = useRef(false);

  const { invoke, on } = useIpc();
  const { clipboardText, clearClipboard } = useClipboard();
  const { settings, updateSettings } = useSettings();

  // Style for kbd elements in shortcut hints
  const kbdStyle = {
    display: 'inline-block',
    padding: '1px 4px',
    fontSize: 10,
    fontFamily: 'inherit',
    lineHeight: 1.4,
    color: 'var(--text-secondary, #6B7280)',
    backgroundColor: 'var(--bg-tertiary, #F3F4F6)',
    border: '1px solid var(--border-secondary, #E5E7EB)',
    borderRadius: 3,
    marginRight: 1,
  };

  // Ref to hold latest triggerProcessing to avoid stale closures in effects
  const triggerProcessingRef = useRef(null);
  useEffect(() => {
    triggerProcessingRef.current = triggerProcessing;
  }, [triggerProcessing]);

  // Handle clipboard auto-fill with debounce
  useEffect(() => {
    if (clipboardText && clipboardText.trim()) {
      setInputText(clipboardText);
      setError(null);

      // Auto-trigger processing after debounce if clipboard monitoring is on
      if (settings.clipboardMonitoring && !processingRef.current) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          if (triggerProcessingRef.current) triggerProcessingRef.current(clipboardText);
        }, 500);
      }
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [clipboardText]);

  // Listen for OCR results
  useEffect(() => {
    const unsubResult = on(IPC_CHANNELS.OCR_RESULT, (text) => {
      if (text && text.trim()) {
        setInputText(text);
        // Auto-trigger processing after OCR (via ref to avoid stale closure)
        if (triggerProcessingRef.current) triggerProcessingRef.current(text);
      }
    });

    const unsubError = on(IPC_CHANNELS.OCR_ERROR, (payload) => {
      const errMsg = typeof payload === 'string' ? payload : (payload?.error || 'OCR 识别失败');
      setError(errMsg);
      setStatus(STATUS.ERROR);
    });

    return () => {
      unsubResult();
      unsubError();
    };
  }, []);

  // Listen for LLM processing errors only (result comes via invoke return)
  useEffect(() => {
    const unsubError = on(IPC_CHANNELS.LLM_ERROR, (payload) => {
      const errMsg = typeof payload === 'string' ? payload : (payload?.error || 'LLM 处理失败');
      setError(errMsg);
      setStatus(STATUS.ERROR);
      processingRef.current = false;
    });

    return () => {
      unsubError();
    };
  }, []);

  const triggerProcessing = useCallback(
    async (text) => {
      let textToProcess = text || inputText;
      if (!textToProcess || !textToProcess.trim()) return;

      if (textToProcess.length > DEFAULTS.MAX_TEXT_LENGTH) {
        textToProcess = textToProcess.slice(0, DEFAULTS.MAX_TEXT_LENGTH);
        setError('文本过长，已截断至 10,000 字符');
      }

      if (processingRef.current) return;
      processingRef.current = true;

      setStatus(STATUS.PROCESSING);
      setError(null);
      setResult('');

      try {
        const _result = await invoke(IPC_CHANNELS.LLM_PROCESS, {
          text: textToProcess,
          backend: settings.activeBackend,
          model: settings.activeModel,
          promptTemplate: settings.customPrompt,
          languageHint: settings.languageHint,
        });
        // Set result from invoke return
        if (_result && _result.success) {
          setResult(_result.text || '');
          setStatus(STATUS.DONE);
        } else {
          setError(_result?.error || '处理失败');
          setStatus(STATUS.ERROR);
        }
      } catch (err) {
        const msg = typeof err === 'string' ? err : (err?.message || '处理失败');
        setError(msg);
        setStatus(STATUS.ERROR);
      } finally {
        processingRef.current = false;
      }
    },
    [settings.activeBackend, settings.activeModel, settings.customPrompt, settings.languageHint, invoke]
  );

  const handleScreenshot = useCallback(async () => {
    try {
      setError(null);
      setStatus(STATUS.PROCESSING);
      await invoke(IPC_CHANNELS.SCREENSHOT_CAPTURE);
      // Status will be set by the OCR result handler or triggerProcessing
    } catch (err) {
      const msg = typeof err === 'string' ? err : (err?.message || '截图失败');
      setError(msg);
      setStatus(STATUS.ERROR);
    }
  }, [invoke]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setInputText(text);
      }
    } catch (err) {
      // Fallback: clipboard read failed silently
    }
  }, []);

  const handleClear = useCallback(() => {
    setInputText('');
    setResult('');
    setError(null);
    setStatus(STATUS.IDLE);
    clearClipboard();
  }, [clearClipboard]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'var(--bg-primary)',
        backdropFilter: 'blur(12px)',
        borderRadius: 12,
        border: '1px solid var(--border-primary)',
        overflow: 'hidden',
        boxShadow: 'var(--shadow)',
        color: 'var(--text-primary)',
      }}
    >
      {/* Title bar — drag region */}
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
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: -0.3 }}>
          Slipstream
        </span>
        <button
          type="button"
          onClick={() => { if (onOpenSettings) onOpenSettings(); }}
          style={{
            WebkitAppRegion: 'no-drag',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 18,
            padding: 4,
            lineHeight: 1,
            color: '#9CA3AF',
            borderRadius: 4,
            transition: 'color 0.15s, background-color 0.15s',
          }}
          title="设置"
          aria-label="打开设置"
          onMouseEnter={(e) => {
            e.target.style.color = '#374151';
            e.target.style.backgroundColor = '#F3F4F6';
          }}
          onMouseLeave={(e) => {
            e.target.style.color = '#9CA3AF';
            e.target.style.backgroundColor = 'transparent';
          }}
        >
          <span style={{display:'block', lineHeight:1}}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{display:'block'}}>
              <path d="M8 10a2 2 0 100-4 2 2 0 000 4z" fill="currentColor"/>
              <path fillRule="evenodd" clipRule="evenodd" d="M7.34.5H8.66l.26.9c.42.14.82.32 1.2.54l.86-.38.92.92-.38.86c.22.38.4.78.54 1.2l.9.26v1.32l-.9.26c-.14.42-.32.82-.54 1.2l.38.86-.92.92-.86-.38c-.38.22-.78.4-1.2.54l-.26.9H7.34l-.26-.9a5.02 5.02 0 01-1.2-.54l-.86.38-.92-.92.38-.86a5.02 5.02 0 01-.54-1.2L2.5 8.66V7.34l.9-.26c.14-.42.32-.82.54-1.2l-.38-.86.92-.92.86.38c.38-.22.78-.4 1.2-.54L7.34.5zM8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11z" fill="currentColor"/>
            </svg>
          </span>
        </button>
      </div>

      {/* Input area */}
      <div
        style={{
          WebkitAppRegion: 'no-drag',
          padding: '12px 16px 8px',
          flexShrink: 0,
        }}
      >
        <div style={{ position: 'relative' }}>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                triggerProcessing();
              }
            }}
            placeholder="粘贴文本、复制文本后等待自动检测，或点击截图按钮..."
            rows={4}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: 13,
              border: '1px solid var(--border-secondary)',
              borderRadius: 8,
              outline: 'none',
              resize: 'none',
              fontFamily: 'inherit',
              lineHeight: 1.5,
              boxSizing: 'border-box',
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              transition: 'border-color 0.15s, box-shadow 0.15s',
            }}
            onFocus={(e) => {
              e.target.style.borderColor = 'var(--accent)';
              e.target.style.boxShadow = '0 0 0 3px var(--accent-light)';
            }}
            onBlur={(e) => {
              e.target.style.borderColor = 'var(--border-secondary)';
              e.target.style.boxShadow = 'none';
            }}
          />
          {inputText && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="清空输入"
              style={{
                position: 'absolute',
                right: 8,
                top: 8,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 11,
                color: '#9CA3AF',
                padding: '2px 6px',
                borderRadius: 4,
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => { e.target.style.color = '#EF4444'; }}
              onMouseLeave={(e) => { e.target.style.color = '#9CA3AF'; }}
            >
              清空
            </button>
          )}
        </div>

        {/* Action buttons */}
        <div
          style={{
            display: 'flex',
            gap: 6,
            marginTop: 8,
          }}
        >
          <button
            type="button"
            onClick={handleScreenshot}
            aria-label="截图并识别文字"
            style={{
              flex: 1,
              padding: '7px 10px',
              fontSize: 12,
              border: '1px solid #D1D5DB',
              borderRadius: 8,
              backgroundColor: '#FFF',
              cursor: 'pointer',
              color: '#374151',
              transition: 'background-color 0.15s, border-color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.target.style.backgroundColor = '#F9FAFB';
              e.target.style.borderColor = '#9CA3AF';
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = '#FFF';
              e.target.style.borderColor = '#D1D5DB';
            }}
          >
            截图 (OCR)
          </button>
          <button
            type="button"
            onClick={handlePaste}
            aria-label="从剪贴板粘贴"
            style={{
              flex: 1,
              padding: '7px 10px',
              fontSize: 12,
              border: '1px solid #D1D5DB',
              borderRadius: 8,
              backgroundColor: '#FFF',
              cursor: 'pointer',
              color: '#374151',
              transition: 'background-color 0.15s, border-color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.target.style.backgroundColor = '#F9FAFB';
              e.target.style.borderColor = '#9CA3AF';
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = '#FFF';
              e.target.style.borderColor = '#D1D5DB';
            }}
          >
            粘贴
          </button>
          <button
            type="button"
            onClick={() => triggerProcessing()}
            disabled={status === STATUS.PROCESSING || !inputText?.trim()}
            aria-label="处理文本"
            style={{
              flex: 1,
              padding: '7px 10px',
              fontSize: 12,
              border: 'none',
              borderRadius: 8,
              backgroundColor: status === STATUS.PROCESSING ? '#93C5FD' : '#3B82F6',
              cursor: status === STATUS.PROCESSING || !inputText?.trim() ? 'not-allowed' : 'pointer',
              color: '#FFF',
              fontWeight: 600,
              transition: 'background-color 0.15s',
            }}
          >
            处理
          </button>
        </div>

        {/* Shortcut hints — only when idle */}
        {status === STATUS.IDLE && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: 12,
              marginTop: 4,
              fontSize: 10,
              color: 'var(--text-tertiary, #9CA3AF)',
              userSelect: 'none',
            }}
          >
            <span><kbd style={kbdStyle}>F2</kbd> 显示/隐藏</span>
            <span><kbd style={kbdStyle}>⌘⇧S</kbd> 截图</span>
            <span><kbd style={kbdStyle}>⌘↵</kbd> 处理</span>
          </div>
        )}
      </div>

      {/* Result area */}
      <div
        style={{
          WebkitAppRegion: 'no-drag',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          borderTop: '1px solid var(--bg-tertiary)',
        }}
      >
        <ResultDisplay result={result} error={error} status={status} />
      </div>

      {/* Status bar */}
      <StatusBar status={status} error={error} />
    </div>
  );
}
