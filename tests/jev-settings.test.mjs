import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../options.js', import.meta.url), 'utf8');

function settings(initial = {}, discovery = { ok: true, models: ['laya', 'kev-0.8b'] }) {
  const nodes = new Map();
  const state = { ...initial };
  const messages = [];
  const writes = [];
  function element(id) {
    if (!nodes.has(id)) {
      const node = { id, value: '', textContent: '', className: '', hidden: false, disabled: false,
        checked: false, options: [], listeners: {},
        add(option) { this.options.push(option); },
        appendChild(node) { this.options.push(node); },
        addEventListener(type, fn) { this.listeners[type] = fn; },
        focus() { this.focused = true; },
        async click() { return this.listeners.click?.(); },
        async change() { return this.listeners.change?.(); },
      };
      Object.defineProperty(node, 'innerHTML', {
        set(value) { if (value === '') node.options = []; },
        get() { return ''; },
      });
      nodes.set(id, node);
    }
    return nodes.get(id);
  }
  const chrome = {
    storage: { local: {
      get: (defaults, callback) => callback({ ...defaults, ...state }),
      set: (update, callback) => { Object.assign(state, update); writes.push(update); callback?.(); },
      remove: (key, callback) => { delete state[key]; callback?.(); },
    } },
    runtime: { lastError: null, sendMessage: (msg, callback) => {
      messages.push(msg);
      callback(discovery);
    } },
  };
  runInNewContext(source, {
    self: { SpiderShared: {
      DEFAULTS: { skin: 'venom', size: 1, speed: 1, mode: 'neon', creature: 'spider',
        hunt: '', customSkins: {}, jevThreshold: 0.5 },
      SKINS: { venom: { name: 'Venom' } }, SKIN_KEYS: ['shell'],
      validSkin: () => true, resolveSkin: () => ({ shell: '#121212' }),
    } },
    document: { getElementById: element, createElement: () => ({ innerHTML: '' }) },
    chrome, Option: class { constructor(label, value) { this.text = label; this.value = value; } },
    setTimeout, clearTimeout, URL,
  });
  return { element, state, messages, writes };
}

async function settle() { await new Promise(resolve => setTimeout(resolve, 15)); }

test('auto-detects local decision models without selecting the first result', async () => {
  const ui = settings({ jevProvider: 'local', jevLocalModel: '' });
  await settle();
  assert.equal(ui.element('jevKeySection').hidden, true);
  assert.equal(ui.element('jevLocalSettings').hidden, false);
  assert.deepEqual(JSON.parse(JSON.stringify(ui.messages[0])), { type: 'jev-models', baseUrl: 'http://127.0.0.1:8800/v1' });
  assert.deepEqual(ui.element('jevLocalModel').options.map(option => option.value), ['', 'laya', 'kev-0.8b']);
  assert.equal(ui.element('jevLocalModel').value, '');
  assert.equal(ui.state.jevLocalModel || '', '');
  ui.element('jevLocalModel').value = 'kev-0.8b';
  await ui.element('jevLocalModel').change();
  assert.equal(ui.state.jevLocalModel, 'kev-0.8b');
  const reloaded = settings(ui.state);
  await settle();
  assert.equal(reloaded.element('jevLocalModel').value, 'kev-0.8b');
});

test('preserves unavailable selected model until the user changes it', async () => {
  const ui = settings({ jevProvider: 'local', jevLocalModel: 'laya' },
    { ok: true, models: ['kev-0.8b'] });
  await settle();
  assert.equal(ui.state.jevLocalModel, 'laya');
  assert.equal(ui.element('jevLocalModel').value, 'laya');
  assert.match(ui.element('jevLocalStatus').textContent, /unavailable/i);
  ui.element('jevLocalModel').value = 'kev-0.8b';
  await ui.element('jevLocalModel').change();
  assert.equal(ui.state.jevLocalModel, 'kev-0.8b');
});

test('outage leaves saved endpoint and model intact', async () => {
  const ui = settings({ jevProvider: 'local', jevLocalModel: 'laya',
    jevLocalUrl: 'http://127.0.0.1:8800/v1' },
    { ok: false, error: 'local_unavailable' });
  await settle();
  assert.equal(ui.state.jevLocalModel, 'laya');
  assert.equal(ui.state.jevLocalUrl, 'http://127.0.0.1:8800/v1');
  assert.match(ui.element('jevLocalStatus').textContent, /unavailable/i);
  assert.equal(ui.element('jevLocalModel').value, 'laya');
});

test('changing local endpoint clears old selection and never picks an arbitrary model', async () => {
  const ui = settings({ jevProvider: 'local', jevLocalModel: 'laya',
    jevLocalUrl: 'http://127.0.0.1:8800/v1' });
  await settle();
  ui.element('jevLocalUrl').value = 'http://127.0.0.1:46549/v1';
  await ui.element('jevRefresh').click();
  await settle();
  assert.equal(ui.state.jevLocalUrl, 'http://127.0.0.1:46549/v1');
  assert.equal(ui.state.jevLocalModel, '');
  assert.equal(ui.element('jevLocalModel').value, '');
});

test('switching remote/local provider preserves saved remote credentials', async () => {
  const ui = settings({ jevProvider: 'typesafe', jevKeySet: true, jevLocalModel: 'laya' });
  assert.equal(ui.element('jevLocalSettings').hidden, true);
  assert.equal(ui.element('jevKeySection').hidden, false);
  ui.element('jevProvider').value = 'local';
  await ui.element('jevProvider').change();
  await settle();
  assert.equal(ui.element('jevKeySection').hidden, true);
  assert.equal(ui.element('jevLocalSettings').hidden, false);
  assert.equal(ui.state.jevProvider, 'local');
  assert.equal(ui.state.jevKeySet, true);
  assert.equal(ui.state.jevLocalModel, 'laya');
});
