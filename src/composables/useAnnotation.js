import { reactive } from 'vue'

let seq = 0

function cloneGeometry(type, geometry) {
  if (type === 'line') return { points: [...geometry.points] }
  return { ...geometry }
}

export function useAnnotation() {
  const tracksByDataset = reactive({})

  function ensure(datasetId) {
    if (!tracksByDataset[datasetId]) tracksByDataset[datasetId] = []
    return tracksByDataset[datasetId]
  }

  function getTracks(datasetId) {
    return tracksByDataset[datasetId] || []
  }

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

  function updateFromFrame(datasetId, trackId, frameIndex, geometry, lastFrame) {
    const track = (tracksByDataset[datasetId] || []).find((item) => item.id === trackId)
    if (!track) return
    for (let frame = frameIndex; frame <= lastFrame; frame++) {
      if (track.geometries[frame]) {
        track.geometries[frame] = cloneGeometry(track.type, geometry)
      }
    }
  }

  function deleteTrack(datasetId, trackId) {
    const list = tracksByDataset[datasetId]
    if (!list) return
    const index = list.findIndex((item) => item.id === trackId)
    if (index >= 0) list.splice(index, 1)
  }

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

  function clearDataset(datasetId) {
    tracksByDataset[datasetId] = []
  }

  function countTracks(datasetId) {
    return (tracksByDataset[datasetId] || []).length
  }

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
