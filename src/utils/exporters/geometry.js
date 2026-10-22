/**
 * 导出用的几何工具：把各类几何归一化为包围盒 / 点列表，并计算面积。
 */

/** 折线类类型 */
export function isPolyline(type) {
  return type === 'line' || type === 'polygon'
}

/** 折线的点列表（[x, y, x, y...]） */
export function pointsOf(geometry) {
  return Array.isArray(geometry?.points) ? geometry.points : []
}

/**
 * 任意几何的包围盒（原图像素坐标）。
 * 点按 2×2 像素的小框处理，便于导出为检测格式时保留。
 */
export function bboxOf(type, geometry) {
  if (!geometry) return null
  if (type === 'rect') {
    return {
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
    }
  }
  if (type === 'point') {
    return { x: geometry.x - 1, y: geometry.y - 1, width: 2, height: 2 }
  }
  const points = pointsOf(geometry)
  if (points.length < 2) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let index = 0; index < points.length; index += 2) {
    const x = points[index]
    const y = points[index + 1]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  if (!Number.isFinite(minX)) return null
  return {
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1),
  }
}

/** 多边形面积（鞋带公式）；非多边形回落到包围盒面积 */
export function areaOf(type, geometry) {
  if (!geometry) return 0
  if (type === 'polygon') {
    const points = pointsOf(geometry)
    if (points.length < 6) return 0
    let sum = 0
    const count = points.length / 2
    for (let index = 0; index < count; index++) {
      const next = (index + 1) % count
      sum += points[index * 2] * points[next * 2 + 1] - points[next * 2] * points[index * 2 + 1]
    }
    return Math.abs(sum) / 2
  }
  const box = bboxOf(type, geometry)
  return box ? Math.abs(box.width * box.height) : 0
}

/** 包围盒是否越界（允许 0.5px 误差） */
export function isBoxOutOfBounds(box, size) {
  if (!box || !size) return false
  const tolerance = 0.5
  return (
    box.x < -tolerance ||
    box.y < -tolerance ||
    box.x + box.width > size.width + tolerance ||
    box.y + box.height > size.height + tolerance
  )
}

/** 点是否越界 */
export function isPointOutOfBounds(point, size) {
  if (!point || !size) return false
  const tolerance = 0.5
  return (
    point.x < -tolerance ||
    point.y < -tolerance ||
    point.x > size.width + tolerance ||
    point.y > size.height + tolerance
  )
}

/** 把数字格式化为固定小数位，去掉多余的 0 */
export function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return '0'
  return String(Number(value.toFixed(digits)))
}

/** 帧文件名的基名（去掉扩展名） */
export function baseName(name) {
  return String(name || '').replace(/\.[^.]+$/, '')
}
