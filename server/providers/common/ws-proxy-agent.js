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
 * Returns null when no proxy is configured, so callers pass no agent and the
 * direct path is byte-for-byte unchanged. To remove: delete this file and the
 * two-line import/usage in vessels/ais-live.js.
 */
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

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

/** @returns {https.Agent|null} a proxy agent, or null when no proxy is set. */
export function wsProxyAgent() {
  const raw = String(
    process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy ||
      '',
  ).trim();
  if (!raw) return null;
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
