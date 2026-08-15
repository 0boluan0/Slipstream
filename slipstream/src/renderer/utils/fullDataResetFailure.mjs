import { FULL_DATA_RESET_ERROR_CODES } from './fullDataResetErrorCodes.mjs';

function partialResetMessage(detail) {
  return `当前原文、结果、撤销副本和临时恢复记录已在上一次尝试中清除；${detail}`;
}

export function nextFullDataResetSessionCleared(previous, error) {
  return Boolean(previous || error?.sessionCleared === true);
}

export function describeFullDataResetFailure(error, { sessionAlreadyCleared = false } = {}) {
  const sessionCleared = nextFullDataResetSessionCleared(sessionAlreadyCleared, error);
  if (sessionCleared) {
    switch (error?.code) {
      case FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_OPERATION_PENDING:
        return partialResetMessage('系统剪贴板操作仍在确认，凭据、术语和设置尚未确认全部清除。请等待后重试剩余清除。');
      case FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_STATUS_UNCONFIRMED:
      case FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_CHOICE_REQUIRED:
      case FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_CONSEQUENCE_ID_REQUIRED:
        return partialResetMessage('无法确认本次保留系统剪贴板的授权，凭据、术语和设置尚未确认全部清除。请重试剩余清除。');
      case FULL_DATA_RESET_ERROR_CODES.RESET_TRANSACTION_UNAVAILABLE:
        return partialResetMessage('清除功能暂时不可用，凭据、术语和设置尚未确认全部清除。请关闭设置后重新打开，再重试剩余清除。');
      case FULL_DATA_RESET_ERROR_CODES.SESSION_CLEAR_UNAVAILABLE:
      case FULL_DATA_RESET_ERROR_CODES.SESSION_CLEAR_UNCONFIRMED:
        return partialResetMessage('不会重复清除会话；凭据、术语和设置尚未确认全部清除。请重试剩余清除。');
      case FULL_DATA_RESET_ERROR_CODES.PERSISTENT_CLEAR_UNCONFIRMED:
      default:
        return partialResetMessage('凭据、术语或设置尚未确认全部清除。请重试完成剩余清除。');
    }
  }

  switch (error?.code) {
    case FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_OPERATION_PENDING:
      return '系统剪贴板操作仍在确认；尚未开始清除应用内数据。请等待当前复制完成后重试。';
    case FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_STATUS_UNCONFIRMED:
      return '无法确认保留系统剪贴板的授权；尚未开始清除应用内数据。请重试。';
    case FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_CHOICE_REQUIRED:
      return '请先明确保留当前系统剪贴板内容；尚未开始清除应用内数据。';
    case FULL_DATA_RESET_ERROR_CODES.CLIPBOARD_CONSEQUENCE_ID_REQUIRED:
      return '无法确认要保留的系统剪贴板后果；尚未开始清除应用内数据。请返回后重试。';
    case FULL_DATA_RESET_ERROR_CODES.RESET_TRANSACTION_UNAVAILABLE:
      return '清除功能暂时不可用；尚未开始清除应用内数据。请关闭设置后重新打开，再重试。';
    case FULL_DATA_RESET_ERROR_CODES.SESSION_CLEAR_UNAVAILABLE:
    case FULL_DATA_RESET_ERROR_CODES.SESSION_CLEAR_UNCONFIRMED:
      return '没有确认当前原文、结果和临时恢复记录已清除；凭据、术语和设置尚未开始清除。请重试。';
    case FULL_DATA_RESET_ERROR_CODES.PERSISTENT_CLEAR_UNCONFIRMED:
      return partialResetMessage('凭据、术语或设置尚未确认全部清除。请重试完成剩余清除。');
    default:
      return '没有确认清除完成。请不要把当前状态视为已经全部清除；你可以直接重试。';
  }
}
