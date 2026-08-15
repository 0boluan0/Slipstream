#!/usr/bin/env node

const assert = require('node:assert/strict');
const http = require('node:http');
const util = require('node:util');
const zlib = require('node:zlib');

const {
  CUSTOM_PROVIDER_MAX_RESPONSE_BYTES,
  CUSTOM_PROVIDER_ERROR_CODES,
  processCustom,
} = require('../src/main/llm-service');
const {
  CUSTOM_ENDPOINT_ERROR_CODES,
  createCustomEndpointFetch,
} = require('../src/main/custom-endpoint-fetch');

const SOURCE_TEXT = 'FICTIONAL_CUSTOM_SOURCE_NEVER_LOG';
const API_KEY = 'fixture-custom-provider-key';
const SYSTEM_PROMPT = 'Return the fixture response.';
const HTTP_ECHO_MARKER = 'PRIVATE_CUSTOM_HTTP_ERROR_BODY_NEVER_LOG';

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        origin: `http://127.0.0.1:${address.port}`,
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

function settingsFor(origin) {
  return {
    customEndpointUrl: `${origin}/v1`,
    customEndpointApiKey: API_KEY,
  };
}

async function analyze(origin) {
  return processCustom(
    settingsFor(origin),
    'fixture-model',
    SYSTEM_PROMPT,
    SOURCE_TEXT,
    undefined,
    false,
  );
}

function assertSafeBoundaryError(error, expectedCode, forbiddenValues) {
  assert.equal(error?.code, expectedCode);
  const serialized = `${error?.name || ''} ${error?.message || ''} ${error?.stack || ''}`;
  for (const value of forbiddenValues) {
    assert.equal(serialized.includes(value), false, 'boundary errors must not expose request data');
  }
  return true;
}

function assertSafeHttpError(error, expectedStatus, endpoint) {
  assert.equal(error?.name, 'CustomProviderError');
  assert.equal(error?.code, CUSTOM_PROVIDER_ERROR_CODES.HTTP_ERROR);
  assert.equal(error?.status, expectedStatus);
  assert.deepEqual(Object.keys(error).sort(), ['code', 'name', 'status']);
  const representations = [
    String(error),
    error?.message,
    error?.stack,
    JSON.stringify(error),
    util.inspect(error, { depth: 10, showHidden: true }),
  ].join('\n');
  for (const forbidden of [
    SOURCE_TEXT,
    API_KEY,
    HTTP_ECHO_MARKER,
    'server-private-field',
    endpoint,
  ]) {
    assert.equal(representations.includes(forbidden), false,
      'custom HTTP errors must not retain the response body or request secrets');
  }
  assert.equal(Object.hasOwn(error, 'cause'), false);
  assert.equal(Object.hasOwn(error, 'error'), false);
  assert.equal(Object.hasOwn(error, 'headers'), false);
  console.error(error);
  return true;
}

function assertSafeProviderError(error, expectedCode, forbiddenValues = []) {
  assert.equal(error?.name, 'CustomProviderError');
  assert.equal(error?.code, expectedCode);
  assert.deepEqual(Object.keys(error).sort(), ['code', 'name']);
  const representations = [
    String(error),
    error?.message,
    error?.stack,
    JSON.stringify(error),
    util.inspect(error, { depth: 10, showHidden: true }),
  ].join('\n');
  for (const forbidden of forbiddenValues) {
    assert.equal(representations.includes(forbidden), false,
      'custom response-boundary errors must not retain service content or request secrets');
  }
  assert.equal(Object.hasOwn(error, 'cause'), false);
  assert.equal(Object.hasOwn(error, 'error'), false);
  assert.equal(Object.hasOwn(error, 'headers'), false);
  return true;
}

