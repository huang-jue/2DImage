import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useProjection } from '../src/composables/useProjection'
import {
  DEFAULT_PROJECTION,
  buildProjectionShapes,
  buildProjectionSummary,
  normalizeProjectionSettings,
  resolveProjectionFrames,
} from '../src/utils/projection'

const track = {
  keyframes: [0, 5, 10],
  geometries: {
    0: { x: 0, y: 0, width: 10, height: 10 },
    5: { x: 20, y: 20, width: 10, height: 10 },
    10: { x: 40, y: 40, width: 10, height: 10 },
  },
}

describe('normalizeProjectionSettings', () => {
  it('为空对象提供默认值', () => {
    expect(normalizeProjectionSettings()).toEqual(DEFAULT_PROJECTION)
    expect(normalizeProjectionSettings(null)).toEqual(DEFAULT_PROJECTION)
  })

  it('夹取非法偏移、透明度和内容类型', () => {
    const result = normalizeProjectionSettings({
      enabled: 'yes',
      mode: 'unknown',
      offset: 99,
      opacity: 2,
      content: 'unknown',
    })
    expect(result.enabled).toBe(false)
    expect(result.mode).toBe('prev')
    expect(result.offset).toBe(5)
    expect(result.opacity).toBe(0.7)
    expect(result.content).toBe('shapes')
  })

  it('custom 模式需要有效帧号，并夹取到数据集范围内', () => {
    expect(normalizeProjectionSettings({ mode: 'custom' }).mode).toBe('prev')
    expect(normalizeProjectionSettings({ mode: 'custom' }, { frameCount: 10 }).mode).toBe('prev')

    const result = normalizeProjectionSettings(
      { mode: 'custom', customFrame: 99 },
      { frameCount: 10 },
    )
    expect(result.mode).toBe('custom')
    expect(result.customFrame).toBe(9)
  })

  it('保留布尔设置', () => {
    const result = normalizeProjectionSettings({
      selectedOnly: true,
      showLabels: true,
      showAllKeyframes: true,
    })
    expect(result.selectedOnly).toBe(true)
    expect(result.showLabels).toBe(true)
    expect(result.showAllKeyframes).toBe(true)
  })
})

describe('resolveProjectionFrames', () => {
  it('上一帧/下一帧按由远到近返回', () => {
    expect(
      resolveProjectionFrames({ mode: 'prev', offset: 2, frameIndex: 5, lastFrame: 20 }),
    ).toEqual([3, 4])
    expect(
      resolveProjectionFrames({ mode: 'next', offset: 2, frameIndex: 5, lastFrame: 20 }),
    ).toEqual([7, 6])
    expect(
      resolveProjectionFrames({ mode: 'both', offset: 2, frameIndex: 5, lastFrame: 20 }),
    ).toEqual([3, 4, 7, 6])
  })

  it('边界帧不会产生越界来源', () => {
    expect(
      resolveProjectionFrames({ mode: 'prev', offset: 3, frameIndex: 1, lastFrame: 20 }),
    ).toEqual([0])
    expect(
      resolveProjectionFrames({ mode: 'prev', offset: 1, frameIndex: 0, lastFrame: 20 }),
    ).toEqual([])
    expect(
      resolveProjectionFrames({ mode: 'next', offset: 1, frameIndex: 20, lastFrame: 20 }),
    ).toEqual([])
  })

  it('指定帧排除越界、非法值与当前帧', () => {
    expect(
      resolveProjectionFrames({ mode: 'custom', customFrame: 7, frameIndex: 3, lastFrame: 20 }),
    ).toEqual([7])
    expect(
      resolveProjectionFrames({ mode: 'custom', customFrame: 3, frameIndex: 3, lastFrame: 20 }),
    ).toEqual([])
    expect(
      resolveProjectionFrames({ mode: 'custom', customFrame: 99, frameIndex: 3, lastFrame: 20 }),
    ).toEqual([])
    expect(
      resolveProjectionFrames({ mode: 'custom', customFrame: -1, frameIndex: 3, lastFrame: 20 }),
    ).toEqual([])
  })

  it('关键帧模式默认取最近前后各一个', () => {
    expect(
      resolveProjectionFrames({
        mode: 'keyframe',
        frameIndex: 7,
        lastFrame: 20,
        selectedTrack: track,
      }),
    ).toEqual([5, 10])
    expect(
      resolveProjectionFrames({
        mode: 'keyframe',
        frameIndex: 0,
        lastFrame: 20,
        selectedTrack: track,
      }),
    ).toEqual([5])
    expect(
      resolveProjectionFrames({
        mode: 'keyframe',
        frameIndex: 12,
        lastFrame: 20,
        selectedTrack: track,
      }),
    ).toEqual([10])
    expect(
      resolveProjectionFrames({
        mode: 'keyframe',
        frameIndex: 7,
        lastFrame: 20,
        selectedTrack: null,
      }),
    ).toEqual([])
  })

  it('全部关键帧按由远到近返回，并排除当前帧', () => {
    expect(
      resolveProjectionFrames({
        mode: 'keyframe',
        showAllKeyframes: true,
        frameIndex: 7,
        lastFrame: 20,
        selectedTrack: track,
      }),
    ).toEqual([0, 10, 5])
    expect(
      resolveProjectionFrames({
        mode: 'keyframe',
        showAllKeyframes: true,
        frameIndex: 5,
        lastFrame: 20,
        selectedTrack: track,
      }),
    ).toEqual([0, 10])
  })
})

