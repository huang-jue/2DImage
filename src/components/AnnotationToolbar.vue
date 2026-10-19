<script setup>
import { ElMessageBox } from 'element-plus'
import {
  Aim,
  Crop,
  Delete,
  Download,
  Minus,
  RefreshLeft,
  Select,
} from '@element-plus/icons-vue'

const props = defineProps({
  tool: { type: String, default: 'select' },
  label: { type: String, default: '' },
  color: { type: String, default: '#409eff' },
  selectedId: { type: String, default: null },
  frameIndex: { type: Number, default: 0 },
  frameCount: { type: Number, default: 0 },
  frameShapeCount: { type: Number, default: 0 },
  trackCount: { type: Number, default: 0 },
})

const emit = defineEmits([
  'update:tool',
  'update:label',
  'update:color',
  'delete',
  'delete-from-frame',
  'clear',
  'export',
])

const tools = [
  { value: 'select', label: '选择', icon: Select },
  { value: 'rect', label: '矩形', icon: Crop },
  { value: 'point', label: '点', icon: Aim },
  { value: 'line', label: '线', icon: Minus },
]

async function handleDeleteFromFrame() {
  if (!props.selectedId) return
  try {
    await ElMessageBox.confirm(
      `将删除当前对象从第 ${props.frameIndex + 1} 帧到末帧的所有标注，是否继续？`,
      '从当前帧起删除',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
    emit('delete-from-frame')
  } catch {
    /* cancelled */
  }
}

async function handleClear() {
  try {
    await ElMessageBox.confirm('将清空当前数据的所有标注，是否继续？', '清空标注', {
      type: 'warning',
      confirmButtonText: '清空',
      cancelButtonText: '取消',
    })
    emit('clear')
  } catch {
    /* cancelled */
  }
}
</script>

<template>
  <div class="toolbar">
    <el-radio-group
      :model-value="tool"
      class="toolbar__tools"
      @update:model-value="emit('update:tool', $event)"
    >
      <el-radio-button
        v-for="item in tools"
        :key="item.value"
        :value="item.value"
      >
        <el-icon><component :is="item.icon" /></el-icon>
        <span>{{ item.label }}</span>
      </el-radio-button>
    </el-radio-group>

    <div class="toolbar__field">
      <span class="toolbar__label">标签</span>
      <el-input
        :model-value="label"
        placeholder="对象标签"
        clearable
        style="width: 140px"
        @update:model-value="emit('update:label', $event)"
      />
    </div>

    <div class="toolbar__field">
      <span class="toolbar__label">颜色</span>
      <el-color-picker
        :model-value="color"
        @update:model-value="emit('update:color', $event || '#409eff')"
      />
    </div>

    <div class="toolbar__actions">
      <el-button
        type="danger"
        plain
        :icon="Delete"
        :disabled="!selectedId"
        @click="emit('delete')"
      >
        删除对象
      </el-button>
      <el-button
        type="warning"
        plain
        :icon="RefreshLeft"
        :disabled="!selectedId"
        @click="handleDeleteFromFrame"
      >
        从当前帧起删除
      </el-button>
      <el-button :icon="Delete" @click="handleClear">清空</el-button>
      <el-button type="primary" :icon="Download" @click="emit('export')">
        导出 JSON
      </el-button>
    </div>

    <div class="toolbar__stats">
      <el-tag type="info" effect="plain">
        帧 {{ frameCount ? frameIndex + 1 : 0 }} / {{ frameCount }}
      </el-tag>
      <el-tag type="info" effect="plain">本帧 {{ frameShapeCount }} 个</el-tag>
      <el-tag type="success" effect="plain">对象 {{ trackCount }} 个</el-tag>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px 16px;
}

.toolbar__tools :deep(.el-radio-button__inner) {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar__field {
  display: flex;
  align-items: center;
  gap: 6px;
}

.toolbar__label {
  font-size: 13px;
  color: #606266;
}

.toolbar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar__stats {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
</style>
