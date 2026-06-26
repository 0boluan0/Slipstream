const store = require('./store');

/**
 * Retry a function with exponential backoff for transient errors.
 * Retries on: 429, 502, 503, 504 status codes, or timeout/fetch/socket errors.
 * @param {() => Promise<any>} fn
 * @param {number} retries
 * @returns {Promise<any>}
 */
async function withRetry(fn, retries = 3) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRetryable =
        err.status === 429 ||
        err.status === 503 ||
        err.status === 502 ||
        err.status === 504 ||
        (err.message && (err.message.includes('timeout') || err.message.includes('fetch failed') || err.message.includes('socket hang up')));

      if (!isRetryable || i === retries - 1) break;

      const delay = [1000, 3000, 5000][i]; // 1s, 3s, 5s
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * Apply a timeout to a promise.
 * @param {Promise<any>} promise
 * @param {number} ms
 * @returns {Promise<any>}
 */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('LLM 请求超时，请稍后重试')), ms)
    ),
  ]);
}

const DEFAULT_SYSTEM_PROMPT = 'You are a bilingual English-Chinese language assistant. Your job is to help a Chinese speaker understand English text in context. You must respond in Chinese.';
const DEFAULT_USER_TEMPLATE = `Please help me understand the following English text. Provide:

1. **中文翻译**：将原文翻译成自然流畅的中文
2. **专有名词解释**：列出文中的专有名词（人名、地名、机构名、专业术语、缩写），逐一用中文解释
3. **语境说明**：解释文中涉及的文化背景、习惯用法、特殊表达方式，以及在英语语境下才会出现的概念

原文：
{{text}}

请用清晰的结构化格式回复。`;

/**
 * Process text through the configured LLM backend.
 *
 * @param {object} options
 * @param {string} options.text          - The text to process (OCR result or clipboard text).
 * @param {string} [options.backend]     - Backend identifier ('anthropic', 'openai', 'ollama', 'custom').
 * @param {string} [options.model]       - Model name/ID to use.
 * @param {string} [options.promptTemplate] - User prompt template (with {{text}} and {{languageHint}} placeholders).
 * @param {string} [options.languageHint]   - Language hint (e.g. 'en', 'zh').
 * @returns {Promise<{result: string, processingTimeMs: number}>}
 */
async function processText({ text, backend, model, promptTemplate, languageHint }) {
  const startTime = Date.now();
  const settings = store.getAllSettings();

  const resolvedBackend = backend || settings.activeBackend || 'anthropic';
  const resolvedModel = model || settings.activeModel || 'claude-sonnet-4-20250514';
  const resolvedLanguageHint = languageHint || settings.languageHint || 'en';
  const resolvedPromptTemplate = promptTemplate || settings.customPrompt || DEFAULT_USER_TEMPLATE;

  // Always use the generic bilingual assistant role as system prompt
  const systemPrompt = DEFAULT_SYSTEM_PROMPT;

  // Build the user message by replacing template placeholders
  let userMessage = resolvedPromptTemplate
    .replace(/\{\{text\}\}/g, text)
    .replace(/\{\{languageHint\}\}/g, resolvedLanguageHint);

  let result;

  switch (resolvedBackend) {
    case 'anthropic':
      result = await processAnthropic(settings, resolvedModel, systemPrompt, userMessage);
      break;
    case 'openai':
      result = await processOpenAI(settings, resolvedModel, systemPrompt, userMessage);
      break;
    case 'ollama':
      result = await processOllama(settings, resolvedModel, systemPrompt, userMessage);
      break;
    case 'custom':
      result = await processCustom(settings, resolvedModel, systemPrompt, userMessage);
      break;
    default:
      throw new Error(`Unknown backend: ${resolvedBackend}`);
  }

  const processingTimeMs = Date.now() - startTime;

  return { result, processingTimeMs };
}

/**
 * Process via Anthropic SDK.
 */
async function processAnthropic(settings, model, systemPrompt, userMessage) {
  const Anthropic = require('@anthropic-ai/sdk');
  const apiKey = settings.anthropicApiKey;

  if (!apiKey) {
    throw new Error('Anthropic API key is not configured.');
  }

  return withTimeout(withRetry(async () => {
    const anthropic = new Anthropic({ apiKey });

    const response = await anthropic.messages.create({
      model: model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const result = response.content[0].text;

    if (response.stop_reason === 'max_tokens') {
      return result + '\n\n⚠️ 注意：回复可能被截断，内容可能不完整。';
    }
    return result;
  }), 60000);
}

/**
 * Process via OpenAI SDK.
 */
async function processOpenAI(settings, model, systemPrompt, userMessage) {
  const OpenAI = require('openai');
  const apiKey = settings.openaiApiKey;

  if (!apiKey) {
    throw new Error('OpenAI API key is not configured.');
  }

  return withTimeout(withRetry(async () => {
    const openai = new OpenAI({ apiKey });

    const response = await openai.chat.completions.create({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 4096,
    });

    const result = response.choices[0].message.content;

    if (response.choices[0].finish_reason === 'length') {
      return result + '\n\n⚠️ 注意：回复可能被截断，内容可能不完整。';
    }
    return result;
  }), 60000);
}

/**
 * Process via Ollama's local API.
 */
async function processOllama(settings, model, systemPrompt, userMessage) {
  const baseUrl = settings.ollamaBaseUrl || 'http://localhost:11434';

  return withTimeout(withRetry(async () => {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        prompt: `${systemPrompt}\n\n${userMessage}`,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const result = data.response || '';

    if (data.done && data.done_reason === 'length') {
      return result + '\n\n⚠️ 注意：回复可能被截断，内容可能不完整。';
    }
    return result;
  }), 60000);
}

/**
 * Process via a custom OpenAI-compatible endpoint.
 */
async function processCustom(settings, model, systemPrompt, userMessage) {
  const OpenAI = require('openai');
  const baseURL = settings.customEndpointUrl;
  const apiKey = settings.customEndpointApiKey;

  if (!baseURL) {
    throw new Error('Custom endpoint URL is not configured.');
  }

  return withTimeout(withRetry(async () => {
    const openai = new OpenAI({
      apiKey: apiKey || 'sk-no-key-required',
      baseURL: baseURL,
    });

    const response = await openai.chat.completions.create({
      model: model || 'custom',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 4096,
    });

    const result = response.choices[0].message.content;

    if (response.choices[0].finish_reason === 'length') {
      return result + '\n\n⚠️ 注意：回复可能被截断，内容可能不完整。';
    }
    return result;
  }), 60000);
}

module.exports = {
  processText,
};
