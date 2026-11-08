import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function popup(response = { ok: true }, stored = {}, session = {}, tabId = 1) {
  const elements = new Map();
  const opened = [];
  const messages = [];
  const sentToTabs = [];
  const localWrites = [];
  const el = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', checked: false, hidden: false,
      add() {}, addEventListener(name, callback) { this[name] = callback; },
    });
    return elements.get(id);
  };
  const chrome = {
    runtime: { sendMessage: (msg, cb) => { messages.push(msg); cb(response); }, openOptionsPage() {} },
    tabs: {
      create: ({ url }) => opened.push(url),
      query: (_query, cb) => cb([{ id: tabId }]),
      sendMessage: (id, message, cb) => { sentToTabs.push({ id, message }); cb?.(); },
    },
    storage: {
      local: {
        get: (defaults, cb) => cb({ ...defaults, ...stored }),
        set: (values, cb) => { localWrites.push(values); cb?.(); },
      },
      session: {
        get: (key, cb) => cb({ [key]: session[key] }),
        set: (values, cb) => { Object.assign(session, values); cb?.(); },
        remove: (key, cb) => { delete session[key]; cb?.(); },
      },
      onChanged: { addListener() {} },
    },
  };
  runInNewContext(readFileSync(new URL('../popup.js', import.meta.url), 'utf8'), {
    self: { SpiderShared: { DEFAULTS: { enabled: true, mode: 'neon', creature: 'spider',
      skin: 'venom', hunt: '', customSkins: {} }, SKINS: { venom: { name: 'Venom' } } } },
    document: { getElementById: el }, chrome,
    Option: class { constructor(name, value) { this.name = name; this.value = value; } },
    setTimeout, clearTimeout, URL, Blob,
  });
  return { el, opened, messages, sentToTabs, localWrites, session };
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

test('activation affects only the current tab and survives popup reopening', () => {
  const session = {};
  const first = popup({ ok: true }, { enabled: true }, session, 21);
  const other = popup({ ok: true }, { enabled: true }, session, 22);
  assert.equal(first.el('enabled').checked, false);
  assert.equal(other.el('enabled').checked, false);
  first.el('enabled').checked = true;
  first.el('enabled').change();
  assert.equal(session['spider-tab-21'], true);
  assert.equal(session['spider-tab-22'], undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(first.sentToTabs)), [
    { id: 21, message: { type: 'spider-tab-activation', enabled: true } },
  ]);
  assert.deepEqual(first.localWrites, [], 'tab activation must never change shared settings');
  assert.equal(popup({ ok: true }, {}, session, 21).el('enabled').checked, true);
  assert.equal(popup({ ok: true }, {}, session, 22).el('enabled').checked, false);
  first.el('enabled').checked = false;
  first.el('enabled').change();
  assert.equal(session['spider-tab-21'], undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(first.sentToTabs.at(-1))), {
    id: 21, message: { type: 'spider-tab-activation', enabled: false },
  });
});
