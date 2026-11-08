import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../background.js', import.meta.url), 'utf8');

function worker() {
  const session = { 'spider-tab-11': true };
  const listeners = [];
  const removed = [];
  const chrome = {
    runtime: { id: 'test-extension', onMessage: { addListener: fn => listeners.push(fn) } },
    tabs: { onRemoved: { addListener: fn => removed.push(fn) } },
    storage: {
      local: { get: async defaults => defaults },
      session: {
        get: async key => ({ [key]: session[key] }),
        remove: async key => { delete session[key]; },
      },
    },
  };
  runInNewContext(source, { chrome, fetch, URL, AbortController, AbortSignal, performance, setTimeout, clearTimeout });
  return {
    session,
    removed,
    send: (tabId) => new Promise(resolve => {
      const sender = { url: 'https://example.com/', tab: { id: tabId } };
      const accepted = listeners[0]({ type: 'spider-tab-state' }, sender, resolve);
      if (!accepted) resolve({ rejected: true });
    }),
  };
}

test('content scripts read only their own tab activation', async () => {
  const ext = worker();
  assert.equal((await ext.send(11)).enabled, true);
  assert.equal((await ext.send(12)).enabled, false);
});

test('closed tabs discard their activation state', async () => {
  const ext = worker();
  assert.equal(ext.removed.length, 1);
  await ext.removed[0](11);
  assert.equal(ext.session['spider-tab-11'], undefined);
  assert.equal((await ext.send(11)).enabled, false);
});

function contentPage(initiallyEnabled = false) {
  const injected = [];
  let activation;
  let onSettingsChanged;
  const node = () => ({
    id: '', style: {}, dataset: {}, classList: { toggle() {}, remove() {} },
    appendChild() {}, querySelectorAll: () => [],
    attachShadow() { return node(); },
    getContext: () => ({}),
    remove() { this.removed = true; },
  });
  const document = {
    body: { appendChild: element => injected.push(element) },
    head: { appendChild() {} },
    createElement: node,
    querySelectorAll: () => [],
  };
  const chrome = {
    runtime: {
      id: 'test-extension', lastError: null,
      onMessage: { addListener: fn => { activation = fn; } },
      sendMessage: (msg, callback) => {
        if (msg.type === 'spider-tab-state') callback({ enabled: initiallyEnabled });
      },
    },
    storage: { local: {
      get: (defaults, callback) => callback({ ...defaults, enabled: true }),
    }, onChanged: { addListener: fn => { onSettingsChanged = fn; } } },
  };
  const skin = { shell: '#101010', shellMid: '#202020', shellHi: '#ffffff',
    leg: '#dddddd', legTip: '#eeeeee', accent: '#ffffff', glow: '#ffffff', eye: '#ffffff' };
  const shared = { DEFAULTS: { enabled: true, skin: 'venom', size: 1, mode: 'neon',
    creature: 'spider', hunt: '', useJev: false, showHud: true, wrapRejects: true },
    resolveSkin: () => skin };
  runInNewContext(readFileSync(new URL('../content.js', import.meta.url), 'utf8'), {
    window: { addEventListener() {}, innerWidth: 1280, innerHeight: 800,
      scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
    document, chrome, self: { SpiderShared: shared },
    crypto: globalThis.crypto ?? { getRandomValues: bytes => bytes.fill(1) },
    performance, location: { protocol: 'https:', href: 'https://example.com' },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setTimeout, clearTimeout,
  });
  return {
    injected,
    activate: enabled => activation({ type: 'spider-tab-activation', enabled }),
    updateSettings: () => onSettingsChanged({ mode: { newValue: '8bit' } }, 'local'),
  };
}

test('inactive tabs do not draw; activation and deactivation create and remove overlays', () => {
  const page = contentPage(false);
  assert.equal(page.injected.length, 0);
  page.updateSettings();
  assert.equal(page.injected.length, 0, 'shared settings cannot activate another tab');
  page.activate(true);
  assert.equal(page.injected.length, 1);
  assert.equal(page.injected[0].removed, undefined);
  page.activate(false);
  assert.equal(page.injected[0].removed, true);
  page.updateSettings();
  assert.equal(page.injected.length, 1, 'settings must not restart a disabled spider');
});

test('activated tabs restore their spider after navigation', () => {
  const page = contentPage(true);
  assert.equal(page.injected.length, 1);
});