describe('buildProjectionShapes', () => {
  const getFrameShapes = (frame) => [
    {
      id: 'a',
      type: 'rect',
      label: 'a',
      color: '#f00',
      geometry: { x: frame, y: frame, width: 10, height: 10 },
    },
    {
      id: 'b',
      type: 'point',
      label: 'b',
      color: '#0f0',
      geometry: { x: frame, y: frame },
    },
  ]

  it('为每个来源帧生成带来源信息的只读图形', () => {
    const shapes = buildProjectionShapes({ frames: [2, 4], getFrameShapes })
    expect(shapes).toHaveLength(4)
    expect(shapes[0]).toMatchObject({ id: 'a', sourceFrame: 2, key: '2:a' })
    expect(shapes[2]).toMatchObject({ id: 'a', sourceFrame: 4, key: '4:a' })
  })

  it('支持仅选中对象；没有选中时返回空', () => {
    const shapes = buildProjectionShapes({
      frames: [2, 4],
      getFrameShapes,
      selectedOnly: true,
      selectedId: 'a',
    })
    expect(shapes.map((shape) => shape.key)).toEqual(['2:a', '4:a'])
    expect(
      buildProjectionShapes({ frames: [2], getFrameShapes, selectedOnly: true, selectedId: null }),
    ).toEqual([])
  })
})

describe('buildProjectionSummary', () => {
  it('关闭或无来源时给出明确文案', () => {
    expect(buildProjectionSummary({ settings: DEFAULT_PROJECTION })).toBe('')
    expect(
      buildProjectionSummary({
        settings: { ...DEFAULT_PROJECTION, enabled: true },
        sourceFrames: [],
      }),
    ).toBe('无可投影帧')
  })

  it('描述来源、内容与透明度', () => {
    expect(
      buildProjectionSummary({
        settings: { ...DEFAULT_PROJECTION, enabled: true, mode: 'prev', offset: 1 },
        sourceFrames: [3],
      }),
    ).toBe('上一帧 · 第 4 帧 · 标注 · 35%')

    expect(
      buildProjectionSummary({
        settings: {
          ...DEFAULT_PROJECTION,
          enabled: true,
          mode: 'keyframe',
          showAllKeyframes: true,
          content: 'image',
          opacity: 0.5,
        },
        sourceFrames: [0, 4, 10],
      }),
    ).toBe('全部关键帧（3） · 第 1、5、11 帧 · 图像 · 50%')
  })
})

describe('useProjection', () => {
  function setup() {
    const datasetId = ref('d1')
    const frames = ref(
      Array.from({ length: 5 }, (_, index) => ({ index, url: `frame-${index}` })),
    )
    const frameIndex = ref(2)
    const lastFrame = computed(() => frames.value.length - 1)
    const selectedId = ref(null)
    const selectedTrack = computed(() => null)
    const getFrameShapes = vi.fn((datasetIdValue, frame) => [
      {
        id: 'a',
        type: 'rect',
        label: 'a',
        color: '#f00',
        geometry: { x: frame, y: frame, width: 10, height: 10 },
      },
      {
        id: 'b',
        type: 'point',
        label: 'b',
        color: '#0f0',
        geometry: { x: frame, y: frame },
      },
    ])
    const projection = useProjection({
      datasetId,
      frames,
      frameIndex,
      lastFrame,
      selectedId,
      selectedTrack,
      getFrameShapes,
    })
    return { projection, frames, frameIndex, selectedId, getFrameShapes }
  }

  it('指定帧只在本会话生效，不进入会话快照', () => {
    const { projection } = setup()
    projection.settings.enabled = true
    projection.settings.mode = 'custom'
    projection.settings.customFrame = 3
    expect(projection.sourceFrames.value).toEqual([3])
    expect(projection.snapshot().customFrame).toBeNull()
  })

  it('按选中对象过滤投影图形', () => {
    const { projection, selectedId } = setup()
    projection.settings.enabled = true
    projection.settings.mode = 'prev'
    expect(projection.shapes.value.map((shape) => shape.id)).toEqual(['a', 'b'])

    selectedId.value = 'a'
    projection.settings.selectedOnly = true
    expect(projection.shapes.value.map((shape) => shape.id)).toEqual(['a'])
  })

  it('仅图像模式不返回投影图形，只返回图像', () => {
    const { projection } = setup()
    projection.settings.enabled = true
    projection.settings.content = 'image'
    expect(projection.shapes.value).toEqual([])
    expect(projection.images.value).toHaveLength(1)
    expect(projection.images.value[0]).toMatchObject({ frameIndex: 1, url: 'frame-1' })
  })
})
