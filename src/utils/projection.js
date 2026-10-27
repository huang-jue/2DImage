/**
 * 投影（跨帧只读叠加）的纯逻辑工具。
 *
 * 投影只负责计算“哪些帧、哪些图形需要叠加”，不读写标注状态，
 * 也不参与撤销、导出或对象统计。
 */

export const PROJECTION_MODES = ['prev', 'next', 'both', 'keyframe', 'custom']
export const PROJECTION_CONTENTS = ['shapes', 'image', 'both']

export const DEFAULT_PROJECTION = {
  enabled: false,
  mode: 'prev',
  offset: 1,
  customFrame: null,
  content: 'shapes',
  opacity: 0.35,
  selectedOnly: false,
  showLabels: false,
  showAllKeyframes: false,
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

/** 规范化投影设置；frameCount 可选，用于夹取指定帧 */
export function normalizeProjectionSettings(raw = {}, options = {}) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const frameCount =
    Number.isInteger(options.frameCount) && options.frameCount > 0 ? options.frameCount : 0

  let mode = PROJECTION_MODES.includes(source.mode) ? source.mode : DEFAULT_PROJECTION.mode
  let offset = Number.isInteger(source.offset) ? source.offset : DEFAULT_PROJECTION.offset
  offset = clamp(offset, 1, 5)

  let opacity = Number(source.opacity)
  if (!Number.isFinite(opacity)) opacity = DEFAULT_PROJECTION.opacity
  opacity = clamp(opacity, 0.1, 0.7)

  let customFrame =
    Number.isInteger(source.customFrame) && source.customFrame >= 0
      ? source.customFrame
      : null
  if (customFrame != null && frameCount) {
    customFrame = Math.min(customFrame, frameCount - 1)
  }
  if (mode === 'custom' && customFrame == null) mode = 'prev'

  return {
    enabled: source.enabled === true,
    mode,
    offset,
    customFrame,
    content: PROJECTION_CONTENTS.includes(source.content)
      ? source.content
      : DEFAULT_PROJECTION.content,
    opacity,
    selectedOnly: source.selectedOnly === true,
    showLabels: source.showLabels === true,
    showAllKeyframes: source.showAllKeyframes === true,
  }
}

/** 选中对象中有效的关键帧（有几何、非负整数） */
function keyframesOf(track, lastFrame) {
  if (!track || !Array.isArray(track.keyframes)) return []
  return [
    ...new Set(
      track.keyframes.filter(
        (key) =>
          Number.isInteger(key) &&
          key >= 0 &&
          key <= lastFrame &&
          Boolean(track.geometries?.[key]),
      ),
    ),
  ].sort((a, b) => a - b)
}

/**
 * 解析投影来源帧。
 * 相邻帧按“由远到近”返回，便于画布把最近的投影绘制在最上层。
 */
export function resolveProjectionFrames({
  mode = DEFAULT_PROJECTION.mode,
  offset = DEFAULT_PROJECTION.offset,
  customFrame = null,
  showAllKeyframes = false,
  frameIndex = 0,
  lastFrame = 0,
  selectedTrack = null,
} = {}) {
  if (!Number.isInteger(frameIndex) || frameIndex < 0) return []
  if (!Number.isInteger(lastFrame) || lastFrame < 0 || frameIndex > lastFrame) return []

  const current = frameIndex
  const step = clamp(Number.isInteger(offset) ? offset : 1, 1, 5)
  const frames = []
  const seen = new Set()

  function push(frame) {
    if (!Number.isInteger(frame)) return
    if (frame < 0 || frame > lastFrame || frame === current) return
    if (seen.has(frame)) return
    seen.add(frame)
    frames.push(frame)
  }

  if (mode === 'prev') {
    for (let frame = current - step; frame < current; frame++) push(frame)
  } else if (mode === 'next') {
    for (let frame = current + step; frame > current; frame--) push(frame)
  } else if (mode === 'both') {
    for (let frame = current - step; frame < current; frame++) push(frame)
    for (let frame = current + step; frame > current; frame--) push(frame)
  } else if (mode === 'custom') {
    push(customFrame)
  } else if (mode === 'keyframe') {
    const keys = keyframesOf(selectedTrack, lastFrame)
    if (showAllKeyframes) {
      const sorted = [...keys].sort(
        (a, b) => Math.abs(b - current) - Math.abs(a - current) || a - b,
      )
      for (const key of sorted) push(key)
    } else {
      let previous = null
      let next = null
      for (const key of keys) {
        if (key < current) previous = key
        else if (key > current && next == null) next = key
      }
      if (previous != null) push(previous)
      if (next != null) push(next)
    }
  }

  return frames
}

/** 从来源帧中组装只读投影图形，附带来源帧号用于点击跳转 */
export function buildProjectionShapes({
  frames = [],
  getFrameShapes,
  selectedId = null,
  selectedOnly = false,
} = {}) {
  if (typeof getFrameShapes !== 'function') return []
  if (selectedOnly && !selectedId) return []

  const shapes = []
  for (const frame of frames) {
    const list = getFrameShapes(frame)
    if (!Array.isArray(list)) continue
    for (const shape of list) {
      if (selectedOnly && shape.id !== selectedId) continue
      shapes.push({
        ...shape,
        sourceFrame: frame,
        key: `${frame}:${shape.id}`,
      })
    }
  }
  return shapes
}

/** 帧号列表（1 基） */
function formatFrameList(frames) {
  if (!frames.length) return ''
  const numbers = [...frames]
    .sort((a, b) => a - b)
    .map((frame) => frame + 1)
  if (numbers.length <= 4) return `第 ${numbers.join('、')} 帧`
  return `第 ${numbers.slice(0, 3).join('、')} 等 ${numbers.length} 帧`
}

/** 画布右上角状态文案 */
export function buildProjectionSummary({ settings = DEFAULT_PROJECTION, sourceFrames = [] } = {}) {
  if (!settings.enabled) return ''
  if (!sourceFrames.length) return '无可投影帧'

  const content =
    settings.content === 'both'
      ? '标注+图像'
      : settings.content === 'image'
        ? '图像'
        : '标注'
  const opacity = `${Math.round(settings.opacity * 100)}%`

  let scope
  if (settings.mode === 'keyframe') {
    scope = settings.showAllKeyframes ? `全部关键帧（${sourceFrames.length}）` : '关键帧'
  } else if (settings.mode === 'custom') {
    scope = '指定帧'
  } else if (settings.mode === 'prev') {
    scope = settings.offset > 1 ? `前 ${settings.offset} 帧` : '上一帧'
  } else if (settings.mode === 'next') {
    scope = settings.offset > 1 ? `后 ${settings.offset} 帧` : '下一帧'
  } else {
    scope = `前后 ${settings.offset} 帧`
  }

  return `${scope} · ${formatFrameList(sourceFrames)} · ${content} · ${opacity}`
}
