/**
 * gev-dossier — 非侵入式「目标详细档案」浮层。
 *
 * 监控 `viewer.trackedEntity`（本应用里“跟踪某个交通工具”= 相机跟随该实体），
 * 把图层已发布的 `entity.gevLabelModel`（title / details / specs）渲染成一个
 * 详细档案框，并每帧用该实体的实时位置换算经纬度/高度，实现“实时追踪位置”。
 *
 * 零侵入：本文件独立，不改动任何应用源码或事件契约；index.html 追加一行引用即可。
 * 删除该文件与那一行引用即可完全还原。任何异常都被吞掉，绝不影响主应用。
 */
(function () {
  if (window.__gevDossier) return;

  const FIELD_LABELS = {
    name: '名称',
    operator: '航司',
    owner: '运营方',
    callsign: '呼号',
    registration: '注册号',
    type: '机型',
    typeCode: '型别代码',
    altitude: '高度',
    flightLevel: '飞行高度层',
    speed: '地速',
    heading: '航向',
    verticalRate: '垂直速度',
    eta: '预计到达',
    route: '航线',
    departure: '起飞机场',
    arrival: '落地机场',
    squawk: '应答机',
    category: '类别',
    status: '数据状态',
    mmsi: 'MMSI',
    imo: 'IMO',
    vesselType: '船型',
    length: '船长',
    beam: '船宽',
    draught: '吃水',
    destination: '目的地',
    course: '航向',
    country: '船旗国',
    icao24: 'ICAO24',
  };
  // 这些键放在标题行下的身份行，而不是表格里
  const IDENTITY_KEYS = ['type', 'operator', 'owner', 'airline'];

  const STYLE = `
  #gev-dossier{
    position:fixed; left:12px; bottom:64px; z-index:2147483000;
    width:316px; max-width:calc(100vw - 24px); max-height:60vh; overflow:hidden auto;
    background:linear-gradient(180deg, rgba(6,18,24,.94), rgba(4,12,18,.92));
    border:1px solid rgba(57,208,255,.34); border-radius:10px;
    box-shadow:0 8px 28px rgba(0,0,0,.5), inset 0 0 24px rgba(57,208,255,.05);
    color:#d6f4ff; font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;
    font-size:12px; line-height:1.5; letter-spacing:.2px;
    backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
    transform:translateY(8px); opacity:0; pointer-events:none;
    transition:opacity .18s ease, transform .18s ease;
  }
  #gev-dossier.show{ transform:translateY(0); opacity:1; pointer-events:auto; }
  #gev-dossier .gd-head{
    display:flex; align-items:center; gap:8px; padding:8px 10px;
    border-bottom:1px solid rgba(57,208,255,.2); cursor:move; user-select:none;
    background:rgba(57,208,255,.06);
  }
  #gev-dossier .gd-dot{ width:8px; height:8px; border-radius:50%; flex:0 0 auto;
    background:var(--gd-accent,#39d0ff); box-shadow:0 0 8px var(--gd-accent,#39d0ff); }
  #gev-dossier .gd-title{ font-weight:700; font-size:13px; color:#fff; flex:1 1 auto;
    white-space:normal; overflow:visible; text-overflow:clip; word-break:break-word; }
  #gev-dossier .gd-badge{ font-size:9px; padding:1px 6px; border-radius:8px;
    border:1px solid currentColor; opacity:.9; flex:0 0 auto; }
  #gev-dossier .gd-badge.live{ color:#5ef1a6; }
  #gev-dossier .gd-badge.stale{ color:#ffb44d; }
  #gev-dossier .gd-x{ flex:0 0 auto; cursor:pointer; opacity:.6; padding:0 2px; }
  #gev-dossier .gd-x:hover{ opacity:1; }
  #gev-dossier .gd-body{ padding:6px 10px 10px; }
  #gev-dossier .gd-tag{ font-size:9px; letter-spacing:1.6px; text-transform:uppercase;
    color:rgba(57,208,255,.75); margin:6px 0 3px; }
  #gev-dossier .gd-ident{ color:#9fe9ff; font-size:11.5px; margin-bottom:2px; }
  #gev-dossier table{ width:100%; border-collapse:collapse; }
  #gev-dossier td{ padding:1.5px 0; vertical-align:top; }
  #gev-dossier td.k{ color:rgba(150,200,220,.72); width:78px; white-space:nowrap; }
  #gev-dossier td.v{ color:#eafbff; word-break:break-word; }
  #gev-dossier .gd-live td.v{ color:#8ff0c4; font-variant-numeric:tabular-nums; }
  #gev-dossier .gd-foot{ margin-top:6px; padding-top:5px; border-top:1px solid rgba(57,208,255,.14);
    font-size:9.5px; color:rgba(140,180,200,.6); display:flex; justify-content:space-between; }
  #gev-dossier.gd-collapsed .gd-body{ display:none; }
  #gev-dossier .gd-photo{ margin:6px 0 2px; }
  #gev-dossier .gd-photo-link{ display:block; }
  #gev-dossier .gd-photo-img{ display:block; width:100%; height:auto; border-radius:6px;
    border:1px solid rgba(57,208,255,.28); background:rgba(0,0,0,.25); }
  #gev-dossier .gd-photo-cap{ font-size:9px; color:rgba(140,180,200,.7); margin-top:3px;
    text-align:right; }
  `;

  function ensureStyle() {
    if (document.getElementById('gev-dossier-style')) return;
    const s = document.createElement('style');
    s.id = 'gev-dossier-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  // WGS84 ECEF -> geodetic (无 Cesium 依赖)
  const A = 6378137.0;
  const F = 1 / 298.257223563;
  const E2 = F * (2 - F);
  function ecefToLla(c) {
    if (!c || !Number.isFinite(c.x)) return null;
    const x = c.x,
      y = c.y,
      z = c.z;
    const lon = Math.atan2(y, x);
    const p = Math.hypot(x, y);
    if (p < 1e-6)
      return { lat: z < 0 ? -90 : 90, lon: 0, alt: Math.abs(z) - A };
    let lat = Math.atan2(z, p * (1 - E2));
    let N = A,
      alt = 0;
    for (let i = 0; i < 6; i += 1) {
      const s = Math.sin(lat);
      N = A / Math.sqrt(1 - E2 * s * s);
      alt = p / Math.cos(lat) - N;
      lat = Math.atan2(z, p * (1 - (E2 * N) / (N + alt)));
    }
    const s = Math.sin(lat);
    N = A / Math.sqrt(1 - E2 * s * s);
    alt = p / Math.cos(lat) - N;
    return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI, alt };
  }

  const state = {
    viewer: null,
    target: null, // {title, ident, accent, specs, position, stale}
    posGetter: null,
    userHidden: false,
    el: null,
    els: {},
    rafId: null,
    started: false,
  };

  function fmtNum(v, digits) {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString('en-US', {
      maximumFractionDigits: digits ?? 0,
      minimumFractionDigits: 0,
    });
  }
  function fmtCoord(lat, lon) {
    const ns = lat >= 0 ? 'N' : 'S';
    const ew = lon >= 0 ? 'E' : 'W';
    return `${fmtNum(Math.abs(lat), 4)}°${ns}  ${fmtNum(Math.abs(lon), 4)}°${ew}`;
  }

  function buildDom() {
    ensureStyle();
    const el = document.createElement('div');
    el.id = 'gev-dossier';
    el.innerHTML =
      '<div class="gd-head">' +
      '<span class="gd-dot"></span>' +
      '<span class="gd-title">—</span>' +
      '<span class="gd-badge live">LIVE</span>' +
      '<span class="gd-x" title="关闭">✕</span>' +
      '</div>' +
      '<div class="gd-body">' +
      '<div class="gd-tag">目标档案 · TARGET DOSSIER</div>' +
      '<div class="gd-ident" data-r="ident"></div>' +
      '<div class="gd-photo" data-r="photo" style="display:none"></div>' +
      '<table data-r="specs"></table>' +
      '<div class="gd-tag">实时位置 · LIVE POSITION</div>' +
      '<table class="gd-live"><tbody>' +
      '<tr><td class="k">纬度/经度</td><td class="v" data-r="ll">—</td></tr>' +
      '<tr><td class="k">高度</td><td class="v" data-r="alt">—</td></tr>' +
      '<tr><td class="k">预计到达</td><td class="v" data-r="eta">—</td></tr>' +
      '</tbody></table>' +
      '<div class="gd-foot"><span data-r="src">数据源</span><span data-r="upd">—</span></div>' +
      '</div>';
    document.body.appendChild(el);
    state.el = el;
    const q = (r) => el.querySelector('[data-r="' + r + '"]');
    state.els = {
      title: el.querySelector('.gd-title'),
      badge: el.querySelector('.gd-badge'),
      ident: q('ident'),
      photo: q('photo'),
      specs: q('specs'),
      ll: q('ll'),
      alt: q('alt'),
      eta: q('eta'),
      src: q('src'),
      upd: q('upd'),
    };
    el.querySelector('.gd-x').addEventListener('click', () => {
      state.userHidden = true;
      hide();
    });
    el.querySelector('.gd-head').addEventListener('click', (e) => {
      if (e.target.classList.contains('gd-x')) return;
      el.classList.toggle('gd-collapsed');
    });
    makeDraggable(el);
  }

  function makeDraggable(el) {
    const head = el.querySelector('.gd-head');
    let sx = 0,
      sy = 0,
      ox = 0,
      oy = 0,
      dragging = false;
    head.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('gd-x')) return;
      dragging = true;
      const r = el.getBoundingClientRect();
      el.style.left = r.left + 'px';
      el.style.top = r.top + 'px';
      el.style.bottom = 'auto';
      sx = e.clientX;
      sy = e.clientY;
      ox = r.left;
      oy = r.top;
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const nx = Math.max(
        4,
        Math.min(window.innerWidth - 60, ox + (e.clientX - sx)),
      );
      const ny = Math.max(
        4,
        Math.min(window.innerHeight - 40, oy + (e.clientY - sy)),
      );
      el.style.left = nx + 'px';
      el.style.top = ny + 'px';
    });
    const end = (e) => {
      dragging = false;
      try {
        head.releasePointerCapture(e.pointerId);
      } catch {}
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
  }

  function renderStatic() {
    const t = state.target;
    if (!t) return;
    state.els.title.textContent = t.title || '目标';
    state.els.ident.textContent = t.ident || '';
    state.els.ident.style.display = t.ident ? '' : 'none';
    const accent = t.accent || '#39d0ff';
    state.el.style.setProperty('--gd-accent', accent);
    // specs 表
    const rows = [];
    const specs = t.specs || {};
    for (const k of Object.keys(specs)) {
      const val = specs[k];
      if (val === null || val === undefined || val === '') continue;
      const label = FIELD_LABELS[k] || k;
      rows.push(
        '<tr><td class="k">' +
          esc(label) +
          '</td><td class="v">' +
          esc(String(val)) +
          '</td></tr>',
      );
    }
    if (!rows.length && Array.isArray(t.details)) {
      for (const line of t.details) {
        rows.push('<tr><td class="v" colspan="2">' + esc(line) + '</td></tr>');
      }
    }
    state.els.specs.innerHTML = rows.length
      ? '<tbody>' + rows.join('') + '</tbody>'
      : '<tbody><tr><td class="v">（无详细参数）</td></tr></tbody>';
    // 状态徽标
    const stale =
      t.stale === true ||
      String(specs.status || '')
        .toLowerCase()
        .indexOf('stale') >= 0;
    state.els.badge.textContent = stale ? 'STALE' : 'LIVE';
    state.els.badge.className = 'gd-badge ' + (stale ? 'stale' : 'live');
    state.els.src.textContent = t.source || '实时数据';
    renderPhoto(t);
  }

  // ── 外部补充：航司 / 航线 / 起降机场 / 预计到达（独立于主应用，整段可删）──
  const ROUTE_KEY = 'gev-dossier-routes';
  const routeCache = (() => {
    try {
      return JSON.parse(sessionStorage.getItem(ROUTE_KEY)) || {};
    } catch {
      return {};
    }
  })();
  const routePending = new Map();
  function persistRoutes() {
    try {
      sessionStorage.setItem(ROUTE_KEY, JSON.stringify(routeCache));
    } catch {}
  }
  function fetchRoute(cs) {
    if (!cs) return Promise.resolve(null);
    if (cs in routeCache) return Promise.resolve(routeCache[cs]);
    if (routePending.has(cs)) return routePending.get(cs);
    const p = fetch('/api/adsbdb/route/' + encodeURIComponent(cs))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const v =
          d && d.found
            ? {
                airline: d.airline || null,
                origin: d.origin || null,
                destination: d.destination || null,
              }
            : null;
        routeCache[cs] = v;
        if (v) persistRoutes();
        return v;
      })
      .catch(() => null)
      .finally(() => routePending.delete(cs));
    routePending.set(cs, p);
    return p;
  }
  // ── 真实飞机照片（按 ICAO24 匹配，航司/机型都与已跟踪航班一致）──────────
  const PHOTO_KEY = 'gev-dossier-photos';
  const photoCache = (() => {
    try {
      return JSON.parse(sessionStorage.getItem(PHOTO_KEY)) || {};
    } catch {
      return {};
    }
  })();
  const photoPending = new Map();
  function persistPhotos() {
    try {
      sessionStorage.setItem(PHOTO_KEY, JSON.stringify(photoCache));
    } catch {}
  }
  function fetchPhoto(hex) {
    if (!hex) return Promise.resolve(null);
    if (hex in photoCache) return Promise.resolve(photoCache[hex]);
    if (photoPending.has(hex)) return photoPending.get(hex);
    const p = fetch('/api/aircraft-photo?hex=' + encodeURIComponent(hex))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const v = d && d.found ? d : null;
        photoCache[hex] = v;
        if (v) persistPhotos();
        return v;
      })
      .catch(() => null)
      .finally(() => photoPending.delete(hex));
    photoPending.set(hex, p);
    return p;
  }
  function renderPhoto(t) {
    const box = state.els.photo;
    if (!box) return;
    const hex = String((t && t.hex) || '').toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(hex)) {
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }
    fetchPhoto(hex).then((ph) => {
      if (state.target !== t) return;
      if (!ph || !(ph.thumb || ph.large)) {
        box.style.display = 'none';
        box.innerHTML = '';
        return;
      }
      const cap = [];
      if (t.specs && (t.specs.type || t.specs.operator))
        cap.push(String(t.specs.type || t.specs.operator));
      if (ph.photographer) cap.push('摄影 ' + ph.photographer);
      cap.push('planespotters.net');
      box.style.display = '';
      box.innerHTML =
        '<a class="gd-photo-link" href="' +
        esc(ph.link || '#') +
        '" target="_blank" rel="noopener">' +
        '<img class="gd-photo-img" src="' +
        esc(ph.thumb || ph.large) +
        '" alt="aircraft photo" loading="lazy" referrerpolicy="no-referrer">' +
        '</a>' +
        '<div class="gd-photo-cap">' +
        esc(cap.join(' · ')) +
        '</div>';
    });
  }

  function pickHex(list) {
    for (const v of list) {
      const s = String(v || '').trim().toLowerCase();
      if (/^[0-9a-f]{6}$/.test(s)) return s;
    }
    return null;
  }

  function airportLabel(a) {
    if (!a) return '';
    const code = String(a.code || '').trim();
    const name = String(a.name || '').trim();
    if (name && code && name.toLowerCase() !== code.toLowerCase())
      return name + ' (' + code + ')';
    return name || code || '';
  }
  const EARTH_R = 6371008.8;
  function haversineM(lat1, lon1, lat2, lon2) {
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(lat2 - lat1),
      dLon = rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function trackedInfo() {
    try {
      const g = window.__godsEyeView;
      const reg = g && g.dataManager && g.dataManager.layers;
      const mod =
        reg && reg.get && reg.get('flights') && reg.get('flights').module;
      return (mod && mod.getTrackedInfo && mod.getTrackedInfo()) || null;
    } catch {
      return null;
    }
  }
  function flightRecord(id, cs) {
    try {
      const g = window.__godsEyeView;
      const reg = g && g.dataManager && g.dataManager.layers;
      const mod =
        reg && reg.get && reg.get('flights') && reg.get('flights').module;
      const ps = mod && mod.getAllPositions && mod.getAllPositions();
      if (!Array.isArray(ps)) return null;
      const key = String(id || '').toLowerCase();
      const want = String(cs || '')
        .trim()
        .toUpperCase();
      return (
        ps.find(
          (p) =>
            p &&
            ((key && String(p.id || '').toLowerCase() === key) ||
              (want &&
                String(p.label || '')
                  .trim()
                  .toUpperCase() === want)),
        ) || null
      );
    } catch {
      return null;
    }
  }

  function esc(s) {
    return String(s).replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
    );
  }

  function tick() {
    if (state.el && state.el.classList.contains('show') && state.posGetter) {
      let cart = null;
      try {
        cart = state.posGetter();
      } catch {
        cart = null;
      }
      const lla = ecefToLla(cart);
      if (lla) {
        state.els.ll.textContent = fmtCoord(lla.lat, lla.lon);
        state.els.alt.textContent = fmtNum(lla.alt, 0) + ' m';
        updateEta(lla);
      }
      state.els.upd.textContent = new Date().toLocaleTimeString('zh-CN', {
        hour12: false,
      });
    }
  }
  function updateEta(lla) {
    if (!state.els.eta) return;
    const t = state.target;
    const dest = t && t.dest;
    if (!dest || !Number.isFinite(dest.lat) || !Number.isFinite(dest.lon)) {
      state.els.eta.textContent = '—';
      return;
    }
    const remM = haversineM(lla.lat, lla.lon, dest.lat, dest.lon);
    const kt = parseFloat(String((t.specs && t.specs.speed) || ''));
    if (!Number.isFinite(kt) || kt <= 1) {
      state.els.eta.textContent = fmtNum(remM / 1000, 0) + ' km（地速不足）';
      return;
    }
    const secs = remM / (kt * 0.514444);
    if (!Number.isFinite(secs) || secs > 86400) {
      state.els.eta.textContent = fmtNum(remM / 1000, 0) + ' km';
      return;
    }
    const eta = new Date(Date.now() + secs * 1000);
    state.els.eta.textContent =
      eta.toLocaleTimeString('zh-CN', { hour12: false }) +
      '（约 ' +
      Math.round(secs / 60) +
      ' 分 · ' +
      fmtNum(remM / 1000, 0) +
      ' km）';
  }
  // setInterval 而非 rAF：后台标签 rAF 会被暂停，位置读数不能因此停摆。
  function scheduleTick() {
    if (state.rafId == null) state.rafId = setInterval(tick, 250);
  }
  function stopTick() {
    if (state.rafId != null) {
      clearInterval(state.rafId);
      state.rafId = null;
    }
  }

  function show() {
    if (!state.el || !state.target) return;
    state.userHidden = false;
    state.el.classList.add('show');
    renderStatic();
    scheduleTick();
  }
  function hide() {
    if (state.el) state.el.classList.remove('show');
    stopTick();
  }

  function posGetterFor(entity, viewer) {
    if (!entity) return null;
    return function () {
      try {
        if (typeof entity.gevDisplayPosition === 'function') {
          const p = entity.gevDisplayPosition();
          if (p) return p;
        }
        const prop = entity.position;
        if (prop && typeof prop.getValue === 'function') {
          return prop.getValue(viewer.clock.currentTime);
        }
      } catch {
        /* ignore */
      }
      return null;
    };
  }

  function targetFromTrackedEntity(entity, viewer) {
    const model = entity && entity.gevLabelModel;
    if (!model || !model.title) return null;
    const specs = {};
    if (model.specs && typeof model.specs === 'object') {
      for (const k of Object.keys(model.specs)) {
        if (IDENTITY_KEYS.indexOf(k) >= 0) continue;
        specs[k] = model.specs[k];
      }
    }
    // 兜底：主应用偶发不发布明细时，从图层实时记录补齐 航司/机型/注册号/呼号
    const icao = String((entity && entity.id) || '')
      .trim()
      .toLowerCase();
    const csFromTitle = (
      String(model.title || '')
        .trim()
        .split(/[\s·]+/)[0] || ''
    ).toUpperCase();
    const rec = flightRecord(icao, specs.callsign || csFromTitle);
    if (rec) {
      if (!specs.operator && rec.airline) specs.operator = rec.airline;
      if (!specs.type && (rec.typeName || rec.typeCode))
        specs.type = rec.typeName || rec.typeCode;
      if (!specs.registration && rec.registration)
        specs.registration = rec.registration;
      if (!specs.callsign && rec.label) specs.callsign = rec.label;
    }
    // 再兜底：用图层跟踪信息补齐 地速/航向 与目的地坐标（实时值，最可靠）
    // 守卫：仅当图层跟踪的呼号与本档案标题一致（确系同一架航班）才采用，
    // 避免跟踪船/火点时串到上一架航班的数据。
    const ti0 = trackedInfo();
    const ti =
      ti0 &&
      csFromTitle &&
      String(ti0.callsign || '').toUpperCase() === csFromTitle
        ? ti0
        : null;
    if (ti) {
      if (!specs.speed && Number.isFinite(ti.velocityMps))
        specs.speed = Math.round(ti.velocityMps * 1.944) + ' kt';
      if (!specs.heading && Number.isFinite(ti.track))
        specs.heading = Math.round(ti.track) + '°';
    }
    const t = {
      title: String(model.title || '').trim(),
      ident: buildIdent(model),
      accent: model.accent || '#39d0ff',
      specs,
      details: Array.isArray(model.details) ? model.details : [],
      stale:
        model.specs && typeof model.specs.status === 'string'
          ? /stale/i.test(model.specs.status)
          : /STALE/.test((model.details || []).join(' ')),
      source: (model.specs && model.specs.source) || '实时数据 · 相机跟踪',
      // ICAO24 hex for the planespotters photo lookup (airline/type matched by
      // airframe). The Cesium entity id is a UUID, so prefer the matched live
      // record's id (that IS the hex) and fall back to an explicit icao24 field.
      hex: pickHex([rec && rec.id, model.specs && model.specs.icao24, icao]),
      dest:
        ti &&
        ti.route &&
        ti.route.destination &&
        Number.isFinite(ti.route.destination.lat)
          ? { lat: ti.route.destination.lat, lon: ti.route.destination.lon }
          : null,
    };
    // 航线/起降机场兜底 + 取目的地坐标（算 预计到达）
    const cs = String(specs.callsign || csFromTitle || '')
      .trim()
      .toUpperCase();
    if (cs && /^[A-Z]{3}\d/.test(cs)) {
      fetchRoute(cs).then((r) => {
        if (!r || state.target !== t) return;
        if (r.airline && !t.specs.operator) t.specs.operator = r.airline;
        if (r.origin && r.destination) {
          if (!t.specs.route)
            t.specs.route =
              (r.origin.code || '?') + ' → ' + (r.destination.code || '?');
          if (!t.specs.departure) t.specs.departure = airportLabel(r.origin);
          if (!t.specs.arrival) t.specs.arrival = airportLabel(r.destination);
          if (
            Number.isFinite(r.destination.lat) &&
            Number.isFinite(r.destination.lon)
          )
            t.dest = { lat: r.destination.lat, lon: r.destination.lon };
        }
        renderStatic();
      });
    }
    return t;
  }

  function buildIdent(model) {
    // details[1] 通常是 "航司 · 机型"
    if (Array.isArray(model.details) && model.details[1])
      return String(model.details[1]);
    if (model.specs) {
      const parts = [model.specs.operator, model.specs.type].filter(Boolean);
      if (parts.length) return parts.join(' · ');
    }
    return '';
  }

  function syncTracked() {
    if (!state.viewer) return;
    const entity = state.viewer.trackedEntity;
    if (!entity) {
      // 没有相机跟踪目标
      if (state.trackSrc !== 'focus') {
        state.target = null;
        state.posGetter = null;
        hide();
      }
      return;
    }
    const t = targetFromTrackedEntity(entity, state.viewer);
    if (!t) {
      state.target = null;
      hide();
      return;
    }
    state.trackSrc = 'tracked';
    state.target = t;
    state.posGetter = posGetterFor(entity, state.viewer);
    if (entity.gevLabelModel._dossierRefresh) {
      /* noop */
    }
    show();
  }

  function onTrackedChanged() {
    // 新的跟踪目标（含切换到另一架）→ 清除"用户手动关闭"状态，重新显示。
    state.userHidden = false;
    syncTracked();
  }

  function onWorldFocus(e) {
    const d = e && e.detail;
    if (!d || !d.kind) return;
    const kindCn = { vessel: '水面舰船', fire: '火场' }[d.kind] || d.kind;
    state.trackSrc = 'focus';
    state.target = {
      title: String(d.label || d.id || kindCn),
      ident: kindCn,
      accent: d.kind === 'fire' ? '#ff7a3c' : '#39d0ff',
      specs: { vesselType: kindCn },
      details: [],
      source: '点击锁定（位置为锁定时刻）',
    };
    const frozen = d.position
      ? { x: d.position.x, y: d.position.y, z: d.position.z }
      : null;
    state.posGetter = frozen ? () => frozen : null;
    show();
  }

  function start() {
    if (state.started) return;
    const viewer = window.__gevViewer;
    if (!viewer || !viewer.trackedEntityChanged) return;
    state.viewer = viewer;
    state.started = true;
    buildDom();
    viewer.trackedEntityChanged.addEventListener(onTrackedChanged);
    window.addEventListener('gev:world-request-focus', onWorldFocus);
    window.addEventListener('gev:awareness-subject-selected', () => {
      // 再次点击已被跟踪的目标也会发这个事件（trackedEntityChanged 不会），
      // 必须清除"已关闭"状态，否则叉掉后无法再弹出。
      state.userHidden = false;
      setTimeout(() => syncTracked(), 60);
    });
    syncTracked();
  }

  // viewer 通常在本脚本之后创建，轮询等待。
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (window.__gevViewer) {
      start();
    }
    if (state.started || tries > 300) clearInterval(timer);
  }, 500);

  window.__gevDossier = {
    start,
    refresh: syncTracked,
    show,
    hide,
    _state: state,
  };
})();
