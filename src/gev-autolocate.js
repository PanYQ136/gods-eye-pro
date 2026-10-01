/* ═══════════════════════════════════════════════════════════════
   GEV —— 启动相机：地球上空 → 定位当前设备 → 电影镜头放大到当前位置
   用户 2026-09-28 指定：定位与瓦片加载【并行】；不做航班追踪。

   ⚠️ 大陆环境关键结论：浏览器内置定位（走 Google）在国内被墙，常年拿不到值，
      所以之前一直回退到"家"（福州）。本模块改用【多源定位】，优先国内可用源：
        1) 高德 JS API Geolocation（手机 GPS/WiFi，最准）
        2) 浏览器 navigator.geolocation（境外或已授权时）
        3) 高德 REST IP 定位（城市级，大陆可用；用客户端真实 IP）
        4) localStorage 上次成功的位置
        5) 兜底：家（福州）

   诊断：window.__gevCine = { stage, frames, geo, sources }
        geo = { lat, lon, source, city?, acc? } 或 null
        sources = { amapJs, browser, amapIp } 各自结果

   零侵入可还原：删本文件 + index.html 那行 <script> + controls.js 取消注释。
   ═══════════════════════════════════════════════════════════════ */

import * as Cesium from 'cesium';
import {
  holdContinuousRender,
  releaseContinuousRender,
} from './renderGovernor.js';

