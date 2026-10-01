// src/data/vehicleIcons.js
/**
 * Shape icons for the non-aircraft moving targets — rockets (launch markers),
 * satellites (orbital markers), cars (road-traffic flow) — as white SVG data
 * URIs for Cesium billboards, in the SAME house language as `aircraftIcons.js`:
 * a 96-unit viewBox centred at (48,48), front/nose toward -Y, white fill with a
 * dark hairline edge so the billboard tint pipeline (billboard.color = the
 * class colour, plus .withAlpha fades) keeps working — a hardcoded colour would
 * fight the tint that tells a person what they are looking at.
 */

const VIEW = 96;
const C = VIEW / 2; // 48 — glyph centre
const STROKE =
  'stroke="rgba(0,0,0,0.34)" stroke-width="1.6" stroke-linejoin="round"';
const INK =
  'stroke="rgba(0,0,0,0.30)" stroke-width="1.5" stroke-linecap="round" fill="none"';

const BODIES = {
  // Rocket: pointed nose, slim body, two swept fins, an exhaust flame below.
  rocket: `
    <path d="M0,-42 C7,-30 10,-16 10,-2 L10,20 L-10,20 L-10,-2 C-10,-16 -7,-30 0,-42 Z" fill="white" ${STROKE}/>
    <path d="M-10,8 L-24,28 L-10,22 Z" fill="white" ${STROKE}/>
    <path d="M10,8 L24,28 L10,22 Z" fill="white" ${STROKE}/>
    <path d="M-6,20 L0,40 L6,20 Z" fill="white" fill-opacity="0.55" ${STROKE}/>`,
  // Satellite: a boxed bus with two solar wings and a dish on a stub mast.
  satellite: `
    <path d="M-11,-11 L11,-11 L11,11 L-11,11 Z" fill="white" ${STROKE}/>
    <path d="M-11,-7 L-40,-7 L-40,7 L-11,7 Z" fill="white" ${STROKE}/>
    <path d="M11,-7 L40,-7 L40,7 L11,7 Z" fill="white" ${STROKE}/>
    <path d="M-40,-7 L-40,7 M-25.5,-7 L-25.5,7 M25.5,-7 L25.5,7" ${INK}/>
    <path d="M0,11 L0,20" ${INK}/>
    <circle cx="0" cy="26" r="7" fill="white" ${STROKE}/>`,
  // Car: a rounded top-down saloon — bonnet, cabin, tapered boot.
  car: `
    <path d="M-10,-24 C-10,-28 -7,-29 0,-29 C7,-29 10,-28 10,-24 L11,2 L11,22 C11,26 10,28 7,28 L-7,28 C-10,28 -11,26 -11,22 L-11,2 Z" fill="white" ${STROKE}/>
    <path d="M-8,-16 L8,-16 M-8,-2 L8,-2" ${INK}/>`,
};

function b64(svg) {
  try {
    const bytes = new TextEncoder().encode(svg);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  } catch {
    return btoa(svg);
  }
}

const _cache = new Map();

/**
 * @param {'rocket'|'satellite'|'car'} kind
 * @param {number} [px] Raster size (default 48 → crisp down-sample at icon sizes).
 * @returns {string} `data:image/svg+xml;base64,...`
 */
export function vehicleIcon(kind, px = 48) {
  const k = BODIES[kind] ? kind : 'car';
  const key = k + '@' + px;
  let uri = _cache.get(key);
  if (!uri) {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      px +
      '" height="' +
      px +
      '" viewBox="0 0 ' +
      VIEW +
      ' ' +
      VIEW +
      '"><g transform="translate(' +
      C +
      ',' +
      C +
      ')">' +
      BODIES[k] +
      '</g></svg>';
    uri = 'data:image/svg+xml;base64,' + b64(svg);
    _cache.set(key, uri);
  }
  return uri;
}
