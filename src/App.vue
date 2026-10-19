<script setup>
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

const activeId = ref(datasets[0]?.id ?? '')
const frameIndex = ref(0)
const tool = ref('select')
const label = ref('')
const color = ref('#409eff')
const selectedId = ref(null)
const verification = ref([])

const activeDataset = computed(
  () => datasets.find((item) => item.id === activeId.value) || datasets[0],
)
const frames = computed(() => activeDataset.value?.frames ?? [])
const lastFrame = computed(() => Math.max(frames.value.length - 1, 0))
const imageUrl = computed(() => frames.value[frameIndex.value]?.url ?? '')
const shapes = computed(() =>
  activeId.value ? annotation.getFrameShapes(activeId.value, frameIndex.value) : [],
)
const trackCount = computed(() =>
  activeId.value ? annotation.countTracks(activeId.value) : 0,
)
const markedFrames = computed(() => {
  if (!activeId.value) return []
  const set = new Set()
  for (const track of annotation.getTracks(activeId.value)) {
    for (const key of Object.keys(track.geometries)) set.add(Number(key))
  }
  return [...set]
})

function handleCreate(payload) {
  const track = annotation.createTrack(activeId.value, {
    ...payload,
    lastFrame: lastFrame.value,
    label: label.value,
    color: color.value,
  })
  selectedId.value = track.id
}

function handleUpdate({ trackId, geometry }) {
  annotation.updateFromFrame(
    activeId.value,
    trackId,
    frameIndex.value,
    geometry,
    lastFrame.value,
  )
}

function handleDelete(trackId) {
  annotation.deleteTrack(activeId.value, trackId)
  if (selectedId.value === trackId) selectedId.value = null
}

function handleDeleteFromFrame() {
  if (!selectedId.value) return
  annotation.deleteFromFrame(activeId.value, selectedId.value, frameIndex.value)
  if (!annotation.getTracks(activeId.value).some((item) => item.id === selectedId.value)) {
    selectedId.value = null
  }
}

function handleClear() {
  annotation.clearDataset(activeId.value)
  selectedId.value = null
}

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

watch(activeId, () => {
  frameIndex.value = 0
  selectedId.value = null
})

watch(frameIndex, () => {
  if (!selectedId.value) return
  const visible = annotation
    .getFrameShapes(activeId.value, frameIndex.value)
    .some((item) => item.id === selectedId.value)
  if (!visible) selectedId.value = null
})

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
