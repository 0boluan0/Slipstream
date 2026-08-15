export const PROCESSING_CANCELLED_SOURCE_NOTICE = '处理已停止；原文仍保留，你可以修改后重新生成。';
export const PROCESSING_CANCELLED_RESULT_NOTICE = '处理已停止；已返回上一份结果。';
export const PROCESSING_COMPLETED_DURING_CANCEL_NOTICE = '停止请求生效前，任务已经完成；结果已显示。';
export const PROCESSING_COMPLETED_AFTER_CANCEL_FAILURE_NOTICE = '停止请求未能确认，但任务随后完成；结果已显示。';
export const PROCESSING_COMPLETED_BEFORE_SETTINGS_NOTICE = '任务在停止请求生效前已经完成；结果已显示，未自动打开设置。';
export const PROCESSING_COMPLETED_AFTER_SETTINGS_CANCEL_FAILURE_NOTICE = '停止请求未能确认，但任务随后完成；结果已显示，未自动打开设置。';

export function processingCancelFailureMessage(location) {
  if (location === 'online') {
    return '暂时无法确认请求已停止。在线服务可能仍在处理并产生费用；你可以重试停止。';
  }
  if (location === 'local-loopback') {
    return '暂时无法确认请求已停止。本机兼容服务可能仍在处理；它是否再联网或计费取决于自己的配置。你可以重试停止。';
  }
  if (location === 'unknown') {
    return '暂时无法确认请求已停止，处理位置也无法确认。当前服务可能仍在处理；你可以重试停止。';
  }
  return '暂时无法确认请求已停止。任务仍在继续；你可以重试停止。';
}

export function processingSettingsGuardMessage(location, returnsToPreviousResult = false) {
  const destination = returnsToPreviousResult ? '返回上一份结果' : '保留原文';
  if (location === 'online') {
    return `完整原文已经发送给在线服务。为避免丢失结果或产生重复费用，需要先确认停止并${destination}，再打开设置。`;
  }
  if (location === 'local-loopback') {
    return `完整原文已经发送到本机回环地址；兼容服务是否再联网或计费取决于它的配置。为避免丢失结果，需要先确认停止并${destination}，再打开设置。`;
  }
  if (location === 'unknown') {
    return `当前处理位置无法确认。为避免丢失结果或产生重复请求，需要先确认停止并${destination}，再打开设置。`;
  }
  return `本机任务仍在处理。为避免丢失当前结果，需要先确认停止并${destination}，再打开设置。`;
}
