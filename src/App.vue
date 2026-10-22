<script setup>
/**
 * 应用主页面：串联数据集、标注状态、工具栏、画布、对象面板与帧条。
 *
 * 数据流：
 *   useDatasets    提供数据集与帧列表（静态发现 + 本地导入 + 校验）
 *   useAnnotation  管理按数据集隔离的跨帧标注（track）
 *   useHistory     记录写操作前的快照，提供撤销/重做
 *   usePersistence 自动保存到 localStorage，启动时恢复
 *   useLabels      全局标签类别（数字快捷键）
 *   画布通过 shapes(当前帧) 渲染，编辑结果经 create/update/select/delete 回流到 useAnnotation
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Expand, Fold, Moon, Picture, QuestionFilled, Sunny } from '@element-plus/icons-vue'
import AnnotationCanvas from './components/AnnotationCanvas.vue'
import AnnotationToolbar from './components/AnnotationToolbar.vue'
import FrameStrip from './components/FrameStrip.vue'
import ObjectPanel from './components/ObjectPanel.vue'
import LabelManager from './components/LabelManager.vue'
import ShortcutHelp from './components/ShortcutHelp.vue'
import ExportDialog from './components/ExportDialog.vue'
import { useDatasets } from './composables/useDatasets'
import { useAnnotation } from './composables/useAnnotation'
import { useHistory } from './composables/useHistory'
import { usePersistence } from './composables/usePersistence'
import { useLabels } from './composables/useLabels'
import { useShortcuts } from './composables/useShortcuts'
import { useSession } from './composables/useSession'
import { pickLocalDirectory } from './composables/useLocalDataset'
import { useTheme } from './composables/useTheme'
import { buildExportFiles, downloadExportFiles, validateBundles } from './utils/exporters'

const {
  datasets,
  report,
  totalFrames,
  minFrames,
  getFrameCount,
  addLocalDataset,
  removeLocalDataset,
  isLocalDataset,
  verifyAllFrames,
  detectDuplicateFrames,
} = useDatasets()
const { labels, ensureLabel } = useLabels()
const { dark, toggleTheme } = useTheme()

// 标注状态：每次写操作前把快照交给 undo 历史
const annotation = useAnnotation({ onBeforeMutate: recordSnapshot })
const history = useHistory({
  capture: () => annotation.exportAll(),
  apply: (snapshot) => annotation.restoreAll(snapshot),
})
const { canUndo, canRedo, undo, redo } = history

// 自动保存到 localStorage，启动时可恢复
const {
  savedAt,
  saving,
  error: saveError,
  restore,
  readFile,
} = usePersistence({
  tracksByDataset: annotation.tracksByDataset,
  getFrameCount: (datasetId) => getFrameCount(datasetId),
  onRestore: (snapshot) => annotation.restoreAll(snapshot),
})

const activeId = ref(datasets.value[0]?.id ?? '') // 当前数据集 id
const frameIndex = ref(0) // 当前帧序号
const tool = ref('select') // 当前工具
const label = ref(labels[0]?.name ?? '') // 新建标注的标签（默认第一个类别）
const color = ref(labels[0]?.color ?? '#409eff') // 新建标注的颜色
const editMode = ref('forward') // 编辑传播模式：frame | forward | all
const fillMode = ref('forward') // 新建填充模式：forward=到末帧，frame=仅当前帧（关键帧模式）
const selectedIds = ref([]) // 选中的 track id 列表（支持多选）
// 主选中对象：兼容原有单对象逻辑；赋值时替换整个选区
const selectedId = computed({
  get: () => selectedIds.value[0] ?? null,
  set: (value) => {
    selectedIds.value = value ? [value] : []
  },
})
const verification = ref([]) // 数据校验结果
const autoAdvance = ref(false) // 画完是否自动跳帧
const panelVisible = ref(true)
const showLabels = ref(true) // 画布是否显示标签文字
const labelManagerVisible = ref(false)
const shortcutHelpVisible = ref(false)
const exportDialogVisible = ref(false)
const exporting = ref(false)
const clipboard = ref(null) // 应用内对象剪贴板：{ datasetId, frameIndex, tracks }
const canvasRef = ref(null)

// —— 派生状态 ——
const activeDataset = computed(
  () => datasets.value.find((item) => item.id === activeId.value) || datasets.value[0],
)
const frames = computed(() => activeDataset.value?.frames ?? [])
const lastFrame = computed(() => Math.max(frames.value.length - 1, 0))
const imageUrl = computed(() => frames.value[frameIndex.value]?.url ?? '')
// 当前帧需要渲染的图形
const shapes = computed(() =>
  activeId.value ? annotation.getFrameShapes(activeId.value, frameIndex.value) : [],
)
const trackCount = computed(() =>
  activeId.value ? annotation.countTracks(activeId.value) : 0,
)
const tracks = computed(() =>
  activeId.value ? annotation.getTracks(activeId.value) : [],
)
// 主选中对象（多选时用于帧条关键帧标记）
const primaryTrack = computed(() =>
  selectedId.value ? annotation.getTrack(activeId.value, selectedId.value) : null,
)
// 主选中对象在当前数据集内所有有几何的帧
const selectedFrames = computed(() => {
  const track = primaryTrack.value
  return track ? Object.keys(track.geometries).map(Number) : []
})
// 主选中对象的关键帧
const selectedKeyframes = computed(() => {
  const track = primaryTrack.value
  return track && Array.isArray(track.keyframes) ? [...track.keyframes] : []
})
// 含标注的帧序号集合（供帧条显示标记）
const markedFrames = computed(() => {
  if (!activeId.value) return []
  const set = new Set()
  for (const track of annotation.getTracks(activeId.value)) {
    for (const key of Object.keys(track.geometries)) set.add(Number(key))
  }
  return [...set]
})
// 相邻帧图片地址（画布预加载，减少切帧等待）
const preloadUrls = computed(() => {
  const urls = []
  for (const offset of [-2, -1, 1, 2]) {
    const item = frames.value[frameIndex.value + offset]
    if (item) urls.push(item.url)
  }
  return urls
})

/** 自动保存状态文案 */
const savedText = computed(() => {
  if (!savedAt.value) return '未保存'
  const time = savedAt.value.toLocaleTimeString('zh-CN', { hour12: false })
  return `已保存 ${time}`
})

