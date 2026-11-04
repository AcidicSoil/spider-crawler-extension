import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackend } from '../server/app.mjs';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'spider-backend-'));
  const dbPath = join(dir, 'spider.sqlite');
  const app = createBackend({ dbPath });
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch });
  const base = `http://127.0.0.1:${server.port}`;
  const request = async (path, body, origin) => {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(origin ? { Origin: origin } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  return { app, server, base, dbPath, request, close: async () => {
    server.stop(true);
    app.close();
    await rm(dir, { recursive: true, force: true });
  } };
}

const sessionId = 'eb42b46f-c9c5-4e2d-9a16-dc3f59b23fe1';
const pageUrl = 'https://en.wikipedia.org/wiki/Spider';
const candidate = (href, kind = 'bite', x = 20) => ({
  href, text: href.split('/').at(-1), kind, by: 'kw', p: null, cx: x, cy: 10,
});
const payload = () => ({
  sessionId, pageUrl, hunt: 'spider', position: { x: 0, y: 0 },
  candidates: [
    candidate('https://en.wikipedia.org/wiki/Banana', 'wrap', 2),
    candidate('https://en.wikipedia.org/wiki/Spider_silk', 'bite', 20),
    candidate('https://en.wikipedia.org/wiki/Tarantula', 'bite', 60),
  ],
});

test('backend assigns, verifies and persists real spider actions', async () => {
  const testServer = await fixture();
  try {
    assert.deepEqual((await testServer.request('/api/health')).body, { status: 'ok' });
    const initial = await testServer.request('/api/next', payload());
    assert.equal(initial.status, 200);
    assert.equal(initial.body.target.href, 'https://en.wikipedia.org/wiki/Spider_silk');
    assert.equal(initial.body.target.kind, 'bite');

    const outOfOrder = await testServer.request('/api/actions', {
      sessionId, href: 'https://en.wikipedia.org/wiki/Tarantula', kind: 'bite',
      text: 'Tarantula', by: 'kw', p: null,
    });
    assert.equal(outOfOrder.status, 409);

    const action = await testServer.request('/api/actions', {
      sessionId, href: initial.body.target.href, kind: 'bite', text: 'Spider silk', by: 'kw', p: null,
    });
    assert.equal(action.status, 200);
    assert.equal(action.body.count, 1);
    assert.equal((await testServer.request('/api/actions', {
      sessionId, href: initial.body.target.href, kind: 'bite', text: 'Spider silk', by: 'kw', p: null,
    })).body.count, 1);

    const next = await testServer.request('/api/next', payload());
    assert.equal(next.body.target.href, 'https://en.wikipedia.org/wiki/Tarantula');

    const results = await testServer.request('/api/results?sessionId=' + sessionId);
    assert.equal(results.body.actions.length, 1);
    assert.equal(results.body.actions[0].href, initial.body.target.href);

    testServer.server.stop(true);
    testServer.app.close();
    const reopened = createBackend({ dbPath: testServer.dbPath });
    const actions = await reopened.fetch(new Request('http://127.0.0.1/api/results?sessionId=' + sessionId));
    assert.equal((await actions.json()).actions.length, 1);
    reopened.close();
  } finally { await testServer.close(); }
});

test('backend rejects invalid candidates, forged sessions and page origins', async () => {
  const testServer = await fixture();
  try {
    assert.equal((await testServer.request('/api/next',
      payload(), 'https://malicious.example')).status, 403);
    assert.equal((await testServer.request('/api/next',
      { ...payload(), candidates: [candidate('javascript:alert(1)')] })).status, 400);
    assert.equal((await testServer.request('/api/next',
      { ...payload(), sessionId: 'invalid' })).status, 400);
    assert.equal((await testServer.request('/api/actions',
      { sessionId, href: pageUrl, kind: 'bite', text: 'Spider', by: 'kw', p: null })).status, 409);
    assert.equal((await testServer.request('/api/next', payload())).status, 200);
    assert.equal((await testServer.request('/api/next',
      { ...payload(), pageUrl: 'https://example.com/' })).status, 409);
  } finally { await testServer.close(); }
});

test('backend serves extension preview without exposing local files', async () => {
  const testServer = await fixture();
  try {
    const options = await fetch(testServer.base + '/options.html');
    assert.equal(options.status, 200);
    assert.match(await options.text(), /Spider Crawler settings/);
    const dashboard = await fetch(testServer.base + '/');
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /recent actions/);
    assert.equal((await fetch(testServer.base + '/.git/config')).status, 404);
    assert.equal((await fetch(testServer.base + '/server/app.mjs')).status, 404);
  } finally { await testServer.close(); }
});

