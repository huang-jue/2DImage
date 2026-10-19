<script setup>
/**
 * 应用主页面：串联数据集、标注状态、工具栏、画布与帧条。
 *
 * 数据流：
 *   useDatasets  提供数据集与帧列表（静态发现 + 校验）
 *   useAnnotation 管理按数据集隔离的跨帧标注（track）
 *   画布通过 shapes(当前帧) 渲染，编辑结果经 create/update/select/delete 回流到 useAnnotation
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Picture } from '@element-plus/icons-vue'
import AnnotationCanvas from './components/AnnotationCanvas.vue'
import AnnotationToolbar from './components/AnnotationToolbar.vue'
import FrameStrip from './components/FrameStrip.vue'
import { useDatasets } from './composables/useDatasets'
import { useAnnotation } from './composables/useAnnotation'

const { datasets, report, totalFrames, verifyAllFrames } = useDatasets()
const annotation = useAnnotation()

const activeId = ref(datasets[0]?.id ?? '') // 当前数据集 id
const frameIndex = ref(0) // 当前帧序号
const tool = ref('select') // 当前工具
const label = ref('') // 新建标注的标签
const color = ref('#409eff') // 新建标注的颜色
const selectedId = ref(null) // 选中的 track id
const verification = ref([]) // 数据校验结果

// —— 派生状态 ——
const activeDataset = computed(
  () => datasets.find((item) => item.id === activeId.value) || datasets[0],
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
// 含标注的帧序号集合（供帧条显示标记）
const markedFrames = computed(() => {
  if (!activeId.value) return []
  const set = new Set()
  for (const track of annotation.getTracks(activeId.value)) {
    for (const key of Object.keys(track.geometries)) set.add(Number(key))
  }
  return [...set]
})

// —— 画布事件处理 ——
/** 新建标注：从当前帧延伸到末帧，并选中新对象 */
function handleCreate(payload) {
  const track = annotation.createTrack(activeId.value, {
    ...payload,
    lastFrame: lastFrame.value,
    label: label.value,
    color: color.value,
  })
  selectedId.value = track.id
}

/** 编辑标注：从当前帧传播到末帧 */
function handleUpdate({ trackId, geometry }) {
  annotation.updateFromFrame(
    activeId.value,
    trackId,
    frameIndex.value,
    geometry,
    lastFrame.value,
  )
}

/** 删除整条 track */
function handleDelete(trackId) {
  annotation.deleteTrack(activeId.value, trackId)
  if (selectedId.value === trackId) selectedId.value = null
}

/** 从当前帧起删除（若对象被删空则取消选中） */
function handleDeleteFromFrame() {
  if (!selectedId.value) return
  annotation.deleteFromFrame(activeId.value, selectedId.value, frameIndex.value)
  if (!annotation.getTracks(activeId.value).some((item) => item.id === selectedId.value)) {
    selectedId.value = null
  }
}

/** 清空当前数据集全部标注 */
function handleClear() {
  annotation.clearDataset(activeId.value)
  selectedId.value = null
}

/** 导出当前数据集标注为 JSON 文件 */
function handleExport() {
  const data = annotation.exportDataset(activeId.value, {
    name: activeDataset.value?.name,
    frameCount: frames.value.length,
  })
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${activeId.value}-annotations.json`
  link.click()
  URL.revokeObjectURL(url)
  ElMessage.success('已导出标注 JSON')
}

// 切换数据集：回到第 0 帧并清除选中
watch(activeId, () => {
  frameIndex.value = 0
  selectedId.value = null
})

// 切换帧：若选中对象在目标帧不可见，则取消选中
watch(frameIndex, () => {
  if (!selectedId.value) return
  const visible = annotation
    .getFrameShapes(activeId.value, frameIndex.value)
    .some((item) => item.id === selectedId.value)
  if (!visible) selectedId.value = null
})

// 挂载后校验所有帧能否正常加载
onMounted(async () => {
  verification.value = await verifyAllFrames()
  const failed = verification.value.filter((item) => !item.ok)
  if (failed.length) {
    ElMessage.error(`${failed.length} 份数据校验未通过，请检查图片`)
  } else {
    ElMessage.success(`数据校验通过：${datasets.length} 份 / ${totalFrames} 帧全部加载成功`)
  }
})
</script>

<template>
  <div class="app">
    <!-- 顶部：标题、数据集切换、数据校验标签 -->
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
      <div class="app__verify">
        <el-tag
          v-for="item in report"
          :key="item.id"
          :type="item.ok ? 'success' : 'danger'"
          effect="plain"
          size="small"
        >
          {{ item.name }}：{{ item.frames }} 帧
        </el-tag>
      </div>
    </header>

    <!-- 工具栏 -->
    <section class="app__toolbar">
      <AnnotationToolbar
        v-model:tool="tool"
        v-model:label="label"
        v-model:color="color"
        :selected-id="selectedId"
        :frame-index="frameIndex"
        :frame-count="frames.length"
        :frame-shape-count="shapes.length"
        :track-count="trackCount"
        @delete="handleDelete(selectedId)"
        @delete-from-frame="handleDeleteFromFrame"
        @clear="handleClear"
        @export="handleExport"
      />
    </section>

    <!-- 标注画布 -->
    <main class="app__canvas">
      <AnnotationCanvas
        :image-url="imageUrl"
        :frame-index="frameIndex"
        :shapes="shapes"
        :tool="tool"
        :selected-id="selectedId"
        :color="color"
        @create="handleCreate"
        @update="handleUpdate"
        @select="selectedId = $event"
        @delete="handleDelete"
      />
    </main>

    <!-- 帧条 -->
    <footer class="app__footer">
      <FrameStrip
        v-model:current="frameIndex"
        :frames="frames"
        :marked-frames="markedFrames"
      />
    </footer>
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

/* 数据校验标签靠右 */
.app__verify {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.app__toolbar {
  padding: 12px 16px;
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

/* 画布占满剩余高度 */
.app__canvas {
  flex: 1;
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
