import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function popup(response = { ok: true }, stored = {}) {
  const elements = new Map();
  const opened = [];
  const messages = [];
  const el = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', checked: false, hidden: false,
      add() {}, addEventListener(name, callback) { this[name] = callback; },
    });
    return elements.get(id);
  };
  const chrome = {
    runtime: { sendMessage: (msg, cb) => { messages.push(msg); cb(response); }, openOptionsPage() {} },
    tabs: { create: ({ url }) => opened.push(url) },
    storage: { local: {
      get: (defaults, cb) => cb({ ...defaults, ...stored }),
      set: (_values, cb) => cb?.(),
    }, onChanged: { addListener() {} } },
  };
  runInNewContext(readFileSync(new URL('../popup.js', import.meta.url), 'utf8'), {
    self: { SpiderShared: { DEFAULTS: { enabled: true, mode: 'neon', creature: 'spider',
      skin: 'venom', hunt: '', customSkins: {} }, SKINS: { venom: { name: 'Venom' } } } },
    document: { getElementById: el }, chrome,
    Option: class { constructor(name, value) { this.name = name; this.value = value; } },
    setTimeout, clearTimeout, URL, Blob,
  });
  return { el, opened, messages };
}

test('popup checks the real backend and opens recorded results', () => {
  const { el, opened, messages } = popup();
  assert.equal(el('backendState').textContent, 'Backend connected');
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{ type: 'spider-health' }]);
  el('backendResults').click();
  assert.deepEqual(opened, ['http://127.0.0.1:5195/']);
});

test('popup shows disconnected backend without hiding System One model', () => {
  const { el } = popup({ ok: false, error: 'backend_offline' }, {
    hunt: 'spider', useJev: true, jevProvider: 'local', jevLocalModel: 'laya',
  });
  assert.equal(el('backendState').textContent, 'Backend offline');
  assert.equal(el('jevState').textContent, 'Jev · laya');
  assert.equal(el('jevState').hidden, false);
});