test('session isolation and origin validation prevent unintended action writes', async () => {
  const server = await fixture();
  const otherSession = 'f422f772-f087-46a1-8d4c-290362260c74';
  try {
    assert.equal((await server.request('/api/next', payload())).status, 200);
    assert.equal((await server.request('/api/next', { ...payload(), sessionId: otherSession })).status, 200);
    assert.equal((await server.request('/api/actions', {
      sessionId: otherSession, href: 'https://en.wikipedia.org/wiki/Spider_silk',
      kind: 'wrap', text: 'Spider silk', by: 'kw', p: null,
    })).status, 409);
    const first = await server.request('/api/actions', {
      sessionId, href: 'https://en.wikipedia.org/wiki/Spider_silk',
      kind: 'bite', text: 'Spider silk', by: 'kw', p: null,
    });
    assert.equal(first.status, 200);
    assert.equal((await server.request('/api/results?sessionId=' + otherSession)).body.actions.length, 0);
    assert.equal((await server.request('/api/results?sessionId=' + sessionId)).body.actions.length, 1);
    assert.equal((await server.request('/api/results', undefined, 'https://malicious.example')).status, 403);
    const preflight = await fetch(server.base + '/api/actions', {
      method: 'OPTIONS', headers: { Origin: 'https://malicious.example',
        'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(preflight.status, 403);
    assert.equal(preflight.headers.get('access-control-allow-origin'), null);
  } finally { await server.close(); }
});

test('server disconnect and restart restore persisted sessions without duplicating actions', async () => {
  const server = await fixture();
  let restarted;
  try {
    assert.equal((await server.request('/api/next', payload())).status, 200);
    const completed = await server.request('/api/actions', {
      sessionId, href: 'https://en.wikipedia.org/wiki/Spider_silk',
      kind: 'bite', text: 'Spider silk', by: 'kw', p: null,
    });
    assert.equal(completed.body.count, 1);
    server.server.stop(true);
    await assert.rejects(() => fetch(server.base + '/api/health',
      { signal: AbortSignal.timeout(500) }));
    restarted = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: server.app.fetch });
    const response = await fetch(`http://127.0.0.1:${restarted.port}/api/results?sessionId=${sessionId}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).actions.length, 1);
    const next = await fetch(`http://127.0.0.1:${restarted.port}/api/next`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload()),
    });
    assert.equal((await next.json()).target.href, 'https://en.wikipedia.org/wiki/Tarantula');
  } finally {
    restarted?.stop(true);
    await server.close();
  }
});

test('bounded JSON payload validation rejects oversized and malformed requests', async () => {
  const server = await fixture();
  try {
    const overLimit = await server.request('/api/next', {
      ...payload(), candidates: Array.from({ length: 65 },
        (_, i) => candidate(`https://example.com/item${i}`)),
    });
    assert.equal(overLimit.status, 400);
    assert.equal((await server.request('/api/results?sessionId=bad-id')).status, 400);
    const malformed = await fetch(server.base + '/api/next', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
    });
    assert.equal(malformed.status, 400);
    assert.equal((await fetch(server.base + '/../../server/app.mjs')).status, 404);
  } finally { await server.close(); }
});
