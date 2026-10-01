import * as Cesium from 'cesium';

// Attribution and service rights are documented in DATA_SOURCES.md.
export const ESRI_ATTRIBUTION_HTML =
  '<a href="https://www.esri.com" target="_blank" rel="noopener">Powered by Esri</a>';

export const AMAP_ATTRIBUTION_HTML =
  '<a href="https://www.amap.com" target="_blank" rel="noopener">© 高德地图 AutoNavi</a>';

/**
 * AMap (高德) satellite imagery — keyless (`webst0{s}.is.autonavi.com/appmaptile`),
 * reachable from mainland China, and served with `Access-Control-Allow-Origin: *`
 * so the tiles texture cleanly in WebGL. `style=6` → pure satellite; `style=8`
 * → satellite with a road/label overlay.
 *
 * NOTE: AMap tiles are in GCJ-02 (the China offset datum), so WGS-84 features
 * (ADS-B aircraft, AIS vessels) can sit a few hundred metres off the imagery
 * detail inside China. Outside China the offset vanishes.
 */
export function createAmapImagery({ style = 6 } = {}) {
  return new Cesium.UrlTemplateImageryProvider({
    url: `https://webst0{s}.is.autonavi.com/appmaptile?style=${style}&x={x}&y={y}&z={z}`,
    subdomains: ['1', '2', '3', '4'],
    maximumLevel: 18,
    credit: '© 高德地图 AutoNavi',
  });
}

export function createOsmImagery() {
  return new Cesium.OpenStreetMapImageryProvider({
    url: 'https://tile.openstreetmap.org/',
    credit: '© OpenStreetMap contributors',
  });
}

export function createEsriImagery() {
  return Cesium.ArcGisMapServerImageryProvider.fromUrl(
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
    {
      credit:
        'Powered by Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      enablePickFeatures: false,
    },
  );
}

export function createIonImagery(style, accessToken) {
  accessToken = String(accessToken || '').trim();
  if (!accessToken) throw new Error('Ion imagery requires an explicit token');
  return Cesium.IonImageryProvider.fromAssetId(style, { accessToken });
}
