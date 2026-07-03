const store = require('./store');
const { PROMPT_TEMPLATES } = require('../shared/constants.cjs');

const MODEL_TIMEOUT_MESSAGE = '模型响应超时';

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

      const delay = Math.min(1000 * Math.pow(2, i), 8000); // exponential backoff: 1s, 2s, 4s...
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

function stripReasoning(text) {
  return (text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/**
 * Apply a timeout to an async operation and abort the underlying request.
 * Creates an AbortController that aborts after `ms` milliseconds.
 * @param {object} options
 * @param {(signal: AbortSignal) => Promise<any>} options.fn - Function that receives the abort signal
 * @param {number} options.ms - Timeout in milliseconds
 * @param {AbortSignal} [options.parentSignal] - Optional external signal to link
 * @returns {Promise<any>}
 */
function withTimeout({ fn, ms, parentSignal }) {
  const controller = new AbortController();
  const signal = controller.signal;

  // Link parent signal if provided
  if (parentSignal) {
    const onParentAbort = () => controller.abort();
    parentSignal.addEventListener('abort', onParentAbort, { once: true });
    // Clean up listener if our controller aborts first
    signal.addEventListener('abort', () => parentSignal.removeEventListener('abort', onParentAbort), { once: true });
  }

  const timer = setTimeout(() => {
    controller.abort(new Error(MODEL_TIMEOUT_MESSAGE));
  }, ms);

  return fn(signal)
    .catch((error) => {
      const message = error?.message || '';
      if (
        signal.aborted ||
        error?.name === 'AbortError' ||
        message.includes('timeout') ||
        message.includes('Timeout') ||
        message.includes('aborted') ||
        message.includes('abort')
      ) {
        throw new Error(MODEL_TIMEOUT_MESSAGE);
      }
      throw error;
    })
    .finally(() => {
      clearTimeout(timer);
    });
}


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

  // Select the appropriate prompt templates based on language direction
  const langTemplates = PROMPT_TEMPLATES[resolvedLanguageHint] || PROMPT_TEMPLATES.en;

  // Always use the language-appropriate system prompt
  const systemPrompt = langTemplates.system;

  // Build the user message — use custom prompt if provided, otherwise the template
  const resolvedPromptTemplate = promptTemplate || settings.customPrompt;

  let userMessage;
  if (resolvedPromptTemplate) {
    // Custom prompts still get {{text}} and {{languageHint}} substitutions for backward compatibility
    userMessage = resolvedPromptTemplate
      .replace(/\{\{text\}\}/g, text)
      .replace(/\{\{languageHint\}\}/g, resolvedLanguageHint);
  } else {
    userMessage = langTemplates.user.replace(/\{\{text\}\}/g, text);
  }

  let result;

  switch (resolvedBackend) {
    case 'anthropic':
      result = await processAnthropic(settings, resolvedModel, systemPrompt, userMessage);
      break;
    case 'openai':
      result = await processOpenAI(settings, resolvedModel, systemPrompt, userMessage);
      break;
    case 'deepseek':
      result = await processDeepSeek(settings, resolvedModel, systemPrompt, userMessage);
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
    throw new Error('需要先添加 API key');
  }

  return withTimeout({
    fn: async (signal) => withRetry(async () => {
      const anthropic = new Anthropic({ apiKey });

      const response = await anthropic.messages.create({
        model: model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }, { signal });

      const result = response.content[0].text;

      if (response.stop_reason === 'max_tokens') {
        return result + '\n\n⚠️ 注意：回复可能被截断，内容可能不完整。';
      }
      return result;
    }),
    ms: 60000,
  });
}

/**
 * Process via OpenAI SDK.
 */
async function processOpenAI(settings, model, systemPrompt, userMessage) {
  const OpenAI = require('openai');
  const apiKey = settings.openaiApiKey;

  if (!apiKey) {
    throw new Error('需要先添加 API key');
  }

  return withTimeout({
    fn: async (signal) => withRetry(async () => {
      const openai = new OpenAI({ apiKey });

      const response = await openai.chat.completions.create({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 4096,
      }, { signal });

      const result = response.choices[0].message.content;

      if (response.choices[0].finish_reason === 'length') {
        return result + '\n\n⚠️ 注意：回复可能被截断，内容可能不完整。';
      }
      return result;
    }),
    ms: 60000,
  });
}

/**
 * Process via DeepSeek's OpenAI-compatible API.
 */
async function processDeepSeek(settings, model, systemPrompt, userMessage) {
  const OpenAI = require('openai');
  const apiKey = settings.deepseekApiKey;

  if (!apiKey) {
    throw new Error('需要先添加 API key');
  }

  return withTimeout({
    fn: async (signal) => withRetry(async () => {
      const openai = new OpenAI({
        apiKey,
        baseURL: 'https://api.deepseek.com',
      });

      const response = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 4096,
      }, { signal });

      const result = response.choices[0].message.content;

      if (response.choices[0].finish_reason === 'length') {
        return result + '\n\n⚠️ 注意：回复可能被截断，内容可能不完整。';
      }
      return result;
    }),
    ms: 60000,
  });
}

/**
 * Process via Ollama's local API.
 */
async function processOllama(settings, model, systemPrompt, userMessage) {
  const baseUrl = settings.ollamaBaseUrl || 'http://localhost:11434';

  return withTimeout({
    fn: async (signal) => withRetry(async () => {
      const response = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          system: systemPrompt,
          prompt: userMessage,
          stream: false,
        }),
        signal: signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const result = stripReasoning(data.response || '');

      if (data.done && data.done_reason === 'length') {
        return result + '\n\n⚠️ 注意：回复可能被截断，内容可能不完整。';
      }
      return result;
    }),
    ms: 60000,
  });
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

  return withTimeout({
    fn: async (signal) => withRetry(async () => {
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
      }, { signal });

      const result = response.choices[0].message.content;

      if (response.choices[0].finish_reason === 'length') {
        return result + '\n\n⚠️ 注意：回复可能被截断，内容可能不完整。';
      }
      return result;
    }),
    ms: 60000,
  });
}

module.exports = {
  processText,
};
