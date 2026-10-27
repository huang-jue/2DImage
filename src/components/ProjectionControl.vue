<script setup>
/**
 * 投影设置：选择来源帧、内容、透明度与过滤条件。
 * 只读视图设置，不修改标注数据。
 */
import { computed } from 'vue'
import { View } from '@element-plus/icons-vue'
import { DEFAULT_PROJECTION } from '../utils/projection'

const props = defineProps({
  modelValue: { type: Object, default: () => ({ ...DEFAULT_PROJECTION }) },
  hasSelection: { type: Boolean, default: false },
  currentFrame: { type: Number, default: 0 },
  frameCount: { type: Number, default: 0 },
  warning: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])

const settings = computed(() => props.modelValue || DEFAULT_PROJECTION)

function update(patch) {
  emit('update:modelValue', { ...settings.value, ...patch })
}

/** 切换到指定帧模式时给一个合理的初始帧，避免立刻回落到上一帧 */
function updateMode(mode) {
  if (mode === 'custom' && !Number.isInteger(settings.value.customFrame)) {
    const fallback = props.currentFrame > 0 ? props.currentFrame - 1 : 1
    update({ mode, customFrame: fallback })
    return
  }
  update({ mode })
}

const customFrameNumber = computed({
  get: () => {
    const value = settings.value.customFrame
    return Number.isInteger(value) ? value + 1 : props.currentFrame + 1
  },
  set: (value) => {
    if (!Number.isInteger(value)) return
    const max = Math.max(props.frameCount, 1)
    update({ customFrame: Math.min(Math.max(value, 1), max) - 1 })
  },
})

const opacityPercent = computed({
  get: () => Math.round(settings.value.opacity * 100),
  set: (value) => update({ opacity: value / 100 }),
})

function formatOpacity(value) {
  return `${value}%`
}
</script>

<template>
  <el-popover
    placement="bottom-end"
    :width="320"
    trigger="click"
    popper-class="projection-popover"
  >
    <template #reference>
      <el-button
        :icon="View"
        :type="settings.enabled ? 'primary' : ''"
        size="small"
        plain
        class="projection-control__button"
      >
        投影
      </el-button>
    </template>

    <div class="projection-control">
      <div class="projection-control__head">
        <span>投影</span>
        <el-switch
          :model-value="settings.enabled"
          @update:model-value="update({ enabled: $event })"
        />
      </div>

      <div class="projection-control__group">
        <span class="projection-control__label">来源</span>
        <el-radio-group
          class="projection-control__modes"
          :model-value="settings.mode"
          @update:model-value="updateMode"
        >
          <el-radio value="prev">上一帧</el-radio>
          <el-radio value="next">下一帧</el-radio>
          <el-radio value="both">前后帧</el-radio>
          <el-radio value="keyframe" :disabled="!hasSelection">
            选中对象关键帧
          </el-radio>
          <el-radio value="custom" :disabled="!frameCount">指定帧</el-radio>
        </el-radio-group>
      </div>

      <div
        v-if="['prev', 'next', 'both'].includes(settings.mode)"
        class="projection-control__group"
      >
        <span class="projection-control__label">范围</span>
        <div class="projection-control__row">
          <el-input-number
            :model-value="settings.offset"
            :min="1"
            :max="5"
            size="small"
            @update:model-value="update({ offset: $event })"
          />
          <span class="projection-control__suffix">帧</span>
        </div>
      </div>

      <div v-if="settings.mode === 'keyframe'" class="projection-control__group">
        <el-checkbox
          :model-value="settings.showAllKeyframes"
          @update:model-value="update({ showAllKeyframes: $event })"
        >
          显示全部关键帧
        </el-checkbox>
      </div>

      <div v-if="settings.mode === 'custom'" class="projection-control__group">
        <span class="projection-control__label">帧号</span>
        <el-input-number
          v-model="customFrameNumber"
          :min="1"
          :max="Math.max(frameCount, 1)"
          size="small"
        />
      </div>

      <div class="projection-control__group">
        <span class="projection-control__label">内容</span>
        <el-radio-group
          class="projection-control__content"
          :model-value="settings.content"
          @update:model-value="update({ content: $event })"
        >
          <el-radio value="shapes">标注</el-radio>
          <el-radio value="image">图像</el-radio>
          <el-radio value="both">两者</el-radio>
        </el-radio-group>
      </div>

      <div class="projection-control__group">
        <span class="projection-control__label">透明度（图像 / 标注共用）</span>
        <el-slider
          v-model="opacityPercent"
          :min="10"
          :max="70"
          :step="5"
          :format-tooltip="formatOpacity"
        />
      </div>

      <el-checkbox
        :model-value="settings.selectedOnly"
        :disabled="settings.mode === 'keyframe'"
        @update:model-value="update({ selectedOnly: $event })"
      >
        仅选中对象
      </el-checkbox>

      <el-checkbox
        :model-value="settings.showLabels"
        @update:model-value="update({ showLabels: $event })"
      >
        显示投影标签
      </el-checkbox>

      <el-alert
        v-if="warning"
        :title="warning"
        type="warning"
        :closable="false"
        show-icon
        class="projection-control__warning"
      />
    </div>
  </el-popover>
</template>

<style scoped>
.projection-control {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 66vh;
  overflow-y: auto;
  padding-right: 2px;
}

.projection-control__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.projection-control__group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.projection-control__label {
  font-size: 12px;
  color: #909399;
}

.projection-control__modes {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.projection-control__modes :deep(.el-radio) {
  height: 24px;
  margin-right: 0;
}

.projection-control__content {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.projection-control__content :deep(.el-radio) {
  margin-right: 0;
}

.projection-control__row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.projection-control__suffix {
  font-size: 12px;
  color: #909399;
}

.projection-control__warning {
  margin-top: 2px;
}

html.dark .projection-control__head {
  color: #e5eaf3;
}
</style>
