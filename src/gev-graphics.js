/**
 * gev-graphics.js — 非侵入「画面设置」面板（桌面 + 手机通用，独立浮层）。
 * （取代早前的 gev-antialias.js。）
 *
 * 可调项：
 *   • 画质预设：流畅 / 均衡 / 清晰 / 极致
 *   • 渲染分辨率 (0.5–2.0)  —— 立即生效（引擎 resolutionScale）
 *   • 抗锯齿 MSAA：关 / 2x / 4x —— 创建期选项，改后点「重载生效」
 *   • 抗锯齿 FXAA（开关）—— 立即生效
 *   • 锐化 CAS (0–100)   —— 立即生效
 *   • 瓦片精度 (1–8，越小越清晰越吃内存) —— 立即生效（globe.maximumScreenSpaceError）
 *   • 帧率上限：30 / 60 / 90 / 不限 —— 立即生效（viewer.targetFrameRate）
 *   • 保持帧缓冲 preserveDrawingBuffer（开关）—— 创建期选项，改后点「重载生效」
 *
 * 手机(iOS)默认走轻量档，防止标签页被系统杀；桌面默认高清档。所有偏好写入
 * localStorage('gev.gfx')，viewer.js 启动时读取创建期项(MSAA/preserveBuffer/瓦片精度/帧率)。
 *
 * 「FSR 风格放大」= 渲染分辨率 <1 + 锐化 >0（真 DLSS 需原生引擎，网页不可用）。
 *
 * 完全可还原：删本文件 + index.html 一行引用。
 */
import { PostProcessStage, Cartesian2 } from "cesium";

