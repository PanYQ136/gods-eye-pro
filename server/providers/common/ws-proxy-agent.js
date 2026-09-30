/**
 * Minimal HTTPS-CONNECT proxy agent for `ws` upstream sockets.
 *
 * Node's global fetch honours NODE_USE_ENV_PROXY (set by
 * server/standalone/local-proxy.mjs), but the `ws` package opens its own
 * socket through https.request and ignores that flag — so behind a firewall
 * (AISStream's wss endpoint is blocked in mainland China) the live-vessel
 * websocket never connects unless we hand `ws` a proxy agent. This builds one
 * from the standard HTTP(S)_PROXY env with NO extra dependency: an HTTP
 * CONNECT tunnel wrapped in TLS.
 *
 * Returns null when no proxy is configured — or when the target must not be
 * tunneled at all (loopback hosts, NO_PROXY matches, non-TLS `ws://` targets,
 * which the TLS-wrapping tunnel below cannot carry) — so callers pass no agent
 * and the direct path is byte-for-byte unchanged. To remove: delete this file
 * and the two-line import/usage in vessels/ais-live.js.
 */
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

/** Never tunnel the dev server's own (or a test fixture's) loopback traffic. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

/** @type {{url: string, agent: https.Agent}|null} */
let _cached = null;

class HttpsProxyConnectAgent extends https.Agent {
  constructor(proxy) {
    super({ keepAlive: false });
    this._proxyHost = proxy.hostname;
    this._proxyPort = Number(proxy.port || 80);
  }

  createConnection(options, callback) {
    const targetHost = options.host;
    const targetPort = Number(options.port) || 443;
    const connectReq = http.request({
      host: this._proxyHost,
      port: this._proxyPort,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      headers: { Host: `${targetHost}:${targetPort}` },
    });
    connectReq.once('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        callback(new Error(`proxy CONNECT ${res.statusCode}`));
        return;
      }
      const tlsSocket = tls.connect({
        socket,
        servername: options.servername || targetHost,
      });
      tlsSocket.once('secureConnect', () => callback(null, tlsSocket));
      tlsSocket.once('error', (err) => callback(err));
    });
    connectReq.once('error', (err) => callback(err));
    connectReq.end();
  }
}

/** Strip a leading dot and a trailing `:port` from one NO_PROXY entry. */
function noProxyEntryHost(entry) {
  if (entry.startsWith('[')) return entry.replace(/^\[([^\]]*)\].*$/, '$1');
  const bare = entry.replace(/^\.+/, '');
  // '::1' (IPv6, no brackets) keeps every colon; only a single colon is a port.
  return bare.split(':').length === 2 ? bare.split(':')[0] : bare;
}

/** NO_PROXY / no_proxy match: '*', an exact host, a '.suffix' or 'suffix' domain. */
function noProxyExcludes(host) {
  const raw = String(process.env.NO_PROXY || process.env.no_proxy || '');
  for (const entry of raw.split(',')) {
    const cleaned = entry.trim().toLowerCase();
    if (!cleaned) continue;
    if (cleaned === '*') return true;
    const bare = noProxyEntryHost(cleaned);
    if (!bare) continue;
    if (host === bare || host.endsWith(`.${bare}`)) return true;
  }
  return false;
}

/**
 * Whether one websocket target may be tunneled through the proxy. The CONNECT
 * tunnel is TLS-wrapped, so only `wss:`/`https:` targets can use it; loopback
 * and NO_PROXY hosts must always dial directly (server/standalone/local-proxy.mjs
 * keeps localhost out of the proxy for exactly this reason).
 */
function targetNeedsProxy(targetUrl) {
  // Unknown/undeclared target: keep the historical behaviour (proxy it).
  if (!targetUrl) return true;
  let target;
  try {
    target = new URL(String(targetUrl));
  } catch {
    return true;
  }
  if (target.protocol !== 'wss:' && target.protocol !== 'https:') return false;
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost')) return false;
  return !noProxyExcludes(host);
}

/**
 * @param {string} [targetUrl] Upstream websocket URL the agent will be used for.
 * @returns {https.Agent|null} a proxy agent, or null when the target should be
 *   dialed directly (no proxy configured, loopback/NO_PROXY host, or `ws://`).
 */
export function wsProxyAgent(targetUrl) {
  const raw = String(
    process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy ||
      '',
  ).trim();
  if (!raw) return null;
  if (!targetNeedsProxy(targetUrl)) return null;
  if (_cached && _cached.url === raw) return _cached.agent;
  let proxy;
  try {
    proxy = new URL(raw);
  } catch {
    return null;
  }
  const agent = new HttpsProxyConnectAgent(proxy);
  _cached = { url: raw, agent };
  return agent;
}
