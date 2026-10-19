<script setup>
/**
 * 标注画布组件（基于 Konva）。
 *
 * 结构：一个 Stage + 三个 Layer
 *   - imageLayer   当前帧图片（不监听事件）
 *   - shapeLayer   已确认的标注图形 + 选中框（Transformer）
 *   - overlayLayer 绘制中的临时图形
 * 三个 Layer 施加相同的缩放/位移（view），使图片与标注共用一套坐标变换。
 * 标注几何一律使用“原图像素坐标”，指针事件通过 view 反算回原图坐标。
 *
 * 交互：
 *   - rect  拖拽画出矩形（mouseup 提交）
 *   - point 单击落点
 *   - line  连续单击落点，双击或回车结束，Esc 取消
 *   - select 点选图形可拖动 / 矩形可缩放，通过 delete 事件删除
 *
 * 组件本身无状态：几何数据由父组件通过 shapes 传入，编辑结果通过 emit 抛回父组件。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Konva from 'konva'
import { loadImage } from '../utils/imageCache'

const props = defineProps({
  imageUrl: { type: String, default: '' }, // 当前帧图片地址
  frameIndex: { type: Number, default: 0 }, // 当前帧序号（用于生成新标注）
  shapes: { type: Array, default: () => [] }, // 当前帧要渲染的图形
  tool: { type: String, default: 'select' }, // 当前工具：select | rect | point | line
  selectedId: { type: String, default: null }, // 选中对象的 track id
  color: { type: String, default: '#409eff' }, // 新标注默认颜色
})

const emit = defineEmits(['create', 'update', 'select', 'delete'])

const containerRef = ref(null)

// Konva 实例与内部状态（非响应式，避免无谓的响应式开销）
let stage = null
let imageLayer = null
let shapeLayer = null
let overlayLayer = null
let transformer = null
let imageNode = null
let resizeObserver = null
let naturalWidth = 0 // 原图宽（像素）
let naturalHeight = 0 // 原图高（像素）
let drawState = null // 绘制中的临时状态

// 视图变换：原图坐标 -> 屏幕坐标的等比缩放与偏移
const view = { scale: 1, offsetX: 0, offsetY: 0 }

/** 把鼠标位置换算成原图像素坐标 */
function pointerToImage() {
  const pos = stage?.getPointerPosition()
  if (!pos) return null
  return {
    x: (pos.x - view.offsetX) / view.scale,
    y: (pos.y - view.offsetY) / view.scale,
  }
}

/** 把当前 view 变换应用到三个 Layer 上 */
function applyView() {
  for (const layer of [imageLayer, shapeLayer, overlayLayer]) {
    if (!layer) continue
    layer.scale({ x: view.scale, y: view.scale })
    layer.position({ x: view.offsetX, y: view.offsetY })
    layer.batchDraw()
  }
}

/** 根据容器尺寸计算等比缩放，使图片居中铺满 */
function fitView() {
  if (!stage || !naturalWidth || !naturalHeight) return
  const width = stage.width()
  const height = stage.height()
  if (!width || !height) return
  const scale = Math.min(width / naturalWidth, height / naturalHeight)
  view.scale = scale
  view.offsetX = (width - naturalWidth * scale) / 2
  view.offsetY = (height - naturalHeight * scale) / 2
  applyView()
}

/**
 * 创建（或更新）Transformer 选中框。
 * 由于 Transformer 位于被缩放的 Layer 内，其描边与锚点尺寸需除以 scale 才能保持屏幕恒定大小。
 */
function ensureTransformer() {
  if (!transformer) {
    transformer = new Konva.Transformer({
      rotateEnabled: false, // 标注场景不需要旋转
      ignoreStroke: true,
      borderStroke: '#409eff',
      anchorStroke: '#409eff',
      anchorFill: '#ffffff',
    })
    shapeLayer.add(transformer)
  }
  transformer.borderStrokeWidth(1 / view.scale)
  transformer.anchorSize(8 / view.scale)
  transformer.anchorStrokeWidth(1 / view.scale)
}

