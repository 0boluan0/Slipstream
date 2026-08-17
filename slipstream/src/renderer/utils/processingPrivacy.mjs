import {
  PROCESSING_LOCATION_KINDS,
  processingLocationForSettings as resolveProcessingLocationForSettings,
} from '../../shared/endpoint-location.mjs';

const PROVIDER_LABELS = Object.freeze({
  anthropic: 'Anthropic',
  custom: '自定义服务',
  deepseek: 'DeepSeek',
  free_translate: 'Google Translate / MyMemory',
  ollama: 'Ollama',
  openai: 'OpenAI',
});
const VALID_PROCESSING_PROVIDERS = new Set(Object.keys(PROVIDER_LABELS));

export const PROCESSING_LOCATIONS = PROCESSING_LOCATION_KINDS;

export function processingLocationForSettings(settings = {}) {
  return resolveProcessingLocationForSettings(settings);
}

export function normalizeProcessingLocation(value) {
  return Object.values(PROCESSING_LOCATIONS).includes(value)
    ? value
    : PROCESSING_LOCATIONS.UNKNOWN;
}

function resolveDisclosureInput(providerOrSettings, options = {}) {
  const settings = providerOrSettings && typeof providerOrSettings === 'object'
      ? providerOrSettings
      : {
        activeBackend: providerOrSettings,
        customEndpointUrl: options.customEndpointUrl,
        ollamaBaseUrl: options.ollamaBaseUrl,
      };
  const providerCandidate = settings.activeBackend || settings.provider || null;
  const provider = VALID_PROCESSING_PROVIDERS.has(providerCandidate)
    ? providerCandidate
    : null;
  const explicitLocation = options.processingLocation ?? settings.processingLocation;
  return {
    provider,
    location: explicitLocation == null
      ? processingLocationForSettings(settings)
      : normalizeProcessingLocation(explicitLocation),
  };
}

export function resolveResultProcessingSnapshot(brief, lastGood = null) {
  const lastGoodProvider = VALID_PROCESSING_PROVIDERS.has(lastGood?.processingProvider)
    ? lastGood.processingProvider
    : null;
  const provenanceProvider = VALID_PROCESSING_PROVIDERS.has(brief?.analysisProvenance?.provider)
    ? brief.analysisProvenance.provider
    : null;
  const lastGoodLocation = normalizeProcessingLocation(lastGood?.processingLocation);
  const provenanceLocation = normalizeProcessingLocation(
    brief?.analysisProvenance?.processingLocation,
  );
  return Object.freeze({
    provider: lastGoodProvider || provenanceProvider,
    location: lastGoodLocation !== PROCESSING_LOCATIONS.UNKNOWN
      ? lastGoodLocation
      : provenanceLocation,
  });
}

const SOURCE_LABELS = Object.freeze({
  clipboard: '剪贴板原文',
  manual: '手动输入原文',
  ocr: '截图 OCR 原文',
  sample: '安全示例原文',
});

export function processingProviderLabel(provider, location = PROCESSING_LOCATIONS.UNKNOWN) {
  if (provider === 'custom' && location === PROCESSING_LOCATIONS.LOCAL_LOOPBACK) {
    return '本机兼容服务';
  }
  if (provider === 'custom' && location === PROCESSING_LOCATIONS.ONLINE) {
    return '远程自定义服务';
  }
  return PROVIDER_LABELS[provider] || '未配置服务';
}

function withProviderParticle(particle, providerLabel, suffix = '') {
  return /^[\u3400-\u9fff]/u.test(providerLabel)
    ? `${particle}${providerLabel}${suffix}`
    : [particle, providerLabel, suffix].filter(Boolean).join(' ');
}

export function getProcessingSourceSummary(source, sourceLength) {
  const characterCount = Number.isFinite(sourceLength)
    ? Math.max(0, Math.floor(sourceLength))
    : 0;
  return {
    title: SOURCE_LABELS[source] || '当前原文',
    detail: `完整原文已保留 · ${characterCount} 个字符；为避免旁观泄露，处理时不重复显示内容。`,
  };
}

