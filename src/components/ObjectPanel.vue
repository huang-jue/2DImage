<script setup>
/**
 * 对象面板：列出当前数据集的所有跨帧对象（track）。
 *
 * 支持：
 *   - 搜索标签 / id
 *   - 点击选中并定位到该对象的帧范围
 *   - 行内修改标签、颜色
 *   - 切换可见 / 锁定
 *   - 删除整条对象
 */
import { computed, ref } from 'vue'
import { Aim, Delete, Hide, Lock, Plus, Unlock, View } from '@element-plus/icons-vue'

const props = defineProps({
  tracks: { type: Array, default: () => [] },
  selectedIds: { type: Array, default: () => [] },
  frameIndex: { type: Number, default: 0 },
})

const emit = defineEmits([
  'select',
  'update-meta',
  'delete',
  'add-keyframe',
  'locate',
  'batch-meta',
  'batch-delete',
])

const keyword = ref('')
const currentOnly = ref(false)

const TYPE_LABELS = {
  rect: '矩形',
  point: '点',
  line: '折线',
  polygon: '多边形',
}

const filtered = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  return props.tracks.filter((track) => {
    if (currentOnly.value && !track.geometries[props.frameIndex]) return false
    if (!text) return true
    const label = (track.label || '').toLowerCase()
    return label.includes(text) || track.id.toLowerCase().includes(text)
  })
})

/** 对象的帧范围与关键帧数量 */
function rangeText(track) {
  const keys = Object.keys(track.geometries)
    .map(Number)
    .sort((a, b) => a - b)
  if (!keys.length) return '—'
  const range =
    keys[0] === keys[keys.length - 1]
      ? `第 ${keys[0] + 1} 帧`
      : `${keys[0] + 1}–${keys[keys.length - 1] + 1} 帧`
  return `${range} · ${keys.length} 关键帧`
}

/** 对象在当前帧是否有几何 */
function hasCurrentFrame(track) {
  return Boolean(track.geometries[props.frameIndex])
}

function typeText(track) {
  return TYPE_LABELS[track.type] || track.type
}

function updateMeta(track, patch) {
  emit('update-meta', { id: track.id, patch })
}

/** 标签输入：失焦或回车时提交，空值回落为“未命名” */
function handleLabelChange(track, value) {
  const next = (value || '').trim()
  if (next === (track.label || '')) return
  updateMeta(track, { label: next })
}
</script>

