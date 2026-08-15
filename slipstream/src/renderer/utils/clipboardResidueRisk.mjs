export const CLIPBOARD_RESIDUE_RISK_MAX_ID_LENGTH = 100;

export const CLIPBOARD_RESIDUE_RISK_COPY = Object.freeze({
  title: '系统剪贴板可能仍有上次复制的内容',
  detail: '界面意外中断后，Slipstream 无法确认系统剪贴板当前保留的内容，也不会读取、清除或覆盖它；如内容敏感，请检查系统剪贴板，或在其他位置复制一段不敏感文字手动覆盖。',
  acknowledgeLabel: '我已检查或手动覆盖',
  acknowledgementError: '没有确认这项处理；提示和退出保护仍会保留。请重试，或继续手动检查系统剪贴板。',
});

function validRiskId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= CLIPBOARD_RESIDUE_RISK_MAX_ID_LENGTH;
}

export function normalizeClipboardResidueRisk(candidate) {
  if (!validRiskId(candidate?.id)) return null;
  return Object.freeze({ id: candidate.id });
}

export function clipboardResidueRiskFromRecoveryStatus(response) {
  return normalizeClipboardResidueRisk(response?.clipboardResidueRisk);
}

export function clipboardResidueRiskMatches(current, expected) {
  const currentRisk = normalizeClipboardResidueRisk(current);
  const expectedRisk = normalizeClipboardResidueRisk(expected);
  return Boolean(currentRisk && expectedRisk && currentRisk.id === expectedRisk.id);
}

export function clipboardResidueAcknowledgementSucceeded(response) {
  return response?.status === 'acknowledged';
}
