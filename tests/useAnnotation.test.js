import { describe, expect, it } from 'vitest'
import { useAnnotation } from '../src/composables/useAnnotation'

const rect = (x = 0, y = 0, width = 10, height = 10) => ({ x, y, width, height })

function setup() {
  const snapshots = []
  const api = useAnnotation({ onBeforeMutate: (snapshot) => snapshots.push(snapshot) })
  return { api, snapshots }
}

/** 新建一条 0..lastFrame 的矩形 track */
function createRect(api, lastFrame = 4, frameIndex = 0) {
  return api.createTrack('d1', {
    type: 'rect',
    geometry: rect(),
    frameIndex,
    lastFrame,
    label: 'car',
    color: '#ff0000',
  })
}

describe('useAnnotation / createTrack', () => {
  it('从当前帧填充到末帧，且各帧几何互相独立', () => {
    const { api } = setup()
    const track = createRect(api, 2)
    expect(Object.keys(track.geometries)).toEqual(['0', '1', '2'])
    expect(track.startFrame).toBe(0)
    expect(track.visible).toBe(true)
    expect(track.locked).toBe(false)

    track.geometries[1].x = 99
    expect(track.geometries[2].x).toBe(0)
  })

  it('非法几何不创建对象且不写历史', () => {
    const { api, snapshots } = setup()
    const result = api.createTrack('d1', {
      type: 'rect',
      geometry: { x: 0, y: 0, width: 0, height: 0 },
      frameIndex: 0,
      lastFrame: 2,
    })
    expect(result).toBeNull()
    expect(api.countTracks('d1')).toBe(0)
    expect(snapshots).toHaveLength(0)
  })

  it('id 全局唯一并递增', () => {
    const { api } = setup()
    const a = createRect(api, 1)
    const b = createRect(api, 1)
    expect(a.id).not.toBe(b.id)
  })
})

describe('useAnnotation / updateFromFrame', () => {
  it('forward 只影响当前帧及之后', () => {
    const { api } = setup()
    const track = createRect(api, 4)
    api.updateFromFrame('d1', track.id, 2, rect(50), 4, 'forward')
    expect(track.geometries[0].x).toBe(0)
    expect(track.geometries[1].x).toBe(0)
    expect(track.geometries[2].x).toBe(50)
    expect(track.geometries[4].x).toBe(50)
  })

  it('frame 只影响当前帧', () => {
    const { api } = setup()
    const track = createRect(api, 3)
    api.updateFromFrame('d1', track.id, 1, rect(7), 3, 'frame')
    expect(track.geometries[1].x).toBe(7)
    expect(track.geometries[2].x).toBe(0)
  })

  it('all 影响所有已有帧', () => {
    const { api } = setup()
    const track = createRect(api, 3)
    api.updateFromFrame('d1', track.id, 1, rect(8), 3, 'all')
    expect(Object.values(track.geometries).every((item) => item.x === 8)).toBe(true)
  })

  it('无效几何返回 false 且不写历史', () => {
    const { api, snapshots } = setup()
    const track = createRect(api, 2)
    const before = snapshots.length
    expect(api.updateFromFrame('d1', track.id, 0, rect(0, 0, 0, 0), 2)).toBe(false)
    expect(snapshots.length).toBe(before)
  })
})

describe('useAnnotation / extendBackward', () => {
  it('从更早的帧补齐几何并更新 startFrame', () => {
    const { api } = setup()
    const track = createRect(api, 5, 3)
    expect(track.startFrame).toBe(3)

    expect(api.extendBackward('d1', track.id, 1, rect(5))).toBe(true)
    expect(track.startFrame).toBe(1)
    expect(track.geometries[1].x).toBe(5)
    expect(track.geometries[2].x).toBe(5)
    expect(track.geometries[3].x).toBe(0)
  })

  it('目标帧不早于起始帧时不做任何事', () => {
    const { api } = setup()
    const track = createRect(api, 5, 3)
    expect(api.extendBackward('d1', track.id, 3, rect(5))).toBe(false)
    expect(track.startFrame).toBe(3)
  })

  it('extendForward 把末帧几何延伸到指定帧', () => {
    const { api } = setup()
    const track = createRect(api, 4)
    api.deleteFromFrame('d1', track.id, 2)
    expect(Object.keys(track.geometries)).toEqual(['0', '1'])

    expect(api.extendForward('d1', track.id, 4)).toBe(true)
    expect(Object.keys(track.geometries)).toEqual(['0', '1', '2', '3', '4'])
    expect(track.geometries[4]).toEqual(track.geometries[1])
    expect(api.extendForward('d1', track.id, 4)).toBe(false)
  })
})

