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
  const events = new Map();
  const intervals = [];
  const page = { visibilityState: 'visible' };
  let currentDiscovery = discovery;
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
      callback(currentDiscovery);
    } },
  };
  runInNewContext(source, {
    self: { SpiderShared: {
      DEFAULTS: { skin: 'venom', size: 1, speed: 1, mode: 'neon', creature: 'spider',
        hunt: '', customSkins: {}, jevThreshold: 0.5 },
      SKINS: { venom: { name: 'Venom' } }, SKIN_KEYS: ['shell'],
      validSkin: () => true, resolveSkin: () => ({ shell: '#121212' }),
    } },
    document: { ...page, get visibilityState() { return page.visibilityState; },
      getElementById: element, createElement: () => ({ innerHTML: '' }),
      addEventListener: (name, handler) => events.set(`document:${name}`, handler) },
    window: { addEventListener: (name, handler) => events.set(`window:${name}`, handler) },
    chrome, Option: class { constructor(label, value) { this.text = label; this.value = value; } },
    setTimeout, clearTimeout, setInterval: fn => { intervals.push(fn); return intervals.length; }, URL,
  });
  return { element, state, messages, writes, intervals, events, page,
    changeDiscovery: next => { currentDiscovery = next; } };
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


test('newly downloaded decision models appear on focus without replacing selection', async () => {
  const ui = settings({ jevProvider: 'local', jevLocalModel: 'laya' },
    { ok: true, models: ['laya'] });
  await settle();
  ui.changeDiscovery({ ok: true, models: ['laya', 'newly-downloaded-model'] });
  ui.events.get('window:focus')();
  await settle();
  assert.deepEqual(ui.element('jevLocalModel').options.map(option => option.value),
    ['', 'laya', 'newly-downloaded-model']);
  assert.equal(ui.state.jevLocalModel, 'laya');
  assert.equal(ui.element('jevLocalModel').value, 'laya');
});

test('model discovery polls only while the settings page is visible', async () => {
  const ui = settings({ jevProvider: 'local', jevLocalModel: '' },
    { ok: true, models: ['laya'] });
  await settle();
  assert.equal(ui.intervals.length, 1);
  ui.changeDiscovery({ ok: true, models: ['laya', 'downloaded-2'] });
  ui.intervals[0]();
  await settle();
  assert.equal(ui.element('jevLocalModel').options.length, 3);
  ui.changeDiscovery({ ok: true, models: ['laya', 'downloaded-2', 'downloaded-3'] });
  ui.events.get('document:visibilitychange')();
  await settle();
  assert.equal(ui.element('jevLocalModel').options.length, 4);
  ui.page.visibilityState = 'hidden';
  ui.changeDiscovery({ ok: true, models: ['laya', 'downloaded-2', 'downloaded-3', 'downloaded-4'] });
  ui.intervals[0]();
  await settle();
  assert.equal(ui.element('jevLocalModel').options.length, 4);
  ui.page.visibilityState = 'visible';
  ui.events.get('document:visibilitychange')();
  await settle();
  assert.equal(ui.element('jevLocalModel').options.length, 5);
});


test('discovered GGUF with text-only serving is visible but cannot be selected as a decision model', async () => {
  const id = 'mradermacher/StartLux-Decision-v1-4B-GGUF:Q4_K_S';
  const ui = settings({ jevProvider: 'local', jevLocalModel: 'laya' },
    { ok: true, models: ['laya'], unavailableModels: [id] });
  await settle();
  const option = ui.element('jevLocalModel').options.find(item => item.value === id);
  assert.ok(option, 'the downloaded model must appear in the model inventory');
  assert.equal(option.disabled, true, 'text-only models cannot be selected for System One');
  assert.match(option.text, /not served as decisions/i);
  assert.equal(ui.state.jevLocalModel, 'laya');
});


test('servers without capability metadata list explicit opt-in models for testing', async () => {
  const ui = settings({ jevProvider: 'local', jevLocalModel: '' },
    { ok: true, models: [], unverifiedModels: ['custom-provider-model'] });
  await settle();
  const option = ui.element('jevLocalModel').options.find(item => item.value === 'custom-provider-model');
  assert.ok(option);
  assert.equal(option.disabled, undefined);
  assert.match(option.text, /unverified/i);
  assert.equal(ui.state.jevLocalModel || '', '');
});


test('router reload failure is visibly reported with stale candidates retained', async () => {
  const ui = settings({ jevProvider: 'local', jevLocalModel: 'laya' },
    { ok: true, models: ['laya'], stale: true });
  await settle();
  assert.equal(ui.state.jevLocalModel, 'laya');
  assert.match(ui.element('jevLocalStatus').textContent, /cached.*refresh failed|refresh failed.*cached/i);
});


test('selected unverified model remains unique and testable', async () => {
  const ui = settings({ jevProvider: 'local', jevLocalModel: 'local-alias' },
    { ok: true, models: [], unverifiedModels: ['local-alias'] });
  await settle();
  const options = ui.element('jevLocalModel').options.filter(option => option.value === 'local-alias');
  assert.equal(options.length, 1);
  assert.equal(options[0].disabled, undefined);
  assert.equal(ui.element('jevLocalModel').value, 'local-alias');
});
