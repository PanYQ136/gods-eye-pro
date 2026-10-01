/**
 * Network-aware base-map default.
 *
 * The app ships a keyless globe (Esri/OSM), a Google 3D stack, and the
 * mainland-CN-reachable AMap (高德) stacks. Which one a visitor should get by
 * default depends on the NETWORK, not on locale: a browser that can reach
 * Google's hosts is treated as "global" (Google / Esri); one that cannot as
 * mainland CN (高德). A manual chip choice, remembered in localStorage, wins.
 *
 * @module maps/regionDetect
 */

const GOOGLE_PROBE_URLS = [
  'https://www.google.com/generate_204',
  'https://maps.gstatic.com/mapfiles/api-3/images/spotlight-poi2.png',
];

const MANUAL_KEY = 'gev.mapStack.manual';

/** Remember the operator's explicit chip choice so detection does not override it. */
export function rememberManualMapStack(id) {
  try {
    if (id) globalThis.localStorage?.setItem(MANUAL_KEY, String(id));
  } catch {
    /* private mode / disabled storage: detection fallback is fine */
  }
}

/** @returns {string|null} A previously chosen stack id, if any. */
export function readManualMapStack() {
  try {
    return globalThis.localStorage?.getItem(MANUAL_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * True when this browser can reach Google's hosts. A `no-cors` fetch resolves
 * (opaque) on ANY HTTP response — even a 4xx — and rejects when the network
 * blocks the host, so it is a clean reachability probe. A timeout counts as
 * unreachable.
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<boolean>}
 */
export async function detectGoogleReachable({ timeoutMs = 2500 } = {}) {
  if (typeof fetch !== 'function') return true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (const url of GOOGLE_PROBE_URLS) {
      try {
        await fetch(url, {
          mode: 'no-cors',
          cache: 'no-store',
          signal: controller.signal,
        });
        return true;
      } catch {
        /* blocked or timed out — try the next host */
      }
    }
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pick the default stack for this load: a remembered manual choice, else the
 * network-detected default.
 * @param {{hasGoogle3d?: boolean}} [options]
 * @returns {Promise<string>} A stack id from `MAP_STACKS`.
 */
export async function resolveInitialStackId({ hasGoogle3d = false } = {}) {
  const manual = readManualMapStack();
  if (manual) return manual;
  const googleReachable = await detectGoogleReachable();
  if (!googleReachable) return 'amap-satellite';
  return hasGoogle3d ? 'photoreal' : 'esri-imagery';
}
