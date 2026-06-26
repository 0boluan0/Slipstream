// IPC channel names (string constants for every channel between main<->renderer)
const IPC_CHANNELS = {
  CLIPBOARD_TEXT_CHANGED: 'clipboard:text-changed',
  OCR_ERROR: 'ocr:error',
  SETTINGS_LOADED: 'settings:loaded',
  SETTINGS_SET: 'settings:set',
  LLM_PROCESS: 'llm:process',
  SCREENSHOT_CAPTURE: 'screenshot:capture',
};

// LLM backend identifiers
const LLM_BACKENDS = { ANTHROPIC: 'anthropic', OPENAI: 'openai', OLLAMA: 'ollama', CUSTOM: 'custom' };

// Model IDs per backend
const MODEL_IDS = {
  anthropic: ['claude-sonnet-4-20250514', 'claude-haiku-3-5-20250514'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
  ollama: ['llama3.3', 'llama3.2', 'qwen2.5', 'mistral-small', 'phi4'],
  custom: ['custom'],
};

// Default configuration
const DEFAULTS = {
  BACKEND: 'anthropic',
  MODEL: 'claude-sonnet-4-20250514',
  LANGUAGE: 'en',
  WINDOW_WIDTH: 480,
  WINDOW_HEIGHT: 600,
  CLIPBOARD_POLL_INTERVAL: 1000, // ms
  MAX_TEXT_LENGTH: 10000,
};

// App metadata
const APP_NAME = 'Slipstream';

// Processing status values
const STATUS = {
  IDLE: 'idle',
  PROCESSING: 'processing',
  DONE: 'done',
  ERROR: 'error',
};

// Default prompt templates (system + user) for each language direction
const PROMPT_TEMPLATES = {
  en: {
    system: 'You are a bilingual English-Chinese language assistant. Your job is to help a Chinese speaker understand English text in context. You must respond in Chinese.',
    user: `Please help me understand the following English text. Provide:

1. **中文翻译**：将原文翻译成自然流畅的中文
2. **专有名词解释**：列出文中的专有名词（人名、地名、机构名、专业术语、缩写），逐一用中文解释
3. **语境说明**：解释文中涉及的文化背景、习惯用法、特殊表达方式，以及在英语语境下才会出现的概念

原文：
{{text}}

请用清晰的结构化格式回复。`,
  },
  zh: {
    system: 'You are a bilingual Chinese-English language assistant. Your job is to help an English speaker understand Chinese text in context. You must respond in English.',
    user: `Please help me understand the following Chinese text. Provide:

1. **English Translation**: Translate the original text into natural, fluent English
2. **Proper Noun Explanations**: List proper nouns (names, places, organizations, technical terms, abbreviations) and explain each one in English
3. **Context Explanations**: Explain the cultural background, idiomatic usage, special expressions, and concepts that are specific to the Chinese language context

Original text:
{{text}}

Please reply in a clear, structured format.`,
  },
  auto: {
    system: 'You are a bilingual language assistant. Detect the language of the input text, then explain it in the opposite language. For English text, respond in Chinese. For Chinese text, respond in English. Always explain proper nouns, cultural context, and language-specific concepts.',
    user: `Please analyze the following text. First detect whether it is primarily English or Chinese, then explain it in the opposite language. Provide:

1. **Translation**: Translate the original text into the target language naturally
2. **Proper Noun Explanations**: List proper nouns and explain each one
3. **Context Explanations**: Explain cultural background, idiomatic usage, and language-specific concepts

Original text:
{{text}}

Please reply in a clear, structured format.`,
  },
};

// Backward-compatible aliases (default to English->Chinese direction)
const DEFAULT_SYSTEM_PROMPT = PROMPT_TEMPLATES.en.system;

const DEFAULT_USER_PROMPT = PROMPT_TEMPLATES.en.user;

const DEFAULT_PROMPTS = {
  explain: {
    name: 'explain',
    label: '解释与翻译',
    systemPrompt: PROMPT_TEMPLATES.en.system,
    userPromptTemplate: PROMPT_TEMPLATES.en.user,
  },
};

// Language hints
const LANGUAGES = {
  EN: 'en',
  ZH: 'zh',
  AUTO: 'auto',
};

module.exports = {
  IPC_CHANNELS,
  LLM_BACKENDS,
  MODEL_IDS,
  DEFAULTS,
  APP_NAME,
  STATUS,
  PROMPT_TEMPLATES,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_USER_PROMPT,
  DEFAULT_PROMPTS,
  LANGUAGES,
};
