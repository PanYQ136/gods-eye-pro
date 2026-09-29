/**
 * gev-perf.js — 非侵入「性能模式」+ 实时 FPS 徽标（God's Eye View 增强层）。
 *
 * 一键降低渲染负载，实测前台 FPS 提升主要来自三处（本机 RTX3060）：
 *   关后处理(风格滤镜)  +~10 FPS、放宽瓦片 LOD +~6、降分辨率缩放 +~2；
 *   航班层的 billboard 数量是最大单项成本（关掉整层 +~57 FPS）。
 *
 * 完全可还原：删掉本文件 + index.html 里对应的 1 行 <script> 即恢复原状。
 * 只读 window.__gevViewer（由 viewer.js 暴露），不 import Cesium、不改动任何既有模块。
 */
(() => {
  const LS_KEY = 'gev.perfMode';
  const st = {
    viewer: null,
    on: false,
    saved: null, // {res, globeMSE, tfr, tilesets:[], tilesetMSE:[], stageOn:[]}
    frames: 0,
    t0: 0,
  };

  function findTilesets(scene) {
    const out = [];
    for (let i = 0; i < scene.primitives.length; i++) {
      const p = scene.primitives.get(i);
      if (p && p.constructor && p.constructor.name === 'Cesium3DTileset') out.push(p);
    }
    return out;
  }

  function snapshot() {
    const v = st.viewer;
    const s = v.scene;
    const tilesets = findTilesets(s);
    const stageOn = [];
    try {
      for (let i = 0; i < s.postProcessStages.length; i++) stageOn.push(s.postProcessStages.get(i).enabled);
    } catch (e) {}
    st.saved = {
      res: v.resolutionScale,
      globeMSE: s.globe ? s.globe.maximumScreenSpaceError : 2,
      tfr: v.targetFrameRate,
      tilesets,
      tilesetMSE: tilesets.map((t) => t.maximumScreenSpaceError),
      stageOn,
    };
  }

  function apply(on) {
    const v = st.viewer;
    if (!v) return;
    const s = v.scene;
    if (!st.saved) snapshot();
    if (on) {
      v.resolutionScale = 0.7;
      if (s.globe) s.globe.maximumScreenSpaceError = 6;
      st.saved.tilesets.forEach((t) => {
        try { t.maximumScreenSpaceError = 48; } catch (e) {}
      });
      try {
        for (let i = 0; i < s.postProcessStages.length; i++) s.postProcessStages.get(i).enabled = false;
      } catch (e) {}
      if (v.targetFrameRate) v.targetFrameRate = 30;
    } else {
      v.resolutionScale = st.saved.res;
      if (s.globe) s.globe.maximumScreenSpaceError = st.saved.globeMSE;
      st.saved.tilesets.forEach((t, i) => {
        if (st.saved.tilesetMSE[i] != null) { try { t.maximumScreenSpaceError = st.saved.tilesetMSE[i]; } catch (e) {} }
      });
      try {
        for (let i = 0; i < s.postProcessStages.length; i++) {
          if (st.saved.stageOn[i] != null) s.postProcessStages.get(i).enabled = st.saved.stageOn[i];
        }
      } catch (e) {}
      if (st.saved.tfr) v.targetFrameRate = st.saved.tfr;
    }
    st.on = on;
    try { localStorage.setItem(LS_KEY, on ? '1' : '0'); } catch (e) {}
    const btn = document.getElementById('gev-perf-btn');
    if (btn) {
      btn.classList.toggle('on', on);
      btn.textContent = on ? '性能 · 开' : '性能模式';
      btn.title = on ? '点击恢复画质' : '点击降低负载、提高帧率';
    }
    // 立刻刷新一帧，切换当场可见
    try { v.scene.requestRenderMode = false; setTimeout(() => { try { v.scene.requestRenderMode = true; } catch (e) {} }, 260); } catch (e) {}
  }

  // 瓦片集（3D Tileset）通常异步加载，启动时可能还没就绪 → 稍后补设其 LOD。
  function applyTileLod() {
    if (!st.on || !st.viewer) return;
    try {
      const ts = findTilesets(st.viewer.scene);
      for (const t of ts) { try { t.maximumScreenSpaceError = 48; } catch (e) {} }
    } catch (e) {}
  }

  function buildUi() {
    if (document.getElementById('gev-perf-btn')) return;
    const css = document.createElement('style');
    css.textContent = [
      '#gev-perf-wrap{position:fixed;left:12px;bottom:52px;z-index:2147482000;display:flex;gap:8px;align-items:center;font:12px/1.2 system-ui,"Segoe UI",sans-serif;}',
      '#gev-perf-btn{cursor:pointer;border:1px solid #2b4a63;background:rgba(8,20,30,.72);color:#bfe9ff;padding:6px 11px;border-radius:16px;letter-spacing:.4px;backdrop-filter:blur(3px);}',
      '#gev-perf-btn.on{background:#0a3a2a;border-color:#1f8f6a;color:#9dffd6;}',
      '#gev-perf-fps{border:1px solid #2b4a63;background:rgba(8,20,30,.72);color:#8fe3ff;padding:6px 10px;border-radius:16px;min-width:62px;text-align:center;font-variant-numeric:tabular-nums;}',
    ].join('');
    document.head.appendChild(css);
    const wrap = document.createElement('div');
    wrap.id = 'gev-perf-wrap';
    const fps = document.createElement('div');
    fps.id = 'gev-perf-fps';
    fps.textContent = 'FPS —';
    const btn = document.createElement('button');
    btn.id = 'gev-perf-btn';
    btn.type = 'button';
    btn.textContent = '性能模式';
    btn.addEventListener('click', () => apply(!st.on));
    wrap.appendChild(fps);
    wrap.appendChild(btn);
    document.body.appendChild(wrap);
  }

  function tickFps() {
    if (!st.viewer) return;
    const el = document.getElementById('gev-perf-fps');
    const now = performance.now();
    if (st.t0) {
      const dt = now - st.t0;
      if (dt >= 900) {
        const fps = Math.round((st.frames * 1000) / dt);
        if (el) el.textContent = 'FPS ' + fps;
        st.frames = 0;
        st.t0 = now;
      }
    } else st.t0 = now;
  }

  function boot(viewer) {
    st.viewer = viewer;
    buildUi();
    // FPS 计数：st.frames 过去从未自增（徽标恒 0）。用 requestAnimationFrame
    // 度量浏览器实际帧节奏——requestRenderMode 空闲不渲染时它仍反映真实流畅度。
    try {
      const rafTick = () => { st.frames++; requestAnimationFrame(rafTick); };
      requestAnimationFrame(rafTick);
      setInterval(tickFps, 500);
    } catch (e) {}
    // 用户要求「默认最大化流畅度」→ 首次默认开启性能模式（点按钮可关掉恢复画质/风格）
    let want = true;
    try { const p = localStorage.getItem(LS_KEY); if (p != null) want = p === '1'; } catch (e) {}
    if (want) {
      apply(true);
      [3000, 9000, 18000].forEach((t) => setTimeout(applyTileLod, t));
    } else {
      const btn = document.getElementById('gev-perf-btn');
      if (btn) btn.textContent = '性能模式';
    }
  }

  let tries = 0;
  const timer = setInterval(() => {
    if (window.__gevViewer && window.__gevViewer.scene) {
      clearInterval(timer);
      boot(window.__gevViewer);
    } else if (++tries > 200) clearInterval(timer);
  }, 250);
})();
