<script setup>
/**
 * 导出对话框：选择格式与范围。
 *
 * 实际的文件生成、校验与下载由父组件完成。
 */
import { ref } from 'vue'
import { Download } from '@element-plus/icons-vue'

const props = defineProps({
  datasetCount: { type: Number, default: 0 },
  currentName: { type: String, default: '' },
  loading: { type: Boolean, default: false },
})

const visible = defineModel({ type: Boolean, default: false })
const emit = defineEmits(['confirm'])

const format = ref('json')
const scope = ref('current')

const formats = [
  { value: 'json', label: '内部 JSON', desc: '可再次导入本工具，保留全部逐帧几何' },
  { value: 'coco', label: 'COCO', desc: '检测/分割通用；折线输出 segmentation' },
  { value: 'yolo', label: 'YOLO', desc: '归一化包围盒 + classes.txt + labels/*.txt' },
  { value: 'mot', label: 'MOT', desc: '多目标跟踪 gt.txt（frame,id,x,y,w,h,...）' },
  { value: 'csv', label: 'CSV', desc: '表格形式，逐帧一行，含折线点列表' },
]

function handleConfirm() {
  if (props.loading) return
  emit('confirm', { format: format.value, scope: scope.value })
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="导出标注"
    width="560px"
    :show-close="!loading"
    :close-on-click-modal="!loading"
    :close-on-press-escape="!loading"
  >
    <div class="export-dialog">
      <section class="export-dialog__section">
        <h3>格式</h3>
        <el-radio-group v-model="format" class="export-dialog__formats" :disabled="loading">
          <el-radio
            v-for="item in formats"
            :key="item.value"
            :value="item.value"
            class="export-dialog__format"
          >
            <span class="export-dialog__format-name">{{ item.label }}</span>
            <span class="export-dialog__format-desc">{{ item.desc }}</span>
          </el-radio>
        </el-radio-group>
      </section>

      <section class="export-dialog__section">
        <h3>范围</h3>
        <el-radio-group v-model="scope" :disabled="loading">
          <el-radio-button value="current">
            当前数据集{{ currentName ? `（${currentName}）` : '' }}
          </el-radio-button>
          <el-radio-button value="all">
            全部数据集（{{ props.datasetCount }}）
          </el-radio-button>
        </el-radio-group>
      </section>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="导出只包含标注数据，不含图片文件。多文件格式会自动打包为 zip。"
      />
    </div>

    <template #footer>
      <el-button :disabled="loading" @click="visible = false">取消</el-button>
      <el-button
        type="primary"
        :icon="Download"
        :loading="loading"
        @click="handleConfirm"
      >
        {{ loading ? '正在导出…' : '导出' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.export-dialog {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.export-dialog__section h3 {
  margin: 0 0 8px;
  font-size: 14px;
  color: #303133;
}

.export-dialog__formats {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}

.export-dialog__format {
  height: auto;
  margin: 0;
  padding: 6px 10px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
}

.export-dialog__format :deep(.el-radio__label) {
  display: flex;
  flex-direction: column;
  gap: 2px;
  line-height: 1.5;
}

.export-dialog__format-name {
  font-size: 13px;
  color: #303133;
}

.export-dialog__format-desc {
  font-size: 12px;
  color: #909399;
  font-weight: normal;
}
</style>
