<script setup>
/**
 * 标签类别管理对话框。
 * 类别全局共享（useLabels 单例），列表顺序即数字快捷键 1–9 的顺序。
 */
import { ref } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { useLabels } from '../composables/useLabels'

const visible = defineModel({ type: Boolean, default: false })

const { labels, addLabel, updateLabel, removeLabel } = useLabels()

const newName = ref('')

function handleAdd() {
  const name = newName.value.trim()
  if (!name) return
  addLabel({ name })
  newName.value = ''
}
</script>

<template>
  <el-dialog v-model="visible" title="标签类别" width="460px">
    <div class="label-manager">
      <div class="label-manager__hint">
        类别列表顺序对应数字快捷键 1–9，标注时可直接按数字切换类别。
      </div>
      <div v-for="(label, index) in labels" :key="label.id" class="label-manager__row">
        <el-tag size="small" effect="plain" class="label-manager__shortcut">
          {{ index + 1 }}
        </el-tag>
        <el-color-picker
          :model-value="label.color"
          size="small"
          @update:model-value="updateLabel(label.id, { color: $event || '#409eff' })"
        />
        <el-input
          :model-value="label.name"
          size="small"
          class="label-manager__name"
          @change="updateLabel(label.id, { name: $event })"
        />
        <el-button
          link
          type="danger"
          :icon="Delete"
          title="删除类别"
          @click="removeLabel(label.id)"
        />
      </div>
      <div v-if="!labels.length" class="label-manager__empty">还没有类别</div>

      <div class="label-manager__add">
        <el-input
          v-model="newName"
          size="small"
          placeholder="新类别名称"
          @keyup.enter="handleAdd"
        />
        <el-button size="small" type="primary" :icon="Plus" @click="handleAdd">
          添加
        </el-button>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.label-manager {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.label-manager__hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
}

.label-manager__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.label-manager__shortcut {
  width: 24px;
  justify-content: center;
}

.label-manager__name {
  flex: 1;
}

.label-manager__empty {
  padding: 12px 0;
  text-align: center;
  color: #909399;
  font-size: 13px;
}

.label-manager__add {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid #ebeef5;
}
</style>
