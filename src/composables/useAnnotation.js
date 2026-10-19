import { reactive } from 'vue'

/**
 * 标注状态管理（跨帧 track 模型）。
 *
 * 数据模型：
 *   track（跨帧对象） = {
 *     id,                       // 对象唯一 id，同一目标在所有帧共享
 *     type: 'rect'|'point'|'line',
 *     label,                    // 对象标签
 *     color,                    // 显示颜色
 *     startFrame,               // 首次出现的帧（从该帧一直延伸到末帧）
 *     geometries: {             // 键为帧序号，值为该帧的几何（原图像素坐标）
 *       [frameIndex]: { x, y, width, height }   // rect
 *                   | { x, y }                   // point
 *                   | { points: [x, y, x, y...] } // line
 *     }
 *   }
 *
 * 关键规则：
 *   - 新建对象时，几何会从当前帧一直填充到末帧（多帧画）。
 *   - 编辑某帧的对象时，几何会从该帧传播到末帧（编辑传播，之前帧保持不变）。
 *   - 所有几何均以原图像素坐标存储，与画布缩放无关，便于导出与复用。
 */

/** 自增序号，用于生成 track id */
let seq = 0

/**
 * 复制一份几何，避免多帧之间共享同一对象引用。
 * @param {'rect'|'point'|'line'} type
 * @param {object} geometry
 * @returns {object}
 */
function cloneGeometry(type, geometry) {
  if (type === 'line') return { points: [...geometry.points] }
  return { ...geometry }
}

export function useAnnotation() {
  /** 按数据集 id 隔离的 track 列表：{ [datasetId]: track[] } */
  const tracksByDataset = reactive({})

  /** 获取（不存在则创建）某数据集的 track 数组 */
  function ensure(datasetId) {
    if (!tracksByDataset[datasetId]) tracksByDataset[datasetId] = []
    return tracksByDataset[datasetId]
  }

  /** 获取某数据集的所有 track */
  function getTracks(datasetId) {
    return tracksByDataset[datasetId] || []
  }

  /**
   * 取某帧需要渲染的图形列表（只包含在该帧有几何的 track）。
   * @returns {Array<{ id, type, label, color, geometry }>}
   */
  function getFrameShapes(datasetId, frameIndex) {
    const shapes = []
    for (const track of tracksByDataset[datasetId] || []) {
      const geometry = track.geometries[frameIndex]
      if (!geometry) continue
      shapes.push({
        id: track.id,
        type: track.type,
        label: track.label,
        color: track.color,
        geometry,
      })
    }
    return shapes
  }

  /**
   * 新建跨帧对象：几何从 frameIndex 一直复制到 lastFrame。
   * @returns {object} 新建的 track
   */
  function createTrack(datasetId, { type, geometry, frameIndex, lastFrame, label = '', color = '#409eff' }) {
    const list = ensure(datasetId)
    const id = `t${++seq}`
    const geometries = {}
    for (let frame = frameIndex; frame <= lastFrame; frame++) {
      geometries[frame] = cloneGeometry(type, geometry)
    }
    const track = { id, type, label, color, startFrame: frameIndex, geometries }
    list.push(track)
    return track
  }

  /**
   * 在 frameIndex 帧编辑对象：把新几何传播到 frameIndex..lastFrame（仅覆盖已存在的帧）。
   * frameIndex 之前的帧保持不变。
   */
  function updateFromFrame(datasetId, trackId, frameIndex, geometry, lastFrame) {
    const track = (tracksByDataset[datasetId] || []).find((item) => item.id === trackId)
    if (!track) return
    for (let frame = frameIndex; frame <= lastFrame; frame++) {
      if (track.geometries[frame]) {
        track.geometries[frame] = cloneGeometry(track.type, geometry)
      }
    }
  }

  /** 删除整条 track（该对象在所有帧消失） */
  function deleteTrack(datasetId, trackId) {
    const list = tracksByDataset[datasetId]
    if (!list) return
    const index = list.findIndex((item) => item.id === trackId)
    if (index >= 0) list.splice(index, 1)
  }

  /** 从 frameIndex 帧起删除该对象（移除 frameIndex..末帧 的几何）；若全部删空则移除整条 track */
  function deleteFromFrame(datasetId, trackId, frameIndex) {
    const list = tracksByDataset[datasetId]
    if (!list) return
    const track = list.find((item) => item.id === trackId)
    if (!track) return
    for (const key of Object.keys(track.geometries)) {
      if (Number(key) >= frameIndex) delete track.geometries[key]
    }
    if (Object.keys(track.geometries).length === 0) deleteTrack(datasetId, trackId)
  }

  /** 清空某数据集的所有标注 */
  function clearDataset(datasetId) {
    tracksByDataset[datasetId] = []
  }

  /** 某数据集的 track 总数 */
  function countTracks(datasetId) {
    return (tracksByDataset[datasetId] || []).length
  }

  /**
   * 导出某数据集标注为可序列化对象（含每帧几何）。
   * @param {object} meta 附加信息，如 { name, frameCount }
   */
  function exportDataset(datasetId, meta = {}) {
    const tracks = (tracksByDataset[datasetId] || []).map((track) => {
      const frameKeys = Object.keys(track.geometries)
        .map(Number)
        .sort((a, b) => a - b)
      const frames = {}
      for (const key of frameKeys) {
        frames[key] = cloneGeometry(track.type, track.geometries[key])
      }
      return {
        id: track.id,
        type: track.type,
        label: track.label,
        color: track.color,
        startFrame: track.startFrame,
        endFrame: frameKeys.length ? frameKeys[frameKeys.length - 1] : track.startFrame,
        frames,
      }
    })

    return {
      dataset: datasetId,
      name: meta.name || datasetId,
      frameCount: meta.frameCount ?? null,
      exportedAt: new Date().toISOString(),
      tracks,
    }
  }

  return {
    tracksByDataset,
    getTracks,
    getFrameShapes,
    createTrack,
    updateFromFrame,
    deleteTrack,
    deleteFromFrame,
    clearDataset,
    countTracks,
    exportDataset,
  }
}