// 会话状态（数据集 / 帧 / 模式 / 标签等）持久化
const session = useSession(() => ({
  activeId: activeId.value,
  frameIndex: frameIndex.value,
  editMode: editMode.value,
  fillMode: fillMode.value,
  label: label.value,
  color: color.value,
  panelVisible: panelVisible.value,
  showLabels: showLabels.value,
}))

/** 应用上次会话，非法值忽略 */
function applySession(state) {
  if (!state || typeof state !== 'object') return
  if (
    typeof state.activeId === 'string' &&
    datasets.value.some((item) => item.id === state.activeId)
  ) {
    activeId.value = state.activeId
  }
  const length = frames.value.length
  if (
    Number.isInteger(state.frameIndex) &&
    state.frameIndex >= 0 &&
    state.frameIndex < length
  ) {
    frameIndex.value = state.frameIndex
  }
  if (['frame', 'forward', 'all'].includes(state.editMode)) editMode.value = state.editMode
  if (['forward', 'frame'].includes(state.fillMode)) fillMode.value = state.fillMode
  if (typeof state.label === 'string') label.value = state.label
  if (typeof state.color === 'string' && state.color) color.value = state.color
  if (typeof state.panelVisible === 'boolean') panelVisible.value = state.panelVisible
  if (typeof state.showLabels === 'boolean') showLabels.value = state.showLabels
}

/** 记录历史快照（由 useAnnotation 在写操作前调用） */
function recordSnapshot(snapshot) {
  history.record(snapshot)
}

/** 当前选中的 track（可能为 null） */
function selectedTrack() {
  if (!selectedId.value) return null
  return annotation.getTrack(activeId.value, selectedId.value)
}

/** 锁定对象禁止编辑，返回是否允许继续 */
function ensureUnlocked() {
  const track = selectedTrack()
  if (track?.locked) {
    ElMessage.warning('对象已锁定，请先在对象面板解锁')
    return false
  }
  return true
}

// —— 画布事件处理 ——
/** 新建标注：按新建填充模式决定是否延伸到末帧，并选中新对象 */
function handleCreate(payload) {
  const track = annotation.createTrack(activeId.value, {
    ...payload,
    // 仅当前帧 = 关键帧模式，只生成一个帧的几何
    lastFrame: fillMode.value === 'frame' ? frameIndex.value : lastFrame.value,
    label: label.value,
    color: color.value,
  })
  if (!track) return
  selectedId.value = track.id
  // 标签不在类别列表中时自动创建类别，便于后续复用
  if (track.label) ensureLabel(track.label)
  if (autoAdvance.value && frameIndex.value < lastFrame.value) frameIndex.value += 1
}

/** 编辑标注：按当前编辑模式传播 */
function handleUpdate({ trackId, geometry }) {
  const track = annotation.getTrack(activeId.value, trackId)
  if (track?.locked) return
  annotation.updateFromFrame(
    activeId.value,
    trackId,
    frameIndex.value,
    geometry,
    lastFrame.value,
    editMode.value,
  )
}

/** 批量编辑（组拖动 / 多选变换），单步撤销 */
function handleUpdateMany(updates) {
  if (!updates?.length) return
  annotation.updateManyFromFrame(
    activeId.value,
    updates,
    frameIndex.value,
    lastFrame.value,
    editMode.value,
  )
}

