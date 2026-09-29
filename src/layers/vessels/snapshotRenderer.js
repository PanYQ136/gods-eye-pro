import { approxDistanceKm } from '../flights/recordPolicy.js';

const RAD_TO_DEG = 180 / Math.PI;

/** Connect portable vessel reconciliation to scene and selection operations. */
export function createVesselSnapshotRenderer({
  state,
  records,
  rendering,
  tracking,
  selection,
  cards,
}) {
  /**
   * 操作员渲染上限：按到相机子午点的距离排序，只把离相机最近的 N 艘交给
   * records.reconcile（0 = 只留选中/跟踪船）。被裁掉的记录随后由 reconcile 正常移除
   * （remove 效果回收 billboard 与缓存），所以「只渲染最近 N 艘」在记录层就生效，
   * 不会留下看不见的残留。相机不可用（无 WebGL / 单测桩）时不裁剪——宁可多渲染，
   * 也不要在无相机信息时误删。默认 999（不限）走快速返回，旧行为逐位不变。
   * @param {Array<Object>} rows - Accepted vessel display rows.
   * @param {Object|null} viewer - Active viewer (falls back to state.viewer).
   * @param {Object|null} selectedRecord - Selected vessel record, always kept.
   * @returns {Array<Object>} Rows to reconcile.
   */

  function capRowsToNearest(rows, viewer, selectedRecord) {
    if (!Array.isArray(rows) || rows.length === 0) return rows;
    const capN = rendering.renderRowLimit();
    if (capN >= rows.length) return rows; // 不限（默认 999）→ 原样放行
    const camera = (viewer || state.viewer)?.camera?.positionCartographic;
    if (!camera) return rows;
    const camLat = Number(camera.latitude) * RAD_TO_DEG;
    const camLon = Number(camera.longitude) * RAD_TO_DEG;
    if (!Number.isFinite(camLat) || !Number.isFinite(camLon)) return rows;

    const ranked = [];
    for (const row of rows) {
      const distance = approxDistanceKm(
        camLat,
        camLon,
        Number(row?.lat),
        Number(row?.lon),
      );
      if (Number.isFinite(distance)) ranked.push({ distance, row });
    }
    ranked.sort((a, b) => a.distance - b.distance);
    const keep = Math.max(0, Math.floor(capN));
    const nearest = new Set();
    for (let i = 0; i < ranked.length && i < keep; i += 1)
      nearest.add(ranked[i].row);

    // 选中/跟踪船永远保留：即使它排在 N 名之外，也不该被上限抹掉。
    const pinned = new Set();
    if (selectedRecord?.mmsi) pinned.add(String(selectedRecord.mmsi).trim());
    if (state.trailMmsi) pinned.add(String(state.trailMmsi).trim());

    const capped = [];
    for (const row of rows) {
      if (nearest.has(row)) {
        capped.push(row);
        continue;
      }
      const mmsi = String(row?.mmsi ?? '').trim();
      if (mmsi && pinned.has(mmsi)) capped.push(row);
    }
    return capped;
  }

  function reconcileVessels(viewer, rows, { complete = true } = {}) {
    rendering.ensureCollections(viewer);
    const occluder = rendering.makeOccluder();
    records.reconcile(
      capRowsToNearest(rows, viewer, state.selectedRecord),
      {
        complete,
        selectedRecord: state.selectedRecord,
        // 存储层上限仍是取数上限（不是操作员渲染上限）：部分快照的保留窗口
        // （PARTIAL_RETENTION_MS）必须继续按原预算工作。
        cap: rendering.fetchRowLimit(),
      },
      {
        add(record) {
          rendering.prepareRecordVisual(record);
          rendering.addRecordPrimitives(record, occluder);
        },
        beforeUpdate(record) {
          return rendering.shipIcon(record, record === state.selectedRecord);
        },
        updated(record, prevIcon) {
          const selected = record === state.selectedRecord;
          const visual = rendering.prepareRecordVisual(record);
          if (visual.billboard) {
            visual.billboard.position = visual.position;
            visual.billboard.scale =
              rendering.shipScale(record) * (selected ? 1.2 : 1);
            const nextIcon = rendering.shipIcon(record, selected);
            if (nextIcon !== prevIcon) visual.billboard.image = nextIcon;
          }
          if (record.mmsi === state.trailMmsi)
            tracking.appendSelectedVesselTrailFix(record);
          if (selected) {
            cards.updateSelectedVesselHud(record);
            selection.registerSelectedContext(record);
          }
        },
        remove(record, evicted) {
          if (evicted) selection.clearVesselInspection({ evicted: true });
          rendering.removeRecordPrimitives(record);
        },
        removed(mmsi) {
          if (state.trailMmsi === mmsi) tracking.clearSelectedVesselTrail();
        },
        staleSelected(record) {
          cards.updateSelectedVesselHud(record);
        },
      },
    );
    state.lastVisibilityUpdate = 0;
    rendering.updateVisibility(true);
  }
  return { reconcileVessels };
}
