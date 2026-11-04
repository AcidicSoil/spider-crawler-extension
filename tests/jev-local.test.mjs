import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../background.js', import.meta.url), 'utf8');

async function serve(handler) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const part of req) body += part;
    requests.push({ method: req.method, path: req.url, auth: req.headers.authorization, body });
    await handler(req, res, body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, requests,
    close: () => new Promise(resolve => server.close(resolve)) };
}

function worker(config = {}, fetchImpl = fetch) {
  const handlers = [];
  const state = { ...config };
  const chrome = {
    runtime: { id: 'test-extension', onMessage: { addListener: handler => handlers.push(handler) } },
    storage: { local: {
      get: async defaults => ({ ...defaults, ...state }),
      set: async updates => Object.assign(state, updates),
    } },
  };
  runInNewContext(source, {
    chrome,
    fetch: fetchImpl, AbortController, AbortSignal, URL, setTimeout, clearTimeout, performance,
  });
  async function message(payload, sender = { url: 'chrome-extension://test-extension/options.html' }) {
    return new Promise(resolve => {
      const keep = handlers[0](payload, sender, resolve);
      if (!keep) resolve({ rejected: true });
    });
  }
  return { message, state };
}

test('discovers only decision-capable installed models; never selects a default', async () => {
  const service = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      data: [
        { id: 'laya', architecture: { output_modalities: ['decisions'] } },
        { id: 'kev-0.8b', architecture: { output_modalities: ['text', 'decisions'] } },
        { id: 'regular-chat', architecture: { output_modalities: ['text'] } },
        { id: 'unknown' },
        { id: 'laya', architecture: { output_modalities: ['decisions'] } },
      ],
    }));
  });
  try {
    const { message } = worker();
    const response = await message({ type: 'jev-models', baseUrl: service.baseUrl });
    assert.equal(response.ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(response.models)), ['laya', 'kev-0.8b']);
    assert.equal(Object.hasOwn(response, 'selectedModel'), false);
    assert.deepEqual(service.requests.map(req => [req.method, req.path, req.auth]), [['GET', '/v1/models', undefined]]);
  } finally { await service.close(); }
});

test('rejects discovery from webpage senders and non-loopback model endpoints', async () => {
  let fetchCount = 0;
  const { message } = worker({}, async () => { fetchCount++; throw Error('not expected'); });
  assert.deepEqual(await message({ type: 'jev-models', baseUrl: 'http://127.0.0.1:8800/v1' },
    { url: 'https://en.wikipedia.org/wiki/Spider' }), { rejected: true });
  for (const baseUrl of [
    'http://example.com:8800/v1',
    'https://127.0.0.1:8800/v1',
    'http://127.0.0.1:8800/other',
    'http://user:pass@127.0.0.1:8800/v1',
  ]) {
    const response = await message({ type: 'jev-models', baseUrl });
    assert.equal(response.ok, false, baseUrl);
    assert.match(response.error, /endpoint/i);
  }
  assert.equal(fetchCount, 0);
});

test('keyless local Jev uses the exact user-selected model and System One payload', async () => {
  const service = await serve((_req, res) => res.writeHead(200, { 'content-type': 'application/json' })
    .end(JSON.stringify({ model: 'kev-0.8b', answers: {
      l0: { type: 'noul', noul: 0.91 }, l1: { type: 'noul', noul: 0.12 },
    } })));
  try {
    const { message } = worker({ jevProvider: 'local', jevLocalUrl: service.baseUrl,
      jevLocalModel: 'kev-0.8b', jevKey: '' });
    const result = await message({ type: 'jev-test' });
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(result.probs)), [0.91, 0.12]);
    assert.equal(result.model, 'kev-0.8b');
    assert.equal(service.requests.length, 1);
    assert.equal(service.requests[0].path, '/v1/systemone');
    assert.equal(service.requests[0].auth, undefined);
    const body = JSON.parse(service.requests[0].body);
    assert.equal(body.model, 'kev-0.8b');
    assert.equal(body.questions.l0.type, 'noul');
  } finally { await service.close(); }
});

test('missing preferred model prevents guessing or sending a request', async () => {
  let fetchCount = 0;
  const { message } = worker({ jevProvider: 'local', jevLocalModel: '',
    jevLocalUrl: 'http://127.0.0.1:8800/v1' }, async () => { fetchCount++; });
  const result = await message({ type: 'jev-test' });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: false, error: 'no_model' });
  assert.equal(fetchCount, 0);
});

test('local discovery outage reports failure without changing stored model', async () => {
  const service = await serve((_req, res) => res.writeHead(503).end('temporarily unavailable'));
  try {
    const { message, state } = worker({ jevProvider: 'local', jevLocalModel: 'laya' });
    const result = await message({ type: 'jev-models', baseUrl: service.baseUrl });
    assert.equal(result.ok, false);
    assert.equal(state.jevLocalModel, 'laya');
  } finally { await service.close(); }
});

test('remote Jev still requires its key and uses bearer authorization', async () => {
  let actualUrl, actualAuth;
  const fetchImpl = async (url, init) => {
    actualUrl = url; actualAuth = init.headers.Authorization;
    return { ok: true, status: 200, json: async () => ({ answers: { l0: { noul: 0.7 }, l1: { noul: 0.3 } } }) };
  };
  const missing = worker({ jevProvider: 'typesafe', jevKey: '' }, fetchImpl);
  assert.equal((await missing.message({ type: 'jev-test' })).error, 'no_key');
  const configured = worker({ jevProvider: 'typesafe', jevKey: 'example-key' }, fetchImpl);
  const result = await configured.message({ type: 'jev-test' });
  assert.equal(result.ok, true);
  assert.equal(actualUrl, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(actualAuth, 'Bearer example-key');
});
