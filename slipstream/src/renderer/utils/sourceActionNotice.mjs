export function createSourceOpenPendingNotice() {
  return {
    kind: 'source-open',
    status: 'open-pending',
    message: '正在交给默认浏览器',
    detail: '当前结果不会改变；打开后请在浏览器中核对网址和页面内容。',
  };
}

export function createSourceOpenSuccessNotice() {
  return {
    kind: 'source-open',
    status: 'opened',
    message: '已交给默认浏览器',
    detail: '这只表示系统已接收打开请求，不代表页面内容已经核验。',
  };
}

export function createSourceOpenFailureNotice() {
  return {
    kind: 'source-open',
    status: 'open-error',
    message: '没有打开官方来源',
    detail: '当前结果没有改变；可以重试，或复制链接后手动打开。',
  };
}