/** 删除整条 track */
function handleDelete(trackId) {
  const id = trackId || selectedId.value
  if (!id) return
  const track = annotation.getTrack(activeId.value, id)
  if (track?.locked) {
    ElMessage.warning('对象已锁定，请先在对象面板解锁')
    return
  }
  annotation.deleteTrack(activeId.value, id)
  selectedIds.value = selectedIds.value.filter((item) => item !== id)
}

/** 批量删除选中对象（锁定对象会被跳过） */
function handleDeleteSelected() {
  if (!selectedIds.value.length) return
  const tracks = selectedIds.value
    .map((id) => annotation.getTrack(activeId.value, id))
    .filter(Boolean)
  const lockedCount = tracks.filter((track) => track.locked).length
  const ids = tracks.filter((track) => !track.locked).map((track) => track.id)
  if (!ids.length) {
    ElMessage.warning('选中的对象都已锁定，请先解锁')
    return
  }
  const deleted = annotation.deleteTracks(activeId.value, ids)
  selectedIds.value = selectedIds.value.filter((id) => !ids.includes(id))
  if (lockedCount) {
    ElMessage.warning(`已删除 ${deleted} 个对象，跳过 ${lockedCount} 个锁定对象`)
  }
}

/** 仅删除当前帧的标注 */
function handleDeleteAtFrame() {
  if (!selectedId.value || !ensureUnlocked()) return
  if (!annotation.deleteAtFrame(activeId.value, selectedId.value, frameIndex.value)) return
  if (!annotation.getTrack(activeId.value, selectedId.value)) selectedId.value = null
  ElMessage.success('已删除当前帧标注')
}

/** 从当前帧起删除（若对象被删空则取消选中） */
function handleDeleteFromFrame() {
  if (!selectedId.value || !ensureUnlocked()) return
  annotation.deleteFromFrame(activeId.value, selectedId.value, frameIndex.value)
  if (!annotation.getTrack(activeId.value, selectedId.value)) selectedId.value = null
}

/** 在当前帧拆分对象（当前帧及之后成为新对象） */
function handleSplitTrack() {
  if (!selectedId.value || !ensureUnlocked()) return
  const result = annotation.splitTrack(activeId.value, selectedId.value, frameIndex.value)
  if (!result) {
    ElMessage.info('请跳到对象中间的帧再拆分（前后都需要有几何）')
    return
  }
  selectedIds.value = [result.track.id]
  ElMessage.success('已拆分对象，可分别编辑前后两段')
}

