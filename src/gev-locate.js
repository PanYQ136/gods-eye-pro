/* ═══════════════════════════════════════════════════════════════
   GEV —— 定位当前设备位置（非侵入附加功能）
   由 index.html 以模块加载；删除该 <script> 即完全移除。
   依赖 viewer.js 暴露的 window.__gevViewer。
   点“定位”按钮 → 浏览器定位 → 镜头飞抵本机坐标并落标记。
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const RAD = Math.PI / 180;
  const MARKER_ID = 'gev-device-location';

  const viewer = () => window.__gevViewer;

  function flyTo(lat, lon) {
    const v = viewer();
    if (!v || !v.camera || !v.scene || !v.scene.globe) return false;
    const e = v.scene.globe.ellipsoid;
    const dest = e.cartographicToCartesian({
      longitude: lon * RAD,
      latitude: lat * RAD,
      height: 55000,
    });
    v.camera.flyTo({
      destination: dest,
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      duration: 2.2,
    });
    return true;
  }

  function dropMarker(lat, lon) {
    const v = viewer();
    if (!v || !v.entities || !v.scene || !v.scene.globe) return;
    const e = v.scene.globe.ellipsoid;
    const pos = e.cartographicToCartesian({
      longitude: lon * RAD,
      latitude: lat * RAD,
      height: 0,
    });
    const old = v.entities.getById(MARKER_ID);
    if (old) v.entities.remove(old);
    v.entities.add({
      id: MARKER_ID,
      position: pos,
      point: {
        pixelSize: 14,
        color: '#00d4ff',
        outlineColor: '#ffffff',
        outlineWidth: 2,
      },
      label: {
        text: '我的位置',
        font: '600 14px "Microsoft YaHei", sans-serif',
        fillColor: '#e8fbff',
        showBackground: true,
        backgroundColor: 'rgba(3, 20, 28, 0.72)',
        pixelOffset: { x: 0, y: -24 },
      },
    });
  }

  function toast(msg) {
    let el = document.getElementById('gev-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'gev-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.remove('show'), 4200);
  }

  function setLabel(text) {
    const b = document.getElementById('gev-locate-btn');
    if (b) b.querySelector('.gev-locate-text').textContent = text;
  }

  function locate() {
    if (!navigator.geolocation) {
      toast('本浏览器不支持定位');
      return;
    }
    setLabel('定位中…');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const lat = p.coords.latitude;
        const lon = p.coords.longitude;
        const ok = flyTo(lat, lon);
        dropMarker(lat, lon);
        setLabel('已定位');
        toast(
          (ok ? '已定位：' : '已获取坐标：') +
            lat.toFixed(4) +
            ', ' +
            lon.toFixed(4),
        );
        setTimeout(() => setLabel('定位'), 2600);
      },
      (err) => {
        setLabel('定位');
        const map = {
          1: '定位被拒绝：请在浏览器允许位置权限',
          2: '无法获取位置信息',
          3: '定位超时',
        };
        toast(map[err && err.code] || '定位失败');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  function mount() {
    if (document.getElementById('gev-locate-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'gev-locate-btn';
    btn.type = 'button';
    btn.title = '定位当前设备位置';
    btn.setAttribute('aria-label', '定位当前设备位置');
    btn.innerHTML =
      '<span class="gev-locate-icon" aria-hidden="true">\u2316</span>' +
      '<span class="gev-locate-text">定位</span>';
    btn.addEventListener('click', locate);
    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
