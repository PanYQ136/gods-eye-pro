import {
  STATUS_POLL_MS,
  RENDER_LIMIT_MIN,
  RENDER_LIMIT_MAX,
} from './policy.js';

export function createControls({ state: layerState, services, parts, source }) {
  const governorRequestRender = services.render?.governorRequestRender;
  const methods = {
    id: 'bikeshare',

    name: 'Bikeshare',

    icon: '🚲',

    source: 'GBFS',

    updateInterval: STATUS_POLL_MS,

    /**
     * Live layer params.
     * `renderLimit` (0–999) keeps only the stations nearest the camera
     * rendered; 999 means unlimited (the default) and 0 renders nothing but a
     * selected station.
     * @param {{renderLimit?: number}} params
     * @returns {boolean} Always true.
     */
    setParams(params = {}) {
      if (Number.isFinite(params.renderLimit)) {
        const limit = Math.max(
          RENDER_LIMIT_MIN,
          Math.min(RENDER_LIMIT_MAX, Math.floor(params.renderLimit)),
        );
        if (limit !== layerState._renderLimit) {
          layerState._renderLimit = limit;
          // Re-rank the stations already in hand and repaint — no GBFS request,
          // no city re-activation, so the limit lands immediately.
          parts.rendering.applyRenderLimit();
          if (typeof governorRequestRender === 'function')
            governorRequestRender('bikeshare-render-limit');
          else layerState._viewer?.scene?.requestRender?.();
        }
      }
      return true;
    },

    getParams() {
      return { renderLimit: layerState._renderLimit };
    },

    /**
     * Return a sampled array of detectable station objects for HUD overlay rendering.
     * @param {Object} [options] - Sampling options (maxCount, seed).
     * @returns {Array<{ position: Cesium.Cartesian3, id: string, type: string, skipLabel: boolean }>}
     */
    getDetectableObjects(options = {}) {
      return parts.queries.collectDetectableStations(options);
    },

    /**
     * Return current layer statistics for the UI status display.
     * @returns {{ count: number, lastUpdate: number|null, loading: boolean, loadingLabel?: string, error?: string }}
     */
    getStats() {
      const stats = {
        count: layerState._count,
        lastUpdate: layerState._lastUpdate,
        loading: layerState._loading,
      };
      if (layerState._loading) {
        stats.loadingLabel =
          layerState._activeCityIds.size > 0
            ? `syncing ${layerState._activeCityIds.size} city feeds...`
            : 'scanning nearby systems...';
      }
      if (layerState._error) stats.error = layerState._error;
      return stats;
    },
  };

  return { methods };
}
