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

  const resolvedBackend = backend || settings.activeBackend || 'free_translate';
  const resolvedModel = model || settings.activeModel || 'google-translate';
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

  // Wikipedia enrichment for LLM backends (skip for free_translate)
  if (resolvedBackend !== 'free_translate' && !resolvedPromptTemplate) {
    const candidates = extractTermCandidates(text);
    if (candidates.length > 0) {
      const wikiLang = resolvedLanguageHint === 'zh' ? 'zh' : 'en';
      const lookups = await Promise.all(
        candidates.map(async (term) => {
          const extract = await wikipediaLookup(term, wikiLang);
          return extract ? `**${term}**: ${extract}` : null;
        })
      );
      const wikiContext = lookups.filter(Boolean);
      if (wikiContext.length > 0) {
        userMessage = userMessage + '\n\n[Wikipedia context for reference — use if helpful, ignore if irrelevant]:\n' + wikiContext.join('\n');
      }
    }
  }

  let result;

  switch (resolvedBackend) {
    case 'free_translate':
      result = await processFreeTranslate(text, resolvedLanguageHint);
      break;
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

/**
 * Look up a term on Wikipedia and return a short extract.
 * Uses the Wikipedia REST API (free, no key required).
 * @param {string} term - The term to search for
 * @param {string} lang - Wikipedia language code ('en' or 'zh')
 * @returns {Promise<string|null>} - Short extract or null if not found
 */
async function wikipediaLookup(term, lang = 'en') {
  try {
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Slipstream/2.0 (https://github.com/slipstream)' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) return null;

    const data = await response.json();
    if (data.type === 'disambiguation') return null;

    const extract = data.extract || '';
    if (!extract.trim()) return null;

    // Return first 2-3 sentences (up to ~300 chars) for context
    const sentences = extract.split(/[.。]/).filter(s => s.trim().length > 10);
    const short = sentences.slice(0, 3).join('. ') + (sentences.length > 3 ? '.' : '');
    return short.length > 350 ? short.slice(0, 350) + '...' : short;
  } catch {
    return null;
  }
}

/**
 * Extract potential proper nouns / terms from text for Wikipedia lookup.
 * Very simple: multi-word capitalized phrases, all-caps abbreviations, and 2+ char words.
 * @param {string} text - Source text
 * @returns {string[]} - Candidate terms (max 5)
 */
function extractTermCandidates(text) {
  const candidates = [];

  // All-caps abbreviations (2+ chars): ASAP, HTML, CEO, etc.
  const abbrevMatches = text.match(/\b[A-Z]{2,8}\b/g);
  if (abbrevMatches) candidates.push(...abbrevMatches);

  // Capitalized multi-word phrases: "San Francisco", "Machine Learning", etc.
  const phraseMatches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g);
  if (phraseMatches) candidates.push(...phraseMatches);

  // Single capitalized words (not at sentence start): "Python", "Google", "Einstein"
  const singleMatches = text.match(/(?<!\.\s)\b[A-Z][a-z]{3,}\b/g);
  if (singleMatches) candidates.push(...singleMatches);

  // Deduplicate, limit to 5, skip very short
  const seen = new Set();
  return candidates
    .map(t => t.trim())
    .filter(t => t.length >= 2 && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, 5);
}

/**
 * Process text through free Google Translate API (no API key required).
 * Uses the googleapis.com translate endpoint with a simple REST call.
 * Falls back to MyMemory if Google fails.
 * @param {string} text - Text to translate
 * @param {string} languageHint - 'en' (to Chinese), 'zh' (to English), 'auto' (detect)
 * @returns {Promise<string>} - Translated text
 */
async function processFreeTranslate(text, languageHint) {
  // Determine target language
  let targetLang = 'zh-CN';
  let sourceLang = 'en';

  if (languageHint === 'zh') {
    targetLang = 'en';
    sourceLang = 'zh-CN';
  } else if (languageHint === 'auto') {
    // Heuristic: if >30% CJK characters, it's Chinese text → translate to English
    const cjkCount = (text.match(/[一-鿿㐀-䶿豈-﫿]/g) || []).length;
    if (cjkCount / text.length > 0.3) {
      targetLang = 'en';
      sourceLang = 'zh-CN';
    } else {
      targetLang = 'zh-CN';
      sourceLang = 'en';
    }
  }

  return withTimeout({
    fn: async (signal) => withRetry(async () => {
      let result;

      // Try Google Translate first (free, unauthenticated endpoint)
      try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
        const response = await fetch(url, { signal });
        if (response.ok) {
          const data = await response.json();
          // Google's response is [[["translated text", ...], null, ...], ...]
          if (data && data[0] && Array.isArray(data[0])) {
            const translatedParts = data[0].map(part => part[0]).join('');
            result = translatedParts.trim();
          }
        }
      } catch {
        // Google failed, try fallback
      }

      // Fallback: MyMemory API
      if (!result) {
        const mmUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang}|${targetLang}`;
        const mmResponse = await fetch(mmUrl, { signal });
        if (!mmResponse.ok) {
          throw new Error(`MyMemory API error: ${mmResponse.status}`);
        }
        const mmData = await mmResponse.json();
        if (mmData.responseStatus !== 200 && mmData.responseStatus !== '200') {
          throw new Error(mmData.responseDetails || 'MyMemory translation failed');
        }
        result = mmData.responseData.translatedText.trim();
      }

      if (!result) {
        throw new Error('Translation failed: all backends returned empty result');
      }

      // Free translation only does translation — add a note about upgrading for explanations
      return result + '\n\n---\n💡 这是免费翻译结果。配置 LLM API Key 可获得专有名词解释和术语解析能力。';
    }),
    ms: 15000,
  });
}

module.exports = {
  processText,
  wikipediaLookup,
  extractTermCandidates,
};
