import { computed, reactive, watch } from 'vue'
import {
  DEFAULT_PROJECTION,
  buildProjectionShapes,
  buildProjectionSummary,
  normalizeProjectionSettings,
  resolveProjectionFrames,
} from '../utils/projection'

/**
 * 投影（跨帧只读叠加）的状态与派生数据。
 *
 * @param {{
 *   datasetId: import('vue').Ref<string>,
 *   frames: import('vue').Ref<Array<{ index: number, name: string, url: string }>>,
 *   frameIndex: import('vue').Ref<number>,
 *   lastFrame: import('vue').Ref<number>,
 *   selectedId: import('vue').Ref<string|null>,
 *   selectedTrack: import('vue').ComputedRef<object|null>,
 *   getFrameShapes: (datasetId: string, frameIndex: number) => Array,
 * }} options
 */
export function useProjection({
  datasetId,
  frames,
  frameIndex,
  lastFrame,
  selectedId,
  selectedTrack,
  getFrameShapes,
}) {
  const settings = reactive({ ...DEFAULT_PROJECTION })

  const sourceFrames = computed(() => {
    if (!settings.enabled) return []
    return resolveProjectionFrames({
      mode: settings.mode,
      offset: settings.offset,
      customFrame: settings.customFrame,
      showAllKeyframes: settings.showAllKeyframes,
      frameIndex: frameIndex.value,
      lastFrame: lastFrame.value,
      selectedTrack: selectedTrack.value,
    })
  })

  const shapes = computed(() => {
    if (!settings.enabled) return []
    if (settings.content !== 'shapes' && settings.content !== 'both') return []
    const id = datasetId.value
    if (!id) return []
    return buildProjectionShapes({
      frames: sourceFrames.value,
      selectedId: selectedId.value,
      // 关键帧模式天然只投影选中对象
      selectedOnly: settings.selectedOnly || settings.mode === 'keyframe',
      getFrameShapes: (frame) => getFrameShapes(id, frame),
    })
  })

  const images = computed(() => {
    if (!settings.enabled) return []
    if (settings.content !== 'image' && settings.content !== 'both') return []
    const list = []
    for (const frame of sourceFrames.value) {
      const item = frames.value[frame]
      if (item?.url) list.push({ frameIndex: frame, url: item.url })
    }
    return list
  })

  const summary = computed(() =>
    buildProjectionSummary({ settings, sourceFrames: sourceFrames.value }),
  )

  const canUseKeyframes = computed(() => Boolean(selectedTrack.value))

  const warning = computed(() => {
    if (settings.mode === 'keyframe' && !selectedTrack.value) {
      return '先选中一个对象才能投影关键帧'
    }
    if (settings.mode === 'custom' && !Number.isInteger(settings.customFrame)) {
      return '请输入有效的指定帧'
    }
    if (!settings.enabled) return ''
    if (
      settings.mode === 'keyframe' &&
      settings.showAllKeyframes &&
      sourceFrames.value.length > 50
    ) {
      return `将投影 ${sourceFrames.value.length} 个关键帧，可能影响性能`
    }
    return ''
  })

  /** 应用一份设置（来自控件或会话恢复），自动规范化 */
  function apply(raw, options = {}) {
    Object.assign(
      settings,
      normalizeProjectionSettings(raw, {
        frameCount: frames.value.length,
        ...options,
      }),
    )
  }

  function restore(raw, options = {}) {
    apply(raw, options)
  }

  /** 可序列化的设置快照（用于 useSession）；指定帧只在本会话内有效 */
  function snapshot() {
    return { ...settings, customFrame: null }
  }

  function reset() {
    Object.assign(settings, DEFAULT_PROJECTION)
  }

  function toggle() {
    settings.enabled = !settings.enabled
  }

  // 切换数据集后旧帧号不再可靠，指定帧回到上一帧模式
  watch(datasetId, () => {
    if (settings.customFrame != null) settings.customFrame = null
    if (settings.mode === 'custom') settings.mode = 'prev'
  })

  // 数据集帧数变少时移除失效的指定帧
  watch(
    () => frames.value.length,
    (length) => {
      if (settings.customFrame == null) return
      if (settings.customFrame < length) return
      settings.customFrame = null
      if (settings.mode === 'custom') settings.mode = 'prev'
    },
  )

  return {
    settings,
    sourceFrames,
    shapes,
    images,
    summary,
    warning,
    canUseKeyframes,
    apply,
    restore,
    snapshot,
    reset,
    toggle,
  }
}
