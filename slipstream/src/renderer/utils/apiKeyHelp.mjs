// Getting-a-key guidance for readers who picked an online service but have
// no API Key yet. Links point at each provider's own key page and are opened
// by the main process through the public-HTTPS external opener.
//
// The DeepSeek estimate combines the measured size of one screenshot reading
// (transcription + translation + one lookup, about 3–5k tokens with thinking
// disabled) with DeepSeek's published peak price for deepseek-flash
// (¥2 per million input tokens, ¥8 per million output tokens; off-peak is
// half). Re-check both before changing the wording.
const API_KEY_HELP = Object.freeze({
  deepseek: Object.freeze({
    provider: 'DeepSeek',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    consoleLabel: '打开 DeepSeek 开放平台',
    accountUrl: 'https://platform.deepseek.com/',
    steps: Object.freeze([
      '注册并登录 DeepSeek 开放平台。',
      '在“API keys”页面创建一个新 Key，复制以 sk- 开头的整串字符，粘贴到上面。',
      '账户有余额才能调用；余额不足时在平台的“充值”页面充值，按实际用量扣费。',
    ]),
    cost: '按 DeepSeek 目前公布的价格，一次截图阅读通常约 1–2 分钱，空闲时段减半；以服务商实时价格为准。',
    pricingUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
  }),
  openai: Object.freeze({
    provider: 'OpenAI',
    consoleUrl: 'https://platform.openai.com/api-keys',
    consoleLabel: '打开 OpenAI 控制台',
    accountUrl: 'https://platform.openai.com/',
    steps: Object.freeze([
      '登录 OpenAI 开发者平台。',
      '在“API keys”页面创建新 Key，复制后粘贴到上面。',
    ]),
    cost: '按用量计费，价格以 OpenAI 公布的为准。',
    pricingUrl: '',
  }),
  anthropic: Object.freeze({
    provider: 'Anthropic',
    consoleUrl: 'https://platform.claude.com/settings/keys',
    consoleLabel: '打开 Anthropic 控制台',
    accountUrl: 'https://platform.claude.com/',
    steps: Object.freeze([
      '登录 Anthropic 控制台。',
      '在“API keys”页面创建新 Key，复制后粘贴到上面。',
    ]),
    cost: '按用量计费，价格以 Anthropic 公布的为准。',
    pricingUrl: '',
  }),
});

export function apiKeyHelpFor(backend) {
  return Object.hasOwn(API_KEY_HELP, backend) ? API_KEY_HELP[backend] : null;
}
