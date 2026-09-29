import * as Cesium from 'cesium';

/**
 * Camera presets for notable locations.
 * Phase 1 default: fly to Austin, TX on load.
 */
export const CAMERA_PRESETS = {
  fuzhou: {
    destination: Cesium.Cartesian3.fromDegrees(119.349, 26.067, 4000),
    orientation: {
      heading: Cesium.Math.toRadians(15),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
  austin: {
    destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 800),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-35),
      roll: 0.0,
    },
  },
  sf: {
    destination: Cesium.Cartesian3.fromDegrees(-122.4194, 37.7749, 1000),
    orientation: {
      heading: Cesium.Math.toRadians(30),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
  nyc: {
    destination: Cesium.Cartesian3.fromDegrees(-73.9857, 40.7484, 1200),
    orientation: {
      heading: Cesium.Math.toRadians(-20),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
};

/**
 * Fly the camera to a preset location with a smooth animation.
 */
export function flyToPreset(viewer, presetName, duration = 3.0) {
  const preset = CAMERA_PRESETS[presetName];
  if (!preset) return;

  viewer.camera.flyTo({
    destination: preset.destination,
    orientation: preset.orientation,
    duration,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });
}

/**
 * Set camera to Fuzhou, China on load with a cinematic fly-in.
 * Default startup view — shows the user's local (Fujian coast / Taiwan Strait)
 * airspace so domestic flights are the focus rather than the US default.
 * @returns {Function} Cancels the pending or active startup flight.
 */
export function flyToFuzhou(viewer) {
  // Shared cinematic landing (Fuzhou fallback for the device-location default).
  return cinematicFlyIn(viewer, 119.349, 26.067, 12000);
}

/**
 * Cinematic fly-in to a lon/lat: start high, descend after a brief pause.
 * @param {object} viewer Cesium viewer.
 * @param {number} longitude Degrees.
 * @param {number} latitude Degrees.
 * @param {number} [finalHeight] Metres for the settled view.
 * @returns {Function} Cancels the pending or active flight.
 */
export function cinematicFlyIn(viewer, longitude, latitude, finalHeight = 12000) {
  // NB: this app's render governor does not drive Cesium's flyTo tween, so a
  // programmatic flyTo never animates (the camera would stay put). Land with an
  // instant setView instead — reliable, and it forces a render.
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(
      longitude,
      latitude,
      finalHeight,
    ),
    orientation: {
      heading: Cesium.Math.toRadians(15),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  });
  return () => {};
}

/**
 * Default startup view: fly to the device's ACTUAL location via browser
 * geolocation, with a cinematic fly-in. Falls back to Fuzhou when geolocation
 * is unavailable, denied, or times out, so startup never strands the camera.
 * Returns a cancel function synchronously (so it fits `defer(...)`).
 * @param {object} viewer Cesium viewer.
 * @param {{fallback?: (viewer: object) => Function, timeoutMs?: number}} [opts]
 * @returns {Function} Cancels the pending or active startup flight.
 */
export function flyToDeviceLocation(
  viewer,
  { fallback = flyToFuzhou, timeoutMs = 8000 } = {},
) {
  let cancel = () => {};
  let cancelled = false;
  const useFallback = () => {
    if (!cancelled) cancel = fallback(viewer);
  };
  if (!globalThis.navigator?.geolocation?.getCurrentPosition) {
    useFallback();
    return () => {
      cancelled = true;
      cancel();
    };
  }
  const guard = setTimeout(useFallback, timeoutMs);
  try {
    globalThis.navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        clearTimeout(guard);
        cancel = cinematicFlyIn(
          viewer,
          pos.coords.longitude,
          pos.coords.latitude,
        );
      },
      () => {
        clearTimeout(guard);
        useFallback();
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 120000 },
    );
  } catch {
    clearTimeout(guard);
    useFallback();
  }
  return () => {
    cancelled = true;
    clearTimeout(guard);
    cancel();
  };
}

/**
 * Set camera to Austin on load with a cinematic fly-in.
 * @returns {Function} Cancels the pending or active startup flight.
 */
export function flyToAustin(viewer) {
  // Start from a high altitude, then fly down
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 25000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-90),
      roll: 0.0,
    },
  });

  // Cinematic fly-in after a brief pause
  const timer = setTimeout(() => {
    if (viewer.isDestroyed()) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 600),
      orientation: {
        heading: Cesium.Math.toRadians(15),
        pitch: Cesium.Math.toRadians(-30),
        roll: 0.0,
      },
      duration: 4.0,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }, 500);
  return () => {
    clearTimeout(timer);
    if (!viewer.isDestroyed()) viewer.camera.cancelFlight();
  };
}
