import path from 'node:path';
import { promises as fsp } from 'node:fs';

/**
 * Aircraft-photo proxy: ICAO24 hex → a real airframe photo (thumbnail +
 * large + the planespotters photo page + photographer). Matched by hex so the
 * airline/livery and type on the photo correspond to the tracked flight, the
 * way adsb.lol's selected-aircraft card does.
 *
 * Source: planespotters.net public photo API (no key). Their policy requires a
 * descriptive User-Agent carrying a contact (URL/email). Cached aggressively
 * (photos of an airframe rarely change) and persisted to disk so restarts do
 * not re-hammer the service. Photo-less airframes are negative-cached briefly.
 */
export function aircraftPhotoProxy() {
  const TTL_MS = 7 * 24 * 3600_000;
  const NEG_TTL_MS = 6 * 3600_000;
  const CACHE_PATH = path.join(
    process.cwd(),
    '.gev-cache',
    'aircraft-photos.json',
  );
  const UA = 'GodsEyeView/1.0 (+https://gods-eye-pro.vercel.app)';
  let cache = {};
  let dirty = false;
  let loaded = false;
  const inflight = new Map();

  async function loadOnce() {
    if (loaded) return;
    loaded = true;
    try {
      cache = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8')) || {};
    } catch {
      /* first run */
    }
    setInterval(async () => {
      if (!dirty) return;
      dirty = false;
      try {
        await fsp.mkdir(path.dirname(CACHE_PATH), { recursive: true });
        await fsp.writeFile(CACHE_PATH, JSON.stringify(cache), 'utf8');
      } catch {
        dirty = true; // retry next tick
      }
    }, 15_000).unref?.();
  }

  const ttl = (e) => (e && e.data ? TTL_MS : NEG_TTL_MS);
  const fresh = (e) => e && Date.now() - e.at < ttl(e);

  function parse(json) {
    const p = Array.isArray(json?.photos) ? json.photos[0] : null;
    if (!p) return null;
    const thumb = p.thumbnail_large?.src || p.thumbnail?.src || null;
    return {
      thumb,
      thumbSmall: p.thumbnail?.src || thumb,
      large: thumb,
      link: p.link || null,
      photographer: p.photographer || null,
    };
  }

  function lookup(hex) {
    if (fresh(cache[hex])) return Promise.resolve(cache[hex].data);
    if (!inflight.has(hex)) {
      inflight.set(
        hex,
        (async () => {
          try {
            const res = await fetch(
              `https://api.planespotters.net/pub/photos/hex/${hex}`,
              {
                headers: { 'User-Agent': UA, Accept: 'application/json' },
                signal: AbortSignal.timeout(9000),
              },
            );
            if (res.ok) {
              const data = parse(await res.json());
              cache[hex] = { at: Date.now(), data }; // data may be null — negative cache
              dirty = true;
              return data;
            }
            if (res.status === 404) {
              cache[hex] = { at: Date.now(), data: null };
              dirty = true;
            }
            return fresh(cache[hex]) ? cache[hex].data : null;
          } catch {
            return fresh(cache[hex]) ? cache[hex].data : null;
          } finally {
            inflight.delete(hex);
          }
        })(),
      );
    }
    return inflight.get(hex);
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/aircraft-photo', async (req, res) => {
      await loadOnce();
      const send = (status, obj) => {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600',
        });
        res.end(JSON.stringify(obj));
      };
      try {
        const q = new URL(req.url || '', 'http://localhost').searchParams;
        const hex = String(q.get('hex') || '').toLowerCase();
        if (!/^[0-9a-f]{6}$/.test(hex))
          return send(400, { found: false, error: 'invalid hex' });
        const data = await lookup(hex);
        return send(200, data ? { found: true, ...data } : { found: false });
      } catch {
        return send(500, { found: false, error: 'photo proxy error' });
      }
    });
  };
  return {
    name: 'aircraft-photo-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
