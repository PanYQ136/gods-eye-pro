import * as Cesium from 'cesium';
import { gstime } from 'satellite.js';
import {
  ISS_NORAD,
  POSITION_UPDATE_MS,
  RING_ROTATION_MS,
  RENDER_CAP_DENSE_INTERVAL_MS,
  RENDER_CAP_DENSE_SIZE,
  RENDER_CAP_INTERVAL_MS,
  RENDER_LIMIT_UNLIMITED,
} from './policy.js';

export function createRendering({
  state: layerState,
  services,
  parts,
  source,
}) {
  const {
    focusNowMs,
    getFocusTarget,
    focusPassIsNeeded,
    nearFarScalarValueAtDistance,
    advanceSpriteFocus,
    focusAlphaNeedsWrite,
  } = services.focus;

  /**
   * Show orbital path for a satellite.
   *
   * RING FLICKER FIX: this is a one-instance Cesium.Primitive built
   * synchronously ONCE (asynchronous: false), then re-aligned to current GMST
   * each tick via its modelMatrix. The previous Entity-polyline approach
   * rebuilt geometry ASYNCHRONOUSLY on every positions assignment, which made
   * both the selected ring and the ISS ring blink once per second while the
   * rebuild was in flight. A rigid Z-rotation needs no rebuild at all.
   *
   * Why not a CallbackProperty entity (dynamic mode)? Verified in Cesium
   * 1.138 source: the dynamic polyline updater renders through a shared
   * PolylineCollection and applies only the fill material —
   * `depthFailMaterial` is silently dropped, losing the dimmed behind-Earth
   * segment. The Primitive keeps it via depthFailAppearance + the per-instance
   * depthFailColor attribute (same mechanism the entity STATIC batch uses):
   * bright where above the horizon, dimmed where behind the globe.
   */

  function _showOrbitPath(noradId, color) {
    if (layerState._orbitPaths.has(noradId)) return; // already showing

    const sat = layerState._catalog.get(noradId);
    if (!sat || !layerState._viewer) return;

    const bakeDate = new Date();
    const basePositions = parts.orbits.computeOrbitPath(sat.satrec, bakeDate);
    if (basePositions.length < 2) return;

    const pathColor = color || Cesium.Color.CYAN;

    const primitive = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry: new Cesium.PolylineGeometry({
          positions: basePositions,
          width: noradId === ISS_NORAD ? 2.5 : 2.0,
          vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
        }),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(
            pathColor.withAlpha(0.6),
          ),
          depthFailColor: Cesium.ColorGeometryInstanceAttribute.fromColor(
            pathColor.withAlpha(0.35),
          ),
        },
      }),
      appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
      depthFailAppearance: new Cesium.PolylineColorAppearance({
        translucent: true,
      }),
      asynchronous: false, // build this frame — no async-rebuild blink window
      allowPicking: false, // ring clicks fall through to satellites/deselect
    });
    layerState._viewer.scene.primitives.add(primitive);

    layerState._orbitPaths.set(noradId, {
      primitive,
      // Same Date object as computeOrbitPath's internal fixedGmst → identical
      // GMST value (gstime is pure), so delta starts at exactly 0 and the
      // initial identity modelMatrix is correct until the first ring tick.
      gmstAtBake: gstime(bakeDate),
    });
  }

  /**
   * Rotate every baked orbit ring from its bake-time ECEF snapshot to current
   * GMST (WS-D1). The baked ring is an inertial-frame snapshot frozen at
   * gmstAtBake; the live dot lives in true rotating-frame ECEF, so without this
   * the dot slides west off the ring at Earth-rotation rate (~0.25°/min).
   *
   * Sign derivation: a point fixed in inertial space keeps its right ascension
   * α, so its ECEF longitude λ = α − gmst DECREASES by ΔGMST as time advances
   * (it drifts WEST). Cesium.Matrix3.fromRotationZ(θ) rotates +X toward +Y,
   * i.e. INCREASES longitude by θ — so we rotate the baked points by −ΔGMST.
   * Mental check: ISS baked over Austin at t0; 10 min later Austin has rotated
   * east under the (inertial) ring, so the ring must sit further WEST in ECEF.
   *
   * Wraparound: gstime returns radians in [0, 2π), so the raw difference can be
   * off from the continuous ΔGMST — but only by exact multiples of 2π, which a
   * rotation cannot distinguish. Tiny negative deltas right after bake are
   * likewise harmless. No unwrapping needed.
   *
   * No SGP4 here — the rotation is applied as the ring primitive's modelMatrix
   * (exact compensation; WGS84 is rotationally symmetric about Z, so rotating
   * the baked curve rigidly equals rebaking from rotated points). modelMatrix
   * updates are synchronous uniforms — no geometry rebuild, no flicker. Post-
   * creation modelMatrix changes are supported for one-instance primitives in
   * 3D mode, which these rings are. In-place mutation is safe: Primitive.update
   * diffs modelMatrix against an internal clone.
   * @param {Date} nowDate Epoch used for current GMST.
   */

  function _updateOrbitPathRotations(nowDate) {
    if (layerState._orbitPaths.size === 0) return;

    for (const path of layerState._orbitPaths.values()) {
      if (!path.primitive) continue;
      parts.orbits.orbitFrameModelMatrix(
        path.gmstAtBake,
        nowDate,
        path.primitive.modelMatrix,
      );
    }
  }

  /**
   * Remove orbital path for a satellite.
   */

  function _hideOrbitPath(noradId) {
    const path = layerState._orbitPaths.get(noradId);
    if (path) {
      if (layerState._viewer)
        layerState._viewer.scene.primitives.remove(path.primitive); // remove() destroys
      layerState._orbitPaths.delete(noradId);
    }
  }

  /**
   * Propagate all CORE satellite positions and update point primitives.
   * (~840 sats ≈ 1.6 ms/pass — fine at the 1s/200ms cadence.) Dense extras are
   * excluded: they refresh on the round-robin budget in _propagateDenseChunk.
   */

  function _propagateAll() {
    const now = new Date();
    let updated = 0;

    for (const [noradId, sat] of layerState._catalog) {
      if (sat.group === 'dense') continue;
      const pos = parts.orbits.propagatePosition(sat.satrec, now);
      if (!pos) continue;

      const cartesian = Cesium.Cartesian3.fromDegrees(
        pos.longitude,
        pos.latitude,
        pos.altitude,
      );
      const point = layerState._points.get(noradId);
      if (point) {
        point.position = cartesian;
        updated++;
      }
    }

    return updated;
  }

  /**
   * 操作员渲染上限 (renderLimit, 0–999) — flights/military parity.
   *
   * Unlike flights, this catalog is NOT viewport-clipped: every satellite on the
   * planet is a point in one collection, so "only the nearest N" has to be
   * computed here. Each pass ranks every point by its squared distance to the
   * camera and hides the ones outside the nearest N through
   * `PointPrimitive.show` — the same switch the track path already uses, so the
   * two writers can never fight: `show === false` means EITHER "tracked" (the
   * tracked entity draws that dot) OR "outside the cap", and one of them always
   * re-asserts on the next pass.
   *
   * The tracked satellite is exempt in BOTH directions — never hidden by the cap
   * (it must survive renderLimit 0) and never force-shown (it stays hidden while
   * its entity owns the visual).
   *
   * 999 (RENDER_LIMIT_UNLIMITED) and any limit at or above the point count bypass
   * the ranking entirely — that is what leaves the default view, and the whole
   * dense Starlink shell, byte-for-byte unchanged.
   *
   * Cost: one squared distance per point + a sort, run on a cadence
   * (RENDER_CAP_INTERVAL_MS, or the slower dense cadence for 10K+ catalogs).
   * Steady state writes nothing: a point's flag only changes when it enters or
   * leaves the nearest set.
   * @param {{force?: boolean, nowMs?: number}} [options] `force` bypasses the
   *   cadence — used by setParams so a slider write lands this frame.
   * @returns {boolean} Whether a pass actually ran.
   */

  function _applyRenderCap({ force = false, nowMs = Date.now() } = {}) {
    const points = layerState._points;
    const camera = layerState._viewer?.camera;
    if (!points || points.size === 0) return false;
    // Nothing to rank against while the dots are switched off wholesale (the
    // same gate _preRenderTick uses for hidden propagation), or in a viewer
    // stand-in that carries no camera (test seams). The next pass corrects.
    if (!layerState._params.showPoints || !camera?.positionWC) return false;

    const interval =
      points.size > RENDER_CAP_DENSE_SIZE
        ? RENDER_CAP_DENSE_INTERVAL_MS
        : RENDER_CAP_INTERVAL_MS;
    if (!force && nowMs - layerState._renderCapLastMs < interval) return false;
    layerState._renderCapLastMs = nowMs;

    const requested = Number.isFinite(layerState._renderLimit)
      ? Math.max(0, Math.floor(layerState._renderLimit))
      : RENDER_LIMIT_UNLIMITED;
    const tracked = layerState._trackedNorad;

    let allowed = null;
    if (requested < RENDER_LIMIT_UNLIMITED && requested < points.size) {
      const ranked = [];
      for (const [noradId, point] of points) {
        if (!point?.position) continue;
        ranked.push([
          Cesium.Cartesian3.distanceSquared(camera.positionWC, point.position),
          noradId,
        ]);
      }
      // Ties resolve by catalog order, so the set is stable frame to frame for
      // a stationary camera (no flicker at the cutoff).
      ranked.sort((a, b) => a[0] - b[0]);
      allowed = new Set();
      for (let i = 0; i < ranked.length && i < requested; i += 1)
        allowed.add(ranked[i][1]);
      // Exempt, and NOT charged against the budget — same as flights.
      if (tracked !== null) allowed.add(tracked);
    }
    layerState._renderCapAllowed = allowed;

    for (const [noradId, point] of points) {
      if (!point || noradId === tracked) continue;
      const visible = allowed ? allowed.has(noradId) : true;
      // Write only on an actual change: a steady state costs zero vertex-buffer
      // updates, which is what keeps this pass free at 4 Hz.
      if (point.show !== visible) point.show = visible;
    }

    // The ISS callout is a world-overlay label, not a point primitive: without
    // this gate it would keep floating over empty sky once the cap hides the dot.
    const issAllowed = !allowed || allowed.has(ISS_NORAD);
    if (issAllowed !== layerState._renderCapIssAllowed) {
      layerState._renderCapIssAllowed = issAllowed;
      parts.labels._syncIssOverlay();
    }
    return true;
  }

  /** Whether the active render cap keeps this satellite's dot on screen. */

  function _pointAllowedByRenderCap(noradId) {
    const allowed = layerState._renderCapAllowed;
    return !allowed || allowed.has(noradId);
  }

  /**
   * Shared scene.preRender tick (single definition for init + enable):
   * - core fleet propagation at 200ms-tracked / 1s-idle cadence,
   * - dense extras on a per-frame round-robin budget,
   * - tracked satellite's point primitive per frame (WS-D2),
   * - orbit ring GMST re-alignment every ~1s (WS-D1).
   */

  function _preRenderTick() {
    if (!layerState._enabled) return;
    const now = focusNowMs(Date.now());

    const interval = layerState._trackedNorad ? 200 : POSITION_UPDATE_MS;
    // Space Missions keeps this layer enabled for TLE lookup while deliberately
    // hiding its standalone fleet. Do not rebuild hidden point buffers on the
    // one-second propagation cadence: that GPU upload presented as a periodic
    // whole-globe pulse even though the camera remained stationary.
    if (
      layerState._params.showPoints &&
      now - layerState._lastPropagation >= interval
    ) {
      _propagateAll();
      layerState._lastPropagation = now;
    }

    if (layerState._params.showPoints) parts.catalog._propagateDenseChunk();

    // Keep the tracked dot on the per-frame epoch shared with label + camera —
    // runs after _propagateAll so the per-frame sample wins over the 200ms one.
    if (layerState._trackedNorad !== null) {
      const pos = parts.tracking._getTrackedFramePosition();
      const point = layerState._points.get(layerState._trackedNorad);
      if (pos && point) {
        point.position = layerState._trackedFrameCartesian; // primitive setter clones
      }
    }

    // 操作员渲染上限 (renderLimit)：位置刚更新过，按当前相机重排「最近 N 颗」。
    _applyRenderCap({ nowMs: now });

    _updatePointFocus(now);

    // Hidden standalone orbit primitives do not need GMST matrix writes while
    // Space Missions draws the selected mission orbit itself.
    if (
      layerState._params.showOrbits &&
      now - layerState._lastRingRotation >= RING_ROTATION_MS
    ) {
      _updateOrbitPathRotations(new Date(now));
      layerState._lastRingRotation = now;
    }
  }

  /** Focus alpha for satellite points, inside the existing shared preRender tick. */

  function _updatePointFocus(nowMs) {
    const target = getFocusTarget();
    if (
      !layerState._params.showPoints ||
      !focusPassIsNeeded(target, layerState._activeFocusCount)
    )
      return;
    if (nowMs - layerState._lastFocusUpdate < 80) return;
    layerState._lastFocusUpdate = nowMs;
    const scene = layerState._viewer.scene;
    const camera = layerState._viewer.camera;
    const result = applySatellitePointFocusDeemphasis({
      points: layerState._points,
      trackedId: layerState._trackedNorad,
      target,
      previousActiveCount: layerState._activeFocusCount,
      nowMs,
      screenPositionFor: (position) =>
        Cesium.SceneTransforms.worldToWindowCoordinates(
          scene,
          position,
          layerState._scratchFocusScreen,
        ),
      cameraDistanceFor: (position) =>
        Cesium.Cartesian3.distance(camera.positionWC, position),
      baseColorFor: (noradId) =>
        parts.controls._pointStyleFor(
          noradId,
          layerState._catalog.get(noradId)?.group,
        ).color,
    });
    layerState._activeFocusCount = result.activeCount;
  }

  /**
   * Apply the gated satellite-point focus pass through the production color path.
   * @param {object} input
   * @returns {{writes:number,transitioning:boolean,activeCount:number,ran:boolean}}
   */

  function applySatellitePointFocusDeemphasis({
    points,
    trackedId,
    target,
    previousActiveCount = 0,
    nowMs,
    screenPositionFor,
    cameraDistanceFor,
    baseColorFor,
    params,
  }) {
    if (!focusPassIsNeeded(target, previousActiveCount)) {
      return { writes: 0, transitioning: false, activeCount: 0, ran: false };
    }
    let writes = 0;
    let transitioning = false;
    let activeCount = 0;
    for (const [noradId, point] of points || []) {
      if (noradId === trackedId || !point?.position) continue;
      const cameraDistance = cameraDistanceFor(point.position);
      const distanceScale = nearFarScalarValueAtDistance(
        point.scaleByDistance,
        cameraDistance,
      );
      const halfExtentPx = (point.pixelSize || 5) * distanceScale * 0.5;
      const focus = advanceSpriteFocus(point, {
        // Hidden points still release toward identity, preventing stale dim
        // alpha if a catalog/presentation toggle later makes them visible.
        screenPosition:
          point.show === false ? null : screenPositionFor(point.position),
        cameraDistance,
        nowMs,
        target,
        params,
        spriteHalfWidthPx: halfExtentPx,
        spriteHalfHeightPx: halfExtentPx,
      });
      transitioning ||= focus.transitioning;
      if (focus.active) activeCount += 1;
      const base = baseColorFor(noradId);
      const alpha = base.alpha * focus.factor;
      if (focusAlphaNeedsWrite(point.color?.alpha, alpha, params)) {
        // Point stays continuously present at the non-zero emphasis floor; its
        // own alpha yields around the tracked target, independent of draw order.
        point.color = base.withAlpha(alpha);
        writes += 1;
      }
    }
    return { writes, transitioning, activeCount, ran: true };
  }
  return {
    _showOrbitPath,
    _updateOrbitPathRotations,
    _hideOrbitPath,
    _propagateAll,
    _applyRenderCap,
    _pointAllowedByRenderCap,
    _preRenderTick,
    _updatePointFocus,
    applySatellitePointFocusDeemphasis,
  };
}