/**
 * 从 Konva 节点读取几何（原图坐标）。
 * 处理拖拽/缩放带来的节点偏移与 scale，使结果可持久化。
 */
function readGeometry(node, type) {
  if (type === 'rect') {
    return {
      x: node.x(),
      y: node.y(),
      width: node.width() * node.scaleX(), // 缩放后宽度 = 基础宽 * scaleX
      height: node.height() * node.scaleY(),
    }
  }
  if (type === 'point') return { x: node.x(), y: node.y() }
  // line：节点的 points 是相对坐标，叠加节点位移后得到绝对坐标
  const dx = node.x()
  const dy = node.y()
  const points = node.points().slice()
  const moved = points.map((value, index) => (index % 2 === 0 ? value + dx : value + dy))
  if (dx || dy) {
    node.points(moved)
    node.position({ x: 0, y: 0 })
  }
  return { points: moved }
}

/** 拖拽/缩放结束时提交几何：归一化 scale 并向上抛出 update */
function commitNode(node, shape) {
  const geometry = readGeometry(node, shape.type)
  node.scaleX(1)
  node.scaleY(1)
  emit('update', { trackId: shape.id, geometry })
}

/** 根据图形数据创建 Konva 节点，并绑定选择/拖拽/缩放事件 */
function createNode(shape) {
  const color = shape.color || props.color
  // 公共属性：描边不随缩放变粗（strokeScaleEnabled=false），仅在 select 工具下可拖动
  const common = {
    id: shape.id,
    name: 'annotation',
    stroke: color,
    strokeWidth: 2,
    strokeScaleEnabled: false,
    draggable: props.tool === 'select',
  }
  let node
  if (shape.type === 'rect') {
    const geometry = shape.geometry
    node = new Konva.Rect({
      ...common,
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
    })
  } else if (shape.type === 'point') {
    const geometry = shape.geometry
    node = new Konva.Circle({
      ...common,
      x: geometry.x,
      y: geometry.y,
      radius: 6 / view.scale, // 半径除以 scale 以保持屏幕恒定大小
      fill: color,
    })
  } else {
    node = new Konva.Line({
      ...common,
      points: shape.geometry.points,
      lineJoin: 'round',
      lineCap: 'round',
      hitStrokeWidth: 10 / view.scale, // 扩大命中区域，便于点击细线
    })
  }
  node.on('click tap', (event) => {
    event.cancelBubble = true // 阻止冒泡到 Stage，避免随即被反选
    emit('select', shape.id)
  })
  node.on('dragend', () => commitNode(node, shape))
  node.on('transformend', () => commitNode(node, shape))
  return node
}

/** 重建 shapeLayer（帧切换 / 数据变化 / 选中变化时调用） */
function renderShapes() {
  if (!stage || !shapeLayer) return
  shapeLayer.destroyChildren() // 连同旧 Transformer 一并销毁
  transformer = null
  ensureTransformer()

  let selectedNode = null
  let selectedType = null
  for (const shape of props.shapes) {
    const node = createNode(shape)
    shapeLayer.add(node)
    if (shape.id === props.selectedId) {
      selectedNode = node
      selectedType = shape.type
    }
  }

  if (selectedNode) {
    transformer.nodes([selectedNode])
    if (selectedType === 'rect') {
      // 仅矩形允许缩放；点/线只允许拖动
      transformer.resizeEnabled(true)
      transformer.enabledAnchors([
        'top-left',
        'top-center',
        'top-right',
        'middle-left',
        'middle-right',
        'bottom-left',
        'bottom-center',
        'bottom-right',
      ])
    } else {
      transformer.resizeEnabled(false)
    }
  } else {
    transformer.nodes([])
  }
  shapeLayer.batchDraw()
}

