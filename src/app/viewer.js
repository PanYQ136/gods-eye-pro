import * as Cesium from 'cesium';
import { applyModelAtmosphereWorkaround, isAppleMobilePlatform } from './atmosphereCompat.js';

const PINCH_ZOOM_MULTIPLIER = 8;
const MAX_PINCH_PIXEL_DELTA = 120;

function boundedPinchDelta(delta) {
  if (!Number.isFinite(delta) || delta === 0) return delta;
  return (
    Math.sign(delta) *
    Math.min(Math.abs(delta) * PINCH_ZOOM_MULTIPLIER, MAX_PINCH_PIXEL_DELTA)
  );
}

/**
 * Add browser trackpad pinch to Cesium's zoom inputs and return its disposer.
 * Browsers expose this gesture as a small pixel-mode Ctrl+wheel event.
 */
export function installTrackpadPinchZoom(
  viewer,
  { createWheelEvent = (type, init) => new WheelEvent(type, init) } = {},
) {
  const controller = viewer?.scene?.screenSpaceCameraController;
  const container = viewer?.container;
  const canvas = viewer?.canvas;
  if (!controller || !container || !canvas)
    throw new TypeError('A complete Cesium viewer is required');

  const originalZoomEventTypes = controller.zoomEventTypes;
  const zoomEventTypes = Array.isArray(originalZoomEventTypes)
    ? originalZoomEventTypes
    : originalZoomEventTypes === undefined
      ? []
      : [originalZoomEventTypes];
  const alreadyHandlesControlWheel = zoomEventTypes.some(
    (binding) =>
      binding?.eventType === Cesium.CameraEventType.WHEEL &&
      binding?.modifier === Cesium.KeyboardEventModifier.CTRL,
  );
  const configuredZoomEventTypes = alreadyHandlesControlWheel
    ? originalZoomEventTypes
    : [
        ...zoomEventTypes,
        {
          eventType: Cesium.CameraEventType.WHEEL,
          modifier: Cesium.KeyboardEventModifier.CTRL,
        },
      ];
  if (!alreadyHandlesControlWheel)
    controller.zoomEventTypes = configuredZoomEventTypes;

  const relayedEvents = new WeakSet();
  const relayPinch = (event) => {
    if (
      !event.ctrlKey ||
      relayedEvents.has(event) ||
      event.deltaMode !== 0 ||
      !Number.isFinite(event.deltaY) ||
      event.deltaY === 0
    )
      return;
    let relayed;
    try {
      relayed = createWheelEvent('wheel', {
        deltaX: event.deltaX,
        deltaY: boundedPinchDelta(event.deltaY),
        deltaZ: event.deltaZ,
        deltaMode: event.deltaMode,
        screenX: event.screenX,
        screenY: event.screenY,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        view: globalThis.window,
      });
    } catch {
      // The registered Ctrl+wheel binding can still consume the original.
      return;
    }
    relayedEvents.add(relayed);
    event.preventDefault();
    event.stopPropagation();
    canvas.dispatchEvent(relayed);
  };
  container.addEventListener('wheel', relayPinch, {
    capture: true,
    passive: false,
  });

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    container.removeEventListener('wheel', relayPinch, true);
    if (
      !alreadyHandlesControlWheel &&
      controller.zoomEventTypes === configuredZoomEventTypes
    )
      controller.zoomEventTypes = originalZoomEventTypes;
  };
}

