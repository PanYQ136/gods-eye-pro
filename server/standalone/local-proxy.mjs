/**
 * Local-proxy bootstrap (China-network helper).
 *
 * The dev server fetches provider data (OpenSky, CelesTrak, NASA FIRMS,
 * adsb.lol, Launch Library, TomTom, AISStream, …) from Node. Behind the
 * mainland-China firewall those hosts time out unless the request egresses
 * through the user's local proxy (ClashMi on 127.0.0.1:7890). Node's global
 * fetch (undici) honours NODE_USE_ENV_PROXY + HTTP(S)_PROXY, but only if the
 * variables are set before the first fetch — which is exactly here, in the
 * Vite config, before any provider middleware runs.
 *
 * Safe & reversible:
 *  - does nothing when a proxy is already configured in the environment, or
 *    when no candidate proxy port answers (ordinary / non-China setups are
 *    completely unaffected);
 *  - localhost is always added to NO_PROXY so the dev server's own traffic
 *    never loops through the proxy;
 *  - to remove: delete this file and the two-line import/call in
 *    vite.config.js — nothing else depends on it.
 *
 * Override / opt-in: set GEV_HTTP_PROXY=http://host:port to force a proxy
 * (skips probing), or NODE_USE_ENV_PROXY=1 with HTTP(S)_PROXY yourself.
 */
import net from 'node:net';

/** Common local proxy ports: ClashMi/Clash (7890), Clash Verge (7897),
 *  v2rayN (10809/10808), fallback (1080). */
const CANDIDATE_PORTS = [7890, 7897, 10809, 10808, 1080];
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

/** Quick TCP connect probe — true if something is listening on the port. */
function portOpen(port, host = '127.0.0.1', timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

/**
 * Point undici (Node global fetch) at a local HTTP proxy when one is present.
 * Idempotent; intended to be awaited once from the Vite config entry.
 */
export async function bootstrapLocalProxy() {
  // Already handled by the caller's environment — don't second-guess it.
  if (String(process.env.NODE_USE_ENV_PROXY || '').trim() === '1') return;
  if (process.env.HTTP_PROXY || process.env.http_proxy) return;

  let proxyUrl = String(process.env.GEV_HTTP_PROXY || '').trim();
  if (!proxyUrl) {
    for (const port of CANDIDATE_PORTS) {
      // eslint-disable-next-line no-await-in-loop
      if (await portOpen(port)) {
        proxyUrl = `http://127.0.0.1:${port}`;
        break;
      }
    }
  }
  if (!proxyUrl) return;

  process.env.NODE_USE_ENV_PROXY = '1';
  process.env.HTTP_PROXY = proxyUrl;
  process.env.HTTPS_PROXY = proxyUrl;

  const existing = String(process.env.NO_PROXY || process.env.no_proxy || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const host of LOCAL_HOSTS) {
    if (!existing.includes(host)) existing.push(host);
  }
  process.env.NO_PROXY = existing.join(',');

  console.log(
    `[local-proxy] routing dev-server provider fetches through ${proxyUrl}`,
  );
}
