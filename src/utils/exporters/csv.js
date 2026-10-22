import { bboxOf, isPolyline, pointsOf } from './geometry'

/**
 * 通用 CSV 导出：每行一个对象在某帧的几何。
 *
 * 表头：frame,track_id,type,label,color,x,y,width,height,points
 *   - frame 从 1 开始
 *   - 折线的 points 用空格分隔：x1 y1 x2 y2 ...
 */

/** CSV 字段转义 */
function cell(value) {
  const text = String(value ?? '')
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function exportCsv(bundle) {
  const header = 'frame,track_id,type,label,color,x,y,width,height,points'
  const rows = [header]

  for (const track of bundle.tracks) {
    const frameKeys = Object.keys(track.frames)
      .map(Number)
      .sort((a, b) => a - b)
    for (const frameIndex of frameKeys) {
      const geometry = track.frames[frameIndex]
      const box = bboxOf(track.type, geometry)
      const points = isPolyline(track.type) ? pointsOf(geometry).join(' ') : ''
      rows.push(
        [
          frameIndex + 1,
          cell(track.id),
          track.type,
          cell(track.label || ''),
          cell(track.color || ''),
          box ? Number(box.x.toFixed(2)) : '',
          box ? Number(box.y.toFixed(2)) : '',
          box ? Number(box.width.toFixed(2)) : '',
          box ? Number(box.height.toFixed(2)) : '',
          cell(points),
        ].join(','),
      )
    }
  }

  return [
    {
      name: `${bundle.dataset}-annotations.csv`,
      content: `${rows.join('\n')}\n`,
    },
  ]
}
