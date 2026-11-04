import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../background.js', import.meta.url), 'utf8');

function extensionWorker(fetchImpl) {
  const handlers = [];
  const chrome = {
    runtime: { id: 'abcdefghijklmnopabcdefghijklmnop',
      onMessage: { addListener: fn => handlers.push(fn) } },
    storage: { local: { get: async defaults => defaults } },
  };
  runInNewContext(source, {
    chrome, fetch: fetchImpl, URL, AbortSignal, AbortController, performance, setTimeout, clearTimeout,
  });
  const send = (msg, sender) => new Promise(resolve => {
    const accepted = handlers[0](msg, sender, resolve);
    if (!accepted) resolve({ rejected: true });
  });
  return { send };
}
const sender = { url: 'https://en.wikipedia.org/wiki/Spider',
  tab: { id: 1, url: 'https://en.wikipedia.org/wiki/Spider' } };
const sessionId = 'c47d1241-9a84-4f44-8888-a2dd61e289c2';

test('browser targets are assigned by the local backend; actions are reported', async () => {
  const calls = [];
  const worker = extensionWorker(async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () =>
      url.endsWith('/api/next') ? { target: { href: 'https://example.com/spider', kind: 'bite' } } :
        { count: 1 } };
  });
  const chosen = await worker.send({
    type: 'spider-next', sessionId, pageUrl: sender.url, hunt: 'spider',
    position: { x: 10, y: 12 }, candidates: [{
      href: 'https://example.com/spider', text: 'Spider', kind: 'bite', by: 'kw',
      p: null, cx: 20, cy: 30,
    }],
  }, sender);
  assert.equal(chosen.ok, true);
  assert.equal(chosen.data.target.kind, 'bite');
  const action = await worker.send({
    type: 'spider-action', sessionId, pageUrl: sender.url,
    href: 'https://example.com/spider', text: 'Spider', kind: 'bite', by: 'kw', p: null,
  }, sender);
  assert.equal(action.data.count, 1);
  assert.deepEqual(calls.map(c => new URL(c.url).pathname), ['/api/next', '/api/actions']);
  assert.equal(calls[0].body.sessionId, sessionId);
});

test('web pages cannot forge another tab or use administrative endpoints', async () => {
  let calls = 0;
  const worker = extensionWorker(async () => { calls++; throw Error('forbidden'); });
  const forged = await worker.send({ type: 'spider-next', sessionId, pageUrl: 'https://other.test/',
    candidates: [], hunt: '', position: { x: 0, y: 0 } }, sender);
  assert.equal(forged.rejected, true);
  const missingTab = await worker.send({ type: 'spider-action', sessionId, href: 'https://example.com/',
    kind: 'bite' }, { url: sender.url });
  assert.equal(missingTab.rejected, true);
  assert.equal(calls, 0);
});