/** Create the standard globe viewer in caller-owned, visible containers. */
export function createApplicationViewer({ container, creditContainer }) {
  if (!container || !creditContainer)
    throw new TypeError('Viewer and credit containers are required');
  // GEV: Apple mobile (iOS/iPadOS WebKit) has a tight per-tab WebGL memory
  // budget. 4x MSAA + preserveDrawingBuffer + a HiDPI (DPR2) canvas together
  // exceed it, so Safari/Edge-on-iOS kills and reload-loops the tab (symptom:
  // the view "keeps flashing", entities freeze, assets never accumulate).
  // Use a low-memory profile there; desktop (apple === false) is untouched.
  const apple = isAppleMobilePlatform();
  // GEV 画面设置（gev-graphics.js 写入 localStorage 'gev.gfx'）: 创建期项
  // MSAA / preserveDrawingBuffer / 瓦片精度 / 帧率上限在此读取；由面板「重载生效」。
  let gfx = {};
  try { gfx = JSON.parse(globalThis.localStorage?.getItem('gev.gfx') || '{}') || {}; } catch (e) { gfx = {}; }
  const msaa = (gfx.msaa === 0 || gfx.msaa === 2 || gfx.msaa === 4) ? gfx.msaa : (apple ? 0 : 4);
  const pdb = (typeof gfx.pdb === 'boolean') ? gfx.pdb : !apple;
  const tileMSE = (typeof gfx.tileMSE === 'number') ? gfx.tileMSE : (apple ? 4 : 2);
  const fps = (typeof gfx.fps === 'number') ? gfx.fps : (apple ? 30 : 60);
  const gpuPref = (gfx.gpuPref === 'high-performance' || gfx.gpuPref === 'low-power' || gfx.gpuPref === 'default')
    ? gfx.gpuPref : (apple ? 'default' : 'high-performance');
  const viewer = new Cesium.Viewer(container, {
    timeline: false,
    animation: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    vrButton: false,
    selectionIndicator: false,
    infoBox: false,
    baseLayer: false,
    creditContainer,
    // iOS: no MSAA by default — the biggest single memory cost on a phone GPU.
    msaaSamples: msaa,
    // Honour resolutionScale instead of clamping to 1 CSS px — keeps the
    // canvas crisp on HiDPI (on a 1080p panel this stays at native 1.0).
    useBrowserRecommendedResolution: false,
    // iOS: drop preserveDrawingBuffer (forces a full extra framebuffer copy
    // every frame). Screenshot features degrade; stability wins on mobile.
    // GEV: 强制浏览器优先使用高性能(独显)GPU —— 双显卡本上默认可能落到核显，
    // 表现为"很卡/没调用 GPU"。preserveDrawingBuffer 由画面设置面板控制。
    contextOptions: { webgl: { preserveDrawingBuffer: pdb, powerPreference: gpuPref, failIfMajorPerformanceCaveat: false } },
  });
  try {
    viewer.targetFrameRate = fps;
    // ── GEV 高清增强包 · 1080p 锐利 ─────────────────────────────
    // 按设备像素比满分辨率渲染：1080p(DPR=1)→1.0、Retina(DPR=2)→2.0（封顶 2），
    // 并把地球瓦片屏幕误差收紧到 2 → 地形/贴图/图标更锐、更清。若中端机变卡，
    // 把 resolutionScale 改回 1 或 0.9、maximumScreenSpaceError 调回 3 即可。
    // iOS: keep the drawing buffer small (cap DPR at 1, then 0.75 → a light
    // framebuffer). Desktop keeps the crisp DPR2 render.
    viewer.resolutionScale = apple
      ? Math.min(Math.max(window.devicePixelRatio || 1, 1), 1) * 0.75
      : Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
    viewer.scene.globe.maximumScreenSpaceError = tileMSE;
    window.__gevViewer = viewer;
    // Before any tile builds a draw command: Cesium's per-vertex model
    // atmosphere fails to LINK on Apple's Metal backend and kills the
    // render loop. See app/atmosphereCompat.js.
    applyModelAtmosphereWorkaround(viewer.scene);
    viewer.scene.globe.show = false;
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.skyAtmosphere.atmosphereLightIntensity = 18;
    viewer.scene.skyAtmosphere.saturationShift = -0.12;
    viewer.scene.skyAtmosphere.brightnessShift = -0.08;
    return viewer;
  } catch (error) {
    viewer.destroy();
    throw error;
  }
}
