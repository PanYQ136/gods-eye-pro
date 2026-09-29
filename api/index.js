// GEV-VERCEL-BRIDGE — 把本地 27 个 Vite provider 中间件桥接成单个 Vercel 函数。
// 非侵入：本文件 + vercel.json 是新增部署层，删掉即回到纯本地 dev。
//
// 原理：每个 provider 是 { name, configureServer(server) }，内部用
// server.middlewares.use('/api/xxx', handler) 注册 connect 风格 handler。
// 我们用一个"假 server" 捕获这些 (path, handler)，按最长前缀匹配手动分发，
// 并像 connect 那样把挂载前缀从 req.url 里剥掉再交给 handler。
import { localProviderPlugins } from '../server/providers/local.js';

let ROUTES = null;

function captureRoutes() {
  if (ROUTES) return ROUTES;
  const routes = [];
  const mock = {
    middlewares: { use: (path, handler) => routes.push({ path, handler }) },
    httpServer: null,
    ws: null,
    config: { logger: { info() {}, warn() {}, error() {} } },
  };
  for (const p of localProviderPlugins().flatMap((x) => (Array.isArray(x) ? x : [x]))) {
    if (typeof p?.configureServer === 'function') {
      try {
        p.configureServer(mock);
      } catch (e) {
        console.warn('[gev-vercel] plugin failed:', p?.name, e?.message || e);
      }
    }
  }
  // 最长路径优先，避免 /api/opensky 抢走 /api/opensky-track。
  routes.sort((a, b) => b.path.length - a.path.length);
  ROUTES = routes;
  return ROUTES;
}

function matchRoute(raw, routes) {
  for (const r of routes) {
    if (raw === r.path) return { r, rest: '/' };
    if (raw.startsWith(r.path + '/')) return { r, rest: raw.slice(r.path.length) };
    if (raw.startsWith(r.path + '?')) return { r, rest: raw.slice(r.path.length) };
  }
  return null;
}

const RELAY_URL = process.env.GEV_RELAY_URL || '';
const RELAY_PATHS = (process.env.GEV_RELAY_PATHS || 'opensky')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Forward an /api request to the home relay (residential IP — OpenSky blocks AWS). */
async function proxyToRelay(req, res, raw) {
  const target = RELAY_URL.replace(/\/$/, '') + raw;
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    const lk = k.toLowerCase();
    if (['host', 'connection', 'content-length', 'accept-encoding'].includes(lk)) continue;
    headers[k] = v;
  }
  const init = { method: req.method, headers, redirect: 'manual' };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req;
    init.duplex = 'half';
  }
  const r = await fetch(target, init);
  res.statusCode = r.status;
  const SKIP = new Set(['transfer-encoding', 'content-length', 'content-encoding', 'connection', 'keep-alive']);
  r.headers.forEach((v, k) => {
    if (SKIP.has(k.toLowerCase())) return;
    try {
      res.setHeader(k, v);
    } catch {
      /* ignore */
    }
  });
  res.end(Buffer.from(await r.arrayBuffer()));
}

export default async function handler(req, res) {
  const raw = req.url || '/';
  // Paths known to be blocked from Vercel (AWS) are relayed via the home box.
  const seg = raw.replace(/^\/api\//, '').split(/[/?]/)[0];
  if (RELAY_URL && RELAY_PATHS.includes(seg)) {
    try {
      return await proxyToRelay(req, res, raw);
    } catch (e) {
      console.warn('[gev-vercel] relay failed:', e?.message || e);
      if (!res.headersSent) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
      }
      res.end(JSON.stringify({ error: 'gev_relay_error', message: e?.message || String(e) }));
      return;
    }
  }
  const routes = captureRoutes();
  const hit = matchRoute(raw, routes);
  if (!hit) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'gev_api_not_found', path: raw, routes: routes.map((x) => x.path) }));
    return;
  }
  req.originalUrl = raw;
  req.url = hit.rest; // 模拟 connect 的挂载前缀剥离
  try {
    return await hit.r.handler(req, res);
  } catch (e) {
    console.warn('[gev-vercel] handler error:', hit.r.path, e?.message || e);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify({ error: 'gev_api_handler_error', message: e?.message || String(e) }));
  }
}
