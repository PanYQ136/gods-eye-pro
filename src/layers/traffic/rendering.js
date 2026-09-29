import * as Cesium from 'cesium';
import { flowBucket } from '../../data/trafficFlowStyle.js';
import { trafficStyleProfile } from '../../data/trafficPresetStyle.js';
import {
  HEAT_LINE_CAP,
  HEAT_JAM_COLOR,
  HEAT_SLOW_COLOR,
  HEAT_LINE_JAM_WIDTH,
  HEAT_JAM_BASE_ALPHA,
  HEAT_LINE_SLOW_WIDTH,
  TRAFFIC_TIMING_ENABLED,
  MAX_DOTS,
  RENDER_LIMIT_UNLIMITED,
} from './policy.js';

export function createRendering({
  state: layerState,
  services,
  parts,
  source,
}) {
  /**
   * At high altitude only major roads render — shared by the render pass and
   * the late-flow heat-line rebuild so lines never mark roads without dots.
   * @param {Array} roads    - Parsed road objects.
   * @param {number} altitude - Camera altitude in meters.
   * @returns {Array} The roads visible at this altitude.
   */

  function visibleRoadsForAltitude(roads, altitude) {
    return altitude > 5000
      ? roads.filter(
          (r) =>
            r.type === 'motorway' || r.type === 'trunk' || r.type === 'primary',
        )
      : roads;
  }

  /**
   * Whether a dot belongs to a road TomTom reports as closed. Such dots are
   * hidden by recolorDotsInPlace; the render-limit pass must respect that and
   * never re-show them (the cap only decides which dots MAY draw).
   * @param {object} dot - Dot state object.
   * @returns {boolean}
   */

  function dotOnClosedRoad(dot) {
    return layerState._liveMode && dot.road?.flow?.closure === true;
  }

  /**
   * Camera position (world coordinates) with the cartographic fallback — the
   * camera always has `positionWC` in the app, but a harness or a pre-frame
   * camera may only carry the cartographic pose.
   * @param {Cesium.Cartesian3} scratch Reusable output for the fallback path.
   * @returns {Cesium.Cartesian3|null}
   */

  function cameraWorldPosition(scratch) {
    const camera = layerState._viewer?.camera;
    if (!camera) return null;
    if (camera.positionWC) return camera.positionWC;
    if (camera.positionCartographic)
      return Cesium.Ellipsoid.WGS84.cartographicToCartesian(
        camera.positionCartographic,
        scratch,
      );
    return null;
  }

  /** Scratch for the render-limit camera read (never escapes this module). */

  const cameraLimitPos = new Cesium.Cartesian3();

  /**
   * 操作员渲染上限 (0–999)：只渲染离相机最近的 N 个车流点。
   *
   * 999 = 不限（默认）—— 该分支只把「被上限藏掉」的点放回来，紧闭路段的点
   * 保持隐藏，未设定上限时是零改动的 no-op。0 = 全部隐藏（车流点没有「选中/
   * 跟踪」个体，故没有豁免对象）。
   *
   * 车流点全部来自当前视区抓取的道路，所以排序对象就是 `_dots` 本身：按相机
   * 距离排序后前 keep 个 `point.show = true`，其余 false。纯本地计算，不联网、
   * 不重新抓取道路/流量。
   */

  function applyRenderLimit() {
    layerState._renderLimitAt = Date.now();
    const dots = layerState._dots;
    if (!Array.isArray(dots) || dots.length === 0) return;
    const limit = layerState._renderLimit;
    if (!Number.isFinite(limit) || limit >= RENDER_LIMIT_UNLIMITED) {
      // 恢复被上限隐藏的点；紧闭路段保持隐藏。
      for (const dot of dots) {
        if (dot.point.show === false && !dotOnClosedRoad(dot))
          dot.point.show = true;
      }
      return;
    }
    const keep = Math.max(0, Math.floor(limit));
    const cameraPos = cameraWorldPosition(cameraLimitPos);
    // admitted === null → 无法排名（尚未 init / 没有相机），此时不裁剪；
    // keep === 0 → 空集合，全部隐藏（无需相机）。
    let admitted = keep === 0 ? new Set() : null;
    if (keep > 0 && cameraPos) {
      const ranked = [];
      for (let i = 0; i < dots.length; i += 1) {
        const at = dots[i].point.position;
        if (!at) continue;
        ranked.push([Cesium.Cartesian3.distanceSquared(cameraPos, at), i]);
      }
      ranked.sort((a, b) => a[0] - b[0]);
      admitted = new Set();
      const take = Math.min(keep, ranked.length);
      for (let i = 0; i < take; i += 1) admitted.add(ranked[i][1]);
    }
    if (admitted === null) return;
    for (let i = 0; i < dots.length; i += 1) {
      const dot = dots[i];
      dot.point.show = admitted.has(i) && !dotOnClosedRoad(dot);
    }
  }

  /** Remove both heat-line ground primitives from the scene. */

  function removeHeatLines() {
    if (layerState._heatJamPrim) {
      layerState._viewer?.scene.groundPrimitives.remove(
        layerState._heatJamPrim,
      );
      layerState._heatJamPrim = null;
    }
    if (layerState._heatSlowPrim) {
      layerState._viewer?.scene.groundPrimitives.remove(
        layerState._heatSlowPrim,
      );
      layerState._heatSlowPrim = null;
    }
    layerState._heatLineCount = 0;
  }

  /**
   * Rebuild the congestion heat-line underlay (jam-viz heatline prototype):
   * slow/jam roads drape a corridor line onto the rendered 3D tiles — glowing
   * pulsing red for jam, faint flat amber for slow — with the dots animating
   * on top. Two batched GroundPolylinePrimitives (one per bucket) so the jam
   * batch pulses through one shared material. Capped at HEAT_LINE_CAP (jam
   * first, longest first); overflow is logged. No-op in sim mode, when the
   * heatline mode is off, or without ground-primitive support.
   *
   * @param {Array} roads - Road objects visible in the current render.
   */

  function rebuildHeatLines(roads) {
    removeHeatLines();
    if (
      !layerState._viewer ||
      !layerState._liveMode ||
      !parts.style.heatlineOn()
    )
      return;
    if (layerState._heatSupported === null) {
      layerState._heatSupported = Cesium.GroundPolylinePrimitive.isSupported(
        layerState._viewer.scene,
      );
      if (!layerState._heatSupported)
        console.warn(
          '[Data:Traffic] GroundPolylinePrimitive unsupported — heat-lines disabled',
        );
    }
    if (!layerState._heatSupported) return;

    const candidates = [];
    for (const road of roads) {
      const flow = road.flow;
      if (!flow || flow.closure) continue;
      const bucket = flowBucket(flow.level);
      if (bucket === 'free') continue;
      let len = 0;
      for (const d of road.segmentDist) len += d;
      candidates.push({ road, bucket, len });
    }
    candidates.sort((a, b) =>
      a.bucket === b.bucket ? b.len - a.len : a.bucket === 'jam' ? -1 : 1,
    );
    const kept = candidates.slice(0, HEAT_LINE_CAP);

    const instancesFor = (bucket, width) =>
      kept
        .filter((c) => c.bucket === bucket)
        .map(
          (c) =>
            new Cesium.GeometryInstance({
              geometry: new Cesium.GroundPolylineGeometry({
                positions: c.road.waypoints,
                width,
              }),
            }),
        );

    // Mono presets (NVG/FLIR/noir) discard hue — heat-lines re-encode in
    // luminance like the dots: jam = white glow, slow = faint gray.
    const monoHeat =
      layerState._presetDots === 'on' &&
      trafficStyleProfile(layerState._stylePreset) === 'mono';
    const jamLineColor = monoHeat ? Cesium.Color.WHITE : HEAT_JAM_COLOR;
    const slowLineColor = monoHeat
      ? new Cesium.Color(0.7, 0.7, 0.7, HEAT_SLOW_COLOR.alpha)
      : HEAT_SLOW_COLOR;

    const jamInstances = instancesFor('jam', HEAT_LINE_JAM_WIDTH);
    if (jamInstances.length) {
      layerState._heatJamPrim = layerState._viewer.scene.groundPrimitives.add(
        new Cesium.GroundPolylinePrimitive({
          geometryInstances: jamInstances,
          classificationType: Cesium.ClassificationType.CESIUM_3D_TILE,
          appearance: new Cesium.PolylineMaterialAppearance({
            material: Cesium.Material.fromType('PolylineGlow', {
              color: jamLineColor.withAlpha(HEAT_JAM_BASE_ALPHA),
              glowPower: 0.25,
            }),
          }),
        }),
      );
    }
    const slowInstances = instancesFor('slow', HEAT_LINE_SLOW_WIDTH);
    if (slowInstances.length) {
      layerState._heatSlowPrim = layerState._viewer.scene.groundPrimitives.add(
        new Cesium.GroundPolylinePrimitive({
          geometryInstances: slowInstances,
          classificationType: Cesium.ClassificationType.CESIUM_3D_TILE,
          appearance: new Cesium.PolylineMaterialAppearance({
            material: Cesium.Material.fromType('Color', {
              color: slowLineColor,
            }),
          }),
        }),
      );
    }

    layerState._heatLineCount = kept.length;
    if (candidates.length > kept.length) {
      console.log(
        `[Data:Traffic] Heat-lines capped at ${HEAT_LINE_CAP} (${candidates.length} congested roads in view)`,
      );
    }
  }

  /**
   * Clear existing dots and re-spawn them for the given road set and altitude.
   *
   * When zoomed out (>5 km), only major road types are rendered to reduce clutter.
   * Dot budgets are allocated fairly across visible roads via `allocateRoadDotBudgets`.
   *
   * @param {Array} roads    - Parsed road objects to render.
   * @param {number} altitude - Camera altitude in meters.
   * @param {string} label    - Logging label (e.g. "Cache full", "Loaded major").
   * @param {Object|null} [trace=null] - Development-only correlated load trace.
   */

  function renderRoadsForAltitude(roads, altitude, label, trace = null) {
    const state =
      TRAFFIC_TIMING_ENABLED && trace
        ? parts.timing.trafficTimingRenderState(trace, label)
        : null;
    const renderId = state ? ++trace.renderSequence : null;
    parts.animation.clearDots();
    layerState._roads = roads;
    layerState._lastRenderAltitude = altitude;

    // At high altitude, drop minor roads to reduce visual noise
    const filteredRoads = visibleRoadsForAltitude(roads, altitude);

    // Closed roads spawn zero dots (computeDotCount/spawnDotsForRoad) — count
    // them here so the closure signal is visible in stats even at zero dots.
    layerState._closedRoads = layerState._liveMode
      ? filteredRoads.reduce((n, r) => n + (r.flow?.closure ? 1 : 0), 0)
      : 0;

    // Fade distances must track the camera-to-AREA distance, not assume a
    // nadir view: oblique pitches put the loaded roads many km away even at
    // low altitude. Probe three roads and stretch the curves accordingly.
    let areaDist = altitude;
    if (layerState._viewer && filteredRoads.length) {
      const probes = [
        filteredRoads[0],
        filteredRoads[Math.floor(filteredRoads.length / 2)],
        filteredRoads[filteredRoads.length - 1],
      ];
      for (const probe of probes) {
        const wp = probe?.waypoints?.[0];
        if (wp)
          areaDist = Math.max(
            areaDist,
            Cesium.Cartesian3.distance(
              layerState._viewer.camera.positionWC,
              wp,
            ),
          );
      }
    }
    layerState._fadeScaleFar = Math.max(8000, areaDist * 1.5);
    layerState._fadeTransFar = Math.max(10000, areaDist * 1.8);

    const dotStart = state
      ? parts.timing.trafficTimingMark(state, 'dot-construction-start', {
          renderId,
          renderLabel: label,
          roadCount: roads.length,
          visibleRoadCount: filteredRoads.length,
        })
      : null;
    const roadBudgets = parts.model.allocateRoadDotBudgets(
      filteredRoads,
      altitude,
      MAX_DOTS,
    );
    for (let i = 0; i < filteredRoads.length; i++) {
      const road = filteredRoads[i];
      const budget = roadBudgets[i] || 0;
      if (budget <= 0) continue;
      parts.animation.spawnDotsForRoad(road, altitude, budget);
      if (layerState._dots.length >= MAX_DOTS) break;
    }

    const renderMetrics = state
      ? {
          renderId,
          renderLabel: label,
          roadCount: roads.length,
          visibleRoadCount: filteredRoads.length,
          dotCount: layerState._dots.length,
        }
      : null;
    if (state) {
      const dotEnd = parts.timing.trafficTimingMark(
        state,
        'dot-construction-end',
        renderMetrics,
      );
      parts.timing.trafficTimingMeasure(
        'dot-construction',
        state,
        dotStart,
        dotEnd,
        renderMetrics,
      );
    }

    const heatStart = state
      ? parts.timing.trafficTimingMark(
          state,
          'rebuild-heat-lines-start',
          renderMetrics,
        )
      : null;
    rebuildHeatLines(filteredRoads);
    if (state) {
      const heatEnd = parts.timing.trafficTimingMark(
        state,
        'rebuild-heat-lines-end',
        {
          ...renderMetrics,
          heatLineCount: layerState._heatLineCount,
        },
      );
      parts.timing.trafficTimingMeasure(
        'rebuild-heat-lines',
        state,
        heatStart,
        heatEnd,
        {
          ...renderMetrics,
          heatLineCount: layerState._heatLineCount,
        },
      );
    }

    layerState._count = layerState._dots.length;
    layerState._lastUpdate = Date.now();
    // 新生的点默认 `show = true`，所以渲染上限必须在这里落到这批新点上 ——
    // 否则一次相机驱动的重载就会让用户设定的上限悄无声息地失效。
    applyRenderLimit();
    console.log(
      `[Data:Traffic] ${label}: ${layerState._count} dots (roads=${roads.length}, alt=${Math.round(altitude)}m)`,
    );
    if (state) {
      const renderEnd = parts.timing.trafficTimingMark(
        state,
        'render-return',
        renderMetrics,
      );
      parts.timing.scheduleTrafficTimingPostRender(
        state,
        renderEnd,
        renderId,
        renderMetrics,
      );
    }
  }
  return {
    visibleRoadsForAltitude,
    removeHeatLines,
    rebuildHeatLines,
    renderRoadsForAltitude,
    applyRenderLimit,
  };
}