/** 合并选中对象（重叠帧保留第一个对象的几何） */
async function handleMergeTracks() {
  if (selectedIds.value.length < 2) return
  const tracks = selectedIds.value
    .map((id) => annotation.getTrack(activeId.value, id))
    .filter(Boolean)
  if (tracks.some((track) => track.locked)) {
    ElMessage.warning('选中的对象中包含锁定对象，请先解锁')
    return
  }
  if (new Set(tracks.map((track) => track.type)).size > 1) {
    ElMessage.warning('只能合并相同类型的对象')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将把选中的 ${tracks.length} 个对象合并为一个，重叠帧保留第一个对象的几何，是否继续？`,
      '合并对象',
      { type: 'warning', confirmButtonText: '合并', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  const result = annotation.mergeTracks(activeId.value, selectedIds.value)
  if (!result) {
    ElMessage.warning('合并失败')
    return
  }
  selectedIds.value = [result.track.id]
  ElMessage.success(
    result.conflicts
      ? `已合并 ${result.merged} 个对象，${result.conflicts} 个重叠帧保留第一个对象`
      : `已合并 ${result.merged} 个对象`,
  )
}

/** 复制选中对象到应用内剪贴板 */
function handleCopy() {
  if (!selectedIds.value.length) return
  const tracks = annotation.exportTracks(activeId.value, selectedIds.value)
  if (!tracks.length) return
  clipboard.value = {
    datasetId: activeId.value,
    frameIndex: frameIndex.value,
    tracks,
  }
  ElMessage.success(`已复制 ${tracks.length} 个对象`)
}

/** 粘贴剪贴板对象到当前帧 */
function handlePaste() {
  if (!clipboard.value?.tracks?.length) return
  const copies = annotation.pasteTracks(
    activeId.value,
    clipboard.value,
    frameIndex.value,
    lastFrame.value,
    fillMode.value,
  )
  if (!copies.length) {
    ElMessage.warning('剪贴板中没有可粘贴的对象')
    return
  }
  selectedIds.value = copies.map((track) => track.id)
  ElMessage.success(`已粘贴 ${copies.length} 个对象`)
}

/** 复制选中对象 */
function handleDuplicate() {
  if (!selectedIds.value.length) return
  const copies = annotation.duplicateTracks(activeId.value, selectedIds.value)
  if (copies.length) selectedIds.value = copies.map((track) => track.id)
}

/** 把上一帧存在、当前帧缺失的对象复制过来 */
function handleCopyPrevious() {
  const count = annotation.copyFromPreviousFrame(
    activeId.value,
    frameIndex.value,
    lastFrame.value,
  )
  if (count) ElMessage.success(`已从上一帧复制 ${count} 个对象`)
  else ElMessage.info('上一帧没有可复制的对象')
}

/** 在当前帧插入关键帧（复制最近关键帧几何，便于后续插值） */
function handleAddKeyframe(trackId = null) {
  if (trackId) selectedId.value = trackId
  if (!selectedId.value || !ensureUnlocked()) return
  const track = selectedTrack()
  if (!track) return
  if ((track.keyframes || []).includes(frameIndex.value)) {
    ElMessage.info('当前帧已经是关键帧')
    return
  }
  const hadGeometry = Boolean(track.geometries[frameIndex.value])
  const wasHidden = track.visible === false
  const ok = annotation.addKeyframe(
    activeId.value,
    selectedId.value,
    frameIndex.value,
    null,
    { reveal: true },
  )
  if (ok) {
    tool.value = 'select'
    if (hadGeometry) {
      ElMessage.success('已在当前帧插入关键帧，可直接拖动调整；随后点「插值补全」重新计算中间帧')
    } else {
      ElMessage.success(
        wasHidden
          ? '已插入关键帧并恢复显示，可直接拖动调整；随后点「插值补全」生成中间帧'
          : '已插入关键帧，可直接拖动调整；随后点「插值补全」生成中间帧',
      )
    }
  } else {
    ElMessage.warning('插入关键帧失败')
  }
}

/** 在整条对象的所有相邻关键帧之间插值 */
function handleInterpolate() {
  if (!selectedId.value || !ensureUnlocked()) return
  const track = selectedTrack()
  if (!track) return
  const keyframes = (track.keyframes || []).filter((key) => track.geometries[key])
  if (keyframes.length < 2) {
    ElMessage.info('至少需要两个关键帧：先跳到目标帧点「插入关键帧」')
    return
  }
  const filled = annotation.interpolate(activeId.value, selectedId.value)
  if (filled) {
    ElMessage.success(`已按关键帧重新计算 ${filled} 帧`)
    return
  }
  ElMessage.info('关键帧之间没有需要重新计算的帧（或折线点数不一致）')
}

/** 把对象几何向更早的帧补齐 */
function handleExtendBackward() {
  if (!selectedId.value || !ensureUnlocked()) return
  const track = selectedTrack()
  if (!track) return
  const range = annotation.getTrackFrameRange(track)
  if (frameIndex.value >= range.start) {
    ElMessage.info('请先跳到对象起始帧之前的帧再补标')
    return
  }
  const geometry = track.geometries[range.start]
  const ok = annotation.extendBackward(
    activeId.value,
    selectedId.value,
    frameIndex.value,
    geometry,
  )
  if (ok) ElMessage.success('已向前补标')
}

/** 把对象末帧几何延伸到末帧 */
function handleExtendForward() {
  if (!selectedId.value || !ensureUnlocked()) return
  const ok = annotation.extendForward(activeId.value, selectedId.value, lastFrame.value)
  if (ok) ElMessage.success('已向后补标')
  else ElMessage.info('对象已延伸到末帧')
}

/** 清空当前数据集全部标注 */
function handleClear() {
  annotation.clearDataset(activeId.value)
  selectedId.value = null
}

/** 撤销 / 重做；恢复后若选中对象已不存在则取消选中 */
function handleUndo() {
  if (undo()) ensureSelectionValid()
}

function handleRedo() {
  if (redo()) ensureSelectionValid()
}

/** 选中对象是否仍存在，不存在则从选区移除 */
function ensureSelectionValid() {
  if (!selectedIds.value.length) return
  const valid = selectedIds.value.filter((id) => annotation.getTrack(activeId.value, id))
  if (valid.length !== selectedIds.value.length) selectedIds.value = valid
}

/** 选中对象；additive=true 时切换多选 */
function handleSelectTrack(id, additive = false) {
  if (!id) {
    selectedIds.value = []
    return
  }
  if (!additive) {
    selectedIds.value = [id]
    return
  }
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((item) => item !== id)
    : [...selectedIds.value, id]
}

/** 画布选择事件：{ id, additive } */
function handleCanvasSelect(payload) {
  if (!payload || typeof payload !== 'object') {
    handleSelectTrack(payload || null, false)
    return
  }
  handleSelectTrack(payload.id || null, payload.additive === true)
}

/** 距离当前帧最近的关键帧序号 */
function nearestKeyframe(track, index) {
  const keys = Object.keys(track.geometries)
    .map(Number)
    .sort((a, b) => a - b)
  if (!keys.length) return 0
  let best = keys[0]
  for (const key of keys) {
    if (Math.abs(key - index) < Math.abs(best - index)) best = key
  }
  return best
}

/** 定位到对象最近的关键帧 */
function handleLocateTrack(id) {
  const track = annotation.getTrack(activeId.value, id)
  if (!track) return
  selectedId.value = id
  frameIndex.value = nearestKeyframe(track, frameIndex.value)
}

/** 对象面板修改标签 / 颜色 / 可见 / 锁定 */
function handleUpdateMeta({ id, patch }) {
  const track = annotation.getTrack(activeId.value, id)
  // 显示/隐藏只控制已有几何的显隐；当前帧没有关键帧时给出明确提示
  if (patch.visible === true && track && !track.geometries[frameIndex.value]) {
    ElMessage.info('该对象在当前帧没有关键帧，请点对象右侧的「+」插入关键帧')
  }
  annotation.updateTrackMeta(activeId.value, id, patch)
}

/** 批量修改选中对象的可见 / 锁定状态 */
function handleBatchMeta(patch) {
  if (!selectedIds.value.length) return
  const count = annotation.updateTracksMeta(activeId.value, selectedIds.value, patch)
  if (count) ElMessage.success(`已更新 ${count} 个对象`)
}

/** 把工具栏当前的标签 / 颜色应用到选中对象 */
function handleApplyStyle() {
  if (!selectedIds.value.length) return
  const count = annotation.updateTracksMeta(activeId.value, selectedIds.value, {
    label: label.value,
    color: color.value,
  })
  if (count) ElMessage.success(`已应用到 ${count} 个对象`)
}

/** 组装导出用的数据集包（当前 / 全部） */
function buildBundles(scope) {
  const list =
    scope === 'all' ? datasets.value : activeDataset.value ? [activeDataset.value] : []
  return list.map((dataset) => {
    const data = annotation.exportDataset(dataset.id, {
      name: dataset.name,
      frameCount: dataset.frames.length,
    })
    return {
      dataset: dataset.id,
      name: dataset.name,
      frames: dataset.frames,
      tracks: data.tracks,
    }
  })
}

/** 打开导出对话框 */
function handleExport() {
  exportDialogVisible.value = true
}

/**
 * 执行导出：先校验，再生成文件（多文件自动打包 zip）。
 * @param {string} format json | coco | yolo | mot | csv
 * @param {'current'|'all'} scope
 */
async function runExport(format, scope) {
  if (exporting.value) return
  exporting.value = true
  try {
    const bundles = buildBundles(scope)
    if (!bundles.length) {
      ElMessage.warning('没有可导出的数据集')
      return
    }
    const totalTracks = bundles.reduce((sum, bundle) => sum + bundle.tracks.length, 0)
    if (!totalTracks) {
      ElMessage.warning('所选范围还没有标注对象')
      return
    }

    const issues = await validateBundles(bundles)
    if (issues.length) {
      const preview = issues
        .slice(0, 5)
        .map((item) => {
          const frame = item.frame == null ? '' : ` 第 ${item.frame + 1} 帧`
          return `${item.datasetName}${frame} #${item.trackId}：${item.message}`
        })
        .join('；')
      try {
        await ElMessageBox.confirm(
          `发现 ${issues.length} 个问题：${preview}${issues.length > 5 ? ' 等' : ''}`,
          '导出校验',
          { type: 'warning', confirmButtonText: '仍然导出', cancelButtonText: '取消' },
        )
      } catch {
        return
      }
    }

    const files = await buildExportFiles(format, bundles)
    const base = scope === 'all' ? 'annotations-all' : `${activeId.value}-${format}`
    downloadExportFiles(files, base)
    exportDialogVisible.value = false
    ElMessage.success(`已导出 ${files.length} 个文件`)
  } catch (error) {
    ElMessage.error(error?.message || '导出失败')
  } finally {
    exporting.value = false
  }
}

