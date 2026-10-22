import { onBeforeUnmount, watch } from 'vue'

/**
 * 会话状态持久化（数据集、当前帧、编辑模式、标签等）。
 *
 * 与标注数据分开存储，避免写标注时携带大量无关字段。
 * 键名：lq2d:session:v1
 */

const STORAGE_KEY = 'lq2d:session:v1'
const VERSION = 1
const SAVE_DELAY = 300

/**
 * @param {() => object} getState 返回需要持久化的状态快照
 */
export function useSession(getState) {
  let timer = null

  /** 读取上次会话（无数据或版本不符返回 null） */
  function read() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const data = JSON.parse(raw)
      if (!data || data.version !== VERSION || typeof data.state !== 'object') return null
      return data.state
    } catch {
      return null
    }
  }

  /** 立即写入 */
  function write() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: VERSION,
          savedAt: new Date().toISOString(),
          state: getState(),
        }),
      )
    } catch {
      /* 忽略存储配额等错误 */
    }
  }

  /** 防抖保存 */
  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(write, SAVE_DELAY)
  }

  watch(getState, schedule, { deep: true })

  onBeforeUnmount(() => {
    clearTimeout(timer)
    write()
  })

  return { read, write }
}
