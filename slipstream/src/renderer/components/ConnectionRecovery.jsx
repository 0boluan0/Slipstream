import React from 'react';
import { ArrowClockwise, ArrowSquareOut, Copy, PencilSimple } from '../phosphorIcons';
import { buildConnectionRecoveryPlan } from '../utils/connectionRecovery.mjs';

const ACTION_ICONS = Object.freeze({
  copy: Copy,
  focus: PencilSimple,
  open: ArrowSquareOut,
  retry: ArrowClockwise,
});

function RecoveryAction({ action, onAction, primary = false, clipboardWritePending = false }) {
  const Icon = ACTION_ICONS[action.kind];
  const copyPending = action.kind === 'copy' && clipboardWritePending;
  return (
    <button
      type="button"
      className={`connection-recovery-action${primary ? ' is-primary' : ''}`}
      data-connection-recovery-copy-action={action.kind === 'copy' ? 'true' : undefined}
      onClick={() => onAction(action)}
      disabled={copyPending}
      aria-busy={copyPending}
    >
      {Icon && <Icon size={15} aria-hidden="true" />}
      {action.label}
    </button>
  );
}

export default function ConnectionRecovery({
  code,
  backend,
  model,
  notice,
  onAction,
  clipboardWritePending = false,
}) {
  const plan = buildConnectionRecoveryPlan({ code, backend, model });

  return (
    <section className="connection-recovery" aria-label="连接恢复步骤">
      <span className="connection-recovery-eyebrow">接下来这样处理</span>
      <strong className="connection-recovery-title">{plan.title}</strong>
      <p>{plan.description}</p>

      {plan.steps.length > 0 && (
        <ol className="connection-recovery-steps">
          {plan.steps.map((step) => (
            <li key={`${step.title}-${step.action?.kind || 'none'}`}>
              <div>
                <strong>{step.title}</strong>
                <span>{step.detail}</span>
                {step.command && <code>{step.command}</code>}
              </div>
              {step.action && (
                <RecoveryAction
                  action={step.action}
                  onAction={onAction}
                  clipboardWritePending={clipboardWritePending}
                />
              )}
            </li>
          ))}
        </ol>
      )}

      <div className="connection-recovery-actions">
        {plan.actions.map((action, index) => (
          <RecoveryAction
            action={action}
            key={`${action.kind}-${action.label}`}
            onAction={onAction}
            primary={index === 0}
            clipboardWritePending={clipboardWritePending}
          />
        ))}
      </div>
      {notice && <span className="connection-recovery-notice" role="status" aria-live="polite">{notice}</span>}
    </section>
  );
}
