# 2D 多帧图像标注

基于 **Vue 3 + Vite + Element Plus + Konva** 的 2D 多帧图像标注工具。

在画布上加载多帧图片，使用矩形 / 点 / 折线工具绘制标注，标注以“跨帧对象（track）”的方式管理：
在当前帧新建的对象会自动出现在后续所有帧，编辑某帧的对象会同步到其后的所有帧。

## 功能

- **多帧浏览**：缩略图、滑块、上一帧 / 下一帧；含标注的帧显示绿色标记点。
- **多种标注工具**：矩形（拖拽绘制）、点（单击落点）、折线（连续单击，双击或回车结束）。
- **选择与编辑**：点选对象后可拖动；矩形可缩放（Transformer）。
- **多帧画**：在当前帧新建的对象从当前帧一直延伸到末帧。
- **编辑传播**：在帧 N 编辑对象，其几何从 N 同步到末帧，N 之前的帧保持不变。
- **删除**：删除整条对象，或「从当前帧起删除」。
- **导出**：将当前数据集标注导出为 JSON（含每个对象的逐帧几何）。
- **数据校验**：启动时逐帧解码图片，校验每份数据集是否达到最少帧数。

## 快速开始

```bash
npm install
npm run dev      # 开发预览，默认 http://localhost:5173
npm run build    # 生产构建
npm run preview  # 预览构建产物
```

## 目录结构

```
src/
├─ assets/datasets/          # 示例数据：caseN/ 目录，图片按文件名排序作为帧顺序
│  ├─ case1/001.jpg ... 020.jpg
│  ├─ case2/...
│  └─ case3/...
├─ components/
│  ├─ AnnotationCanvas.vue   # 基于 Konva 的标注画布（绘制 / 选择 / 编辑）
│  ├─ AnnotationToolbar.vue  # 工具栏（工具、标签、颜色、删除、导出、统计）
│  └─ FrameStrip.vue         # 帧条（缩略图 / 滑块 / 上下帧）
├─ composables/
│  ├─ useDatasets.js         # 数据集自动发现与数据校验
│  └─ useAnnotation.js       # 跨帧标注状态管理（track 模型、传播、导出）
├─ utils/
│  └─ imageCache.js          # 图片加载缓存
├─ App.vue                   # 页面装配
├─ main.js                   # 应用入口（注册 Element Plus 与图标）
└─ style.css                 # 全局基础样式
```

## 添加数据

1. 在 `src/assets/datasets/` 下新建目录，例如 `case4/`。
2. 把该数据集的帧图片放进去，文件名按顺序即可（如 `001.jpg`、`002.jpg` …）。
3. 刷新页面会自动发现新数据集，无需修改代码。

要求：每份数据集建议不少于 20 帧（`src/composables/useDatasets.js` 中的 `MIN_FRAMES`）。

## 标注数据模型

标注状态以“跨帧对象（track）”组织，`src/composables/useAnnotation.js`：

```js
track = {
  id,                          // 对象唯一 id，同一目标在所有帧共享
  type: 'rect' | 'point' | 'line',
  label,                       // 标签
  color,                       // 颜色
  startFrame,                  // 首次出现的帧
  geometries: {                // 键为帧序号，值为该帧几何（原图像素坐标）
    [frameIndex]:
      { x, y, width, height }        // rect
      | { x, y }                     // point
      | { points: [x, y, x, y, ...] } // line
  },
}
```

所有几何均以**原图像素坐标**存储，与画布缩放无关。导出的 JSON 形如：

```json
{
  "dataset": "case1",
  "name": "示例 1",
  "frameCount": 20,
  "exportedAt": "2026-01-01T00:00:00.000Z",
  "tracks": [
    {
      "id": "t1",
      "type": "rect",
      "label": "car",
      "color": "#409eff",
      "startFrame": 0,
      "endFrame": 19,
      "frames": {
        "0": { "x": 100, "y": 120, "width": 200, "height": 160 }
      }
    }
  ]
}
```

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `Esc` | 取消当前绘制 |
| `Enter` | 结束折线绘制 |
| `Delete` / `Backspace` | 删除选中对象（需在 select 工具下） |

## 技术栈

- [Vue 3](https://vuejs.org/)（`<script setup>`）
- [Vite](https://vite.dev/)
- [Element Plus](https://element-plus.org/)
- [Konva](https://konvajs.org/)