/** 导出对话框确认 */
function handleExportConfirm({ format, scope }) {
  runExport(format, scope)
}

/** 导入标注 JSON（合并到对应数据集，默认取当前数据集） */
async function handleImportFile(file) {
  try {
    const data = await readFile(file)
    const targetId = datasets.value.some((item) => item.id === data.dataset)
      ? data.dataset
      : activeId.value
    if (!targetId) {
      ElMessage.error('没有可导入的数据集')
      return
    }
    if (annotation.countTracks(targetId)) {
      await ElMessageBox.confirm(
        `当前数据集已有 ${annotation.countTracks(targetId)} 个对象，导入将追加到现有标注，是否继续？`,
        '导入标注',
        { type: 'warning', confirmButtonText: '导入', cancelButtonText: '取消' },
      )
    }
    const count = annotation.importDataset(targetId, data)
    if (!count) {
      ElMessage.error('文件中没有可导入的标注')
      return
    }
    activeId.value = targetId
    ElMessage.success(`已导入 ${count} 个对象`)
  } catch (error) {
    if (error !== 'cancel') ElMessage.error(error?.message || '导入失败')
  }
}

/** 导入本地图片目录（File System Access API / 目录 input） */
async function handleImportDirectory() {
  try {
    const picked = await pickLocalDirectory()
    if (!picked) return
    const dataset = addLocalDataset(picked)
    if (!dataset) {
      ElMessage.error('所选目录中没有图片文件')
      return
    }
    activeId.value = dataset.id
    ElMessage.success(`已导入 ${dataset.name}（${dataset.frames.length} 帧）`)
    refreshVerification()
  } catch (error) {
    ElMessage.error(error?.message || '导入目录失败')
  }
}

