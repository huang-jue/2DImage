import { onBeforeUnmount, ref, watch } from 'vue'

/**
 * 标注自动保存 / 恢复（localStorage）。
 *
 * 存储结构：
 *   {
 *     version: 1,
 *     savedAt: ISO 字符串,
 *     datasets: { [datasetId]: track[] }
 *   }
 *
 * - 标注变化后 400ms 防抖写入，避免拖拽过程中频繁序列化。
 * - 页面卸载前强制 flush。
 * - 恢复时按数据集实际帧数裁剪越界几何。
 * - 存储配额不足时返回错误，由调用方提示用户手动导出。
 */

const STORAGE_KEY = 'lq2d:annotations:v1'
const VERSION = 1
const DEBOUNCE_MS = 400

/**
 * @param {{
 *   tracksByDataset: object,                  // 响应式标注状态
 *   getFrameCount: (datasetId: string) => number, // 数据集帧数
 *   onRestore: (datasets: object) => void,    // 恢复回调（整体替换标注状态）
 * }} options
 */
export function usePersistence({ tracksByDataset, getFrameCount, onRestore }) {
  const savedAt = ref(null) // 最近一次保存时间
  const saving = ref(false) // 是否正在保存
  const error = ref('') // 最近一次保存错误
  let timer = null
  let suspended = false

  /** 读取并校验存储内容 */
  function read() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const data = JSON.parse(raw)
      if (!data || data.version !== VERSION || typeof data.datasets !== 'object') return null
      return data
    } catch {
      return null
    }
  }

  /** 按数据集帧数裁剪快照中的越界几何 */
  function sanitize(datasets) {
    const clean = {}
    for (const [datasetId, list] of Object.entries(datasets || {})) {
      if (!Array.isArray(list)) continue
      const frameCount = getFrameCount(datasetId)
      // 本地数据集刷新后尚未重新导入：先原样保留，重新导入同名目录即可接续标注
      if (!frameCount) {
        clean[datasetId] = list
        continue
      }
      const tracks = []
      for (const track of list) {
        const geometries = track?.geometries
        if (!geometries || typeof geometries !== 'object') continue
        const kept = {}
        for (const [key, geometry] of Object.entries(geometries)) {
          const frame = Number(key)
          if (Number.isInteger(frame) && frame >= 0 && frame < frameCount && geometry) {
            kept[key] = geometry
          }
        }
        const keys = Object.keys(kept)
        if (!keys.length) continue
        tracks.push({ ...track, startFrame: Math.min(...keys.map(Number)), geometries: kept })
      }
      if (tracks.length) clean[datasetId] = tracks
    }
    return clean
  }

  /**
   * 从 localStorage 恢复标注。
   * @returns {boolean} 是否恢复了数据
   */
  function restore() {
    const data = read()
    if (!data) return false
    suspended = true
    try {
      onRestore(sanitize(data.datasets))
    } finally {
      suspended = false
    }
    savedAt.value = data.savedAt ? new Date(data.savedAt) : null
    return true
  }

  /** 立即写入 localStorage */
  function persist() {
    saving.value = true
    try {
      const payload = {
        version: VERSION,
        savedAt: new Date().toISOString(),
        datasets: tracksByDataset,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
      savedAt.value = new Date()
      error.value = ''
      return true
    } catch (cause) {
      error.value =
        cause?.name === 'QuotaExceededError'
          ? '本地存储空间不足，请导出 JSON 备份后清理'
          : '自动保存失败，请手动导出 JSON 备份'
      return false
    } finally {
      saving.value = false
    }
  }

  /** 防抖保存 */
  function schedule() {
    if (suspended) return
    clearTimeout(timer)
    timer = setTimeout(persist, DEBOUNCE_MS)
  }

  /** 取消防抖并立即保存 */
  function flush() {
    if (suspended) return
    clearTimeout(timer)
    return persist()
  }

  /** 清除存储（“清空全部”时可选） */
  function clearStorage() {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* 忽略 */
    }
    savedAt.value = null
  }

  /** 读取并解析用户选择的 JSON 文件 */
  async function readFile(file) {
    const text = await file.text()
    const data = JSON.parse(text)
    if (!data || !Array.isArray(data.tracks)) {
      throw new Error('文件格式不正确：缺少 tracks 数组')
    }
    return data
  }

  const stopWatch = watch(tracksByDataset, schedule, { deep: true })
  const handleUnload = () => flush()
  window.addEventListener('beforeunload', handleUnload)

  onBeforeUnmount(() => {
    stopWatch()
    window.removeEventListener('beforeunload', handleUnload)
    clearTimeout(timer)
  })

  return {
    savedAt,
    saving,
    error,
    restore,
    persist,
    flush,
    clearStorage,
    readFile,
  }
}
