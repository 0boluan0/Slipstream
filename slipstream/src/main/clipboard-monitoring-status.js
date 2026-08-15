'use strict';

const {
  PROCESSING_LOCATION_KINDS,
  processingLocationForSettings,
} = require('../shared/endpoint-location.cjs');

const DESTINATION_LABELS = Object.freeze({
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  free_translate: 'Google / MyMemory',
  ollama: '这台 Mac',
});

const CUSTOM_DESTINATION_LABELS = Object.freeze({
  [PROCESSING_LOCATION_KINDS.LOCAL_LOOPBACK]: '本机兼容服务（回环）',
  [PROCESSING_LOCATION_KINDS.ONLINE]: '自定义在线服务',
  [PROCESSING_LOCATION_KINDS.UNKNOWN]: '自定义服务（位置未确认）',
});

const OLLAMA_DESTINATION_LABELS = Object.freeze({
  [PROCESSING_LOCATION_KINDS.LOCAL]: '这台 Mac',
  [PROCESSING_LOCATION_KINDS.UNKNOWN]: 'Ollama（位置未确认）',
});

function describeClipboardDestination(settings) {
  const processingLocation = processingLocationForSettings(settings);
  if (settings.activeBackend === 'custom') {
    return {
      destination: CUSTOM_DESTINATION_LABELS[processingLocation],
      processingLocation,
    };
  }

  if (settings.activeBackend === 'ollama') {
    return {
      destination: OLLAMA_DESTINATION_LABELS[processingLocation]
        || OLLAMA_DESTINATION_LABELS[PROCESSING_LOCATION_KINDS.UNKNOWN],
      processingLocation,
    };
  }

  return {
    destination: DESTINATION_LABELS[settings.activeBackend] || '当前处理方式',
    processingLocation,
  };
}

function createClipboardMonitoringTrayPresentation(settings = {}) {
  const enabled = settings.clipboardMonitoring === true;
  const { destination, processingLocation } = describeClipboardDestination(settings);
  return Object.freeze({
    enabled,
    destination,
    processingLocation,
    statusLabel: enabled
      ? `自动检测已开启 · ${destination}`
      : '自动检测已关闭',
    actionLabel: '关闭自动检测',
  });
}

module.exports = { createClipboardMonitoringTrayPresentation };
