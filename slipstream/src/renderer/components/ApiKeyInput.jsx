import React, { useState, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeSlash, LockKey } from '../phosphorIcons';
import CredentialRemovalDialog from './CredentialRemovalDialog';
import { describeCredentialVisibility } from '../utils/credentialVisibility.mjs';
import { credentialDraftAfterSavedStateChange } from '../utils/settingsDraftGuard.mjs';

const LABEL_MAP = {
  anthropic: 'Anthropic API Key',
  openai: 'OpenAI API Key',
  deepseek: 'DeepSeek API Key',
  ollama: 'Ollama 服务地址',
  custom: '自定义 API 地址',
  custom_api_key: '自定义 API Key',
};

const PLACEHOLDER_MAP = {
  anthropic: 'sk-ant-...',
  openai: 'sk-...',
  deepseek: 'sk-...',
  ollama: 'http://localhost:11434',
  custom: 'https://api.example.com/v1',
  custom_api_key: 'sk-...',
};

export default function ApiKeyInput({
  backend,
  settingKey,
  value,
  onChange,
  onDelete,
  onDeleteFailureDismiss,
  onDraftStateChange,
  onDeleteConfirmationChange,
  isSaved = false,
  disabled = false,
  resetEpoch = 0,
  retryReceipt = null,
  inputId: providedInputId,
}) {
  const [showKey, setShowKey] = useState(false);
  const [draft, setDraft] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [operationNotice, setOperationNotice] = useState('');
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const deleteTriggerRef = useRef(null);
  const deleteInFlightRef = useRef(false);
  const draftRevisionRef = useRef(0);
  const failedDraftRevisionRef = useRef(null);
  const lastRetryReceiptIdRef = useRef(null);
  const latestValueRef = useRef(value);
  const previousCredentialStateRef = useRef({ backend, isSaved });
  const generatedInputId = useId();
  const generatedStoredNoticeId = useId();
  const inputId = providedInputId || generatedInputId;
  const storedNoticeId = `${providedInputId || generatedStoredNoticeId}-stored-notice`;
  const isUrlType = backend === 'ollama' || backend === 'custom';
  latestValueRef.current = value;

  const label = LABEL_MAP[backend] || 'API Key';
  const placeholder = PLACEHOLDER_MAP[backend] || (isUrlType ? '输入 URL...' : '输入 API Key...');
  const visiblePlaceholder = !isUrlType && isSaved ? '已保存，输入新值可替换' : placeholder;

  useEffect(() => {
    draftRevisionRef.current += 1;
    failedDraftRevisionRef.current = null;
    setDraft(isUrlType ? (latestValueRef.current || '') : '');
    setShowKey(false);
    setIsDirty(false);
    setConfirmDelete(false);
    setSaveFailed(false);
    setDeleteError('');
    setOperationNotice('');
    deleteInFlightRef.current = false;
    onDraftStateChange?.(false);
  }, [backend, isUrlType, onDraftStateChange, resetEpoch]);

  useEffect(() => {
    if (!isUrlType || isDirty) return;
    setDraft(value || '');
  }, [isDirty, isUrlType, value]);

  useEffect(() => {
    const receiptId = retryReceipt?.id;
    if (!Number.isSafeInteger(receiptId) || lastRetryReceiptIdRef.current === receiptId) return;
    lastRetryReceiptIdRef.current = receiptId;
    if (
      retryReceipt.status !== 'saved'
      || !settingKey
      || !retryReceipt.savedSettingKeys?.includes(settingKey)
    ) return;
    const failedRevision = failedDraftRevisionRef.current;
    if (failedRevision === null) return;
    failedDraftRevisionRef.current = null;
    setSaveFailed(false);
    setOperationNotice('');
    if (draftRevisionRef.current !== failedRevision) {
      setIsDirty(true);
      onDraftStateChange?.(true);
      return;
    }
    draftRevisionRef.current += 1;
    setDraft(isUrlType ? (latestValueRef.current || '') : '');
    setShowKey(false);
    setIsDirty(false);
    onDraftStateChange?.(false);
  }, [isUrlType, onDraftStateChange, retryReceipt, settingKey]);

  useEffect(() => {
    const previous = previousCredentialStateRef.current;
    previousCredentialStateRef.current = { backend, isSaved };
    const transition = credentialDraftAfterSavedStateChange({
      backend,
      previousBackend: previous.backend,
      previousIsSaved: previous.isSaved,
      isSaved,
      isUrlType,
      draft,
    });
    if (!transition.savedCredentialRemoved) return;

    // A recovery write or a custom endpoint origin change may remove the
    // persisted credential without owning the replacement visible here.
    setConfirmDelete(false);
    setIsDeleting(false);
    setDeleteError('');
    setOperationNotice(transition.hasUnsavedReplacement
      ? `${label} 原先保存的值已删除；新输入仍未保存。`
      : `${label} 已从这台 Mac 删除。`);
    setIsDirty(transition.hasUnsavedReplacement);
    deleteInFlightRef.current = false;
    onDraftStateChange?.(transition.hasUnsavedReplacement);
  }, [backend, draft, isSaved, isUrlType, label, onDraftStateChange]);

  useEffect(() => {
    onDeleteConfirmationChange?.(confirmDelete);
    return () => {
      if (confirmDelete) onDeleteConfirmationChange?.(false);
    };
  }, [confirmDelete, onDeleteConfirmationChange]);

  const updateDraft = (nextDraft) => {
    draftRevisionRef.current += 1;
    failedDraftRevisionRef.current = null;
    setDraft(nextDraft);
    if (!nextDraft) setShowKey(false);
    const normalized = nextDraft.trim();
    const dirty = isUrlType
      ? normalized !== String(value || '').trim()
      : Boolean(normalized);
    setIsDirty(dirty);
    setSaveFailed(false);
    setDeleteError('');
    setOperationNotice('');
    onDraftStateChange?.(dirty);
  };

  const commit = async () => {
    const nextValue = draft.trim();
    if (disabled || isSaving || !isDirty || (!isUrlType && !nextValue)) return false;
    const attemptedRevision = draftRevisionRef.current;
    setIsSaving(true);
    setSaveFailed(false);
    setOperationNotice('');
    try {
      const saved = await onChange(nextValue);
      if (saved === false) throw new Error('save-failed');
      if (!isUrlType) {
        setDraft('');
        setShowKey(false);
      }
      else setDraft(nextValue);
      draftRevisionRef.current += 1;
      failedDraftRevisionRef.current = null;
      setIsDirty(false);
      setOperationNotice(`${label} 已保存。`);
      onDraftStateChange?.(false);
      return true;
    } catch {
      // Keep the draft visible so the user can correct or retry it.
      failedDraftRevisionRef.current = attemptedRevision;
      setSaveFailed(true);
      onDraftStateChange?.(true);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (disabled || deleteInFlightRef.current) return false;
    deleteInFlightRef.current = true;
    setIsDeleting(true);
    setSaveFailed(false);
    setDeleteError('');
    setOperationNotice('');
    try {
      const deleted = await onDelete();
      if (deleted === false) throw new Error('delete-failed');
      draftRevisionRef.current += 1;
      failedDraftRevisionRef.current = null;
      setDraft('');
      setShowKey(false);
      setIsDirty(false);
      setConfirmDelete(false);
      setOperationNotice(`${label} 已从这台 Mac 删除。`);
      onDraftStateChange?.(false);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          inputRef.current?.focus({ preventScroll: true });
        });
      });
      return true;
    } catch {
      setDeleteError(`${label} 删除未完成；凭据仍安全保存在这台 Mac，完整分析可能已暂停。请重试，或保留凭据后重新验证。`);
      return false;
    } finally {
      deleteInFlightRef.current = false;
      setIsDeleting(false);
    }
  };

  const hasSavedValue = isUrlType ? Boolean(String(value || '').trim()) : isSaved;
  const ownsLiveStatus = Boolean(
    saveFailed || deleteError || operationNotice || isDeleting || isSaving
  );
  const credentialVisibility = describeCredentialVisibility({
    isUrlType,
    isSaved,
    draft,
    showKey,
  });
  const statusText = deleteError
    ? '删除未完成，凭据仍已保存'
    : operationNotice
      ? operationNotice
      : saveFailed
    ? '保存失败，请重试'
    : isDeleting
      ? '正在删除…'
      : confirmDelete
        ? '等待确认删除'
        : isSaving
          ? '正在保存…'
          : disabled
            ? '当前操作期间已锁定'
          : isDirty
            ? '有未保存的更改'
            : hasSavedValue
              ? (isUrlType ? '已保存' : '已安全保存')
              : '尚未保存';

  const inputStyle = {
    width: '100%',
    padding: isUrlType ? '8px 10px' : '8px 42px 8px 10px',
    fontSize: 13,
    border: '1px solid var(--border-secondary)',
    borderRadius: 8,
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: isUrlType ? 'inherit' : 'monospace',
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  };

  const deleteDialogId = `${inputId}-delete-dialog`;
  const portalTarget = confirmDelete ? rootRef.current?.closest('.settings-panel') : null;

  return (
    <div ref={rootRef} style={{ marginBottom: 12 }}>
      <label
        htmlFor={inputId}
        style={{
          display: 'block',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 4,
        }}
      >
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          id={inputId}
          type={credentialVisibility.inputType}
          value={draft}
          disabled={disabled || isSaving || isDeleting}
          onChange={(e) => updateDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={visiblePlaceholder}
          aria-describedby={credentialVisibility.showStoredCredentialNotice ? storedNoticeId : undefined}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          style={inputStyle}
          onFocus={(e) => {
            e.target.style.borderColor = 'var(--accent)';
            e.target.style.boxShadow = '0 0 0 3px var(--accent-light)';
          }}
          onBlur={(e) => {
            e.target.style.borderColor = 'var(--border-secondary)';
            e.target.style.boxShadow = 'none';
          }}
        />
        {credentialVisibility.canToggleSecret && (
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="credential-visibility-toggle"
            disabled={disabled || isSaving || isDeleting}
            aria-label={credentialVisibility.toggleLabel}
            aria-pressed={credentialVisibility.revealsSecretDraft}
          >
            {credentialVisibility.revealsSecretDraft
              ? <EyeSlash size={18} aria-hidden="true" />
              : <Eye size={18} aria-hidden="true" />}
          </button>
        )}
      </div>
      {credentialVisibility.showStoredCredentialNotice && (
        <p id={storedNoticeId} className="credential-storage-note">
          <LockKey size={15} weight="fill" aria-hidden="true" />
          <span>
            <strong>已保存的密钥不会显示。</strong>
            {' '}Slipstream 不会把它回传到此窗口；输入新值可以替换，显示按钮只作用于新输入。
          </span>
        </p>
      )}
      <div className="setting-editor-actions">
        <span
          className={saveFailed || deleteError ? 'setting-save-status is-error' : isDirty ? 'setting-save-status is-dirty' : 'setting-save-status'}
          role={ownsLiveStatus ? 'status' : undefined}
          aria-live={ownsLiveStatus ? 'polite' : undefined}
        >
          {statusText}
        </span>
        <div>
          {!isUrlType && isSaved && !draft && (
            <button
              ref={deleteTriggerRef}
              type="button"
              className="setting-delete-button"
              onClick={() => {
                setDeleteError('');
                setOperationNotice('');
                setConfirmDelete(true);
              }}
              disabled={disabled || confirmDelete || isDeleting}
              aria-haspopup="dialog"
              aria-expanded={confirmDelete}
              aria-controls={confirmDelete ? deleteDialogId : undefined}
            >
              删除凭据
            </button>
          )}
          <button
            type="button"
            className="setting-save-button"
            disabled={disabled || !isDirty || isSaving || (!isUrlType && !draft.trim())}
            onClick={commit}
          >
            {isSaving ? '正在保存…' : isDirty ? (hasSavedValue ? '保存更改' : '保存') : hasSavedValue ? '已保存' : '保存'}
          </button>
        </div>
      </div>
      {confirmDelete && portalTarget && createPortal(
        <CredentialRemovalDialog
          id={deleteDialogId}
          busy={isDeleting}
          error={deleteError}
          title={`删除 ${label}？`}
          busyTitle={`正在删除 ${label}`}
          description="这会从这台 Mac 的加密设置中删除该凭据，无法撤销，并暂停完整分析。以后使用此在线服务时，需要重新输入并验证。"
          reassurance="当前原文、结果和其他设置都会保留；删除凭据不会向服务商发送请求。"
          cancelLabel="保留凭据"
          confirmLabel={`删除 ${label}`}
          busyLabel="正在删除…"
          onCancel={() => {
            if (isDeleting) return;
            if (deleteError) onDeleteFailureDismiss?.();
            setDeleteError('');
            setConfirmDelete(false);
          }}
          onConfirm={handleDelete}
          returnFocusRef={deleteTriggerRef}
        />,
        portalTarget,
      )}
    </div>
  );
}
