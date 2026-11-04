import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
const PREVIEW_FILES = new Set([
  'server/dashboard.html', 'popup.html', 'options.html', 'ui.css', 'shared.js', 'popup.js', 'options.js', 'content.js',
]);
const validUrl = value => typeof value === 'string' && value.length <= 2048 &&
  /^https?:\/\/[^\s]+$/i.test(value) && (() => {
    try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
  })();
const isCandidate = item => item && validUrl(item.href) &&
  typeof item.text === 'string' && item.text.length <= 160 &&
  ['bite', 'wrap'].includes(item.kind) && ['jev', 'kw', 'all'].includes(item.by) &&
  (item.p === null || (typeof item.p === 'number' && item.p >= 0 && item.p <= 1)) &&
  Number.isFinite(item.cx) && Number.isFinite(item.cy);
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const error = (message, status = 400) => json({ error: message }, status);

export function createBackend({ dbPath } = {}) {
  const path = dbPath || process.env.SPIDER_DB || resolve(process.env.HOME || '.', '.local/state/spider-crawler-extension/actions.sqlite');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path, { create: true });
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, page_url TEXT NOT NULL, hunt TEXT NOT NULL,
      pending_href TEXT, pending_kind TEXT
    );
    CREATE TABLE IF NOT EXISTS actions (
      session_id TEXT NOT NULL, href TEXT NOT NULL, kind TEXT NOT NULL,
      text TEXT NOT NULL, page_url TEXT NOT NULL, hunt TEXT NOT NULL,
      source TEXT NOT NULL, probability REAL, completed_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, href)
    );
  `);
  const getSession = db.query('SELECT * FROM sessions WHERE id = ?');
  const addSession = db.query('INSERT INTO sessions (id, page_url, hunt) VALUES (?, ?, ?)');
  const setPending = db.query('UPDATE sessions SET pending_href = ?, pending_kind = ? WHERE id = ?');
  const hasAction = db.query('SELECT 1 FROM actions WHERE session_id = ? AND href = ?');
  const record = db.query(`INSERT OR IGNORE INTO actions
    (session_id, href, kind, text, page_url, hunt, source, probability, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const count = db.query('SELECT COUNT(*) AS total FROM actions WHERE session_id = ?');
  const list = db.query(`SELECT session_id AS sessionId, href, kind, text, page_url AS pageUrl,
    hunt, source, probability, completed_at AS at FROM actions
    WHERE session_id = ? ORDER BY completed_at DESC LIMIT 200`);
  const recent = db.query(`SELECT session_id AS sessionId, href, kind, text, page_url AS pageUrl,
    hunt, source, probability, completed_at AS at FROM actions
    ORDER BY completed_at DESC LIMIT 200`);

  async function fetchRequest(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health' && request.method === 'GET') return json({ status: 'ok' });

    if (url.pathname.startsWith('/api/')) {
      const origin = request.headers.get('Origin');
      if (origin && !EXTENSION_ORIGIN.test(origin)) return error('Origin not permitted', 403);
      if (request.method === 'OPTIONS') return new Response(null, {
        status: 204,
        headers: { 'Access-Control-Allow-Origin': origin || '', 'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'Content-Type' },
      });
      if (url.pathname === '/api/results' && request.method === 'GET') {
        const sessionId = url.searchParams.get('sessionId');
        if (sessionId && !SESSION_ID.test(sessionId)) return error('Invalid session ID');
        return json({ actions: sessionId ? list.all(sessionId) : recent.all() });
      }
      if (request.method !== 'POST' || !['/api/next', '/api/actions'].includes(url.pathname)) {
        return error('Not found', 404);
      }
      if (!request.headers.get('content-type')?.startsWith('application/json')) return error('Expected JSON');
      let body;
      try {
        if (Number(request.headers.get('content-length') || 0) > 65536) return error('Payload too large', 413);
        const raw = await request.text();
        if (raw.length > 65536) return error('Payload too large', 413);
        body = JSON.parse(raw);
      } catch { return error('Invalid JSON'); }
      if (!body || !SESSION_ID.test(body.sessionId || '')) return error('Invalid session ID');

      if (url.pathname === '/api/next') {
        if (!validUrl(body.pageUrl) || typeof body.hunt !== 'string' || body.hunt.length > 300 ||
            !body.position || !Number.isFinite(body.position.x) || !Number.isFinite(body.position.y) ||
            !Array.isArray(body.candidates) || body.candidates.length > 64 ||
            !body.candidates.every(isCandidate)) return error('Invalid targets');
        const current = getSession.get(body.sessionId);
        if (current && (current.page_url !== body.pageUrl || current.hunt !== body.hunt)) {
          return error('Session belongs to a different page or hunt', 409);
        }
        if (!current) addSession.run(body.sessionId, body.pageUrl, body.hunt);
        const available = body.candidates.filter(item => !hasAction.get(body.sessionId, item.href));
        // Prefer relevant links; within each class, walk to the closest visible target.
        available.sort((a, b) => (a.kind === 'bite' ? 0 : 1) - (b.kind === 'bite' ? 0 : 1) ||
          Math.hypot(a.cx - body.position.x, a.cy - body.position.y) -
          Math.hypot(b.cx - body.position.x, b.cy - body.position.y));
        const target = available.find(item => item.href === current?.pending_href) || available[0] || null;
        setPending.run(target?.href ?? null, target?.kind ?? null, body.sessionId);
        return json({ target: target ? { href: target.href, kind: target.kind } : null });
      }

      const current = getSession.get(body.sessionId);
      if (!current) return error('Unknown session', 409);
      if (!validUrl(body.href) || !['bite', 'wrap'].includes(body.kind) ||
          typeof body.text !== 'string' || body.text.length > 160 ||
          !['jev', 'kw', 'all'].includes(body.by) ||
          !(body.p === null || (typeof body.p === 'number' && body.p >= 0 && body.p <= 1))) {
        return error('Invalid action');
      }
      if (hasAction.get(body.sessionId, body.href)) return json({ count: count.get(body.sessionId).total });
      if (current.pending_href !== body.href || current.pending_kind !== body.kind) {
        return error('Action was not assigned by backend', 409);
      }
      const finish = db.transaction(() => {
        record.run(body.sessionId, body.href, body.kind, body.text, current.page_url,
          current.hunt, body.by, body.p, Date.now());
        setPending.run(null, null, body.sessionId);
      });
      finish();
      return json({ count: count.get(body.sessionId).total });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') return error('Not found', 404);
    let file = url.pathname === '/' ? 'server/dashboard.html' : url.pathname.slice(1);
    if (!PREVIEW_FILES.has(file) && !/^icons\/[a-zA-Z0-9_-]+\.png$/.test(file)) {
      return error('Not found', 404);
    }
    const resource = Bun.file(resolve(root, file));
    if (!await resource.exists()) return error('Not found', 404);
    return new Response(request.method === 'HEAD' ? null : resource, {
      headers: { 'Content-Type': resource.type || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' },
    });
  }
  return { fetch: fetchRequest, close: () => db.close() };
}