describe('useAnnotation / interpolate', () => {
  it('在关键帧之间线性插值，不覆盖已有帧', () => {
    const { api } = setup()
    const track = createRect(api, 4)
    // 删除中间帧，制造关键帧之间的空白
    for (const frame of [1, 2, 3]) api.deleteAtFrame('d1', track.id, frame)
    api.updateFromFrame('d1', track.id, 0, rect(0, 0, 10, 10), 4, 'frame')
    api.updateFromFrame('d1', track.id, 4, rect(40, 20, 50, 10), 4, 'frame')

    expect(api.interpolate('d1', track.id)).toBe(3)
    expect(track.geometries[2]).toEqual({ x: 20, y: 10, width: 30, height: 10 })
  })

  it('折线点数不一致时跳过', () => {
    const { api } = setup()
    const track = api.createTrack('d1', {
      type: 'line',
      geometry: { points: [0, 0, 10, 10] },
      frameIndex: 0,
      lastFrame: 2,
    })
    api.deleteAtFrame('d1', track.id, 1)
    api.updateFromFrame('d1', track.id, 2, { points: [0, 0, 5, 5, 10, 10] }, 2, 'frame')
    expect(api.interpolate('d1', track.id)).toBe(0)
    expect(track.geometries[1]).toBeUndefined()
  })
})

describe('useAnnotation / 关键帧', () => {
  it('「仅当前帧」创建的对象只有一个关键帧', () => {
    const { api } = setup()
    const track = createRect(api, 0)
    expect(Object.keys(track.geometries)).toEqual(['0'])
  })

  it('addKeyframe 复制最近关键帧几何，随后可插值补全', () => {
    const { api } = setup()
    const track = createRect(api, 0)
    expect(api.addKeyframe('d1', track.id, 4)).toBe(true)
    expect(track.geometries[4]).toEqual(track.geometries[0])
    expect(api.addKeyframe('d1', track.id, 4)).toBe(false)

    expect(api.interpolate('d1', track.id)).toBe(3)
    expect(track.geometries[2]).toEqual(track.geometries[0])
  })

  it('reveal 选项会把隐藏的对象恢复显示', () => {
    const { api } = setup()
    const track = createRect(api, 0)
    api.updateTrackMeta('d1', track.id, { visible: false })
    expect(api.getFrameShapes('d1', 2)).toHaveLength(0)

    expect(api.addKeyframe('d1', track.id, 2, null, { reveal: true })).toBe(true)
    expect(track.visible).toBe(true)
    expect(api.getFrameShapes('d1', 2)).toHaveLength(1)
  })

  it('插值补全所有相邻关键帧之间的空隙', () => {
    const { api } = setup()
    const track = createRect(api, 0)
    api.addKeyframe('d1', track.id, 4)
    api.addKeyframe('d1', track.id, 10)
    api.updateFromFrame('d1', track.id, 10, rect(30), 10, 'frame')

    expect(api.interpolate('d1', track.id)).toBe(8)
    expect(track.geometries[7].x).toBeCloseTo(15)
    expect(track.geometries[9].x).toBeCloseTo(25)
    expect(track.geometries[2].x).toBe(0)
  })
})

describe('useAnnotation / 删除', () => {
  it('deleteAtFrame 只删当前帧，删空后移除对象', () => {
    const { api } = setup()
    const track = createRect(api, 2)
    expect(api.deleteAtFrame('d1', track.id, 1)).toBe(true)
    expect(track.geometries[1]).toBeUndefined()
    expect(api.countTracks('d1')).toBe(1)

    api.deleteAtFrame('d1', track.id, 0)
    api.deleteAtFrame('d1', track.id, 2)
    expect(api.countTracks('d1')).toBe(0)
  })

  it('deleteFromFrame 删除当前帧到末帧', () => {
    const { api } = setup()
    const track = createRect(api, 4)
    expect(api.deleteFromFrame('d1', track.id, 2)).toBe(true)
    expect(Object.keys(track.geometries)).toEqual(['0', '1'])
  })
})

describe('useAnnotation / 元信息与可见性', () => {
  it('隐藏对象不出现在帧图形中，锁定状态传递给画布', () => {
    const { api } = setup()
    const track = createRect(api, 2)
    api.updateTrackMeta('d1', track.id, { visible: false })
    expect(api.getFrameShapes('d1', 0)).toHaveLength(0)

    api.updateTrackMeta('d1', track.id, { visible: true })
    api.updateTrackMeta('d1', track.id, { locked: true, label: 'truck' })
    const [shape] = api.getFrameShapes('d1', 0)
    expect(shape.locked).toBe(true)
    expect(shape.label).toBe('truck')
  })
})