(function () {
  'use strict';

  const AMAP_KEY = (import.meta.env && import.meta.env.VITE_AMAP_KEY) || '';

  const CINE = (window.__gevCine = {
    stage: 'boot',
    frames: 0,
    geo: null,
    sources: {},
  });

  const HOME = { lon: 119.349185, lat: 26.067452 }; // 福州东景家园（兜底）
  const LS_KEY = 'gev.lastLocation';
  const START_HEIGHT = 10_000_000;
  const END_HEIGHT = 12_000;
  const MIN_DWELL_MS = 1000;
  const TWEEN_MS = 4200;
  const GEO_CAP = 6500; // 单源最长等待

  let firstCall = true;
  let ran = false;
  let tries = 0;

  const viewer = () => window.__gevViewer;
  const sceneReady = (v) => v && v.camera && v.scene && v.scene.preRender;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cap = (p, ms) => Promise.race([p, sleep(ms).then(() => null)]);
  const valid = (l) =>
    l &&
    Number.isFinite(l.lat) &&
    Number.isFinite(l.lon) &&
    Math.abs(l.lat) <= 90 &&
    Math.abs(l.lon) <= 180 &&
    !(l.lat === 0 && l.lon === 0);

  /* ── 源 1：高德 JS API Geolocation（手机 GPS/WiFi，最准） ── */
  function loadAmapJs() {
    return new Promise((resolve) => {
      if (window.AMap) return resolve(true);
      if (!AMAP_KEY) return resolve(false);
      const s = document.createElement('script');
      s.src =
        'https://webapi.amap.com/maps?v=2.0&key=' +
        encodeURIComponent(AMAP_KEY) +
        '&plugin=AMap.Geolocation,AMap.CitySearch';
      s.onload = () => resolve(!!window.AMap);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
      setTimeout(() => resolve(!!window.AMap), 9000);
    });
  }
  async function amapJsGeo() {
    try {
      const ok = await loadAmapJs();
      if (!ok || !window.AMap || !window.AMap.Geolocation) return null;
      const pos = await cap(
        new Promise((res) => {
          try {
            new window.AMap.Geolocation({
              enableHighAccuracy: true,
              timeout: 6000,
            }).getCurrentPosition((s, r) => {
              if (s === 'complete' && r && r.position)
                res({
                  lon: r.position.getLng(),
                  lat: r.position.getLat(),
                  acc: r.accuracy,
                  source: 'amap-gps',
                });
              else res(null);
            });
          } catch (e) {
            res(null);
          }
        }),
        GEO_CAP,
      );
      return valid(pos) ? pos : null;
    } catch (e) {
      return null;
    }
  }

  /* ── 源 2：浏览器内置定位 ── */
  function tryNav(opts) {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      let done = false;
      const fin = (r) => {
        if (!done) {
          done = true;
          resolve(r);
        }
      };
      const g = setTimeout(() => fin(null), (opts.timeout || 6000) + 1500);
      try {
        navigator.geolocation.getCurrentPosition(
          (p) => {
            clearTimeout(g);
            fin({
              lon: p.coords.longitude,
              lat: p.coords.latitude,
              acc: p.coords.accuracy,
              source: 'browser',
            });
          },
          () => {
            clearTimeout(g);
            fin(null);
          },
          opts,
        );
      } catch (e) {
        clearTimeout(g);
        fin(null);
      }
    });
  }
  async function browserGeo() {
    let r = await cap(
      tryNav({ enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 }),
      GEO_CAP + 1500,
    );
    if (!valid(r))
      r = await cap(
        tryNav({
          enableHighAccuracy: false,
          timeout: 6000,
          maximumAge: 600000,
        }),
        GEO_CAP + 1500,
      );
    return valid(r) ? r : null;
  }

  /* ── 源 3：高德 REST IP 定位（城市级） ── */
  async function amapIpGeo() {
    if (!AMAP_KEY) return null;
    try {
      const u =
        'https://restapi.amap.com/v3/ip?key=' + encodeURIComponent(AMAP_KEY);
      const r = await cap(
        fetch(u).then((x) => x.json()),
        GEO_CAP,
      );
      if (!r || r.status !== '1' || !r.rectangle) return null;
      // rectangle: "lng1,lat1;lng2,lat2" → 取中心
      const m = String(r.rectangle).match(
        /(-?[\d.]+),(-?[\d.]+);(-?[\d.]+),(-?[\d.]+)/,
      );
      if (!m) return null;
      const lon = (parseFloat(m[1]) + parseFloat(m[3])) / 2;
      const lat = (parseFloat(m[2]) + parseFloat(m[4])) / 2;
      return { lon, lat, city: r.city || r.province || '', source: 'amap-ip' };
    } catch (e) {
      return null;
    }
  }

  /* ── 源 4：本地缓存 ── */
  function lastKnown() {
    try {
      const l = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      return valid(l)
        ? { ...l, source: (l.source || 'cache') + '+cache' }
        : null;
    } catch (e) {
      return null;
    }
  }
  function saveLast(loc) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(loc));
    } catch (e) {
      /* ignore */
    }
  }

  async function resolveLocation() {
    // 并行三源（页面一开就发起；通常遮罩收起前已就绪）
    const [ajs, br, ip] = await Promise.all([
      amapJsGeo(),
      browserGeo(),
      amapIpGeo(),
    ]);
    CINE.sources = {
      amapJs: ajs && { lon: ajs.lon, lat: ajs.lat, acc: ajs.acc },
      browser: br && { lon: br.lon, lat: br.lat, acc: br.acc },
      amapIp: ip && { lon: ip.lon, lat: ip.lat, city: ip.city },
    };
    const loc = ajs || br || ip || lastKnown() || { ...HOME, source: 'home' };
    CINE.geo = loc;
    if (loc.source && !String(loc.source).includes('cache')) saveLast(loc);
    try {
      console.log(
        '[GEV] location resolved:',
        JSON.stringify({
          source: loc.source,
          lat: +loc.lat.toFixed(4),
          lon: +loc.lon.toFixed(4),
          city: loc.city || undefined,
        }),
      );
    } catch (e) {
      /* ignore */
    }
    return loc;
  }

  function hasShareLink() {
    return /(?:^|[#&])lat=-?[\d.]+/.test(window.location.hash || '');
  }

  function setSpaceView(lon, lat) {
    const v = viewer();
    if (!sceneReady(v)) return false;
    v.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, START_HEIGHT),
      orientation: {
        heading: Cesium.Math.toRadians(15),
        pitch: Cesium.Math.toRadians(-90),
        roll: 0,
      },
    });
    return true;
  }

  function tweenTo(target) {
    const v = viewer();
    if (!sceneReady(v)) {
      CINE.stage = 'tween-noScene';
      return;
    }
    CINE.stage = 'tweening';
    const cam = v.camera;
    const scene = v.scene;
    let from;
    try {
      const c = cam.positionCartographic;
      from = {
        lon: Cesium.Math.toDegrees(c.longitude),
        lat: Cesium.Math.toDegrees(c.latitude),
        h: c.height,
        heading: cam.heading,
        pitch: cam.pitch,
      };
    } catch (e) {
      from = null;
    }
    if (
      !from ||
      !Number.isFinite(from.lon) ||
      !Number.isFinite(from.lat) ||
      !Number.isFinite(from.h) ||
      from.h <= 0
    ) {
      from = {
        lon: HOME.lon,
        lat: HOME.lat,
        h: START_HEIGHT,
        heading: Cesium.Math.toRadians(15),
        pitch: Cesium.Math.toRadians(-90),
      };
    }
    const to = {
      lon: target.lon,
      lat: target.lat,
      h: END_HEIGHT,
      heading: Cesium.Math.toRadians(15),
      // Land straight-down (nadir) so the view opens flat, not tilted, and the
      // camera-tilt toggle reads OFF by default (owner request 2026-10-01).
      pitch: Cesium.Math.toRadians(-89),
    };

    let done = false;
    let raf = 0;
    const t0 = performance.now();
    const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
    const finish = () => {
      if (done) return;
      done = true;
      try {
        cancelAnimationFrame(raf);
      } catch (e) {
        /* ignore */
      }
      releaseContinuousRender('gev-cine');
    };
    holdContinuousRender('gev-cine');
    const step = () => {
      if (done) return;
      CINE.frames++;
      let t = (performance.now() - t0) / TWEEN_MS;
      if (!Number.isFinite(t)) t = 1;
      if (t > 1) t = 1;
      const s = ease(t);
      const h = from.h * Math.pow(to.h / from.h, s);
      const lon = from.lon + (to.lon - from.lon) * s;
      const lat = from.lat + (to.lat - from.lat) * s;
      const dHeading = Math.atan2(
        Math.sin(to.heading - from.heading),
        Math.cos(to.heading - from.heading),
      );
      const heading = from.heading + dHeading * s;
      const pitch = from.pitch + (to.pitch - from.pitch) * s;
      try {
        cam.setView({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, h),
          orientation: { heading, pitch, roll: 0 },
        });
      } catch (e) {
        /* ignore */
      }
      try {
        scene.requestRender?.();
      } catch (e) {
        /* ignore */
      }
      if (t >= 1) {
        finish();
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    setTimeout(finish, TWEEN_MS + 3000);
  }

  function waitForLoaderHidden(maxMs) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const check = () => {
        const el = document.getElementById('loading-screen');
        // 注意：不能用 offsetParent —— #loading-screen 是 position:fixed，fixed 元素恒为 null
        const op = el ? parseFloat(getComputedStyle(el).opacity) : 0;
        const gone = !el || !Number.isFinite(op) || op < 0.05;
        if (gone || performance.now() - t0 > maxMs) return resolve();
        setTimeout(check, 150);
      };
      check();
    });
  }

  function toast(msg, ms) {
    let el = document.getElementById('gev-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'gev-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), ms || 5200);
  }

  async function run() {
    if (ran) return;
    const v = viewer();
    if (!sceneReady(v)) {
      if (tries++ < 160) setTimeout(run, 250);
      return;
    }
    if (firstCall && hasShareLink()) {
      ran = true;
      CINE.stage = 'share-skip';
      return;
    }
    firstCall = false;
    ran = true;

    CINE.stage = 'locating';
    const locP = resolveLocation(); // ① 并行定位（不等瓦片）

    await waitForLoaderHidden(30000); // ② 等启动遮罩收起
    CINE.stage = 'space-set';
    setSpaceView(HOME.lon, HOME.lat); // ③ 立刻出太空视角

    const loc = await locP; // ④ 定位结果
    if (loc && loc.source !== 'home') {
      setSpaceView(loc.lon, loc.lat); // 对准设备经度（10万米高空跳变几乎看不出）
      CINE.stage =
        loc.source === 'home' ? 'space-set:default' : 'space-set:device';
    } else {
      CINE.stage = 'space-set:default';
    }

    await sleep(MIN_DWELL_MS);
    tweenTo(loc || { ...HOME, source: 'home' }); // ⑤ 电影镜头放大

    if (loc && loc.source && loc.source !== 'home') {
      const tag =
        { 'amap-gps': '高德GPS', browser: '浏览器', 'amap-ip': '高德IP' }[
          loc.source
        ] || loc.source;
      toast('定位来源：' + tag + (loc.city ? '（' + loc.city + '）' : ''));
    } else if (loc && loc.source === 'home') {
      toast('未能获取设备定位，已定位到默认位置');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
