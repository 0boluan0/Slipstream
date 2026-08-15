const CAPTURE_INTENT_COPY = Object.freeze({
  clipboard: Object.freeze({
    tone: 'waiting',
    title: '快捷键捕获的文字已保留',
    detail: '这段文字只保留在当前窗口内；选择处理方式前不会发送。进入主面板后，你仍需明确决定是否处理。',
  }),
  screenshot: Object.freeze({
    tone: 'waiting',
    title: '截图请求已保留',
    detail: '现在不会打开截图框选。先选择处理方式，进入主面板后再明确决定是否开始截图。',
  }),
  'clipboard-error': Object.freeze({
    tone: 'warning',
    title: '剪贴板里没有可处理的文字',
    detail: '当前选择没有改变，也没有发送任何内容。复制一段文字后，可以再次按剪贴板快捷键。',
  }),
});

export function describeSetupCaptureIntent(request) {
  const kind = typeof request === 'string' ? request : request?.kind;
  return CAPTURE_INTENT_COPY[kind] || null;
}
