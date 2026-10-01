import * as Cesium from 'cesium';

export function createController({
  flightState,
  services,
  parts,
  layer,
  resolveAsset,
}) {
  function _abortActiveUpdates() {
    for (const controller of flightState.feed._activeUpdateControllers)
      controller.abort();
    flightState.feed._activeUpdateControllers.clear();
  }

  function _flightQuery(viewer) {
    const cartographic = viewer?.camera?.positionCartographic;
    // Ask the route for the FULL live world (all of adsb.lol) so the
    // render-count slider decides how many are drawn, not the viewport.
    return cartographic
      ? {
          latitude: Cesium.Math.toDegrees(cartographic.latitude),
          longitude: Cesium.Math.toDegrees(cartographic.longitude),
          all: true,
        }
      : { all: true };
  }
  return { _abortActiveUpdates, _flightQuery };
}