<template>
  <aside class="object-panel">
    <div class="object-panel__header">
      <span class="object-panel__title">对象</span>
      <el-tag size="small" type="info" effect="plain">{{ tracks.length }}</el-tag>
      <el-input
        v-model="keyword"
        class="object-panel__search"
        size="small"
        placeholder="搜索标签 / ID"
        clearable
      />
      <el-checkbox v-model="currentOnly" size="small" class="object-panel__filter">
        仅本帧
      </el-checkbox>
    </div>

    <div v-if="selectedIds.length > 1" class="object-panel__batch">
      <span class="object-panel__batch-count">已选 {{ selectedIds.length }}</span>
      <el-button link size="small" @click="emit('batch-meta', { visible: true })">显示</el-button>
      <el-button link size="small" @click="emit('batch-meta', { visible: false })">隐藏</el-button>
      <el-button link size="small" @click="emit('batch-meta', { locked: true })">锁定</el-button>
      <el-button link size="small" @click="emit('batch-meta', { locked: false })">解锁</el-button>
      <el-button link size="small" type="danger" @click="emit('batch-delete')">删除</el-button>
    </div>

    <el-scrollbar class="object-panel__scroll">
      <div v-if="!filtered.length" class="object-panel__empty">
        {{ tracks.length ? '没有匹配的对象' : '还没有标注对象' }}
      </div>
      <div
        v-for="track in filtered"
        :key="track.id"
        class="object-panel__row"
        :class="{
          'is-active': selectedIds.includes(track.id),
          'is-hidden': track.visible === false,
        }"
        title="点击选中，Shift+点击多选，双击定位到最近关键帧"
        @click="emit('select', track.id, $event.shiftKey)"
        @dblclick="emit('locate', track.id)"
      >
        <div class="object-panel__color" @click.stop>
          <el-color-picker
            :model-value="track.color"
            size="small"
            @update:model-value="updateMeta(track, { color: $event || '#409eff' })"
          />
        </div>

        <div class="object-panel__meta">
          <el-input
            :model-value="track.label"
            size="small"
            placeholder="未命名"
            class="object-panel__label"
            @click.stop
            @change="handleLabelChange(track, $event)"
          />
          <div class="object-panel__sub">
            <span>{{ typeText(track) }}</span>
            <span>{{ rangeText(track) }}</span>
            <span
              v-if="!hasCurrentFrame(track)"
              class="object-panel__dim"
              title="当前帧没有关键帧，可用右侧「+」插入"
            >本帧无</span>
            <span class="object-panel__id">#{{ track.id }}</span>
          </div>
        </div>

        <div class="object-panel__actions" @click.stop>
          <el-button
            v-if="!hasCurrentFrame(track)"
            link
            type="primary"
            :icon="Plus"
            title="在当前帧插入关键帧（复制最近关键帧的几何）"
            @click="emit('add-keyframe', track.id)"
          />
          <el-button
            link
            :icon="Aim"
            title="定位到最近的关键帧"
            @click="emit('locate', track.id)"
          />
          <el-button
            link
            :icon="track.visible === false ? Hide : View"
            :title="track.visible === false ? '显示' : '隐藏'"
            @click="updateMeta(track, { visible: track.visible === false })"
          />
          <el-button
            link
            :icon="track.locked ? Lock : Unlock"
            :title="track.locked ? '解锁' : '锁定'"
            @click="updateMeta(track, { locked: !track.locked })"
          />
          <el-button
            link
            type="danger"
            :icon="Delete"
            title="删除对象"
            @click="emit('delete', track.id)"
          />
        </div>
      </div>
    </el-scrollbar>
  </aside>
</template>

<style scoped>
.object-panel {
  display: flex;
  flex-direction: column;
  width: 280px;
  min-width: 280px;
  height: 100%;
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  overflow: hidden;
}

.object-panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #ebeef5;
}

.object-panel__title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.object-panel__search {
  flex: 1;
  min-width: 60px;
}

.object-panel__filter {
  margin-right: 0;
  white-space: nowrap;
  font-size: 12px;
}

/* 多选后的批量操作条 */
.object-panel__batch {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  padding: 4px 10px;
  border-bottom: 1px solid #ebeef5;
  background: #f5f7fa;
  font-size: 12px;
}

.object-panel__batch-count {
  margin-right: 4px;
  color: #409eff;
  font-weight: 600;
}

.object-panel__batch :deep(.el-button) {
  margin: 0;
  padding: 2px 4px;
  font-size: 12px;
}

.object-panel__scroll {
  flex: 1;
  min-height: 0;
}

.object-panel__empty {
  padding: 32px 12px;
  text-align: center;
  color: #909399;
  font-size: 13px;
}

.object-panel__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid #f2f3f5;
  cursor: pointer;
}

.object-panel__row:hover {
  background: #f5f7fa;
}

.object-panel__row.is-active {
  background: #ecf5ff;
  box-shadow: inset 3px 0 0 #409eff;
}

.object-panel__row.is-hidden .object-panel__meta {
  opacity: 0.45;
}

.object-panel__color :deep(.el-color-picker__trigger) {
  width: 20px;
  height: 20px;
  padding: 2px;
}

.object-panel__meta {
  flex: 1;
  min-width: 0;
}

.object-panel__label :deep(.el-input__wrapper) {
  padding: 0 6px;
  box-shadow: none;
  background: transparent;
}

.object-panel__label :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px #dcdfe6 inset;
}

.object-panel__sub {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 6px;
  font-size: 12px;
  color: #909399;
  white-space: nowrap;
  overflow: hidden;
}

.object-panel__dim {
  color: #c0c4cc;
}

.object-panel__id {
  margin-left: auto;
  color: #c0c4cc;
  font-size: 11px;
}

.object-panel__actions {
  display: flex;
  align-items: center;
  gap: 0;
}

.object-panel__actions :deep(.el-button) {
  margin: 0;
  padding: 2px 4px;
}
</style>
