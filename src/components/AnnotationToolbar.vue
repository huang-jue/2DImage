<script setup>
/**
 * 标注工具栏：工具切换、标签/颜色设置、删除与导出操作、统计信息。
 *
 * 组件自身不持有状态，工具/标签/颜色通过 v-model 与父组件双向绑定，
 * 删除、导出等动作以事件形式抛出，由父组件调用标注状态管理处理。
 */
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
  frameShapeCount: { type: Number, default: 0 }, // 当前帧图形数
  trackCount: { type: Number, default: 0 }, // 对象（track）总数
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

// 工具选项：值、中文名、图标
const tools = [
  { value: 'select', label: '选择', icon: Select },
  { value: 'rect', label: '矩形', icon: Crop },
  { value: 'point', label: '点', icon: Aim },
  { value: 'line', label: '线', icon: Minus },
]

/** 「从当前帧起删除」：二次确认后抛出事件 */
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
    /* 用户取消 */
  }
}

/** 「清空」：二次确认后抛出事件 */
async function handleClear() {
  try {
    await ElMessageBox.confirm('将清空当前数据的所有标注，是否继续？', '清空标注', {
      type: 'warning',
      confirmButtonText: '清空',
      cancelButtonText: '取消',
    })
    emit('clear')
  } catch {
    /* 用户取消 */
  }
}
</script>

<template>
  <div class="toolbar">
    <!-- 工具切换 -->
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

    <!-- 新建标注的标签 -->
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

    <!-- 新建标注的颜色 -->
    <div class="toolbar__field">
      <span class="toolbar__label">颜色</span>
      <el-color-picker
        :model-value="color"
        @update:model-value="emit('update:color', $event || '#409eff')"
      />
    </div>

    <!-- 操作按钮 -->
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

    <!-- 统计信息 -->
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

/* 工具按钮内图标与文字横向排列 */
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