async function main() {
  const capturedLogs = [];
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  for (const method of Object.keys(originalConsole)) {
    console[method] = (...args) => capturedLogs.push(util.format(...args));
  }

  const servers = [];
  const httpErrorOrigins = [];
  try {
    let normalRequests = 0;
    const normal = await listen(async (request, response) => {
      normalRequests += 1;
      const body = await readBody(request);
      assert.equal(request.url, '/v1/chat/completions');
      assert.equal(
        request.headers.authorization === `Bearer ${API_KEY}`,
        true,
        'the configured origin should receive the custom credential',
      );
      assert.equal(request.headers['accept-encoding'], 'identity',
        'custom analysis must opt out of compressed responses before applying byte limits');
      assert.equal(
        body.includes(SOURCE_TEXT),
        true,
        'the configured origin should receive the requested source text',
      );
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        id: 'fixture-completion',
        object: 'chat.completion',
        choices: [{
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'fixture-ok' },
        }],
      }));
    });
    servers.push(normal.server);

    const normalResult = await analyze(normal.origin);
    assert.equal(normalResult, 'fixture-ok');
    assert.equal(normalRequests, 1, 'a normal same-origin analysis should remain usable');

    let declaredOversizeRequests = 0;
    const declaredOversize = await listen(async (request, response) => {
      declaredOversizeRequests += 1;
      await readBody(request);
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': String(CUSTOM_PROVIDER_MAX_RESPONSE_BYTES + 1),
      });
      response.end('{}');
    });
    servers.push(declaredOversize.server);
    await assert.rejects(
      analyze(declaredOversize.origin),
      (error) => assertSafeProviderError(
        error,
        CUSTOM_PROVIDER_ERROR_CODES.RESPONSE_TOO_LARGE,
        [SOURCE_TEXT, API_KEY, declaredOversize.origin],
      ),
    );
    assert.equal(declaredOversizeRequests, 1,
      'a declared oversized success response must fail without retry');

    let streamedOversizeRequests = 0;
    const streamedOversize = await listen(async (request, response) => {
      streamedOversizeRequests += 1;
      await readBody(request);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      const chunk = Buffer.alloc(64 * 1024, 0x78);
      const fullChunks = Math.floor(CUSTOM_PROVIDER_MAX_RESPONSE_BYTES / chunk.length);
      for (let index = 0; index < fullChunks; index += 1) response.write(chunk);
      response.end('x');
    });
    servers.push(streamedOversize.server);
    await assert.rejects(
      analyze(streamedOversize.origin),
      (error) => assertSafeProviderError(
        error,
        CUSTOM_PROVIDER_ERROR_CODES.RESPONSE_TOO_LARGE,
        [SOURCE_TEXT, API_KEY, streamedOversize.origin],
      ),
    );
    assert.equal(streamedOversizeRequests, 1,
      'a chunked oversized success response must be cancelled without retry');

    let encodedRequests = 0;
    const encoded = await listen(async (request, response) => {
      encodedRequests += 1;
      await readBody(request);
      assert.equal(request.headers['accept-encoding'], 'identity');
      const encodedBody = zlib.gzipSync(JSON.stringify({
        choices: [{ message: { content: 'encoded-success-must-not-be-decoded' } }],
      }));
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'Content-Length': String(encodedBody.length),
      });
      response.end(encodedBody);
    });
    servers.push(encoded.server);
    await assert.rejects(
      analyze(encoded.origin),
      (error) => assertSafeProviderError(
        error,
        CUSTOM_PROVIDER_ERROR_CODES.INVALID_RESPONSE,
        [SOURCE_TEXT, API_KEY, encoded.origin, 'encoded-success-must-not-be-decoded'],
      ),
    );
    assert.equal(encodedRequests, 1,
      'a service that ignores identity encoding must fail without decompression or retry');

    for (const status of [400, 500]) {
      let errorRequests = 0;
      const errorServer = await listen(async (request, response) => {
        errorRequests += 1;
        const body = await readBody(request);
        assert.equal(body.includes(SOURCE_TEXT), true);
        assert.equal(request.headers.authorization, `Bearer ${API_KEY}`);
        response.writeHead(status, {
          'Content-Type': 'application/json',
          'x-server-private': HTTP_ECHO_MARKER,
        });
        response.end(JSON.stringify({
          error: {
            message: `${HTTP_ECHO_MARKER} ${SOURCE_TEXT} ${API_KEY}`,
            code: 'server-private-field',
          },
        }));
      });
      servers.push(errorServer.server);
      httpErrorOrigins.push(errorServer.origin);
      await assert.rejects(
        analyze(errorServer.origin),
        (error) => assertSafeHttpError(error, status, errorServer.origin),
      );
      assert.equal(errorRequests, 1, `${status} responses must not be retried or reread`);
    }

    let crossOriginTargetRequests = 0;
    const crossOriginTarget = await listen(async (request, response) => {
      crossOriginTargetRequests += 1;
      await readBody(request);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{}');
    });
    servers.push(crossOriginTarget.server);

    let crossOriginFirstHopRequests = 0;
    const crossOriginRedirect = await listen(async (request, response) => {
      crossOriginFirstHopRequests += 1;
      await readBody(request);
      response.writeHead(307, {
        Location: `${crossOriginTarget.origin}/collect`,
        'Content-Type': 'application/json',
      });
      response.end('{}');
    });
    servers.push(crossOriginRedirect.server);

    await assert.rejects(
      analyze(crossOriginRedirect.origin),
      (error) => assertSafeBoundaryError(
        error,
        CUSTOM_ENDPOINT_ERROR_CODES.REDIRECT_REJECTED,
        [SOURCE_TEXT, API_KEY, crossOriginRedirect.origin, crossOriginTarget.origin],
      ),
    );
    assert.equal(crossOriginFirstHopRequests, 1, 'a redirect must fail after one configured-origin request');
    assert.equal(crossOriginTargetRequests, 0, 'source and credential must never reach a redirect target');

    let sameOriginFirstHopRequests = 0;
    let sameOriginSecondHopRequests = 0;
    let sameOrigin;
    sameOrigin = await listen(async (request, response) => {
      await readBody(request);
      if (request.url === '/v1/chat/completions') {
        sameOriginFirstHopRequests += 1;
        response.writeHead(307, {
          Location: `${sameOrigin.origin}/v1/redirect-target`,
          'Content-Type': 'application/json',
        });
        response.end('{}');
        return;
      }
      sameOriginSecondHopRequests += 1;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{}');
    });
    servers.push(sameOrigin.server);

    await assert.rejects(
      analyze(sameOrigin.origin),
      (error) => assertSafeBoundaryError(
        error,
        CUSTOM_ENDPOINT_ERROR_CODES.REDIRECT_REJECTED,
        [SOURCE_TEXT, API_KEY, sameOrigin.origin],
      ),
    );
    assert.equal(sameOriginFirstHopRequests, 1, 'same-origin redirects must also fail closed');
    assert.equal(sameOriginSecondHopRequests, 0, 'no redirect target may receive the request body');

    let publicRedirectFirstHopRequests = 0;
    const publicRedirect = await listen(async (request, response) => {
      publicRedirectFirstHopRequests += 1;
      await readBody(request);
      response.writeHead(302, {
        Location: 'https://example.com/collect',
        'Content-Type': 'application/json',
      });
      response.end('{}');
    });
    servers.push(publicRedirect.server);

    await assert.rejects(
      analyze(publicRedirect.origin),
      (error) => assertSafeBoundaryError(
        error,
        CUSTOM_ENDPOINT_ERROR_CODES.REDIRECT_REJECTED,
        [SOURCE_TEXT, API_KEY, publicRedirect.origin],
      ),
    );
    assert.equal(publicRedirectFirstHopRequests, 1, 'a public redirect must be rejected without retry');

    let lockedTargetRequests = 0;
    const lockedTarget = await listen(async (request, response) => {
      lockedTargetRequests += 1;
      await readBody(request);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{}');
    });
    servers.push(lockedTarget.server);

    const lockedFetch = createCustomEndpointFetch(`${normal.origin}/v1`);
    await assert.rejects(
      lockedFetch(`${lockedTarget.origin}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}` },
        body: SOURCE_TEXT,
      }),
      (error) => assertSafeBoundaryError(
        error,
        CUSTOM_ENDPOINT_ERROR_CODES.ORIGIN_MISMATCH,
        [SOURCE_TEXT, API_KEY, normal.origin, lockedTarget.origin],
      ),
    );
    assert.equal(lockedTargetRequests, 0, 'an off-origin SDK request must be rejected before fetch');

    const logs = capturedLogs.join('\n');
    for (const forbidden of [
      SOURCE_TEXT,
      API_KEY,
      normal.origin,
      crossOriginRedirect.origin,
      crossOriginTarget.origin,
      sameOrigin.origin,
      publicRedirect.origin,
      lockedTarget.origin,
      HTTP_ECHO_MARKER,
      'server-private-field',
      ...httpErrorOrigins,
    ]) {
      assert.equal(logs.includes(forbidden), false, 'production boundary must not log sensitive request context');
    }
  } finally {
    Object.assign(console, originalConsole);
    await Promise.allSettled(servers.map(close));
  }

  process.stdout.write('custom analysis boundary checks passed\n');
}

main().catch(() => {
  // Keep the failure channel generic: a future regression must not make a
  // request URL, credential, or source payload appear in CI output.
  process.stderr.write('custom analysis boundary checks failed\n');
  process.exitCode = 1;
});
