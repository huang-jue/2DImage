import { bboxOf, baseName, formatNumber } from './geometry'

/**
 * YOLO 格式导出（检测用得最多的归一化包围盒格式）。
 *
 * 输出：
 *   classes.txt                 类别名，行号即 class id
 *   labels/<帧名>.txt            每行 `class_id cx cy w h`（归一化 0–1）
 *
 * 点 / 折线 / 多边形都会转换为包围盒，这是检测格式的固有限制。
 * 空帧也会生成空 txt，方便与图片一一对应。
 */

/** 类别表：按首次出现顺序 */
function buildClasses(tracks) {
  const names = []
  const indexByName = new Map()
  for (const track of tracks) {
    const name = (track.label || '').trim() || '未命名'
    if (indexByName.has(name)) continue
    indexByName.set(name, names.length)
    names.push(name)
  }
  return { names, indexByName }
}

/** 为帧生成唯一的基础文件名（避免同名不同扩展冲突） */
function buildBaseNames(frames) {
  const used = new Set()
  const map = new Map()
  for (const frame of frames) {
    let base = baseName(frame.name) || `frame-${frame.index + 1}`
    if (used.has(base)) base = `${base}-${frame.index + 1}`
    used.add(base)
    map.set(frame.index, base)
  }
  return map
}

function frameSize(dims, frameIndex) {
  const size = dims instanceof Map ? dims.get(frameIndex) : dims?.[frameIndex]
  return { width: size?.width || 0, height: size?.height || 0 }
}

export function exportYolo(bundle, { dims } = {}) {
  const { names, indexByName } = buildClasses(bundle.tracks)
  const baseNames = buildBaseNames(bundle.frames)

  // 每帧的标注行
  const linesByFrame = new Map(bundle.frames.map((frame) => [frame.index, []]))
  for (const track of bundle.tracks) {
    const name = (track.label || '').trim() || '未命名'
    const classIndex = indexByName.get(name)
    for (const [key, geometry] of Object.entries(track.frames)) {
      const frameIndex = Number(key)
      const size = frameSize(dims, frameIndex)
      const box = bboxOf(track.type, geometry)
      const lines = linesByFrame.get(frameIndex)
      if (!box || !lines || !size.width || !size.height) continue

      const x = Math.min(Math.max(box.x / size.width, 0), 1)
      const y = Math.min(Math.max(box.y / size.height, 0), 1)
      const width = Math.min(Math.max(box.width / size.width, 0), 1)
      const height = Math.min(Math.max(box.height / size.height, 0), 1)
      if (width <= 0 || height <= 0) continue

      const cx = Math.min(Math.max(x + width / 2, 0), 1)
      const cy = Math.min(Math.max(y + height / 2, 0), 1)
      lines.push(
        `${classIndex} ${formatNumber(cx, 6)} ${formatNumber(cy, 6)} ${formatNumber(width, 6)} ${formatNumber(height, 6)}`,
      )
    }
  }

  const files = [{ name: 'classes.txt', content: `${names.join('\n')}\n` }]
  for (const frame of bundle.frames) {
    const base = baseNames.get(frame.index)
    files.push({
      name: `labels/${base}.txt`,
      content: linesByFrame.get(frame.index).join('\n'),
    })
  }
  return files
}