/** 结束/取消当前绘制，清理 overlayLayer 上的临时图形 */
function finishDrawing() {
  if (drawState?.node) drawState.node.destroy()
  drawState = null
  overlayLayer?.batchDraw()
}

/** 结束折线绘制：去除末尾重合点后提交 create */
function finishLine() {
  if (!drawState || drawState.type !== 'line') return
  const points = drawState.points.slice()
  const tolerance = 5 / view.scale
  // 双击结束会多产生一个重复点，这里循环去除尾部过近的点
  while (points.length >= 4) {
    const length = points.length
    const dx = points[length - 2] - points[length - 4]
    const dy = points[length - 1] - points[length - 3]
    if (Math.hypot(dx, dy) < tolerance) points.splice(length - 2, 2)
    else break
  }
  finishDrawing()
  if (points.length >= 4) {
    emit('create', { type: 'line', geometry: { points }, frameIndex: props.frameIndex })
  }
}

/** 鼠标按下：根据当前工具开始绘制 */
function onMouseDown() {
  if (props.tool === 'select') return
  const point = pointerToImage()
  if (!point) return

  if (props.tool === 'rect') {
    const rect = new Konva.Rect({
      x: point.x,
      y: point.y,
      width: 0,
      height: 0,
      stroke: props.color,
      strokeWidth: 2,
      strokeScaleEnabled: false,
      dash: [5 / view.scale, 4 / view.scale],
    })
    overlayLayer.add(rect)
    drawState = { type: 'rect', startX: point.x, startY: point.y, node: rect }
  } else if (props.tool === 'point') {
    // 点标注一次点击即完成
    emit('create', {
      type: 'point',
      geometry: { x: point.x, y: point.y },
      frameIndex: props.frameIndex,
    })
  } else if (props.tool === 'line') {
    // 首次点击创建临时折线节点
    if (!drawState || drawState.type !== 'line') {
      const line = new Konva.Line({
        points: [],
        stroke: props.color,
        strokeWidth: 2,
        strokeScaleEnabled: false,
        lineJoin: 'round',
        lineCap: 'round',
      })
      overlayLayer.add(line)
      drawState = { type: 'line', node: line, points: [] }
    }
    drawState.points.push(point.x, point.y)
    drawState.node.points([...drawState.points])
    overlayLayer.batchDraw()
  }
}

/** 鼠标移动：更新绘制中的矩形/折线预览 */
function onMouseMove() {
  if (!drawState) return
  const point = pointerToImage()
  if (!point) return
  if (drawState.type === 'rect') {
    drawState.node.setAttrs({
      x: Math.min(drawState.startX, point.x),
      y: Math.min(drawState.startY, point.y),
      width: Math.abs(point.x - drawState.startX),
      height: Math.abs(point.y - drawState.startY),
    })
    overlayLayer.batchDraw()
  } else if (drawState.type === 'line' && drawState.points.length >= 2) {
    // 预览：已确定的点 + 跟随鼠标的最后一个点
    drawState.node.points([...drawState.points, point.x, point.y])
    overlayLayer.batchDraw()
  }
}

/** 鼠标抬起：提交矩形（过滤过小的误触） */
function onMouseUp() {
  if (!drawState || drawState.type !== 'rect') return
  const rect = drawState.node
  const geometry = {
    x: rect.x(),
    y: rect.y(),
    width: rect.width(),
    height: rect.height(),
  }
  const tolerance = 3 / view.scale
  finishDrawing()
  if (geometry.width < tolerance || geometry.height < tolerance) return
  emit('create', { type: 'rect', geometry, frameIndex: props.frameIndex })
}

/** 点击空白处取消选中（仅 select 工具下生效，避免绘制后立即被反选） */
function onStageClick(event) {
  if (props.tool !== 'select') return
  if (event.target && event.target.hasName && event.target.hasName('annotation')) return
  emit('select', null)
}

/** 双击结束折线绘制 */
function onDblClick() {
  if (drawState?.type === 'line') finishLine()
}

