import {
  PROCESSING_LOCATIONS,
  processingLocationForSettings,
} from './processingPrivacy.mjs';

const PROVIDER_LABELS = Object.freeze({
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  custom: '远程自定义服务',
  free_translate: 'Google / MyMemory',
});

export function describeClipboardMonitoring(settings = {}) {
  const backend = settings.activeBackend || 'ollama';
  const processingLocation = processingLocationForSettings(settings);
  const isLocal = processingLocation === PROCESSING_LOCATIONS.LOCAL;
  const isLocalCustom = processingLocation === PROCESSING_LOCATIONS.LOCAL_LOOPBACK;
  const isTranslationOnly = backend === 'free_translate';
  const destination = isLocal
    ? '这台 Mac'
    : isLocalCustom
      ? '这台 Mac 上的兼容服务'
      : PROVIDER_LABELS[backend] || '当前在线服务';

  if (isLocal) {
    return {
      kind: 'local',
      destination,
      title: '允许自动处理今后复制的文字？',
      detail: '开启后，只要剪贴板出现新的非空文字，Slipstream 就会自动读取并在这台 Mac 上开始分析；无需再点击生成或按快捷键。',
      consequences: [
        '原文不会发送给模型服务商。',
        '你复制但没有打算交给 Slipstream 的敏感文字也可能被自动处理。',
      ],
      confirmLabel: '允许并开启本机自动分析',
      activeTitle: '已开启 · 新复制文字会自动在这台 Mac 上分析',
      activeDetail: '无需点击生成或按快捷键；每次出现新的非空剪贴板文字都会开始本机分析。',
      enabledNotice: '自动检测已开启；新复制的文字会在这台 Mac 上自动分析。',
    };
  }

  if (isLocalCustom) {
    return {
      kind: 'local-custom',
      destination,
      title: '允许自动交给本机兼容服务？',
      detail: '开启后，只要剪贴板出现新的非空文字，Slipstream 就会把完整内容自动发送到本机回环地址；无需再点击生成或按快捷键。',
      consequences: [
        'Slipstream 只连接这台 Mac 的回环地址；该兼容服务自身是否联网、转发或留存取决于它的配置。',
        '你复制但没有打算交给 Slipstream 的密码、验证码或其他敏感文字也可能被自动处理。',
      ],
      confirmLabel: '允许并开启本机兼容服务自动分析',
      activeTitle: '已开启 · 新复制文字会交给本机兼容服务',
      activeDetail: '无需点击生成或按快捷键；每次出现新的非空剪贴板文字都会发送到本机回环地址。该服务是否再联网取决于它的配置。',
      enabledNotice: '自动检测已开启；新复制的文字会发送到这台 Mac 上的兼容服务。',
    };
  }

  if (processingLocation === PROCESSING_LOCATIONS.UNKNOWN) {
    return {
      kind: 'unknown',
      destination: '尚未确认的服务',
      title: '先确认文字会去哪里',
      detail: '当前服务地址无法确认是本机回环还是在线服务。请先完成并验证连接设置，再开启自动检测。',
      consequences: [
        '位置未确认时，不应自动处理新的剪贴板文字。',
        '保持关闭不会清除或改写系统剪贴板。',
      ],
      confirmLabel: '返回检查连接设置',
      activeTitle: '自动检测位置未确认',
      activeDetail: '请关闭自动检测并检查当前连接设置。',
      enabledNotice: '自动检测的处理位置未确认；请检查设置。',
    };
  }

  const serviceDetail = isTranslationOnly
    ? '发送给 Google Translate，并可能回退到 MyMemory 生成基础翻译'
    : `发送给 ${destination} 进行分析`;
  const serviceConsequence = isTranslationOnly
    ? '在线翻译服务可能记录请求；免费端点也可能限流或暂时不可用。'
    : '在线服务可能记录请求或产生调用费用。';
  return {
    kind: 'online',
    destination,
    title: '允许自动发送今后复制的文字？',
    detail: `开启后，只要剪贴板出现新的非空文字，完整内容就会自动${serviceDetail}；无需再点击生成或按快捷键。`,
    consequences: [
      serviceConsequence,
      '请不要在开启期间复制密码、验证码、身份标识或其他不想发送的内容。',
    ],
    confirmLabel: '允许并开启自动发送',
    activeTitle: `已开启 · 新复制文字会自动发送给 ${destination}`,
    activeDetail: isTranslationOnly
      ? '无需点击或按快捷键；每次剪贴板变化都可能开始一次在线基础翻译，免费端点也可能限流。'
      : '无需点击或按快捷键；每次剪贴板变化都可能开始一次在线分析并产生费用。',
    enabledNotice: `自动检测已开启；新复制的文字会自动发送给 ${destination}。`,
  };
}

export const CLIPBOARD_MONITORING_OFF_DETAIL = '保持关闭时，只有你主动粘贴、点击读取或使用快捷键时，Slipstream 才会处理剪贴板文字。';
