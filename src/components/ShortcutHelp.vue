<script setup>
/**
 * 快捷键帮助对话框。
 */
const visible = defineModel({ type: Boolean, default: false })

const groups = [
  {
    title: '工具',
    items: [
      { keys: 'V', desc: '选择' },
      { keys: 'R', desc: '矩形' },
      { keys: 'P', desc: '点' },
      { keys: 'L', desc: '折线' },
      { keys: 'G', desc: '多边形' },
      { keys: '1–9', desc: '切换标签类别' },
    ],
  },
  {
    title: '编辑',
    items: [
      { keys: 'Ctrl+Z', desc: '撤销' },
      { keys: 'Ctrl+Shift+Z', desc: '重做' },
      { keys: 'Ctrl+D', desc: '复制选中对象' },
      { keys: 'Ctrl+C / Ctrl+V', desc: '复制对象 / 粘贴到当前帧' },
      { keys: 'Delete', desc: '删除选中对象' },
      { keys: 'Esc', desc: '取消当前绘制' },
      { keys: 'Enter', desc: '结束折线 / 多边形' },
      { keys: '双击折线', desc: '插入顶点' },
      { keys: '右键顶点', desc: '删除顶点' },
    ],
  },
  {
    title: '视图',
    items: [
      { keys: 'Space + 拖拽', desc: '平移画布' },
      { keys: '中键拖拽', desc: '平移画布' },
      { keys: '滚轮', desc: '以指针为中心缩放' },
      { keys: 'O', desc: '开关跨帧投影' },
      { keys: '点击投影图形', desc: '跳到来源帧并选中对应对象' },
      { keys: '+ / -', desc: '放大 / 缩小' },
      { keys: '0', desc: '适应窗口' },
      { keys: '← / →', desc: '选择工具且有选中时微调 1px；否则切帧' },
      { keys: '↑ / ↓', desc: '选中对象时上下微调 1px' },
      { keys: 'Shift+← / → / ↑ / ↓', desc: '微调 10px；未选中时左右跳 10 帧' },
      { keys: 'N / Shift+N', desc: '下一个 / 上一个未标注帧' },
    ],
  },
  {
    title: '导入导出',
    items: [{ keys: 'Ctrl+S', desc: '导出当前数据集标注' }],
  },
]
</script>

<template>
  <el-dialog v-model="visible" title="快捷键" width="560px">
    <div class="shortcut-help">
      <section v-for="group in groups" :key="group.title" class="shortcut-help__group">
        <h3>{{ group.title }}</h3>
        <div class="shortcut-help__grid">
          <template v-for="item in group.items" :key="item.keys">
            <kbd>{{ item.keys }}</kbd>
            <span>{{ item.desc }}</span>
          </template>
        </div>
      </section>
    </div>
  </el-dialog>
</template>

<style scoped>
.shortcut-help {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-height: 66vh;
  overflow-y: auto;
  padding-right: 4px;
}

.shortcut-help__group h3 {
  margin: 0 0 8px;
  font-size: 14px;
  color: #303133;
}

.shortcut-help__grid {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 6px 12px;
  font-size: 13px;
  color: #606266;
}

kbd {
  justify-self: start;
  padding: 1px 6px;
  border: 1px solid #dcdfe6;
  border-bottom-width: 2px;
  border-radius: 4px;
  background: #f5f7fa;
  color: #303133;
  font-family: inherit;
  font-size: 12px;
}
</style>
