/* ═══════════════════════════════════════════════════════════════
   GEV —— 打开即显示航班（非侵入附加功能）
   目的：打开页面时自动开启「实时航班」图层，让带真实三维模型的
         飞机一进来就在地图上飞（模型已按机型上色）。
   实现：引导完成后调用 dataManager.setEnabled('flights', true)。
   回退：删除 index.html 中引用本文件的 <script>，即恢复「图层默认全关」。
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const LAYER = 'flights';
  const R = 6371; // km
  let tries = 0;
  let enabled = false;

  function hav(a1, o1, a2, o2) {
    const p = Math.PI / 180;
    const x =
      Math.sin(((a2 - a1) * p) / 2) ** 2 +
      Math.cos(a1 * p) * Math.cos(a2 * p) * Math.sin(((o2 - o1) * p) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function arm() {
    const dm = window.__godsEyeView && window.__godsEyeView.dataManager;
    const v = window.__gevViewer;

    if (!enabled) {
      if (dm && dm.layers && typeof dm.setEnabled === 'function') {
        try {
          const f = dm.layers.get ? dm.layers.get(LAYER) : dm.layers[LAYER];
          if (f && !f.enabled) dm.setEnabled(LAYER, true, { origin: 'user' });
        } catch (e) {
          /* not ready — retry */
        }
        enabled = true;
      }
    }

    if (enabled && v && dm && dm.layers && dm.layers.get) {
      const m = (dm.layers.get(LAYER) || {}).module;
      const geo = v.camera && v.camera.positionCartographic;
      if (m && typeof m.getAllPositions === 'function' && geo) {
        const list = m.getAllPositions() || [];
        if (list.length) {
          const la = (geo.latitude * 180) / Math.PI;
          const lo = (geo.longitude * 180) / Math.PI;
          let best = null;
          let bd = Infinity;
          for (const p of list) {
            const d = hav(la, lo, p.latitude, p.longitude);
            if (d < bd) {
              bd = d;
              best = p;
            }
          }
          if (best && typeof m.trackById === 'function') {
            try {
              m.trackById(best.id || best.icao24);
            } catch (e) {
              /* ignore */
            }
            return; // done
          }
        }
      }
    }

    if (tries++ < 180) setTimeout(arm, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arm);
  } else {
    arm();
  }
})();
