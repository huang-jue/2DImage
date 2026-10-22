import { bboxOf, formatNumber } from './geometry'

/**
 * MOT Challenge 格式导出（多目标跟踪）。
 *
 * 每行：frame,id,x,y,w,h,conf,class,visibility
 *   - frame 从 1 开始（MOT 约定）
 *   - id 取 track id 中的数字部分，没有则用序号
 *   - 不输出表头（符合 MOT gt.txt 约定）
 *
 * 点 / 折线 / 多边形会转换为包围盒。
 */

/** 从 track id 提取数字，找不到时返回 0 */
function numericId(trackId) {
  const matched = /\d+/.exec(String(trackId || ''))
  return matched ? Number(matched[0]) : 0
}

export function exportMot(bundle) {
  const classIndex = new Map()
  const rows = []
  let fallbackId = 1

  for (const track of bundle.tracks) {
    const name = (track.label || '').trim() || '未命名'
    if (!classIndex.has(name)) classIndex.set(name, classIndex.size + 1)
    const cls = classIndex.get(name)
    const id = numericId(track.id) || fallbackId++
    const frameKeys = Object.keys(track.frames)
      .map(Number)
      .sort((a, b) => a - b)
    for (const frameIndex of frameKeys) {
      const box = bboxOf(track.type, track.frames[frameIndex])
      if (!box) continue
      rows.push(
        [
          frameIndex + 1,
          id,
          formatNumber(box.x),
          formatNumber(box.y),
          formatNumber(box.width),
          formatNumber(box.height),
          1,
          cls,
          1,
        ].join(','),
      )
    }
  }

  return [
    {
      name: `${bundle.dataset}-mot.txt`,
      content: rows.join('\n'),
    },
  ]
}
