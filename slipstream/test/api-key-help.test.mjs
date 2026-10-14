import assert from 'node:assert/strict';
import test from 'node:test';
import { apiKeyHelpFor } from '../src/renderer/utils/apiKeyHelp.mjs';
import { loadComponent, render } from './helpers/render-component.mjs';

const { default: ApiKeyHelp } = await loadComponent('src/renderer/components/ApiKeyHelp.jsx');
const text = (html) => html.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim();
const buttons = (html) => [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/gu)]
  .map(([, label]) => label.replace(/<[^>]+>/gu, '').trim());

test('every key-based online provider links to its own HTTPS key page', () => {
  for (const backend of ['deepseek', 'openai', 'anthropic']) {
    const help = apiKeyHelpFor(backend);
    assert.ok(help, backend);
    const url = new URL(help.consoleUrl);
    assert.equal(url.protocol, 'https:', backend);
    assert.equal(url.username + url.password + url.search, '', backend);
    assert.ok(help.steps.length >= 2, backend);
    assert.match([...help.steps, help.cost].join(''), /用量/u, `${backend} must say it bills by usage`);
  }
});

test('services without an API Key get no key guide', () => {
  for (const backend of ['ollama', 'custom', 'free_translate', '__proto__', undefined]) {
    assert.equal(apiKeyHelpFor(backend), null, String(backend));
    assert.equal(render(ApiKeyHelp, { backend, onOpenExternal: async () => true }), '');
  }
});

test('the DeepSeek guide explains how to get a key, what it costs, and where prices live', () => {
  const html = render(ApiKeyHelp, { backend: 'deepseek', onOpenExternal: async () => true });
  assert.match(html, /^<details class="api-key-help">/u, 'collapsed until the reader asks');
  const visible = text(html);
  assert.match(visible, /还没有 DeepSeek API Key？/u);
  assert.match(visible, /sk- 开头/u);
  assert.match(visible, /余额/u);
  assert.match(visible, /约 1–2 分钱/u);
  assert.match(visible, /以服务商实时价格为准/u);
  assert.deepEqual(buttons(html), ['打开 DeepSeek 开放平台', '查看价格']);
  assert.equal(new URL(apiKeyHelpFor('deepseek').pricingUrl).hostname, 'api-docs.deepseek.com');
});

test('providers without a pricing link show only the key page action', () => {
  const html = render(ApiKeyHelp, { backend: 'anthropic', onOpenExternal: async () => true });
  assert.deepEqual(buttons(html), ['打开 Anthropic 控制台']);
  assert.doesNotMatch(text(html), /分钱/u, 'the DeepSeek estimate must not leak to other providers');
});
