import { areaOf, bboxOf, isPolyline, pointsOf } from './geometry'

/**
 * COCO 格式导出。
 *
 * - 每个帧对应一张 image（id = 帧序号 + 1），尺寸来自实际图片。
 * - 矩形：bbox + 空 segmentation。
 * - 折线 / 多边形：segmentation 为点列表，bbox 为其包围盒。
 * - 点：按 2×2 像素包围盒导出。
 * - 额外字段 track_id / type / color 便于还原跨帧对象。
 */

/** 收集类别：按首次出现顺序编号，空标签归为“未命名” */
function buildCategories(tracks) {
  const map = new Map()
  const categories = []
  for (const track of tracks) {
    const name = (track.label || '').trim() || '未命名'
    if (map.has(name)) continue
    const id = categories.length + 1
    map.set(name, id)
    categories.push({ id, name, supercategory: 'object' })
  }
  return { map, categories }
}

/** 帧尺寸（缺少时为 0，COCO 仍可解析但需要调用方注意） */
function frameSize(dims, frameIndex) {
  const size = dims instanceof Map ? dims.get(frameIndex) : dims?.[frameIndex]
  return { width: size?.width || 0, height: size?.height || 0 }
}

export function exportCoco(bundle, { dims } = {}) {
  const { map: categoryMap, categories } = buildCategories(bundle.tracks)

  const images = bundle.frames.map((frame) => {
    const size = frameSize(dims, frame.index)
    return {
      id: frame.index + 1,
      file_name: frame.name,
      width: size.width,
      height: size.height,
    }
  })

  const annotations = []
  for (const track of bundle.tracks) {
    const labelName = (track.label || '').trim() || '未命名'
    const categoryId = categoryMap.get(labelName)
    const frameKeys = Object.keys(track.frames)
      .map(Number)
      .sort((a, b) => a - b)
    for (const frameIndex of frameKeys) {
      const geometry = track.frames[frameIndex]
      const box = bboxOf(track.type, geometry)
      if (!box) continue
      const segmentation = isPolyline(track.type)
        ? [pointsOf(geometry).map((value) => Number(value.toFixed(2)))]
        : []
      annotations.push({
        id: annotations.length + 1,
        image_id: frameIndex + 1,
        category_id: categoryId,
        bbox: [box.x, box.y, box.width, box.height].map((value) => Number(value.toFixed(2))),
        area: Number(areaOf(track.type, geometry).toFixed(2)),
        iscrowd: 0,
        segmentation,
        track_id: track.id,
        type: track.type,
        color: track.color,
      })
    }
  }

  const doc = {
    info: {
      description: `2D 标注导出：${bundle.name || bundle.dataset}`,
      date_created: new Date().toISOString(),
    },
    licenses: [],
    images,
    annotations,
    categories,
  }

  return [
    {
      name: `${bundle.dataset}-coco.json`,
      content: JSON.stringify(doc, null, 2),
    },
  ]
}
