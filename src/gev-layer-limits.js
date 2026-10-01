/**
 * gev-layer-limits — 非侵入式「图层渲染上限」控件。
 *
 * 在「数据图层」面板里，为支持渲染上限的移动目标图层（当前：实时航班）
 * 注入一行控件：一个滑动条(0–999) + 一个可编辑数值框，二者同步。
 * 调整后调用 `dataManager.setLayerParams(id, { renderLimit: N }, { origin:'user' })`，
 * 该值让图层只保留离相机最近的 N 个目标（0 = 不渲染非跟踪目标）。
 *
 * 零侵入：本文件独立，不改动主应用源码；index.html 追加一行引用即可。
 * 删除该文件与那一行引用即完全还原（图层回到默认 999 ≈ 不限）。任何异常都被吞掉。
 */
(function () {
  if (window.__gevLayerLimits) return;

  /**
   * 候选图层（顺序即注入顺序）。只有在该图层模块的 getParams() 真的返回
   * 有限 renderLimit 时才注入控件 —— 未实现该参数的图层不会冒出死控件。
   * unit = 量词；label = 无障碍标签用的图层名。
   */
  const LAYERS = [
    { id: 'flights', label: '实时航班', unit: '架' },
    { id: 'military', label: '军用航空', unit: '架' },
    { id: 'ais-live-vessels', label: '舰船', unit: '艘' },
    { id: 'satellites', label: '卫星', unit: '颗' },
    { id: 'transit', label: '公共交通', unit: '辆' },
    { id: 'traffic', label: '车流', unit: '辆' },
    { id: 'bikeshare', label: '共享单车', unit: '站' },
    { id: 'local-adsb', label: '本地ADS-B', unit: '架' },
  ];
  const STORE_KEY = 'gev.layerLimit.'; // + layerId
  const MIN = 0;
  const MAX = 8000;

  const STYLE = `
  .gev-limit{
    display:flex; align-items:center; gap:6px; margin:6px 0 2px;
    padding:5px 7px; border-radius:7px;
    background:rgba(57,208,255,.06); border:1px solid rgba(57,208,255,.18);
    font-size:10.5px; color:#bfe9ff; font-family:inherit;
  }
  .gev-limit .gl-label{ flex:0 0 auto; letter-spacing:.5px; color:#8fd6f5; }
  .gev-limit input[type=range]{
    flex:1 1 auto; min-width:60px; height:14px; margin:0; cursor:pointer;
    -webkit-appearance:none; appearance:none; background:transparent;
  }
  .gev-limit input[type=range]::-webkit-slider-runnable-track{
    height:3px; border-radius:2px; background:linear-gradient(90deg,#39d0ff,#2a6f8f);
  }
  .gev-limit input[type=range]::-webkit-slider-thumb{
    -webkit-appearance:none; appearance:none; width:12px; height:12px; margin-top:-4.5px;
    border-radius:50%; background:#eafbff; border:1px solid #39d0ff;
    box-shadow:0 0 6px rgba(57,208,255,.8); cursor:pointer;
  }
  .gev-limit input[type=range]::-moz-range-track{
    height:3px; border-radius:2px; background:#2a6f8f;
  }
  .gev-limit input[type=range]::-moz-range-thumb{
    width:12px; height:12px; border-radius:50%; background:#eafbff;
    border:1px solid #39d0ff; box-shadow:0 0 6px rgba(57,208,255,.8); cursor:pointer;
  }
  .gev-limit input[type=number]{
    flex:0 0 auto; width:52px; text-align:right; padding:2px 5px;
    background:rgba(3,14,20,.85); color:#eafbff; font-family:inherit; font-size:11px;
    border:1px solid rgba(57,208,255,.35); border-radius:5px; outline:none;
    font-variant-numeric:tabular-nums;
  }
  .gev-limit input[type=number]:focus{ border-color:#39d0ff; box-shadow:0 0 6px rgba(57,208,255,.4); }
  .gev-limit .gl-unit{ flex:0 0 auto; color:#7fb8d4; }
  `;

  function ensureStyle() {
    if (document.getElementById('gev-limit-style')) return;
    const s = document.createElement('style');
    s.id = 'gev-limit-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  const clamp = (v) => Math.max(MIN, Math.min(MAX, Math.floor(Number(v) || 0)));

  function dataManager() {
    return window.__godsEyeView && window.__godsEyeView.dataManager;
  }
  function moduleOf(id) {
    try {
      const dm = dataManager();
      return (
        dm &&
        dm.layers &&
        dm.layers.get &&
        dm.layers.get(id) &&
        dm.layers.get(id).module
      );
    } catch {
      return null;
    }
  }
  /** 仅当图层模块的 getParams() 真暴露有限 renderLimit 时才认为它支持本控件。 */
  function supportsLimit(id) {
    try {
      const m = moduleOf(id);
      const p = m && m.getParams && m.getParams();
      return !!(p && Number.isFinite(p.renderLimit));
    } catch {
      return false;
    }
  }
  function currentLimit(id) {
    try {
      const m = moduleOf(id);
      const p = m && m.getParams && m.getParams();
      return p && Number.isFinite(p.renderLimit) ? p.renderLimit : MAX;
    } catch {
      return MAX;
    }
  }
  function setLimit(id, n) {
    try {
      const dm = dataManager();
      dm &&
        dm.setLayerParams &&
        dm.setLayerParams(id, { renderLimit: n }, { origin: 'user' });
    } catch {
      /* ignore */
    }
  }
  function storedLimit(id) {
    try {
      const v = localStorage.getItem(STORE_KEY + id);
      return v == null ? null : clamp(v);
    } catch {
      return null;
    }
  }
  function saveLimit(id, n) {
    try {
      localStorage.setItem(STORE_KEY + id, String(n));
    } catch {
      /* ignore */
    }
  }

  function buildControl(cfg, initial) {
    const wrap = document.createElement('div');
    wrap.className = 'gev-limit';
    wrap.id = 'gev-limit-' + cfg.id;

    const label = document.createElement('span');
    label.className = 'gl-label';
    label.textContent = '渲染上限';

    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(MIN);
    range.max = String(MAX);
    range.value = String(initial);
    range.setAttribute('aria-label', cfg.label + ' 渲染上限（0–8000）');

    const num = document.createElement('input');
    num.type = 'number';
    num.min = String(MIN);
    num.max = String(MAX);
    num.step = '1';
    num.value = String(initial);
    num.setAttribute('aria-label', cfg.label + ' 渲染上限数值');

    const unit = document.createElement('span');
    unit.className = 'gl-unit';
    unit.textContent = cfg.unit || '';

    // 同步 + 下发
    let timer = null;
    const apply = (raw, fromInput) => {
      const n = clamp(raw);
      range.value = String(n);
      if (num.value !== String(n)) num.value = String(n);
      setLimit(cfg.id, n);
      saveLimit(cfg.id, n);
      if (fromInput === 'num') {
        /* keep focus */
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const live = currentLimit(cfg.id);
        if (live !== n) setLimit(cfg.id, n);
      }, 400);
    };

    range.addEventListener('input', () => apply(range.value, 'range'));
    num.addEventListener('input', () => {
      if (num.value !== '' && num.value !== '-') apply(num.value, 'num');
    });
    num.addEventListener('change', () => apply(num.value, 'num'));
    num.addEventListener('blur', () => apply(num.value, 'num'));

    // 阻止面板把点击/拖动当成行操作
    wrap.addEventListener('pointerdown', (e) => e.stopPropagation());
    wrap.addEventListener('click', (e) => e.stopPropagation());

    wrap.append(label, range, num, unit);
    return wrap;
  }

  function injectAll() {
    ensureStyle();
    const container = document.getElementById('data-toggles');
    if (!container) return;
    for (const cfg of LAYERS) {
      const row = container.querySelector('[data-layer-id="' + cfg.id + '"]');
      if (!row) continue;
      if (!supportsLimit(cfg.id)) continue; // 该图层未实现 renderLimit → 不注入
      if (row.querySelector('#gev-limit-' + cfg.id)) continue; // already present
      const initial = storedLimit(cfg.id) ?? currentLimit(cfg.id);
      const ctrl = buildControl(cfg, initial);
      // 插在行标题下的 meta 之后、子控件之前
      const meta = row.querySelector('.data-toggle-meta');
      if (meta && meta.nextSibling) row.insertBefore(ctrl, meta.nextSibling);
      else row.appendChild(ctrl);
      if (storedLimit(cfg.id) != null) setLimit(cfg.id, initial);
    }
  }

  // 面板重建会移除注入节点 → 观察并补注入。
  function startObserver() {
    const attach = () => {
      const container = document.getElementById('data-toggles');
      if (!container) return false;
      injectAll();
      const mo = new MutationObserver(() => injectAll());
      mo.observe(container, { childList: true, subtree: true });
      if (window.__gevLayerLimits) window.__gevLayerLimits._mo = mo;
      return true;
    };
    if (attach()) return;
    let tries = 0;
    const t = setInterval(() => {
      tries += 1;
      if (attach() || tries > 300) clearInterval(t);
    }, 500);
  }

  // 轻量自愈：图层被关开重置后，把用户设定重新下发。
  function startSelfHeal() {
    setInterval(() => {
      for (const cfg of LAYERS) {
        if (!supportsLimit(cfg.id)) continue;
        const want = storedLimit(cfg.id);
        if (want == null) continue;
        if (currentLimit(cfg.id) !== want) setLimit(cfg.id, want);
      }
    }, 3000);
  }

  window.__gevLayerLimits = {
    inject: injectAll,
    set: (id, n) => {
      saveLimit(id, clamp(n));
      setLimit(id, clamp(n));
      injectAll();
    },
    _layers: LAYERS,
  };

  startObserver();
  startSelfHeal();
})();