describe('useAnnotation / 复制', () => {
  it('复制对象生成新 id、解锁并错开位置', () => {
    const { api } = setup()
    const track = createRect(api, 2)
    api.updateTrackMeta('d1', track.id, { locked: true })
    const copy = api.duplicateTrack('d1', track.id)
    expect(copy.id).not.toBe(track.id)
    expect(copy.locked).toBe(false)
    expect(copy.geometries[0]).toEqual({ x: 8, y: 8, width: 10, height: 10 })
    expect(track.geometries[0].x).toBe(0)
  })

  it('copyFromPreviousFrame 补回当前帧缺失的对象', () => {
    const { api } = setup()
    const track = createRect(api, 4)
    api.deleteFromFrame('d1', track.id, 2)
    expect(track.geometries[2]).toBeUndefined()

    expect(api.copyFromPreviousFrame('d1', 2, 4)).toBe(1)
    expect(Object.keys(track.geometries)).toEqual(['0', '1', '2', '3', '4'])
    expect(track.geometries[2]).toEqual(track.geometries[1])
    expect(api.copyFromPreviousFrame('d1', 2, 4)).toBe(0)
  })
})

describe('useAnnotation / 导入导出', () => {
  it('导出后可完整导入，id 保留', () => {
    const { api } = setup()
    const track = createRect(api, 3)
    const payload = api.exportDataset('d1', { name: '示例 1', frameCount: 4 })

    const { api: target } = setup()
    expect(target.importDataset('d9', payload)).toBe(1)
    const [imported] = target.getTracks('d9')
    expect(imported.id).toBe(track.id)
    expect(imported.geometries[3]).toEqual({ x: 0, y: 0, width: 10, height: 10 })
  })

  it('重复导入时自动重命名冲突 id', () => {
    const { api } = setup()
    const track = createRect(api, 1)
    const payload = api.exportDataset('d1')
    api.importDataset('d1', payload)
    const list = api.getTracks('d1')
    expect(list).toHaveLength(2)
    expect(new Set(list.map((item) => item.id)).size).toBe(2)
    expect(list[0].id).toBe(track.id)
  })

  it('导入时忽略非法类型与空帧', () => {
    const { api } = setup()
    const count = api.importDataset('d1', {
      tracks: [
        { id: 'x1', type: 'unknown', frames: { 0: { x: 0, y: 0, width: 1, height: 1 } } },
        { id: 'x2', type: 'rect', frames: {} },
        { id: 'x3', type: 'rect', frames: { 0: { x: 1, y: 2, width: 3, height: 4 } } },
      ],
    })
    expect(count).toBe(1)
    expect(api.getTracks('d1')[0].id).toBe('x3')
  })
})

describe('useAnnotation / 批量操作', () => {
  it('duplicateTracks 一次复制多个对象且只记一次历史', () => {
    const { api, snapshots } = setup()
    const a = createRect(api, 1)
    const b = createRect(api, 1)
    const before = snapshots.length

    const copies = api.duplicateTracks('d1', [a.id, b.id])
    expect(copies).toHaveLength(2)
    expect(new Set([a.id, b.id, ...copies.map((item) => item.id)]).size).toBe(4)
    expect(snapshots.length).toBe(before + 1)
  })

  it('updateTracksMeta 批量改标签并只记一次历史', () => {
    const { api, snapshots } = setup()
    const a = createRect(api, 1)
    const b = createRect(api, 1)
    const before = snapshots.length

    expect(api.updateTracksMeta('d1', [a.id, b.id], { label: 'truck', locked: true })).toBe(2)
    expect(a.label).toBe('truck')
    expect(b.locked).toBe(true)
    expect(snapshots.length).toBe(before + 1)
  })

  it('deleteTracks 批量删除并只记一次历史', () => {
    const { api, snapshots } = setup()
    const a = createRect(api, 1)
    const b = createRect(api, 1)
    const c = createRect(api, 1)
    const before = snapshots.length

    expect(api.deleteTracks('d1', [a.id, b.id])).toBe(2)
    expect(api.countTracks('d1')).toBe(1)
    expect(api.getTracks('d1')[0].id).toBe(c.id)
    expect(snapshots.length).toBe(before + 1)
  })

  it('updateManyFromFrame 批量更新几何并跳过锁定对象', () => {
    const { api, snapshots } = setup()
    const a = createRect(api, 3)
    const b = createRect(api, 3)
    api.updateTrackMeta('d1', b.id, { locked: true })
    const before = snapshots.length

    const count = api.updateManyFromFrame(
      'd1',
      [
        { trackId: a.id, geometry: rect(10) },
        { trackId: b.id, geometry: rect(20) },
      ],
      2,
      3,
      'forward',
    )
    expect(count).toBe(1)
    expect(a.geometries[2].x).toBe(10)
    expect(a.geometries[1].x).toBe(0)
    expect(b.geometries[2].x).toBe(0)
    expect(snapshots.length).toBe(before + 1)
  })

  it('nudgeTracks 按帧微调并跳过锁定对象', () => {
    const { api } = setup()
    const a = createRect(api, 3)
    const b = createRect(api, 3)
    api.updateTrackMeta('d1', b.id, { locked: true })

    expect(api.nudgeTracks('d1', [a.id, b.id], 0, 5, -3, 3, 'frame')).toBe(1)
    expect(a.geometries[0]).toMatchObject({ x: 5, y: -3 })
    expect(a.geometries[1].x).toBe(0)
    expect(b.geometries[0].x).toBe(0)
  })
})

