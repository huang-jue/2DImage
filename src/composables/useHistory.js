import { computed, ref } from 'vue'

/**
 * 撤销 / 重做（快照式）。
 *
 * 工作方式：
 *   - useAnnotation 在任何写操作前通过 onBeforeMutate 把「变更前快照」交给 record()。
 *   - undo() 把当前快照压入 future，再回放 past 栈顶快照。
 *   - redo() 反向操作。
 *
 * 快照通过外部传入的 capture / apply 与标注状态解耦，
 * 这样 useHistory 不需要知道 track 的具体结构。
 *
 * @param {{
 *   capture: () => object,        // 获取当前全量状态
 *   apply: (snapshot: object) => void, // 用快照覆盖当前状态
 *   limit?: number,               // 历史栈上限
 * }} options
 */
export function useHistory({ capture, apply, limit = 100 }) {
  const past = ref([])
  const future = ref([])
  const lastLabel = ref('')

  const canUndo = computed(() => past.value.length > 0)
  const canRedo = computed(() => future.value.length > 0)
  const undoCount = computed(() => past.value.length)
  const redoCount = computed(() => future.value.length)

  /**
   * 记录一个「变更前快照」。每次真实写操作调用一次。
   * @param {object} snapshot
   * @param {string} [label] 操作名称，用于提示
   */
  function record(snapshot, label = '') {
    if (!snapshot) return
    past.value.push({ snapshot, label })
    if (past.value.length > limit) past.value.shift()
    future.value = []
    lastLabel.value = label
  }

  /** 撤销一步，返回是否成功 */
  function undo() {
    if (!past.value.length) return false
    const entry = past.value.pop()
    future.value.push({ snapshot: capture(), label: entry.label })
    apply(entry.snapshot)
    lastLabel.value = entry.label
    return true
  }

  /** 重做一步，返回是否成功 */
  function redo() {
    if (!future.value.length) return false
    const entry = future.value.pop()
    past.value.push({ snapshot: capture(), label: entry.label })
    apply(entry.snapshot)
    lastLabel.value = entry.label
    return true
  }

  /** 清空历史（例如切换数据集或恢复存储后） */
  function clear() {
    past.value = []
    future.value = []
    lastLabel.value = ''
  }

  return {
    record,
    undo,
    redo,
    clear,
    canUndo,
    canRedo,
    undoCount,
    redoCount,
    lastLabel,
  }
}
