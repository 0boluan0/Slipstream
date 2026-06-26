// IPC channel names (string constants for every channel between main<->renderer)
export const IPC_CHANNELS = {
  CLIPBOARD_TEXT_CHANGED: 'clipboard:text-changed',
  OCR_RESULT: 'ocr:result',
  OCR_ERROR: 'ocr:error',
  LLM_RESULT: 'llm:result',
  LLM_ERROR: 'llm:error',
  SETTINGS_LOADED: 'settings:loaded',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  LLM_PROCESS: 'llm:process',
  SCREENSHOT_CAPTURE: 'screenshot:capture',
  WINDOW_HIDE: 'window:hide',
  WINDOW_SHOW: 'window:show',
};

// LLM backend identifiers
export const LLM_BACKENDS = { ANTHROPIC: 'anthropic', OPENAI: 'openai', OLLAMA: 'ollama', CUSTOM: 'custom' };

// Model IDs per backend
export const MODEL_IDS = {
  anthropic: ['claude-sonnet-4-20250514', 'claude-haiku-3-5-20250514'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
  ollama: ['llama3.2', 'llama3.1', 'qwen2', 'mistral'],
  custom: ['custom'],
};

// Default configuration
export const DEFAULTS = {
  BACKEND: 'anthropic',
  MODEL: 'claude-sonnet-4-20250514',
  LANGUAGE: 'en',
  WINDOW_WIDTH: 480,
  WINDOW_HEIGHT: 600,
  CLIPBOARD_POLL_INTERVAL: 1000, // ms
  MAX_TEXT_LENGTH: 10000,
};

// Shortcut keybindings
export const SHORTCUTS = {
  TOGGLE: 'F2',
  SCREENSHOT: 'CmdOrCtrl+Shift+S',
};

// App metadata
export const APP_NAME = 'Slipstream';

// Processing status values
export const STATUS = {
  IDLE: 'idle',
  PROCESSING: 'processing',
  DONE: 'done',
  ERROR: 'error',
};

// Default prompt templates (system + user)
export const DEFAULT_SYSTEM_PROMPT = 'You are a bilingual English-Chinese language assistant. Your job is to help a Chinese speaker understand English text in context. You must respond in Chinese.';

export const DEFAULT_USER_PROMPT = `Please help me understand the following English text. Provide:

1. **中文翻译**：将原文翻译成自然流畅的中文
2. **专有名词解释**：列出文中的专有名词（人名、地名、机构名、专业术语、缩写），逐一用中文解释
3. **语境说明**：解释文中涉及的文化背景、习惯用法、特殊表达方式，以及在英语语境下才会出现的概念

原文：
{{text}}

请用清晰的结构化格式回复。`;

export const DEFAULT_PROMPTS = {
  explain: {
    name: 'explain',
    label: '解释与翻译',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    userPromptTemplate: DEFAULT_USER_PROMPT,
  },
};

// Language hints
export const LANGUAGES = {
  EN: 'en',
  ZH: 'zh',
  AUTO: 'auto',
};