export function getProcessingPrivacyDisclosure(providerOrSettings, options = {}) {
  const { provider, location } = resolveDisclosureInput(providerOrSettings, options);
  const providerLabel = processingProviderLabel(provider, location);
  if (provider === 'ollama' && location === PROCESSING_LOCATIONS.LOCAL) {
    return {
      location: 'local',
      providerLabel,
      headerLabel: '本地处理 · 隐私优先',
      title: '将在这台 Mac 上分析',
      detail: '原文不会发送给模型服务商；若模型提出待办，会在本机再做一次短复核。截图 OCR 始终在本机，官方来源核验另行征求允许。',
      activeTitle: '正在这台 Mac 上分析',
      activeDetail: '原文仍在本机；若模型提出待办，会在本机再做一次短复核。',
      resultTitle: '本次在这台 Mac 上完成分析',
      resultDetail: '原文没有发送给模型服务商；官方来源核验仅在你允许时另行联网。',
      footer: '原文不会发送给模型服务商；官方来源核验只在你允许时进行。',
    };
  }

  if (provider === 'custom' && location === PROCESSING_LOCATIONS.LOCAL_LOOPBACK) {
    return {
      location,
      providerLabel,
      headerLabel: '本机兼容服务 · 连接回环地址',
      title: '将发送到这台 Mac 上的兼容服务',
      detail: 'Slipstream 只会把完整原文发送到本机回环地址；若模型提出待办，可能把同一原文和候选项再发送一次做短复核。该服务是否再联网、转发、留存或计费取决于它自己的配置。',
      activeTitle: '正在由这台 Mac 上的兼容服务分析',
      activeDetail: '完整原文已发送到本机回环地址；若模型提出待办，可能再发送一次做短复核。',
      resultTitle: '本次由这台 Mac 上的兼容服务完成分析',
      resultDetail: 'Slipstream 把完整原文发送到本机回环地址；该服务自身是否再联网、转发或留存取决于它的配置。',
      footer: 'Slipstream 只连接本机回环地址；该兼容服务自身是否联网、转发或留存取决于它的配置。',
    };
  }

  if (provider === 'free_translate' && location === PROCESSING_LOCATIONS.ONLINE) {
    return {
      location: 'online',
      providerLabel,
      headerLabel: '在线基础翻译 · 会发送原文',
      title: '将先发送给 Google Translate',
      detail: '完整原文会先发送给 Google Translate；若未返回可用翻译，会再发送给备用 MyMemory。本次不会发起官方来源核验。',
      activeTitle: '正在使用在线基础翻译',
      activeDetail: '正在尝试 Google Translate；若失败，完整原文会再发送给备用 MyMemory。不会发起官方来源核验。',
      resultTitle: '本次使用在线基础翻译',
      resultDetail: '完整原文已先发送给 Google Translate；若主服务失败，可能再发送给备用 MyMemory。',
      footer: '原文会先发送给 Google Translate，失败时再发送给 MyMemory；不会写入 Slipstream 历史。',
    };
  }

  if (provider && location === PROCESSING_LOCATIONS.ONLINE) {
    const providerRecipient = withProviderParticle('给', providerLabel);
    const providerAgent = withProviderParticle('由', providerLabel, '分析');
    return {
      location: 'online',
      providerLabel,
      headerLabel: `在线模型 · ${providerLabel} · 会发送原文`,
      title: `将发送${providerRecipient}`,
      detail: '完整原文会发送给所选服务；若模型提出待办，可能把同一原文和候选项再发送一次做短复核，并可能产生第二次调用费用。',
      activeTitle: `正在${providerAgent}`,
      activeDetail: '完整原文已发送给所选在线服务；若模型提出待办，可能再发送一次做短复核。',
      resultTitle: `本次${withProviderParticle('由', providerLabel, '完成分析')}`,
      resultDetail: '完整原文已发送给所选在线服务；Slipstream 不会自动发送回复或提交材料。',
      footer: '原文会发送给当前在线服务，但不会写入 Slipstream 历史；官方来源核验另行征求允许。',
    };
  }

  return {
    location: 'unknown',
    providerLabel,
    headerLabel: '处理位置未记录',
    title: '处理位置尚未确认',
    detail: '请先在设置中确认使用本机还是在线服务，再提交原文。',
    activeTitle: '当前处理位置未记录',
    activeDetail: '请取消并在设置中确认使用本机还是在线服务。',
    resultTitle: '本次处理位置未记录',
    resultDetail: '无法确认这份结果来自本机还是在线服务；重新处理前请先检查设置。',
    footer: '处理位置尚未确认；请先检查设置。',
  };
}
