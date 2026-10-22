import { describe, expect, it } from 'vitest'
import { exportCoco } from '../src/utils/exporters/coco'
import { exportYolo } from '../src/utils/exporters/yolo'
import { exportMot } from '../src/utils/exporters/mot'
import { exportCsv } from '../src/utils/exporters/csv'
import { exportJson } from '../src/utils/exporters/json'
import {
  areaOf,
  bboxOf,
  isBoxOutOfBounds,
  isPointOutOfBounds,
} from '../src/utils/exporters/geometry'

const bundle = {
  dataset: 'case1',
  name: '示例 1',
  frames: [
    { index: 0, name: '001.jpg', url: 'a' },
    { index: 1, name: '002.jpg', url: 'b' },
  ],
  tracks: [
    {
      id: 't1',
      type: 'rect',
      label: 'car',
      color: '#ff0000',
      startFrame: 0,
      frames: {
        0: { x: 10, y: 20, width: 30, height: 40 },
        1: { x: 15, y: 20, width: 30, height: 40 },
      },
    },
    {
      id: 't2',
      type: 'polygon',
      label: 'car',
      color: '#00ff00',
      startFrame: 1,
      frames: { 1: { points: [0, 0, 10, 0, 10, 10] } },
    },
    {
      id: 't3',
      type: 'point',
      label: '',
      color: '#0000ff',
      startFrame: 0,
      frames: { 0: { x: 5, y: 6 } },
    },
  ],
}

const dims = new Map([
  [0, { width: 100, height: 100 }],
  [1, { width: 100, height: 100 }],
])

function parseJson(files) {
  return JSON.parse(files[0].content)
}

function linesOf(files, name) {
  const file = files.find((item) => item.name === name)
  return file ? file.content.split('\n').filter(Boolean) : []
}

describe('geometry', () => {
  it('折线包围盒与多边形面积', () => {
    const box = bboxOf('polygon', { points: [2, 3, 10, 3, 10, 9] })
    expect(box).toEqual({ x: 2, y: 3, width: 8, height: 6 })
    expect(areaOf('polygon', { points: [0, 0, 10, 0, 10, 10] })).toBe(50)
  })

  it('越界判断允许 0.5px 误差', () => {
    expect(isBoxOutOfBounds({ x: -0.4, y: 0, width: 10, height: 10 }, { width: 100, height: 100 })).toBe(false)
    expect(isBoxOutOfBounds({ x: -1, y: 0, width: 10, height: 10 }, { width: 100, height: 100 })).toBe(true)
    expect(isPointOutOfBounds({ x: 100.4, y: 50 }, { width: 100, height: 100 })).toBe(false)
    expect(isPointOutOfBounds({ x: 101, y: 50 }, { width: 100, height: 100 })).toBe(true)
  })
})

describe('JSON 导出', () => {
  it('保留 tracks 与 frameCount', () => {
    const doc = parseJson(exportJson(bundle))
    expect(doc.dataset).toBe('case1')
    expect(doc.frameCount).toBe(2)
    expect(doc.tracks).toHaveLength(3)
  })
})

describe('COCO 导出', () => {
  it('images / annotations / categories 正确', () => {
    const doc = parseJson(exportCoco(bundle, { dims }))
    expect(doc.images).toHaveLength(2)
    expect(doc.images[0]).toMatchObject({ id: 1, file_name: '001.jpg', width: 100, height: 100 })
    expect(doc.categories.map((item) => item.name)).toEqual(['car', '未命名'])

    expect(doc.annotations).toHaveLength(4)
    const [first] = doc.annotations
    expect(first).toMatchObject({
      image_id: 1,
      category_id: 1,
      bbox: [10, 20, 30, 40],
      area: 1200,
      track_id: 't1',
      type: 'rect',
    })

    const polygon = doc.annotations.find((item) => item.track_id === 't2')
    expect(polygon.segmentation).toEqual([[0, 0, 10, 0, 10, 10]])
    expect(polygon.area).toBe(50)

    const point = doc.annotations.find((item) => item.track_id === 't3')
    expect(point.bbox).toEqual([4, 5, 2, 2])
    expect(point.category_id).toBe(2)
  })
})

describe('YOLO 导出', () => {
  it('生成 classes.txt 与逐帧 labels，并归一化坐标', () => {
    const files = exportYolo(bundle, { dims })
    expect(files).toHaveLength(3)
    expect(linesOf(files, 'classes.txt')).toEqual(['car', '未命名'])

    const frame0 = linesOf(files, 'labels/001.txt')
    expect(frame0).toHaveLength(2)
    expect(frame0[0]).toBe('0 0.25 0.4 0.3 0.4')
    // 点按 2×2 包围盒导出
    expect(frame0[1]).toBe('1 0.05 0.06 0.02 0.02')

    const frame1 = linesOf(files, 'labels/002.txt')
    expect(frame1).toHaveLength(2)
  })
})

describe('MOT 导出', () => {
  it('frame 从 1 开始，列数固定', () => {
    const [file] = exportMot(bundle)
    const rows = file.content.split('\n').filter(Boolean)
    expect(rows).toHaveLength(4)
    expect(rows[0]).toBe('1,1,10,20,30,40,1,1,1')
    for (const row of rows) expect(row.split(',')).toHaveLength(9)
  })
})

describe('CSV 导出', () => {
  it('包含表头与折线点列表', () => {
    const [file] = exportCsv(bundle)
    const rows = file.content.trim().split('\n')
    expect(rows[0]).toBe('frame,track_id,type,label,color,x,y,width,height,points')
    expect(rows).toHaveLength(5)
    const polygonRow = rows.find((row) => row.includes('t2'))
    expect(polygonRow).toContain('0 0 10 0 10 10')
  })
})
