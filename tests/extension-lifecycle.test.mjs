import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../content.js', import.meta.url), 'utf8');

function checkRuntime(chrome) {
  const functionSource = source.match(/  function extensionContextAlive\(\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(functionSource, 'runtime guard is part of the real content script');
  return runInNewContext(functionSource + '\n extensionContextAlive()', { chrome, HAS_STORAGE: true });
}

test('active extension context permits animation', () => {
  assert.equal(checkRuntime({ runtime: { id: 'abc', getManifest: () => ({ manifest_version: 3 }) } }), true);
});

test('disabled extension context is detected without throwing', () => {
  assert.equal(checkRuntime({ runtime: { id: undefined, getManifest: () => { throw Error('context invalidated'); } } }), false);
  assert.equal(checkRuntime({ runtime: { id: 'abc', getManifest: () => { throw Error('context invalidated'); } } }), false);
});

test('animation loop tears down the overlay when extension context disappears', () => {
  const tick = source.match(/  function tick\(ts\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(tick?.includes('extensionContextAlive()'), 'tick must check context before scheduling another frame');
  assert.ok(tick?.includes('stop()'), 'invalidated content script must call the existing DOM cleanup');
});
