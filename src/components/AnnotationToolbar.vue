<script setup>
/**
 * 标注工具栏：工具切换、标签类别、颜色、编辑模式、撤销重做、删除/导入/导出操作、统计信息。
 *
 * 组件自身不持有状态，各项通过 v-model 与父组件双向绑定，
 * 动作以事件形式抛出，由父组件调用标注状态管理处理。
 */
import { ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import {
  Aim,
  CopyDocument,
  Crop,
  Delete,
  Download,
  Minus,
  Plus,
  RefreshLeft,
  RefreshRight,
  Scissor,
  Select,
  Setting,
  Upload,
} from '@element-plus/icons-vue'

const props = defineProps({
  tool: { type: String, default: 'select' },
  label: { type: String, default: '' },
  color: { type: String, default: '#409eff' },
  labels: { type: Array, default: () => [] },
  editMode: { type: String, default: 'forward' },
  fillMode: { type: String, default: 'forward' },
  selectedCount: { type: Number, default: 0 },
  hasClipboard: { type: Boolean, default: false },
  frameIndex: { type: Number, default: 0 },
  frameCount: { type: Number, default: 0 },
  frameShapeCount: { type: Number, default: 0 }, // 当前帧图形数
  trackCount: { type: Number, default: 0 }, // 对象（track）总数
  canUndo: { type: Boolean, default: false },
  canRedo: { type: Boolean, default: false },
})

const emit = defineEmits([
  'update:tool',
  'update:label',
  'update:color',
  'update:editMode',
  'update:fillMode',
  'apply-selection',
  'delete',
  'delete-from-frame',
  'delete-at-frame',
  'duplicate',
  'copy',
  'paste',
  'split',
  'merge',
  'copy-previous',
  'add-keyframe',
  'interpolate',
  'extend-backward',
  'extend-forward',
  'clear',
  'export',
  'import-file',
  'undo',
  'redo',
  'manage-labels',
])

const fileInputRef = ref(null)

// 工具选项：值、中文名、图标
const tools = [
  { value: 'select', label: '选择', icon: Select },
  { value: 'rect', label: '矩形', icon: Crop },
  { value: 'point', label: '点', icon: Aim },
  { value: 'line', label: '折线', icon: Minus },
  { value: 'polygon', label: '多边形', icon: Plus },
]

// 编辑传播模式
const editModes = [
  { value: 'frame', label: '仅当前帧' },
  { value: 'forward', label: '向后传播' },
  { value: 'all', label: '全部帧' },
]

// 新建对象的填充模式：到末帧 / 仅当前帧（关键帧模式）
const fillModes = [
  { value: 'forward', label: '到末帧' },
  { value: 'frame', label: '仅当前帧' },
]

/** 选择标签：命中预设类别时同步颜色 */
function handleLabel(value) {
  const name = value || ''
  emit('update:label', name)
  const preset = props.labels.find((item) => item.name === name)
  if (preset) emit('update:color', preset.color)
}

/** 打开系统文件选择框导入标注 JSON */
function triggerImport() {
  fileInputRef.value?.click()
}

/** 选择文件后抛出给父组件解析 */
function handleFileChange(event) {
  const file = event.target?.files?.[0]
  if (file) emit('import-file', file)
  if (event.target) event.target.value = ''
}

/** 「从当前帧起删除」：二次确认后抛出事件 */
async function handleDeleteFromFrame() {
  if (!props.selectedCount) return
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

    <!-- 新建标注的标签类别 -->
    <div class="toolbar__field">
      <span class="toolbar__label">标签</span>
      <el-select
        :model-value="label"
        class="toolbar__label-select"
        placeholder="选择或输入标签"
        filterable
        allow-create
        default-first-option
        clearable
        @update:model-value="handleLabel"
      >
        <el-option
          v-for="(item, index) in labels"
          :key="item.id"
          :label="item.name"
          :value="item.name"
        >
          <span class="toolbar__option">
            <span class="toolbar__option-dot" :style="{ background: item.color }" />
            {{ item.name }}
            <span class="toolbar__option-key">{{ index + 1 }}</span>
          </span>
        </el-option>
      </el-select>
      <el-button
        :icon="Setting"
        title="管理标签类别"
        @click="emit('manage-labels')"
      />
    </div>

    <!-- 新建标注的颜色 -->
    <div class="toolbar__field">
      <span class="toolbar__label">颜色</span>
      <el-color-picker
        :model-value="color"
        @update:model-value="emit('update:color', $event || '#409eff')"
      />
      <el-button
        size="small"
        plain
        :disabled="!selectedCount"
        title="把当前标签与颜色应用到选中对象"
        @click="emit('apply-selection')"
      >
        应用到选中
      </el-button>
    </div>

    <!-- 编辑传播模式 -->
    <div class="toolbar__field">
      <span class="toolbar__label">编辑</span>
      <el-radio-group
        :model-value="editMode"
        size="small"
        @update:model-value="emit('update:editMode', $event)"
      >
        <el-radio-button
          v-for="item in editModes"
          :key="item.value"
          :value="item.value"
        >
          {{ item.label }}
        </el-radio-button>
      </el-radio-group>
    </div>

    <!-- 新建对象的填充模式 -->
    <div
      class="toolbar__field"
      title="仅影响新建对象：到末帧 = 多帧画；仅当前帧 = 只创建一个关键帧"
    >
      <span class="toolbar__label">新建</span>
      <el-radio-group
        :model-value="fillMode"
        size="small"
        @update:model-value="emit('update:fillMode', $event)"
      >
        <el-radio-button
          v-for="item in fillModes"
          :key="item.value"
          :value="item.value"
        >
          {{ item.label }}
        </el-radio-button>
      </el-radio-group>
    </div>

    <!-- 操作按钮 -->
    <div class="toolbar__actions">
      <el-button
        :icon="RefreshLeft"
        :disabled="!canUndo"
        title="撤销 (Ctrl+Z)"
        @click="emit('undo')"
      />
      <el-button
        :icon="RefreshRight"
        :disabled="!canRedo"
        title="重做 (Ctrl+Shift+Z)"
        @click="emit('redo')"
      />
      <el-button
        :icon="CopyDocument"
        :disabled="!selectedCount"
        title="复制对象 (Ctrl+D)"
        @click="emit('duplicate')"
      />
      <el-button
        plain
        :disabled="!selectedCount"
        title="复制到剪贴板 (Ctrl+C)"
        @click="emit('copy')"
      >
        复制
      </el-button>
      <el-button
        plain
        :disabled="!hasClipboard"
        title="粘贴到当前帧 (Ctrl+V)"
        @click="emit('paste')"
      >
        粘贴
      </el-button>
      <el-button
        plain
        :disabled="selectedCount !== 1"
        title="从当前帧拆分对象（当前帧及之后成为新对象）"
        @click="emit('split')"
      >
        拆分
      </el-button>
      <el-button
        plain
        :disabled="selectedCount < 2"
        title="合并多个选中对象（重叠帧保留第一个对象）"
        @click="emit('merge')"
      >
        合并
      </el-button>
      <el-button
        plain
        :disabled="frameIndex <= 0"
        title="把上一帧存在、当前帧缺失的对象复制到当前帧"
        @click="emit('copy-previous')"
      >
        复制上一帧
      </el-button>
      <el-button
        type="danger"
        plain
        :icon="Delete"
        :disabled="!selectedCount"
        @click="emit('delete')"
      >
        删除对象
      </el-button>
      <el-button
        plain
        :icon="Scissor"
        :disabled="!selectedCount"
        title="仅删除对象在当前帧的标注"
        @click="emit('delete-at-frame')"
      >
        删除当前帧
      </el-button>
      <el-button
        type="warning"
        plain
        :icon="Scissor"
        :disabled="!selectedCount"
        @click="handleDeleteFromFrame"
      >
        从当前帧起删除
      </el-button>
      <el-button
        plain
        :disabled="!selectedCount"
        title="在当前帧插入关键帧（复制最近关键帧的几何，之后可拖动调整）"
        @click="emit('add-keyframe')"
      >
        插入关键帧
      </el-button>
      <el-button
        plain
        :disabled="!selectedCount"
        title="在相邻关键帧之间重新计算填充帧"
        @click="emit('interpolate')"
      >
        插值补全
      </el-button>
      <el-button
        plain
        :disabled="!selectedCount"
        title="把对象当前几何补到更早的帧"
        @click="emit('extend-backward')"
      >
        向前补标
      </el-button>
      <el-button
        plain
        :disabled="!selectedCount"
        title="把对象末帧几何延伸到末帧"
        @click="emit('extend-forward')"
      >
        向后补标
      </el-button>
      <el-button :icon="Delete" @click="handleClear">清空</el-button>
      <el-button :icon="Upload" @click="triggerImport">导入 JSON</el-button>
      <el-button type="primary" :icon="Download" @click="emit('export')">
        导出
      </el-button>
      <input
        ref="fileInputRef"
        type="file"
        accept="application/json,.json"
        class="toolbar__file"
        @change="handleFileChange"
      />
    </div>

    <!-- 统计信息（固定宽度，避免数字变化导致工具栏换行、画布跳动） -->
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
  white-space: nowrap;
}

.toolbar__label-select {
  width: 140px;
}

/* 标签下拉项：颜色点 + 快捷键序号 */
.toolbar__option {
  display: flex;
  align-items: center;
  gap: 6px;
}

.toolbar__option-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.toolbar__option-key {
  margin-left: auto;
  color: #c0c4cc;
  font-size: 11px;
}

.toolbar__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.toolbar__stats {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
  min-width: 330px;
  white-space: nowrap;
}

/* 隐藏的导入文件输入框 */
.toolbar__file {
  display: none;
}
</style>
