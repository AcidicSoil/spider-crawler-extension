// Spider Crawler: background service worker.
// Calls the Jev decision model (TypeSafe or a compatible provider) on behalf of
// the content script, so the request is not subject to the page's CORS policy.
// Remote API keys stay in chrome.storage.local; local System One requests use
// an explicitly selected model and an approved loopback endpoint without a key.

const PROVIDERS = {
  typesafe: { url: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest' },
  openrouter: { url: 'https://openrouter.ai/api/alpha/decisions', model: '~typesafe/jev-latest' },
  venice: { url: 'https://api.venice.ai/api/v1/decisions', model: 'jev-latest' },
  zen: { url: 'https://opencode.ai/zen/v1/systemone', model: 'jev-1.13-free' },
};
const TIMEOUT_MS = 8000;
const LOCAL_TIMEOUT_MS = 30000;
const MAX_LINKS = 24;
const DEFAULT_LOCAL_URL = 'http://127.0.0.1:8800/v1';

// A configured port is allowed; arbitrary origins and paths are not.
function localApiBase(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' ||
        !['127.0.0.1', 'localhost'].includes(url.hostname) ||
        !url.port || url.username || url.password || url.search || url.hash ||
        !['/', '/v1', '/v1/'].includes(url.pathname)) {
      throw new Error('Invalid endpoint');
    }
    return url.origin + '/v1';
  } catch {
    throw new Error('Invalid local endpoint: use http://127.0.0.1:<port>/v1');
  }
}

async function discoverLocalModels(baseUrl) {
  let url;
  try { url = localApiBase(baseUrl) + '/models'; }
  catch { return { ok: false, error: 'invalid_endpoint' }; }
  try {
    const res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const data = await res.json();
    if (!Array.isArray(data.data)) return { ok: false, error: 'malformed_models' };
    const models = [...new Set(data.data.filter(model =>
      typeof model?.id === 'string' && model.id.length > 0 && model.id.length <= 256 &&
      Array.isArray(model.architecture?.output_modalities) &&
      model.architecture.output_modalities.includes('decisions')).map(model => model.id))];
    return { ok: true, models };
  } catch {
    return { ok: false, error: 'local_unavailable' };
  }
}

function buildRequest(hunt, page, links, model) {
  const state = {
    hunt,
    page_title: String(page.title || '').slice(0, 200),
    page_url: String(page.url || '').slice(0, 300),
    links: {},
  };
  const questions = {};
  links.slice(0, MAX_LINKS).forEach((l, i) => {
    const id = `l${i}`;
    state.links[id] = { text: String(l.text || '').slice(0, 160), url: String(l.href || '').slice(0, 300) };
    questions[id] = {
      type: 'noul',
      instructions: `The link \`links.${id}\` (its text and URL) leads to what the reader is hunting for, described in \`hunt\`.`,
      criteria: {
        true: 'The link text or URL is clearly about the hunted topic.',
        false: 'The link is about something else, is navigation, or is unrelated.',
      },
    };
  });
  return { state, model, questions };
}

async function judge({ hunt, page, links }) {
  const cfg = await chrome.storage.local.get({
    jevKey: '', jevProvider: 'typesafe',
    jevLocalUrl: DEFAULT_LOCAL_URL, jevLocalModel: '',
  });
  const local = cfg.jevProvider === 'local';
  if (local && !cfg.jevLocalModel) return { ok: false, error: 'no_model' };
  if (!local && !cfg.jevKey) return { ok: false, error: 'no_key' };
  let prov;
  if (local) {
    let base;
    try { base = localApiBase(cfg.jevLocalUrl); }
    catch { return { ok: false, error: 'invalid_endpoint' }; }
    prov = { url: base + '/systemone', model: cfg.jevLocalModel };
  } else {
    prov = PROVIDERS[cfg.jevProvider] || PROVIDERS.typesafe;
  }
  const body = buildRequest(hunt, page, links, prov.model);
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(!local ? { Authorization: `Bearer ${cfg.jevKey}` } : {}),
  };
  if (cfg.jevProvider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/AlungranPJ/spider-crawler-extension';
    headers['X-Title'] = 'Spider Crawler';
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), local ? LOCAL_TIMEOUT_MS : TIMEOUT_MS);
  const t0 = performance.now();
  try {
    const res = await fetch(prov.url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
    const latency = Math.round(performance.now() - t0);
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'auth_failed' };
    if (res.status === 429) return { ok: false, error: 'rate_limited' };
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const data = await res.json();
    const answers = data && data.answers;
    if (!answers || typeof answers !== 'object') return { ok: false, error: 'malformed' };
    const n = Math.min(links.length, MAX_LINKS);
    const probs = [];
    for (let i = 0; i < n; i++) {
      const a = answers[`l${i}`];
      const p = a && typeof a.noul === 'number' && isFinite(a.noul) ? Math.max(0, Math.min(1, a.noul)) : null;
      probs.push(p);
    }
    return { ok: true, probs, latency, perLink: n ? Math.round(latency / n) : latency, model: data.model || prov.model };
  } catch (e) {
    return { ok: false, error: e && e.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

const SPIDER_BACKEND = 'http://127.0.0.1:5195';

async function spiderBackend(path, body) {
  try {
    const response = await fetch(SPIDER_BACKEND + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(3000),
    });
    const data = await response.json();
    return response.ok ? { ok: true, data } : { ok: false, error: data.error || 'backend_error' };
  } catch {
    return { ok: false, error: 'backend_offline' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'jev-models') {
    if (!sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`)) return false;
    discoverLocalModels(msg.baseUrl).then(sendResponse);
    return true;
  }
  if (msg?.type === 'spider-health') {
    if (!sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`)) return false;
    spiderBackend('/api/health').then(sendResponse);
    return true;
  }
  if (msg && ['spider-next', 'spider-action'].includes(msg.type)) {
    // Only a content script from its own page may send animation events.
    if (!sender.tab || !/^https?:\/\//.test(sender.url || '') || sender.url !== msg.pageUrl) return false;
    const path = msg.type === 'spider-next' ? '/api/next' : '/api/actions';
    const { type, ...payload } = msg;
    spiderBackend(path, payload).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'jev-judge') {
    judge(msg).then(sendResponse);
    return true; // async response
  }
  if (msg && msg.type === 'jev-test') {
    judge({
      hunt: 'spiders',
      page: { title: 'Key test', url: 'about:test' },
      links: [{ text: 'Jumping spider anatomy', href: 'https://en.wikipedia.org/wiki/Jumping_spider' },
        { text: 'Privacy policy', href: 'https://example.com/privacy' }],
    }).then(sendResponse);
    return true;
  }
  return false;
});
