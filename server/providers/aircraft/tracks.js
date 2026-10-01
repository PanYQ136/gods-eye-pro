import { getOpenSkyToken } from './opensky.js';
import { readCappedResponseText } from '../common/http.js';
/**
 * Vite plugin: aircraft track-history backfill proxies (PRD WS-F F1/F2).
 *
 * /api/opensky-track?icao24=<hex6> — OpenSky GET /tracks/all (experimental;
 *   own credit bucket, 4 credits per call on the free tier). OAuth via the
 *   shared coalesced token. 60s per-icao cache; 404/429 forwarded so the
 *   client can fall back to its accumulated trail silently.
 * /api/adsblol/trace?hex=<hex> — adsb.lol tar1090 readsb trace
 *   (undocumented but live; no browser CORS, hence this proxy). Up to ~24h
 *   of real history per aircraft. Treat as best-effort; data is ODbL —
 *   credit "adsb.lol (ODbL)" in the UI.
 */
export function trackBackfillProxies() {
  const TRACK_CACHE_MS = 60000;
  const TRACK_CACHE_MAX = 200;
  const RESPONSE_CAP_BYTES = 5 * 1024 * 1024;
  /** @type {Map<string, {at:number,status:number,body:string}>} */
  const cache = new Map();

  function cachePut(key, entry) {
    cache.set(key, entry);
    if (cache.size > TRACK_CACHE_MAX) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) cache.delete(oldest[0]);
    }
  }

  async function proxyJson(res, key, upstreamUrl, headers = {}) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < TRACK_CACHE_MS) {
      res.statusCode = cached.status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(cached.body);
      return;
    }
    const upstream = await fetch(upstreamUrl, {
      headers,
      signal: AbortSignal.timeout(12000),
    });
    const { tooLarge, text } = await readCappedResponseText(
      upstream,
      RESPONSE_CAP_BYTES,
    );
    let body;
    let status = upstream.status;
    if (tooLarge) {
      status = 502;
      body = JSON.stringify({ error: 'Upstream track response too large' });
    } else if (!upstream.ok) {
      // Sanitize upstream error surface; status code is signal enough
      body = JSON.stringify({ error: `Track source HTTP ${upstream.status}` });
    } else {
      body = text;
    }
    // Cache the 502 like any upstream error: /tracks/all costs OpenSky
    // credits, so a retry inside the window must not re-download the body.
    cachePut(key, { at: Date.now(), status, body });
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  }

  /**
   * Convert an adsb.lol tar1090 trace into the OpenSky /tracks/ response shape
   * ({icao24,callsign,startTime,endTime,path}) so the client renderer is
   * source-agnostic. Trace points are [offsetSec, lat, lon, altFt|'ground',
   * gsKt, trackDeg, ...]; alt is converted ft→m and offset→absolute epoch sec
   * anchored to payload.timestamp (the trace end).
   */
  function convertAdsbLolTrace(payload) {
    const trace = Array.isArray(payload?.trace) ? payload.trace : [];
    const endEpoch = Number(payload?.timestamp) || Date.now() / 1000;
    const maxOffset = trace.length
      ? Number(trace[trace.length - 1][0]) || 0
      : 0;
    const path = [];
    for (const point of trace) {
      const lat = Number(point?.[1]);
      const lon = Number(point?.[2]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const offset = Number(point?.[0]) || 0;
      const altRaw = point?.[3];
      const onGround = altRaw === 'ground';
      const altFt = Number(altRaw);
      const baroAltM =
        onGround || !Number.isFinite(altFt) ? 0 : altFt * 0.3048;
      const track = Number(point?.[5]);
      path.push([
        Math.round(endEpoch - (maxOffset - offset)),
        lat,
        lon,
        baroAltM,
        Number.isFinite(track) ? track : 0,
        onGround,
      ]);
    }
    const startTime = path.length ? path[0][0] : Math.floor(endEpoch);
    const endTime = path.length ? path[path.length - 1][0] : Math.floor(endEpoch);
    return {
      icao24: String(payload?.icao || '').toLowerCase(),
      callsign: (payload?.r || '').toString().trim() || null,
      startTime,
      endTime,
      path,
    };
  }

  function install(middlewares) {
    middlewares.use('/api/opensky-track', async (req, res) => {
      try {
        const incoming = new URL(req.url || '', 'http://localhost');
        const icao24 = String(incoming.searchParams.get('icao24') || '')
          .trim()
          .toLowerCase();
        if (!/^[0-9a-f]{6}$/.test(icao24)) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({ error: 'icao24 must be a 6-char hex string' }),
          );
          return;
        }
        const cacheKey = `trk:${icao24}`;
        const cached = cache.get(cacheKey);
        if (cached && Date.now() - cached.at < TRACK_CACHE_MS) {
          res.statusCode = cached.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(cached.body);
          return;
        }
        const send = (status, body, source) => {
          cachePut(cacheKey, { at: Date.now(), status, body });
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          if (source) res.setHeader('X-Track-Source', source);
          res.end(body);
        };

        // 1) OpenSky /tracks/all — authentic recent track. Blocked on Vercel
        //    (AWS) and often CN-throttled, so a failure is expected off-home.
        try {
          const token = await getOpenSkyToken();
          const upstream = await fetch(
            `https://opensky-network.org/api/tracks/all?icao24=${icao24}&time=0`,
            {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
              signal: AbortSignal.timeout(12000),
            },
          );
          if (upstream.ok) {
            const capped = await readCappedResponseText(
              upstream,
              RESPONSE_CAP_BYTES,
            );
            if (!capped.tooLarge && capped.text) {
              send(200, capped.text, 'opensky');
              return;
            }
          }
        } catch {
          /* fall through to adsb.lol */
        }

        // 2) adsb.lol trace fallback — keyless, reachable from Vercel and via
        //    the CN proxy; up to ~24 h of real history per aircraft (ODbL).
        try {
          const traceRes = await fetch(
            `https://adsb.lol/data/traces/${icao24.slice(-2)}/trace_full_${icao24}.json`,
            { signal: AbortSignal.timeout(12000) },
          );
          if (traceRes.ok) {
            const capped = await readCappedResponseText(
              traceRes,
              RESPONSE_CAP_BYTES,
            );
            if (!capped.tooLarge && capped.text) {
              send(
                200,
                JSON.stringify(convertAdsbLolTrace(JSON.parse(capped.text))),
                'adsblol',
              );
              return;
            }
          }
          send(
            traceRes.status || 502,
            JSON.stringify({ error: `Track source HTTP ${traceRes.status}` }),
          );
        } catch {
          send(502, JSON.stringify({ error: 'Track fetch failed' }));
        }
      } catch (error) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'OpenSky track fetch failed' }));
      }
    });

    middlewares.use('/api/adsblol/trace', async (req, res) => {
      try {
        const incoming = new URL(req.url || '', 'http://localhost');
        const hex = String(incoming.searchParams.get('hex') || '')
          .trim()
          .toLowerCase();
        if (!/^[0-9a-f~]{6,7}$/.test(hex)) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({ error: 'hex must be a 6-7 char hex string' }),
          );
          return;
        }
        await proxyJson(
          res,
          `lol:${hex}`,
          `https://adsb.lol/data/traces/${hex.slice(-2)}/trace_full_${hex}.json`,
        );
      } catch (error) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'adsb.lol trace fetch failed' }));
      }
    });
  }

  return {
    name: 'track-backfill-proxies',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}