/** 移除当前本地数据集（静态数据集不可移除） */
async function handleRemoveDataset() {
  if (!isLocalDataset(activeId.value)) return
  try {
    await ElMessageBox.confirm(
      `将移除本地数据集「${activeDataset.value?.name}」，其标注也会一并清除，是否继续？`,
      '移除本地数据集',
      { type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  annotation.clearDataset(activeId.value)
  removeLocalDataset(activeId.value)
  selectedId.value = null
  activeId.value = datasets.value[0]?.id ?? ''
  refreshVerification()
}

/** 重新校验所有数据集 */
async function refreshVerification() {
  verification.value = await verifyAllFrames()
}

/** 校验标签级别：加载失败/尺寸不一致=红，帧数不足=黄 */
function verifyType(id) {
  const result = verification.value.find((item) => item.id === id)
  if (!result) return 'success'
  if (!result.ok) return 'danger'
  return result.recommended ? 'success' : 'warning'
}

/** 校验标签的悬停提示 */
function verifyTitle(id) {
  const result = verification.value.find((item) => item.id === id)
  if (!result) return ''
  const parts = []
  if (result.failures.length) parts.push(`加载失败：${result.failures.join('、')}`)
  if (result.inconsistent.length) parts.push(`尺寸不一致：${result.inconsistent.join('、')}`)
  if (result.expected < minFrames) parts.push(`帧数不足 ${minFrames} 帧`)
  return parts.join('\n')
}

// —— 视图与快捷键辅助 ——
function setTool(value) {
  tool.value = value
}

/** 按类别列表序号（0 基）切换标签与颜色 */
function applyLabelIndex(index) {
  const item = labels[index]
  if (!item) return
  label.value = item.name
  color.value = item.color
}

/** 相对当前帧跳转（自动夹取范围） */
function goFrameBy(delta) {
  const next = Math.min(Math.max(frameIndex.value + delta, 0), lastFrame.value)
  frameIndex.value = next
}

/** 跳转到上一个 / 下一个未标注帧 */
function goUnmarked(direction) {
  const marked = new Set(markedFrames.value)
  const list = frames.value
    .map((frame) => frame.index)
    .filter((index) => !marked.has(index))
  if (!list.length) return
  if (direction > 0) {
    const next = list.find((index) => index > frameIndex.value)
    if (next != null) frameIndex.value = next
  } else {
    const prev = [...list].reverse().find((index) => index < frameIndex.value)
    if (prev != null) frameIndex.value = prev
  }
}

/** 微调选中对象；返回是否成功 */
function nudgeSelected(dx, dy) {
  if (!selectedIds.value.length) return false
  return (
    annotation.nudgeTracks(
      activeId.value,
      selectedIds.value,
      frameIndex.value,
      dx,
      dy,
      lastFrame.value,
      editMode.value,
    ) > 0
  )
}

/**
 * 方向键：选择工具下且有选中对象时微调，否则切帧。
 * 上下方向键只在微调时生效。
 */
function handleArrow(dx, dy, frameDelta) {
  if (tool.value === 'select' && nudgeSelected(dx, dy)) return
  if (dx !== 0) goFrameBy(frameDelta)
}

useShortcuts({
  'mod+z': handleUndo,
  'mod+shift+z': handleRedo,
  'mod+y': handleRedo,
  'mod+d': handleDuplicate,
  'mod+c': handleCopy,
  'mod+v': handlePaste,
  'mod+s': handleExport,
  v: () => setTool('select'),
  r: () => setTool('rect'),
  p: () => setTool('point'),
  l: () => setTool('line'),
  g: () => setTool('polygon'),
  1: () => applyLabelIndex(0),
  2: () => applyLabelIndex(1),
  3: () => applyLabelIndex(2),
  4: () => applyLabelIndex(3),
  5: () => applyLabelIndex(4),
  6: () => applyLabelIndex(5),
  7: () => applyLabelIndex(6),
  8: () => applyLabelIndex(7),
  9: () => applyLabelIndex(8),
  arrowleft: () => handleArrow(-1, 0, -1),
  arrowright: () => handleArrow(1, 0, 1),
  arrowup: () => handleArrow(0, -1, 0),
  arrowdown: () => handleArrow(0, 1, 0),
  'shift+arrowleft': () => handleArrow(-10, 0, -10),
  'shift+arrowright': () => handleArrow(10, 0, 10),
  'shift+arrowup': () => handleArrow(0, -10, 0),
  'shift+arrowdown': () => handleArrow(0, 10, 0),
  n: () => goUnmarked(1),
  'shift+n': () => goUnmarked(-1),
  '0': () => canvasRef.value?.fitView(),
  plus: () => canvasRef.value?.zoomIn(),
  minus: () => canvasRef.value?.zoomOut(),
  'shift+?': () => {
    shortcutHelpVisible.value = true
  },
})

// 切换数据集：回到第 0 帧并清除选中（sync 便于恢复会话时随后覆盖帧号）
watch(
  activeId,
  () => {
    frameIndex.value = 0
    selectedId.value = null
  },
  { flush: 'sync' },
)

// 帧数变化（如重新导入同名目录、切换数据集）时把当前帧夹取到合法范围
watch(
  () => frames.value.length,
  (length) => {
    if (frameIndex.value >= length) frameIndex.value = Math.max(length - 1, 0)
  },
)

// 挂载后：先恢复自动保存的标注，再校验所有帧能否正常加载
onMounted(async () => {
  if (restore()) {
    ElMessage.info('已恢复上次自动保存的标注')
  }
  // 恢复上次会话（数据集 / 当前帧 / 编辑模式等）
  applySession(session.read())
  verification.value = await verifyAllFrames()
  const failed = verification.value.filter((item) => !item.ok)
  const short = verification.value.filter((item) => item.ok && !item.recommended)
  if (failed.length) {
    ElMessage.error(`${failed.length} 份数据加载或尺寸校验未通过，请检查图片`)
  } else if (short.length) {
    ElMessage.warning(
      `${short.length} 份数据集帧数少于建议的 ${minFrames} 帧，仍可正常标注`,
    )
  } else {
    ElMessage.success(
      `数据校验通过：${datasets.value.length} 份 / ${totalFrames.value} 帧全部加载成功`,
    )
  }

  // 内容级重复帧检测（哈希相同才算重复）
  try {
    const duplicateGroups = await detectDuplicateFrames()
    if (duplicateGroups.length) {
      const preview = duplicateGroups
        .slice(0, 3)
        .map((group) => group.map((item) => `${item.datasetName}/${item.name}`).join(' = '))
        .join('；')
      ElMessage.warning(
        `检测到 ${duplicateGroups.length} 组内容相同的帧：${preview}${duplicateGroups.length > 3 ? ' 等' : ''}`,
      )
    }
  } catch {
    /* 重复检测失败不影响主流程 */
  }
})
</script>

<template>
  <div class="app">
    <!-- 顶部：标题、数据集切换、保存状态、数据校验标签 -->
    <header class="app__header">
      <div class="app__title">
        <el-icon :size="22"><Picture /></el-icon>
        <h1>2D 多帧图像标注</h1>
      </div>
      <el-radio-group v-model="activeId" class="app__datasets">
        <el-radio-button
          v-for="dataset in datasets"
          :key="dataset.id"
          :value="dataset.id"
        >
          {{ dataset.name }} · {{ dataset.frames.length }} 帧
        </el-radio-button>
      </el-radio-group>
      <div class="app__header-actions">
        <el-button size="small" @click="handleImportDirectory">导入目录</el-button>
        <el-button
          v-if="isLocalDataset(activeId)"
          size="small"
          type="danger"
          plain
          @click="handleRemoveDataset"
        >
          移除本地数据集
        </el-button>
        <el-button
          :icon="panelVisible ? Fold : Expand"
          size="small"
          @click="panelVisible = !panelVisible"
        >
          对象面板
        </el-button>
        <el-checkbox v-model="showLabels" size="small" class="app__labels-toggle">
          显示标签
        </el-checkbox>
        <el-button
          :icon="dark ? Sunny : Moon"
          size="small"
          :title="dark ? '切换到浅色主题' : '切换到深色主题'"
          @click="toggleTheme"
        />
        <el-button
          :icon="QuestionFilled"
          size="small"
          title="快捷键"
          @click="shortcutHelpVisible = true"
        />
      </div>
      <div class="app__verify">
        <el-tag v-if="saveError" type="danger" effect="plain" size="small" class="app__save-tag">
          {{ saveError }}
        </el-tag>
        <el-tag v-else type="info" effect="plain" size="small" class="app__save-tag">
          {{ saving ? '保存中…' : savedText }}
        </el-tag>
        <el-tag
          v-for="item in report"
          :key="item.id"
          :type="verifyType(item.id)"
          effect="plain"
          size="small"
          class="app__verify-tag"
          :title="verifyTitle(item.id)"
          @click="activeId = item.id"
        >
          {{ item.name }}：{{ item.frames }} 帧
          <span v-if="item.source === 'local'" class="app__verify-local">本地</span>
        </el-tag>
      </div>
    </header>

    <!-- 工具栏 -->
    <section class="app__toolbar">
      <AnnotationToolbar
        v-model:tool="tool"
        v-model:label="label"
        v-model:color="color"
        v-model:edit-mode="editMode"
        v-model:fill-mode="fillMode"
        :labels="labels"
        :selected-count="selectedIds.length"
        :has-clipboard="Boolean(clipboard)"
        :frame-index="frameIndex"
        :frame-count="frames.length"
        :frame-shape-count="shapes.length"
        :track-count="trackCount"
        :can-undo="canUndo"
        :can-redo="canRedo"
        @apply-selection="handleApplyStyle"
        @delete="handleDeleteSelected"
        @delete-at-frame="handleDeleteAtFrame"
        @delete-from-frame="handleDeleteFromFrame"
        @duplicate="handleDuplicate"
        @copy="handleCopy"
        @paste="handlePaste"
        @split="handleSplitTrack"
        @merge="handleMergeTracks"
        @copy-previous="handleCopyPrevious"
        @add-keyframe="handleAddKeyframe"
        @interpolate="handleInterpolate"
        @extend-backward="handleExtendBackward"
        @extend-forward="handleExtendForward"
        @clear="handleClear"
        @export="handleExport"
        @import-file="handleImportFile"
        @undo="handleUndo"
        @redo="handleRedo"
        @manage-labels="labelManagerVisible = true"
      />
    </section>

    <!-- 画布 + 对象面板 -->
    <div class="app__main">
      <main class="app__canvas">
        <AnnotationCanvas
          ref="canvasRef"
          :image-url="imageUrl"
          :frame-index="frameIndex"
          :shapes="shapes"
          :tool="tool"
          :selected-ids="selectedIds"
          :color="color"
          :show-labels="showLabels"
          :preload-urls="preloadUrls"
          @create="handleCreate"
          @update="handleUpdate"
          @update-many="handleUpdateMany"
          @select="handleCanvasSelect"
          @delete-selected="handleDeleteSelected"
        />
      </main>
      <ObjectPanel
        v-if="panelVisible"
        :tracks="tracks"
        :selected-ids="selectedIds"
        :frame-index="frameIndex"
        @select="handleSelectTrack"
        @locate="handleLocateTrack"
        @update-meta="handleUpdateMeta"
        @delete="handleDelete"
        @add-keyframe="handleAddKeyframe"
        @batch-meta="handleBatchMeta"
        @batch-delete="handleDeleteSelected"
      />
    </div>

    <!-- 帧条 -->
    <footer class="app__footer">
      <FrameStrip
        v-model:current="frameIndex"
        v-model:auto-advance="autoAdvance"
        :frames="frames"
        :marked-frames="markedFrames"
        :selected-frames="selectedFrames"
        :selected-keyframes="selectedKeyframes"
        :has-selection="Boolean(selectedId)"
      />
    </footer>

    <!-- 对话框 -->
    <LabelManager v-model="labelManagerVisible" />
    <ShortcutHelp v-model="shortcutHelpVisible" />
    <ExportDialog
      v-model="exportDialogVisible"
      :dataset-count="datasets.length"
      :current-name="activeDataset?.name || ''"
      :loading="exporting"
      @confirm="handleExportConfirm"
    />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100vh;
  box-sizing: border-box;
  padding: 16px;
  background: #f5f7fa;
}

.app__header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px 20px;
}

.app__title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #303133;
}

.app__title h1 {
  font-size: 18px;
  margin: 0;
}

.app__header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.app__labels-toggle {
  white-space: nowrap;
}

/* 数据校验标签靠右 */
.app__verify {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
}

.app__verify-tag {
  cursor: pointer;
}

/* 固定宽度，避免“未保存 / 已保存 12:00:00”文本变化导致头部换行、画布跳动 */
.app__save-tag {
  min-width: 148px;
  justify-content: center;
}

.app__verify-local {
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 3px;
  background: #f0f9eb;
  color: #67c23a;
  font-size: 11px;
}

.app__toolbar {
  padding: 12px 16px;
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

/* 画布 + 对象面板 */
.app__main {
  flex: 1;
  display: flex;
  gap: 12px;
  min-height: 0;
}

/* 画布占满剩余空间 */
.app__canvas {
  flex: 1;
  min-width: 0;
  min-height: 0;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

.app__footer {
  padding: 10px 16px;
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}
</style>
