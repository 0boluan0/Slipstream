// IPC channel names (string constants for every channel between main<->renderer)
const IPC_CHANNELS = {
  CLIPBOARD_TEXT_CHANGED: 'clipboard:text-changed',
  OCR_ERROR: 'ocr:error',
  SETTINGS_LOADED: 'settings:loaded',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  TERMS_GET: 'terms:get',
  TERMS_SAVE: 'terms:save',
  LLM_PROCESS: 'llm:process',
  SCREENSHOT_CAPTURE: 'screenshot:capture',
};

// LLM backend identifiers
const LLM_BACKENDS = { FREE_TRANSLATE: 'free_translate', ANTHROPIC: 'anthropic', OPENAI: 'openai', DEEPSEEK: 'deepseek', OLLAMA: 'ollama', CUSTOM: 'custom' };

// Model IDs per backend
const MODEL_IDS = {
  free_translate: ['google-translate'],
  anthropic: ['claude-sonnet-4-20250514', 'claude-haiku-3-5-20250514'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  ollama: ['deepseek-r1:14b', 'gpt-oss:20b', 'llama3.3', 'llama3.2', 'qwen2.5', 'mistral-small', 'phi4'],
  custom: ['custom'],
};

// Default configuration
const DEFAULTS = {
  BACKEND: 'free_translate',
  MODEL: 'google-translate',
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
    system: '你是英文到中文的学习助手。只用中文回答。不要输出思考过程。解释必须锚定原文中的文字、术语、机构、截止日期、文件或动作要求；不要添加宽泛文化背景或氛围解读。',
    user: `请解释下面英文，并只输出两个编号段落：

1. 中文意思：用自然中文说明原文意思。若原文明确提到截止日期、需要携带/提交的文件、是否需要回复或必须完成的动作，也要写清楚。
2. 专有名词 / 缩写 / 机构 / 课程名：只解释原文中实际出现的名称、缩写、机构、课程或术语；没有就写“无”。

原文：
{{text}}
`,
  },
  zh: {
    system: 'You are a bilingual Chinese-English language assistant. Your job is to help an English speaker understand Chinese text in context. You must respond in English.',
    user: `Please help me understand the following Chinese text. Provide exactly two sections:

1. **English Translation**: Translate the original text into natural, fluent English.
2. **Proper Noun / Term Explanations**: List proper nouns, technical terms, abbreviations, organizations, names, or culturally specific expressions that appear in the original text, and explain each one in English. If there are none, write "None".

Original text:
{{text}}

Please reply in a clear, structured format.`,
  },
  auto: {
    system: 'You are a bilingual language assistant. Detect the input language and explain it in the opposite language. Do not reveal reasoning. Keep explanations anchored to text, terms, institutions, deadlines, documents, or required actions.',
    user: `Please analyze the following text. First detect whether it is primarily English or Chinese, then explain it in the opposite language. Provide exactly two sections:

1. **Translation**: Translate the original text into the target language naturally.
2. **Proper Noun / Term Explanations**: List proper nouns, technical terms, abbreviations, organizations, names, or culturally specific expressions that appear in the original text, and explain each one. If there are none, write "None".

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

const constants = {
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

export {
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

export default constants;