(() => {
  const LS_KEY = "gev.gfx";
  const APPLE = (function () {
    try {
      const ua = navigator.userAgent || "";
      if (/\b(iPad|iPhone|iPod)\b/.test(ua)) return true;
      return /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
    } catch (e) { return false; }
  })();

  // 默认档：手机轻量、桌面高清。
  const DEFAULTS = APPLE
    ? { res: 0.75, fxaa: false, sharpen: 50, msaa: 0, pdb: false, tileMSE: 4, fps: 30, gpuPref: 'default' }
    : { res: -1,  fxaa: true,  sharpen: 40, msaa: 4, pdb: true,  tileMSE: 2, fps: 60, gpuPref: 'high-performance' };

  const PRESETS = {
    smooth:   { label: "流畅", res: 0.6,  fxaa: false, sharpen: 55, tileMSE: 6, fps: 30 },
    balanced: { label: "均衡", res: 1.0,  fxaa: true,  sharpen: 40, tileMSE: 4, fps: 60 },
    clear:    { label: "清晰", res: 1.35, fxaa: true,  sharpen: 25, tileMSE: 3, fps: 60 },
    ultra:    { label: "极致", res: 1.8,  fxaa: true,  sharpen: 15, tileMSE: 2, fps: 60 },
  };

  const st = { viewer: null, cfg: { ...DEFAULTS }, stage: null, ui: {} };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const baseScale = () => {
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    if (APPLE) return Math.min(Math.max(dpr, 1), 1); // 手机不乘满 DPR(3)，否则爆内存
    return Math.min(Math.max(dpr, 1), 2);
  };
  const effRes = (res) => clamp(baseScale() * (res < 0 ? 1 : res), 0.4, 3.0);
  const fxaaStage = (v) => { try { return v.scene.postProcessStages.fxaa; } catch (e) { return null; } };

  /* ── CAS 锐化后处理 ─────────────────────────────────────── */
  function ensureStage() {
    if (st.stage || !st.viewer || !st.viewer.scene) return st.stage;
    try {
      st.stage = new PostProcessStage({
        name: "gevCAS",
        fragmentShader: [
          "uniform sampler2D colorTexture;",
          "in vec2 v_textureCoordinates;",
          "uniform float u_amount;",
          "uniform vec2 u_step;",
          "void main() {",
          "  vec2 t = v_textureCoordinates;",
          "  vec3 c = texture(colorTexture, t).rgb;",
          "  if (u_amount <= 0.001) { out_FragColor = vec4(c, 1.0); return; }",
          "  vec3 n = texture(colorTexture, t + vec2(0.0, u_step.y)).rgb;",
          "  vec3 s = texture(colorTexture, t - vec2(0.0, u_step.y)).rgb;",
          "  vec3 e = texture(colorTexture, t + vec2(u_step.x, 0.0)).rgb;",
          "  vec3 w = texture(colorTexture, t - vec2(u_step.x, 0.0)).rgb;",
          "  vec3 blur = (n + s + e + w) * 0.25;",
          "  vec3 outc = c + (c - blur) * (u_amount * 1.6);",
          "  out_FragColor = vec4(outc, 1.0);",
          "}",
        ].join("\n"),
        uniforms: { u_amount: 0.0, u_step: new Cartesian2(1 / 1280, 1 / 720) },
      });
      st.viewer.scene.postProcessStages.add(st.stage);
    } catch (e) { st.stage = null; }
    return st.stage;
  }

  /* ── 应用所有「运行时可调」项 ──────────────────────────── */
  function apply() {
    const v = st.viewer;
    if (!v || !v.scene) return;
    try { v.resolutionScale = effRes(st.cfg.res); } catch (e) {}
    const f = fxaaStage(v);
    if (f) { try { f.enabled = !!st.cfg.fxaa; } catch (e) {} }
    try { if (v.scene.globe) v.scene.globe.maximumScreenSpaceError = clamp(st.cfg.tileMSE, 1, 12); } catch (e) {}
    try { if (v.targetFrameRate != null) v.targetFrameRate = st.cfg.fps; } catch (e) {}
    const stage = ensureStage();
    if (stage) {
      try {
        stage.uniforms.u_amount = clamp(st.cfg.sharpen, 0, 100) / 100;
        const cv = v.canvas;
        if (cv) stage.uniforms.u_step = new Cartesian2(1 / (cv.width || 1280), 1 / (cv.height || 720));
      } catch (e) {}
    }
    try { v.scene.requestRender(); } catch (e) {}
  }

  function matchPreset() {
    for (const [k, p] of Object.entries(PRESETS)) {
      if (Math.abs(p.res - st.cfg.res) < 0.01 && p.sharpen === st.cfg.sharpen &&
          p.fxaa === st.cfg.fxaa && p.tileMSE === st.cfg.tileMSE && p.fps === st.cfg.fps) return k;
    }
    return "";
  }

  function commit(patch) {
    Object.assign(st.cfg, patch);
    apply();
    syncUi();
    try { localStorage.setItem(LS_KEY, JSON.stringify(st.cfg)); } catch (e) {}
  }

  const reloadHint = () => { try { window.location.reload(); } catch (e) {} };

  /* ── UI ─────────────────────────────────────────────────── */
  const CSS = [
    "#gev-gfx-fab{position:fixed;right:12px;bottom:96px;z-index:2147483646;width:42px;height:42px;border-radius:50%;border:1px solid #2b4a63;background:rgba(8,20,30,.82);color:#bfe9ff;font:20px/1 system-ui;cursor:pointer;backdrop-filter:blur(4px);}",
    "#gev-gfx-fab.active{background:#12506e;border-color:#3fb6e0;color:#eaf9ff;}",
    "#gev-gfx-panel{position:fixed;right:12px;bottom:146px;z-index:2147483647;width:274px;max-width:calc(100vw - 24px);max-height:72vh;overflow:auto;background:rgba(6,16,24,.96);border:1px solid #2b4a63;border-radius:12px;padding:10px 11px;display:none;font:12px system-ui,\"Segoe UI\",sans-serif;color:#cfe9ff;backdrop-filter:blur(6px);}",
    "#gev-gfx-panel.open{display:block;}",
    "#gev-gfx-panel h4{margin:0 0 8px;font:600 13px system-ui;color:#9fe4ff;letter-spacing:.4px;}",
    "#gev-gfx-panel .row{display:flex;align-items:center;gap:6px;padding:3px 0;}",
    "#gev-gfx-panel .lbl{min-width:72px;opacity:.85;}",
    "#gev-gfx-panel .seg{display:flex;gap:4px;flex:1;}",
    "#gev-gfx-panel .seg button{flex:1;background:rgba(12,28,40,.7);border:1px solid #2b4a63;color:#bfe9ff;border-radius:7px;padding:5px 2px;font:12px system-ui;cursor:pointer;}",
    "#gev-gfx-panel .seg button.active{background:#12506e;border-color:#3fb6e0;color:#eaf9ff;}",
    "#gev-gfx-panel .presets{display:flex;gap:4px;flex-wrap:wrap;padding:2px 0 4px;}",
    "#gev-gfx-panel .presets button{flex:1;min-width:56px;background:rgba(12,28,40,.7);border:1px solid #2b4a63;color:#bfe9ff;border-radius:7px;padding:5px 2px;font:12px system-ui;cursor:pointer;}",
    "#gev-gfx-panel .presets button.active{background:#12506e;border-color:#3fb6e0;color:#eaf9ff;}",
    "#gev-gfx-panel input[type=range]{flex:1;}",
    "#gev-gfx-panel .num{width:56px;background:rgba(8,20,30,.6);border:1px solid #2b4a63;color:#bfe9ff;border-radius:6px;padding:3px 5px;font:12px system-ui;text-align:center;}",
    "#gev-gfx-panel .num::-webkit-outer-spin-button,#gev-gfx-panel .num::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}",
    "#gev-gfx-panel .note{opacity:.6;font-size:11px;padding:2px 0 4px;}",
    "#gev-gfx-panel button.reload{width:100%;margin-top:6px;background:#0a3a2a;border:1px solid #1f8f6a;color:#9dffd6;border-radius:8px;padding:7px;font:12px system-ui;cursor:pointer;}",
  ].join("");

  function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  /** 探测当前浏览器实际使用的 WebGL 渲染器（判断是否真走了独显）。 */
  function gpuInfo() {
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2") || c.getContext("webgl");
      if (!gl) return "无 WebGL（可能未启用硬件加速）";
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      const r = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      try { gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch (e) {}
      return String(r || "未知");
    } catch (e) { return "未知"; }
  }

  function buildUi() {
    if (document.getElementById("gev-gfx-panel")) return;
    const style = document.createElement("style"); style.textContent = CSS; document.head.appendChild(style);

    const fab = el("button", null, "⚙"); fab.id = "gev-gfx-fab"; fab.type = "button";
    fab.title = "画面设置";
    document.body.appendChild(fab);

    const p = el("div"); p.id = "gev-gfx-panel";
    p.appendChild(el("h4", null, "⚙ 画面设置"));
    p.appendChild(el("div", "note", "GPU: " + gpuInfo()));
    const mkRow = (lbl) => { const r = el("div", "row"); r.appendChild(el("span", "lbl", lbl)); return r; };

    const pr = el("div", "presets");
    Object.entries(PRESETS).forEach(([k, v]) => {
      const b = el("button", null, v.label); b.dataset.k = k; b.type = "button";
      b.addEventListener("click", () => commit({ res: v.res, fxaa: v.fxaa, sharpen: v.sharpen, tileMSE: v.tileMSE, fps: v.fps }));
      pr.appendChild(b);
    });
    p.appendChild(pr);

    const rRes = mkRow("渲染分辨率");
    const res = el("input"); res.type = "range"; res.min = "0.5"; res.max = "2"; res.step = "0.05";
    const resN = el("input", "num"); resN.type = "number"; resN.min = "0.5"; resN.max = "2"; resN.step = "0.05";
    rRes.appendChild(res); rRes.appendChild(resN); p.appendChild(rRes);

    const rMs = mkRow("抗锯齿 MSAA");
    const msSeg = el("div", "seg");
    [["关", 0], ["2x", 2], ["4x", 4]].forEach(([t, v]) => {
      const b = el("button", null, t); b.dataset.v = String(v); b.type = "button";
      b.addEventListener("click", () => commit({ msaa: v }));
      msSeg.appendChild(b);
    });
    rMs.appendChild(msSeg); p.appendChild(rMs);

    const rFx = mkRow("抗锯齿 FXAA");
    const fxSeg = el("div", "seg");
    [["开", 1], ["关", 0]].forEach(([t, v]) => {
      const b = el("button", null, t); b.dataset.v = String(v); b.type = "button";
      b.addEventListener("click", () => commit({ fxaa: !!v }));
      fxSeg.appendChild(b);
    });
    rFx.appendChild(fxSeg); p.appendChild(rFx);

    const rSh = mkRow("锐化 CAS");
    const sh = el("input"); sh.type = "range"; sh.min = "0"; sh.max = "100"; sh.step = "1";
    const shN = el("input", "num"); shN.type = "number"; shN.min = "0"; shN.max = "100"; shN.step = "1";
    rSh.appendChild(sh); rSh.appendChild(shN); p.appendChild(rSh);

    const rTile = mkRow("瓦片精度");
    const tile = el("input"); tile.type = "range"; tile.min = "1"; tile.max = "8"; tile.step = "1";
    const tileN = el("input", "num"); tileN.type = "number"; tileN.min = "1"; tileN.max = "8"; tileN.step = "1";
    rTile.appendChild(tile); rTile.appendChild(tileN); p.appendChild(rTile);
    p.appendChild(el("div", "note", "越小越清晰，越吃内存/显存"));

    const rFps = mkRow("帧率上限");
    const fpsSeg = el("div", "seg");
    [["30", 30], ["60", 60], ["90", 90], ["不限", 0]].forEach(([t, v]) => {
      const b = el("button", null, t); b.dataset.v = String(v); b.type = "button";
      b.addEventListener("click", () => commit({ fps: v }));
      fpsSeg.appendChild(b);
    });
    rFps.appendChild(fpsSeg); p.appendChild(rFps);

    const rPdb = mkRow("保持帧缓冲");
    const pdbSeg = el("div", "seg");
    [["开", 1], ["关", 0]].forEach(([t, v]) => {
      const b = el("button", null, t); b.dataset.v = String(v); b.type = "button";
      b.addEventListener("click", () => commit({ pdb: !!v }));
      pdbSeg.appendChild(b);
    });
    rPdb.appendChild(pdbSeg); p.appendChild(rPdb);

    // GPU 偏好（创建期选项：重建 WebGL 上下文后生效）
    const rGpu = mkRow("GPU 偏好");
    const gpuSeg = el("div", "seg");
    [["高性能", "high-performance"], ["默认", "default"], ["低功耗", "low-power"]].forEach(([t, v]) => {
      const b = el("button", null, t); b.dataset.v = v; b.type = "button";
      b.addEventListener("click", () => commit({ gpuPref: v }));
      gpuSeg.appendChild(b);
    });
    rGpu.appendChild(gpuSeg); p.appendChild(rGpu);
    p.appendChild(el("div", "note", "MSAA / 保持帧缓冲 / GPU 偏好 改动后需「重载生效」"));

    const rl = el("button", "reload", "重载生效 ↻"); rl.type = "button";
    rl.addEventListener("click", reloadHint);
    p.appendChild(rl);
    document.body.appendChild(p);

    st.ui = { fab, panel: p, res, resN, sh, shN, tile, tileN, msSeg, fxSeg, fpsSeg, pdbSeg, gpuSeg, pr };

    const bindRange = (range, num, key, lo, hi) => {
      const setv = (val) => commit({ [key]: clamp(Number(val), lo, hi) });
      range.addEventListener("input", () => setv(range.value));
      num.addEventListener("input", () => { if (num.value !== "" && num.value !== "-") setv(num.value); });
      num.addEventListener("blur", () => syncUi());
    };
    bindRange(res, resN, "res", 0.5, 2);
    bindRange(sh, shN, "sharpen", 0, 100);
    bindRange(tile, tileN, "tileMSE", 1, 8);

    fab.addEventListener("click", () => { p.classList.toggle("open"); fab.classList.toggle("active", p.classList.contains("open")); });

    // 桌面：在「显示」面板里也放一个入口按钮（找不到就跳过）
    try {
      const body = document.querySelector("#pp-toggles .pp-panel-body") || document.getElementById("pp-toggles");
      if (body && !document.getElementById("gev-gfx-launch")) {
        const grp = el("div", "pp-toggle-group");
        const btn = el("button", "pp-toggle-btn", "⚙ 画面设置"); btn.id = "gev-gfx-launch"; btn.type = "button";
        btn.addEventListener("click", () => { p.classList.add("open"); fab.classList.add("active"); });
        grp.appendChild(btn); body.appendChild(grp);
      }
    } catch (e) {}
  }

  function syncUi() {
    const u = st.ui;
    if (u.res) u.res.value = String(st.cfg.res);
    if (u.resN && document.activeElement !== u.resN) u.resN.value = st.cfg.res < 0 ? "" : String(st.cfg.res);
    if (u.sh) u.sh.value = String(st.cfg.sharpen);
    if (u.shN && document.activeElement !== u.shN) u.shN.value = String(st.cfg.sharpen);
    if (u.tile) u.tile.value = String(st.cfg.tileMSE);
    if (u.tileN && document.activeElement !== u.tileN) u.tileN.value = String(st.cfg.tileMSE);
    const seg = (node, isActive) => { if (node) [...node.children].forEach((b) => b.classList.toggle("active", isActive(b))); };
    seg(u.msSeg, (b) => Number(b.dataset.v) === st.cfg.msaa);
    seg(u.fxSeg, (b) => (Number(b.dataset.v) === 1) === !!st.cfg.fxaa);
    seg(u.fpsSeg, (b) => Number(b.dataset.v) === st.cfg.fps);
    seg(u.pdbSeg, (b) => (Number(b.dataset.v) === 1) === !!st.cfg.pdb);
    seg(u.gpuSeg, (b) => b.dataset.v === st.cfg.gpuPref);
    seg(u.pr, (b) => b.dataset.k === matchPreset());
  }

  function watchdog() {
    const v = st.viewer; if (!v || !v.scene) return;
    try { const want = effRes(st.cfg.res); if (Math.abs((v.resolutionScale || 1) - want) > 0.001) v.resolutionScale = want; } catch (e) {}
    const f = fxaaStage(v);
    if (f) { try { if (f.enabled !== !!st.cfg.fxaa) f.enabled = !!st.cfg.fxaa; } catch (e) {} }
    try { if (v.scene.globe && v.scene.globe.maximumScreenSpaceError !== clamp(st.cfg.tileMSE, 1, 12)) v.scene.globe.maximumScreenSpaceError = clamp(st.cfg.tileMSE, 1, 12); } catch (e) {}
    try { if (v.targetFrameRate != null && v.targetFrameRate !== st.cfg.fps) v.targetFrameRate = st.cfg.fps; } catch (e) {}
  }

  function boot(viewer) {
    st.viewer = viewer;
    try { const s = localStorage.getItem(LS_KEY); if (s) Object.assign(st.cfg, JSON.parse(s)); } catch (e) {}
    buildUi(); apply(); syncUi();
    setInterval(watchdog, 1500);
  }

  let tries = 0;
  const timer = setInterval(() => {
    if (window.__gevViewer && window.__gevViewer.scene) { clearInterval(timer); boot(window.__gevViewer); }
    else if (++tries > 240) clearInterval(timer);
  }, 250);

  window.__gevGFX = { set: commit, get: () => ({ ...st.cfg }), presets: Object.keys(PRESETS), reload: reloadHint };
})();
