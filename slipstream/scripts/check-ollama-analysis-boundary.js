#!/usr/bin/env node

const assert = require('node:assert/strict');
const http = require('node:http');

const { processOllama } = require('../src/main/llm-service');

const SOURCE_TEXT = 'FICTIONAL_OLLAMA_SOURCE_NEVER_LOG';
const SYSTEM_PROMPT = 'Return only the fixture response.';
const MODEL = 'fixture-model';

function formatOrigin(host, port) {
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
}

function listen(host, handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      resolve({
        server,
        origin: formatOrigin(host, address.port),
        port: address.port,
      });
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('error', reject);
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function ollamaResponse(value = 'fixture-ok') {
  return JSON.stringify({
    response: value,
    done: true,
    done_reason: 'stop',
  });
}

async function analyze(endpoint, structuredOutput = false) {
  return processOllama(
    { ollamaBaseUrl: endpoint },
    MODEL,
    SYSTEM_PROMPT,
    SOURCE_TEXT,
    undefined,
    structuredOutput,
  );
}

function assertSafeError(error, expectedCode, forbiddenValues) {
  assert.equal(error?.code, expectedCode);
  const serialized = `${error?.name || ''} ${error?.message || ''} ${error?.stack || ''}`;
  for (const forbidden of forbiddenValues) {
    assert.equal(serialized.includes(forbidden), false, 'Ollama errors must not expose request context');
  }
  return true;
}

async function main() {
  const originalFetch = globalThis.fetch;
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const capturedLogs = [];
  for (const method of Object.keys(originalConsole)) {
    console[method] = (...args) => capturedLogs.push(args.map(String).join(' '));
  }

  const servers = [];
  const forbiddenEndpoints = [];
  try {
    const received = [];
    const ipv4 = await listen('127.0.0.1', async (request, response) => {
      received.push({ url: request.url, body: await readBody(request) });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(ollamaResponse());
    });
    servers.push(ipv4.server);

    for (const endpoint of [
      `http://127.0.0.1:${ipv4.port}`,
      `http://localhost:${ipv4.port}`,
      `http://localhost.:${ipv4.port}`,
      `http://127.1:${ipv4.port}`,
    ]) {
      assert.equal(await analyze(endpoint, true), 'fixture-ok');
    }
    assert.equal(received.length, 4);
    for (const request of received) {
      assert.equal(request.url, '/api/generate');
      const body = JSON.parse(request.body);
      assert.equal(body.model, MODEL);
      assert.equal(body.prompt, SOURCE_TEXT);
      assert.equal(body.format, 'json');
      assert.equal(body.options.num_ctx, 16384);
      assert.equal(body.stream, false);
    }

    const ipv6Received = [];
    const ipv6 = await listen('::1', async (request, response) => {
      ipv6Received.push({ url: request.url, body: await readBody(request) });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(ollamaResponse('fixture-ipv6-ok'));
    });
    servers.push(ipv6.server);
    assert.equal(await analyze(`${ipv6.origin}/ollama`), 'fixture-ipv6-ok');
    assert.equal(ipv6Received.length, 1);
    assert.equal(ipv6Received[0].url, '/ollama/api/generate');

    // macOS does not necessarily expose a bindable alias for every 127/8
    // address. Exercise the production validation and request construction
    // through the existing deterministic fetch seam without opening a socket.
    const ipv4RangeRequests = [];
    globalThis.fetch = async (url, options) => {
      ipv4RangeRequests.push({ url: String(url), options });
      return new Response(ollamaResponse('fixture-127-range-ok'), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    assert.equal(
      await analyze('http://127.42.8.9:11434/private-root'),
      'fixture-127-range-ok',
    );
    assert.equal(ipv4RangeRequests.length, 1);
    assert.equal(ipv4RangeRequests[0].url, 'http://127.42.8.9:11434/private-root/api/generate');
    assert.equal(ipv4RangeRequests[0].options.redirect, 'manual');
    assert.equal(JSON.parse(ipv4RangeRequests[0].options.body).prompt, SOURCE_TEXT);
    globalThis.fetch = originalFetch;

    let redirectTargetRequests = 0;
    const redirectTarget = await listen('127.0.0.1', async (request, response) => {
      redirectTargetRequests += 1;
      await readBody(request);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(ollamaResponse('must-not-arrive'));
    });
    servers.push(redirectTarget.server);

    let redirectFirstHopRequests = 0;
    const redirect = await listen('127.0.0.1', async (request, response) => {
      redirectFirstHopRequests += 1;
      await readBody(request);
      response.writeHead(307, {
        Location: `${redirectTarget.origin}/collect`,
        'Content-Type': 'application/json',
      });
      response.end('{}');
    });
    servers.push(redirect.server);
    forbiddenEndpoints.push(redirect.origin, redirectTarget.origin);

    await assert.rejects(
      analyze(redirect.origin),
      (error) => assertSafeError(
        error,
        'ollama-redirect-rejected',
        [SOURCE_TEXT, redirect.origin, redirectTarget.origin],
      ),
    );
    assert.equal(redirectFirstHopRequests, 1, 'a redirect must stop after one intended loopback request');
    assert.equal(redirectTargetRequests, 0, 'the source must never reach an Ollama redirect target');

    let sameOriginFirstHopRequests = 0;
    let sameOriginSecondHopRequests = 0;
    let sameOrigin;
    sameOrigin = await listen('127.0.0.1', async (request, response) => {
      await readBody(request);
      if (request.url === '/api/generate') {
        sameOriginFirstHopRequests += 1;
        response.writeHead(302, {
          Location: `${sameOrigin.origin}/redirect-target`,
          'Content-Type': 'application/json',
        });
        response.end('{}');
        return;
      }
      sameOriginSecondHopRequests += 1;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(ollamaResponse('must-not-arrive'));
    });
    servers.push(sameOrigin.server);
    forbiddenEndpoints.push(sameOrigin.origin);

    await assert.rejects(
      analyze(sameOrigin.origin),
      (error) => assertSafeError(
        error,
        'ollama-redirect-rejected',
        [SOURCE_TEXT, sameOrigin.origin],
      ),
    );
    assert.equal(sameOriginFirstHopRequests, 1);
    assert.equal(sameOriginSecondHopRequests, 0, 'same-origin redirects must also fail closed');

    let unsafeFetches = 0;
    globalThis.fetch = async () => {
      unsafeFetches += 1;
      throw new Error('unsafe endpoint reached fetch');
    };
    for (const endpoint of [
      'http://example.com:11434',
      'https://example.com/ollama',
      'https://localhost/ollama',
      'https://127.0.0.1/ollama',
      'file:///tmp/ollama.sock',
    ]) {
      forbiddenEndpoints.push(endpoint);
      await assert.rejects(
        analyze(endpoint),
        (error) => assertSafeError(error, 'ollama-endpoint-unsafe', [SOURCE_TEXT, endpoint]),
      );
    }
    assert.equal(unsafeFetches, 0, 'unsafe legacy settings must fail before any request');
    globalThis.fetch = originalFetch;

    const unsafeStatus = await listen('127.0.0.1', async (request, response) => {
      await readBody(request);
      response.statusMessage = SOURCE_TEXT;
      response.writeHead(418, { 'Content-Type': 'text/plain' });
      response.end(SOURCE_TEXT);
    });
    servers.push(unsafeStatus.server);
    forbiddenEndpoints.push(unsafeStatus.origin);
    await assert.rejects(
      analyze(unsafeStatus.origin),
      (error) => {
        assert.equal(error?.status, 418);
        assert.equal(`${error?.message || ''} ${error?.stack || ''}`.includes(SOURCE_TEXT), false);
        assert.equal(`${error?.message || ''} ${error?.stack || ''}`.includes(unsafeStatus.origin), false);
        return true;
      },
    );

    const invalidJson = await listen('127.0.0.1', async (request, response) => {
      await readBody(request);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(SOURCE_TEXT);
    });
    servers.push(invalidJson.server);
    forbiddenEndpoints.push(invalidJson.origin);
    await assert.rejects(
      analyze(invalidJson.origin),
      (error) => assertSafeError(
        error,
        'ollama-invalid-response',
        [SOURCE_TEXT, invalidJson.origin],
      ),
    );

    const logs = capturedLogs.join('\n');
    assert.equal(logs.includes(SOURCE_TEXT), false);
    for (const endpoint of forbiddenEndpoints) {
      assert.equal(logs.includes(endpoint), false);
    }
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(console, originalConsole);
    await Promise.allSettled(servers.map(close));
  }

  process.stdout.write('Ollama analysis boundary checks passed\n');
}

main().catch(() => {
  process.stderr.write('Ollama analysis boundary checks failed\n');
  process.exitCode = 1;
});