describe('useAnnotation / 拆分与合并', () => {
  it('splitTrack 把当前帧及之后迁到新对象', () => {
    const { api, snapshots } = setup()
    const track = createRect(api, 4)
    const before = snapshots.length

    const result = api.splitTrack('d1', track.id, 2)
    expect(Object.keys(result.source.geometries)).toEqual(['0', '1'])
    expect(Object.keys(result.track.geometries)).toEqual(['2', '3', '4'])
    expect(result.track.id).not.toBe(track.id)
    expect(api.countTracks('d1')).toBe(2)
    expect(snapshots.length).toBe(before + 1)
  })

  it('splitTrack 在首帧或末帧之外返回 null', () => {
    const { api } = setup()
    const track = createRect(api, 4)
    expect(api.splitTrack('d1', track.id, 0)).toBeNull()
    expect(api.splitTrack('d1', track.id, 5)).toBeNull()
  })

  it('mergeTracks 重叠帧保留第一个对象并统计冲突', () => {
    const { api, snapshots } = setup()
    const a = createRect(api, 4)
    const b = api.createTrack('d1', {
      type: 'rect',
      geometry: rect(200),
      frameIndex: 3,
      lastFrame: 4,
    })
    const before = snapshots.length

    const result = api.mergeTracks('d1', [a.id, b.id])
    expect(result.merged).toBe(2)
    expect(result.conflicts).toBe(2)
    expect(api.countTracks('d1')).toBe(1)
    expect(a.geometries[3].x).toBe(0)
    expect(a.geometries[4].x).toBe(0)
    expect(snapshots.length).toBe(before + 1)
  })

  it('mergeTracks 类型不一致时拒绝合并', () => {
    const { api } = setup()
    const rectTrack = createRect(api, 2)
    const lineTrack = api.createTrack('d1', {
      type: 'line',
      geometry: { points: [0, 0, 10, 10] },
      frameIndex: 0,
      lastFrame: 2,
    })
    expect(api.mergeTracks('d1', [rectTrack.id, lineTrack.id])).toBeNull()
    expect(api.countTracks('d1')).toBe(2)
  })
})

describe('useAnnotation / 复制粘贴', () => {
  it('pasteTracks 按复制帧几何生成新对象并偏移 8px', () => {
    const { api, snapshots } = setup()
    const track = createRect(api, 3)
    api.updateFromFrame('d1', track.id, 2, rect(30, 40, 50, 60), 3, 'frame')

    const payload = {
      frameIndex: 2,
      tracks: api.exportTracks('d1', [track.id]),
    }
    const before = snapshots.length

    const single = api.pasteTracks('d2', payload, 5, 7, 'frame')
    expect(single).toHaveLength(1)
    expect(Object.keys(single[0].geometries)).toEqual(['5'])
    expect(single[0].geometries[5]).toMatchObject({ x: 38, y: 48, width: 50, height: 60 })
    expect(single[0].id).not.toBe(track.id)
    expect(snapshots.length).toBe(before + 1)

    const forward = api.pasteTracks('d2', payload, 5, 7, 'forward')
    expect(Object.keys(forward[0].geometries)).toEqual(['5', '6', '7'])
  })
})

describe('useAnnotation / 快照与恢复', () => {
  it('restoreAll 后 id 序号继续递增，不与已有对象冲突', () => {
    const { api } = setup()
    createRect(api, 1)
    const snapshot = api.exportAll()

    const { api: restored } = setup()
    restored.restoreAll(snapshot)
    const track = createRect(restored, 1)
    expect(new Set(restored.getTracks('d1').map((item) => item.id)).size).toBe(2)
    expect(track.id).not.toBe(restored.getTracks('d1')[0].id)
  })
})