/** 全局键盘：Esc 取消、回车结束折线、Delete/Backspace 删除选中对象 */
function onKeyDown(event) {
  const tag = (event.target?.tagName || '').toLowerCase()
  // 输入框内不拦截键盘
  if (tag === 'input' || tag === 'textarea' || event.target?.isContentEditable) return
  if (event.key === 'Escape') {
    finishDrawing()
    return
  }
  if (event.key === 'Enter' && drawState?.type === 'line') {
    event.preventDefault()
    finishLine()
    return
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && props.selectedId) {
    event.preventDefault()
    emit('delete', props.selectedId)
  }
}

/** 容器尺寸变化：同步 Stage 尺寸并重新适配视图 */
function handleResize() {
  const container = containerRef.value
  if (!container || !stage) return
  const width = container.clientWidth
  const height = container.clientHeight
  if (!width || !height) return
  stage.width(width)
  stage.height(height)
  fitView()
  renderShapes()
}

/** 加载当前帧图片并重绘（异步：加载期间若帧已切换则丢弃结果） */
async function loadAndRender() {
  const url = props.imageUrl
  if (!url || !stage) return
  try {
    const image = await loadImage(url)
    if (!stage || props.imageUrl !== url) return // 防竞态：帧已切换
    naturalWidth = image.naturalWidth || image.width
    naturalHeight = image.naturalHeight || image.height
    if (!imageNode) {
      imageNode = new Konva.Image({
        image,
        x: 0,
        y: 0,
        width: naturalWidth,
        height: naturalHeight,
        listening: false, // 图片不参与命中检测，指针事件落到 Stage
      })
      imageLayer.add(imageNode)
    } else {
      imageNode.image(image)
      imageNode.size({ width: naturalWidth, height: naturalHeight })
    }
    fitView()
    renderShapes()
    imageLayer.batchDraw()
  } catch (error) {
    console.error(error)
  }
}

onMounted(() => {
  const container = containerRef.value
  stage = new Konva.Stage({
    container,
    width: container.clientWidth || 1,
    height: container.clientHeight || 1,
  })
  // 三个图层：图片 / 已确认标注 / 绘制临时层
  imageLayer = new Konva.Layer({ listening: false })
  shapeLayer = new Konva.Layer()
  overlayLayer = new Konva.Layer()
  stage.add(imageLayer)
  stage.add(shapeLayer)
  stage.add(overlayLayer)

  stage.on('mousedown touchstart', onMouseDown)
  stage.on('mousemove touchmove', onMouseMove)
  stage.on('mouseup touchend', onMouseUp)
  stage.on('dblclick dbltap', onDblClick)
  stage.on('click tap', onStageClick)
  window.addEventListener('keydown', onKeyDown)

  // 容器尺寸自适应
  resizeObserver = new ResizeObserver(handleResize)
  resizeObserver.observe(container)
  handleResize()
  loadAndRender()
})

// 切换帧图片时重新加载
watch(
  () => props.imageUrl,
  () => loadAndRender(),
)

// 帧序号 / 图形数据 / 选中项变化时重建图层
watch(
  () => [props.frameIndex, props.shapes, props.selectedId],
  () => renderShapes(),
)

// 切换工具时：离开绘制工具则结束绘制；同时重绘以更新图形的可拖动状态
watch(
  () => props.tool,
  (tool) => {
    if (tool === 'select') finishDrawing()
    renderShapes()
  },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  resizeObserver?.disconnect()
  stage?.destroy()
  stage = null
})
</script>

<template>
  <div
    ref="containerRef"
    class="annotation-canvas"
    :class="{ 'is-drawing': tool !== 'select' }"
  />
</template>

<style scoped>
.annotation-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #1f2028;
  border-radius: 6px;
}

/* 绘制工具激活时显示十字光标 */
.annotation-canvas.is-drawing {
  cursor: crosshair;
}
</style>
