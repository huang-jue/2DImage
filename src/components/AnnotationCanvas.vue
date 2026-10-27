<script setup>
/**
 * 标注画布组件（基于 Konva）。
 *
 * 结构：一个 Stage + 三个 Layer
 *   - imageLayer   当前帧图片（不监听事件）
 *   - shapeLayer   已确认的标注图形 + 选中框（Transformer）+ 折线顶点手柄
 *   - overlayLayer 绘制中的临时图形
 * 三个 Layer 施加相同的缩放/位移（view），使图片与标注共用一套坐标变换。
 * 标注几何一律使用“原图像素坐标”，指针事件通过 view 反算回原图坐标。
 *
 * 交互：
 *   - rect    拖拽画出矩形（mouseup 提交）
 *   - point   单击落点
 *   - line    连续单击落点，双击 / 回车 / Esc 结束
 *   - polygon 同 line，结束时闭合
 *   - select  点选图形可拖动 / 矩形可缩放 / 折线可编辑顶点
 *   - 滚轮以指针为中心缩放；空格 + 拖拽 或 中键拖拽 平移
 *
 * 组件本身无状态：几何数据由父组件通过 shapes 传入，编辑结果通过 emit 抛回父组件。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Konva from 'konva'
import { loadImage, preloadImages } from '../utils/imageCache'
import { hasOpenOverlay, isTypingTarget } from '../utils/dom'

const props = defineProps({
  imageUrl: { type: String, default: '' }, // 当前帧图片地址
  frameIndex: { type: Number, default: 0 }, // 当前帧序号（用于生成新标注）
  shapes: { type: Array, default: () => [] }, // 当前帧要渲染的图形
  tool: { type: String, default: 'select' }, // 当前工具：select | rect | point | line | polygon
  selectedIds: { type: Array, default: () => [] }, // 选中对象的 track id 列表
  color: { type: String, default: '#409eff' }, // 新标注默认颜色
  showLabels: { type: Boolean, default: true }, // 是否在画布上显示标签文字
  preloadUrls: { type: Array, default: () => [] }, // 需要预加载的相邻帧图片
  projectionEnabled: { type: Boolean, default: false }, // 是否显示跨帧投影
  projectionShapes: { type: Array, default: () => [] }, // 投影的只读图形
  projectionImages: { type: Array, default: () => [] }, // 投影的帧图像
  projectionOpacity: { type: Number, default: 0.35 }, // 图像与标注共用透明度
  projectionShowLabels: { type: Boolean, default: false }, // 是否显示投影标签
  projectionSummary: { type: String, default: '' }, // 状态条文案
})

const emit = defineEmits([
  'create',
  'update',
  'update-many',
  'select',
  'delete',
  'delete-selected',
  'projection-jump',
])

const containerRef = ref(null)
const zoomPercent = ref(100)
const imageError = ref(false)
const imageReady = ref(false)
const isPanning = ref(false)
const panReady = ref(false)
const cursorText = ref('')

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
let panState = null // 平移中的临时状态
let spaceHeld = false // 空格是否按下（平移模式）
let lastPointerClick = null // 上一次指针点击（用于过滤 Konva 的“远距离双击”）
let pendingDoubleClick = false // 本次按下是否为真正的双击
let selectedNode = null // 当前选中的 Konva 节点
let selectedShape = null // 当前选中的 shape 数据
let renderedFrameIndex = null // 已渲染的帧序号（用于判断是否需要全量重建）
let vertexHandles = [] // 当前折线的顶点手柄
let dragGroup = null // 多选组拖动时的临时状态
let projectionLayer = null // 投影图层（当前帧图片之上、当前标注之下）
let projectionImageGroup = null // 投影图像（不可点击）
let projectionShapeGroup = null // 投影图形（选择工具下可点击跳帧）
let projectionEntries = [] // { node, shape, labelNode }
let projectionToken = 0 // 异步图像加载竞态令牌
const nodeMap = new Map() // track id -> { node, type, shape }，用于增量更新

// 视图变换：原图坐标 -> 屏幕坐标的等比缩放与偏移
const view = { scale: 1, offsetX: 0, offsetY: 0 }
const MIN_SCALE = 0.05
const MAX_SCALE = 40
const ZOOM_STEP = 1.15

const POLYLINE_TYPES = new Set(['line', 'polygon'])

/** 是否为折线类几何 */
function isPolyline(type) {
  return POLYLINE_TYPES.has(type)
}

/** 鼠标在容器内的坐标 */
function pointerFromEvent(event) {
  const container = stage?.container()
  if (!container) return null
  const rect = container.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

/** 屏幕坐标 -> 原图坐标；clamp=true 时限制在图片范围内 */
function screenToImage(pos, clamp = true) {
  if (!pos) return null
  let x = (pos.x - view.offsetX) / view.scale
  let y = (pos.y - view.offsetY) / view.scale
  if (clamp && naturalWidth && naturalHeight) {
    x = Math.min(Math.max(x, 0), naturalWidth)
    y = Math.min(Math.max(y, 0), naturalHeight)
  }
  return { x, y }
}

/** 当前指针位置（原图坐标，默认裁剪到图片内） */
function pointerToImage(clamp = true) {
  return screenToImage(stage?.getPointerPosition(), clamp)
}

/** 点是否落在图片范围内 */
function insideImage(point) {
  return (
    !!point &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= naturalWidth &&
    point.y <= naturalHeight
  )
}

/** 更新缩放比例显示 */
function syncZoomLabel() {
  zoomPercent.value = Math.round(view.scale * 100)
}

/** Transformer 的描边/锚点需除以 scale 才能保持屏幕恒定大小 */
function syncTransformerMetrics() {
  if (!transformer) return
  transformer.borderStrokeWidth(1 / view.scale)
  transformer.anchorSize(8 / view.scale)
  transformer.anchorStrokeWidth(1 / view.scale)
}

/** 点 / 折线的屏幕恒定尺寸需要在缩放后同步 */
function syncNodeMetrics() {
  if (!shapeLayer) return
  for (const node of shapeLayer.find('.annotation')) {
    const type = node.getAttr('shapeType')
    if (type === 'point') node.radius(6 / view.scale)
    else if (isPolyline(type)) node.hitStrokeWidth(10 / view.scale)
  }
  for (const handle of shapeLayer.find('.vertex')) {
    handle.radius(5 / view.scale)
    handle.strokeWidth(1.5 / view.scale)
  }
  // 标签字号与位置随缩放同步
  for (const entry of nodeMap.values()) {
    if (entry.labelNode && entry.shape) styleLabelNode(entry.labelNode, entry.shape, entry.node)
  }
  // 投影点 / 折线命中区与投影标签同步缩放
  for (const entry of projectionEntries) {
    const type = entry.shape.type
    if (type === 'point') entry.node.radius(6 / view.scale)
    else if (isPolyline(type)) entry.node.hitStrokeWidth(12 / view.scale)
    if (entry.labelNode) {
      styleLabelNode(entry.labelNode, entry.shape, entry.node, props.projectionShowLabels)
    }
  }
}

/** 更新光标处的原图坐标读数 */
function updateCursorText() {
  if (!stage || !naturalWidth || !naturalHeight) {
    cursorText.value = ''
    return
  }
  const point = screenToImage(stage.getPointerPosition(), false)
  if (!insideImage(point)) {
    cursorText.value = ''
    return
  }
  cursorText.value = `${Math.round(point.x)}, ${Math.round(point.y)}`
}

/** 把当前 view 变换应用到三个 Layer 上 */
function applyView() {
  for (const layer of [imageLayer, projectionLayer, shapeLayer, overlayLayer]) {
    if (!layer) continue
    layer.scale({ x: view.scale, y: view.scale })
    layer.position({ x: view.offsetX, y: view.offsetY })
    layer.batchDraw()
  }
  syncTransformerMetrics()
  syncNodeMetrics()
  syncZoomLabel()
}

/** 根据容器尺寸计算等比缩放，使图片居中铺满 */
function fitView() {
  if (!stage || !naturalWidth || !naturalHeight) return
  const width = stage.width()
  const height = stage.height()
  if (!width || !height) return
  const scale = Math.min(width / naturalWidth, height / naturalHeight)
  view.scale = scale > MAX_SCALE ? MAX_SCALE : Math.max(scale, MIN_SCALE)
  view.offsetX = (width - naturalWidth * view.scale) / 2
  view.offsetY = (height - naturalHeight * view.scale) / 2
  applyView()
}

/** 以某个屏幕坐标为中心缩放 */
function zoomAt(pos, factor) {
  if (!pos) return
  const next = Math.min(Math.max(view.scale * factor, MIN_SCALE), MAX_SCALE)
  if (next === view.scale) return
  const point = screenToImage(pos, false)
  view.scale = next
  view.offsetX = pos.x - point.x * next
  view.offsetY = pos.y - point.y * next
  applyView()
}

/** 以画布中心缩放（供外部按钮调用） */
function zoomIn() {
  if (!stage) return
  zoomAt({ x: stage.width() / 2, y: stage.height() / 2 }, ZOOM_STEP)
}

function zoomOut() {
  if (!stage) return
  zoomAt({ x: stage.width() / 2, y: stage.height() / 2 }, 1 / ZOOM_STEP)
}

/** 创建（或更新）Transformer 选中框 */
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
  syncTransformerMetrics()
}

/**
 * 读取节点几何（原图坐标）。
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
  // 折线：节点的 points 可能是相对坐标，叠加节点位移后得到绝对坐标
  return { points: absolutePoints(node) }
}

/** 折线节点的绝对坐标（叠加节点位移） */
function absolutePoints(node) {
  const dx = node.x()
  const dy = node.y()
  return node
    .points()
    .map((value, index) => (index % 2 === 0 ? value + dx : value + dy))
}

/** 拖拽/缩放结束时提交几何：归一化 scale 并向上抛出 update */
function commitNode(node, shape) {
  const geometry = readGeometry(node, shape.type)
  node.scaleX(1)
  node.scaleY(1)
  if (isPolyline(shape.type)) {
    node.points(geometry.points)
    node.position({ x: 0, y: 0 })
  }
  emit('update', { trackId: shape.id, geometry })
}

/** 复位节点的缩放 / 折线相对位移，便于持久化 */
function resetNodeTransform(node, type) {
  node.scaleX(1)
  node.scaleY(1)
  if (isPolyline(type)) {
    node.points(absolutePoints(node))
    node.position({ x: 0, y: 0 })
  }
}

/** 节点在图层坐标系中的“持久化原点”（折线用 0，点/矩形用几何 x/y） */
function originOf(shape) {
  if (isPolyline(shape.type)) return { x: 0, y: 0 }
  return { x: shape.geometry.x, y: shape.geometry.y }
}

/** 组拖动开始：记录主节点与其它选中节点的初始位置 */
function startGroupDrag(node, shape) {
  if (props.selectedIds.length < 2 || !props.selectedIds.includes(shape.id)) return
  const origin = originOf(shape)
  const items = []
  for (const id of props.selectedIds) {
    const entry = nodeMap.get(id)
    if (!entry || entry.node === node) continue
    if (!entry.shape || entry.shape.locked) continue
    const itemOrigin = originOf(entry.shape)
    items.push({
      node: entry.node,
      shape: entry.shape,
      startX: itemOrigin.x,
      startY: itemOrigin.y,
    })
  }
  if (!items.length) return
  dragGroup = {
    node,
    // 以模型坐标为准，抵消 Konva 拖动阈值造成的起始偏移，保证组内位移一致
    startX: origin.x,
    startY: origin.y,
    items,
  }
}

/** 组拖动进行中：其它节点跟随主节点位移 */
function moveGroupDrag(node) {
  if (!dragGroup || dragGroup.node !== node) return
  const dx = node.x() - dragGroup.startX
  const dy = node.y() - dragGroup.startY
  for (const item of dragGroup.items) {
    item.node.position({ x: item.startX + dx, y: item.startY + dy })
  }
  shapeLayer.batchDraw()
}

/** 组拖动结束：一次性提交所有节点几何（单步撤销） */
function endGroupDrag(node, shape) {
  if (!dragGroup || dragGroup.node !== node) {
    commitNode(node, shape)
    return
  }
  const group = dragGroup
  dragGroup = null
  const items = [{ node, shape }, ...group.items]
  const updates = []
  for (const item of items) {
    updates.push({
      trackId: item.shape.id,
      geometry: readGeometry(item.node, item.shape.type),
    })
    resetNodeTransform(item.node, item.shape.type)
  }
  emit('update-many', updates)
}

/**
 * 根据图形数据创建 Konva 节点。
 * interactive=true 用于当前帧标注，false 用于只读投影。
 */
function createShapeNode(shape, interactive = true) {
  const color = shape.color || props.color
  // 公共属性：描边不随缩放变粗（strokeScaleEnabled=false）
  const common = {
    ...(interactive ? { id: shape.id } : {}),
    name: interactive ? 'annotation' : 'projection-shape',
    stroke: color,
    strokeWidth: 2,
    strokeScaleEnabled: false,
    // 当前帧标注只在 select 工具下拦截事件；投影由图层/分组统一控制
    listening: interactive ? props.tool === 'select' : true,
    draggable: interactive ? props.tool === 'select' && !shape.locked : false,
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
      closed: shape.type === 'polygon',
      fill: shape.type === 'polygon' ? `${color}22` : undefined,
      hitStrokeWidth: 10 / view.scale, // 扩大命中区域，便于点击细线
    })
  }
  node.setAttr('shapeType', shape.type)

  if (!interactive) {
    node.opacity(props.projectionOpacity)
    // 矩形投影加极淡填充，便于点击内部而不是只能点边框
    if (shape.type === 'rect') node.fill(`${color}11`)
    if (isPolyline(shape.type)) node.hitStrokeWidth(12 / view.scale)
  }
  return node
}

/** 当前帧标注节点：创建后绑定选择/拖拽/缩放事件 */
function createNode(shape) {
  const node = createShapeNode(shape, true)
  node.on('click tap', (event) => {
    event.cancelBubble = true // 阻止冒泡到 Stage，避免随即被反选
    emit('select', { id: shape.id, additive: event.evt?.shiftKey === true })
  })
  node.on('dragstart', () => {
    hideLabels()
    startGroupDrag(node, shape)
  })
  node.on('dragmove', () => moveGroupDrag(node))
  node.on('dragend', () => endGroupDrag(node, shape))
  node.on('transformend', () => commitNode(node, shape))
  return node
}

/** 投影节点：只读，点击跳转到来源帧 */
function createProjectionNode(shape) {
  const node = createShapeNode(shape, false)
  node.on('click tap', (event) => {
    event.cancelBubble = true
    if (!Number.isInteger(shape.sourceFrame)) return
    emit('projection-jump', { frame: shape.sourceFrame, trackId: shape.id })
  })
  node.on('mouseenter', () => {
    if (stage) stage.container().style.cursor = 'pointer'
  })
  node.on('mouseleave', () => resetCursor())
  return node
}

/** 创建图形对应的标签文字（不可交互，不参与选中） */
function createLabelNode(shape, node) {
  const label = new Konva.Label({ listening: false, opacity: 0.95 })
  label.add(
    new Konva.Tag({
      fill: shape.color || props.color,
      cornerRadius: 3,
      pointerDirection: 'down',
      pointerWidth: 5,
      pointerHeight: 4,
      lineJoin: 'round',
    }),
  )
  label.add(
    new Konva.Text({
      text: shape.label || '未命名',
      fontSize: 12,
      fontFamily: 'system-ui, sans-serif',
      padding: 3,
      fill: '#ffffff',
    }),
  )
  styleLabelNode(label, shape, node)
  return label
}

/** 投影标签：低透明度、始终可读，但仍不参与交互 */
function createProjectionLabel(shape, node) {
  const label = createLabelNode(shape, node)
  label.visible(true)
  label.opacity(props.projectionOpacity)
  return label
}

/** 标签文字的位置：矩形在上方，点/折线在锚点右上 */
function labelPosition(shape, node) {
  const scale = view.scale
  let anchorX
  let anchorY
  if (isPolyline(shape.type)) {
    const points = absolutePoints(node)
    anchorX = points[0] ?? 0
    anchorY = points[1] ?? 0
  } else {
    anchorX = node.x()
    anchorY = node.y()
  }
  const gap = 6 / scale
  const lineHeight = 20 / scale
  let y = anchorY - lineHeight
  if (y < 0) y = anchorY + gap
  return { x: anchorX, y }
}

/** 按当前缩放与标签内容更新标签样式和位置 */
function styleLabelNode(label, shape, node, visible = props.showLabels) {
  const scale = view.scale
  const tag = label.getTag()
  const text = label.getText()
  text.text(shape.label || '未命名')
  text.fontSize(12 / scale)
  text.padding(3 / scale)
  tag.fill(shape.color || props.color)
  tag.cornerRadius(3 / scale)
  tag.pointerWidth(5 / scale)
  tag.pointerHeight(4 / scale)
  label.position(labelPosition(shape, node))
  label.visible(visible)
}

/** 拖动期间隐藏标签，避免标签停留在旧位置 */
function hideLabels() {
  for (const entry of nodeMap.values()) entry.labelNode?.visible(false)
}

/** 增量更新已存在的节点（避免每次选中都销毁重建） */
function updateNode(node, shape) {
  node.stroke(shape.color || props.color)
  node.listening(props.tool === 'select')
  node.draggable(props.tool === 'select' && !shape.locked)
  const geometry = shape.geometry
  if (shape.type === 'rect') {
    node.setAttrs({
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
    })
  } else if (shape.type === 'point') {
    node.setAttrs({ x: geometry.x, y: geometry.y, radius: 6 / view.scale })
    node.fill(shape.color || props.color)
  } else {
    node.points(geometry.points)
    node.closed(shape.type === 'polygon')
    node.fill(shape.type === 'polygon' ? `${shape.color || props.color}22` : undefined)
    node.hitStrokeWidth(10 / view.scale)
  }
}

/** 折线顶点手柄：可拖动、右键删除 */
function createVertexHandles(node, shape) {
  const points = absolutePoints(node)
  // 统一成绝对坐标，方便手柄与 points 使用同一坐标系
  node.points(points)
  node.position({ x: 0, y: 0 })
  const handles = []
  const minPoints = shape.type === 'polygon' ? 3 : 2

  for (let index = 0; index < points.length; index += 2) {
    const handle = new Konva.Circle({
      name: 'vertex',
      x: points[index],
      y: points[index + 1],
      radius: 5 / view.scale,
      fill: '#ffffff',
      stroke: shape.color || props.color,
      strokeWidth: 1.5 / view.scale,
      strokeScaleEnabled: false,
      draggable: true,
    })
    handle.on('mousedown touchstart', (event) => {
      event.cancelBubble = true
    })
    handle.on('dragmove', () => {
      points[index] = handle.x()
      points[index + 1] = handle.y()
      node.points([...points])
      shapeLayer.batchDraw()
    })
    handle.on('dragend', () => {
      node.points([...points])
      node.position({ x: 0, y: 0 })
      emit('update', { trackId: shape.id, geometry: { points: [...points] } })
    })
    handle.on('contextmenu', (event) => {
      event.evt.preventDefault()
      event.cancelBubble = true
      if (points.length / 2 <= minPoints) return
      points.splice(index, 2)
      node.points([...points])
      emit('update', { trackId: shape.id, geometry: { points: [...points] } })
    })
    shapeLayer.add(handle)
    handles.push(handle)
  }
  return handles
}

/** 在折线上插入顶点（双击） */
function insertVertex(node, shape, point) {
  if (!isPolyline(shape.type) || shape.locked) return
  const points = absolutePoints(node)
  if (points.length < 4) return
  const count = points.length / 2
  const closed = shape.type === 'polygon'
  let bestIndex = 0
  let bestDistance = Infinity
  const segments = closed ? count : count - 1
  for (let index = 0; index < segments; index++) {
    const next = (index + 1) % count
    const ax = points[index * 2]
    const ay = points[index * 2 + 1]
    const bx = points[next * 2]
    const by = points[next * 2 + 1]
    const distance = distanceToSegment(point.x, point.y, ax, ay, bx, by)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  }
  if (bestDistance * view.scale > 12) return // 离线段太远，忽略
  points.splice((bestIndex + 1) * 2, 0, point.x, point.y)
  node.points(points)
  node.position({ x: 0, y: 0 })
  emit('update', { trackId: shape.id, geometry: { points: [...points] } })
}

/** 点到线段的距离 */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  if (!lengthSquared) return Math.hypot(px - ax, py - ay)
  const t = Math.min(Math.max(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0), 1)
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** 更新选中框与顶点手柄（不重建图形节点） */
function applySelection() {
  for (const handle of vertexHandles) handle.destroy()
  vertexHandles = []

  const entries = props.selectedIds
    .map((id) => nodeMap.get(id))
    .filter((entry) => entry && entry.shape)
  // 锁定对象可以选中查看，但不参与变换
  const transformable = entries.filter((entry) => !entry.shape.locked)

  selectedNode = entries.length === 1 ? entries[0].node : null
  selectedShape = entries.length === 1 ? entries[0].shape : null

  if (!transformable.length || props.tool !== 'select') {
    selectedShape = null
    transformer.nodes([])
    return
  }

  transformer.nodes(transformable.map((entry) => entry.node))
  transformer.moveToTop() // 选中框始终位于图形之上

  const single = transformable.length === 1 ? transformable[0] : null
  if (single && single.shape.type === 'rect') {
    // 单个矩形允许缩放；多选或点 / 折线只允许拖动或编辑顶点
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
    if (single && isPolyline(single.shape.type)) {
      vertexHandles = createVertexHandles(single.node, single.shape)
    }
  }
}

/**
 * 重建 / 增量更新 shapeLayer。
 * 帧切换时全量重建；同一帧内（拖动、改标签、切换选中）只更新受影响的节点。
 */
function renderShapes() {
  if (!stage || !shapeLayer) return
  const frameChanged = renderedFrameIndex !== props.frameIndex
  if (frameChanged) {
    shapeLayer.destroyChildren() // 连同旧 Transformer / 顶点手柄一并销毁
    transformer = null
    vertexHandles = []
    nodeMap.clear()
    renderedFrameIndex = props.frameIndex
  }
  ensureTransformer()

  const seen = new Set()
  for (const shape of props.shapes) {
    seen.add(shape.id)
    const entry = nodeMap.get(shape.id)
    if (entry && entry.type === shape.type) {
      entry.shape = shape
      updateNode(entry.node, shape)
      styleLabelNode(entry.labelNode, shape, entry.node)
    } else {
      if (entry) {
        entry.node.destroy()
        entry.labelNode?.destroy()
        nodeMap.delete(shape.id)
      }
      const node = createNode(shape)
      shapeLayer.add(node)
      const labelNode = createLabelNode(shape, node)
      shapeLayer.add(labelNode)
      nodeMap.set(shape.id, { node, type: shape.type, shape, labelNode })
    }
  }

  // 移除本帧已不存在的对象（如删除、隐藏）
  for (const [id, entry] of [...nodeMap]) {
    if (seen.has(id)) continue
    entry.node.destroy()
    entry.labelNode?.destroy()
    nodeMap.delete(id)
  }

  // 标签位于图形之上、选中框之下
  for (const entry of nodeMap.values()) entry.labelNode?.moveToTop()

  applySelection()
  shapeLayer.batchDraw()
}

/** 重置画布光标（投影悬停 / 关闭 / 失焦时复用） */
function resetCursor() {
  if (stage) stage.container().style.cursor = ''
}

/** 投影是否可点击：只在选择工具且有投影图形时启用 */
function isProjectionInteractive() {
  return Boolean(
    props.projectionEnabled &&
      props.tool === 'select' &&
      props.projectionShapes.length > 0,
  )
}

/** 同步投影图层 / 分组的事件监听状态 */
function syncProjectionListening() {
  const interactive = isProjectionInteractive()
  projectionLayer?.listening(interactive)
  projectionShapeGroup?.listening(interactive)
}

/** 销毁投影节点（不递增令牌，供渲染和卸载复用） */
function clearProjectionNodes() {
  projectionEntries = []
  projectionImageGroup?.destroy()
  projectionShapeGroup?.destroy()
  projectionImageGroup = null
  projectionShapeGroup = null
  resetCursor()
}

/** 创建当前投影图形（只读 + 点击跳帧） */
function renderProjectionShapes() {
  if (!projectionShapeGroup) return
  const nodes = []
  const labels = []
  projectionEntries = []
  for (const shape of props.projectionShapes) {
    const node = createProjectionNode(shape)
    nodes.push(node)
    let labelNode = null
    if (props.projectionShowLabels) {
      labelNode = createProjectionLabel(shape, node)
      labels.push(labelNode)
    }
    projectionEntries.push({ node, shape, labelNode })
  }
  // 先放图形，再统一放标签，避免后创建的图形盖住前面的标签
  for (const node of nodes) projectionShapeGroup.add(node)
  for (const label of labels) projectionShapeGroup.add(label)
}

/** 异步加载投影图像；token 防止旧帧结果覆盖新帧 */
async function renderProjectionImages(token) {
  const group = projectionImageGroup
  const list = props.projectionImages || []
  if (!group || !list.length) return

  const loaded = await Promise.all(
    list.map(async (item) => {
      try {
        const image = await loadImage(item.url)
        return { item, image }
      } catch {
        return null
      }
    }),
  )
  if (token !== projectionToken || !projectionImageGroup || projectionImageGroup !== group) {
    return
  }

  for (const entry of loaded) {
    if (!entry) continue
    const image = entry.image
    const width = image.naturalWidth || image.width
    const height = image.naturalHeight || image.height
    if (!width || !height) continue
    // 帧尺寸不一致时直接跳过图像投影，避免叠加错位
    if (
      naturalWidth &&
      naturalHeight &&
      (width !== naturalWidth || height !== naturalHeight)
    ) {
      console.warn(`投影图像尺寸与当前帧不一致，已跳过：${entry.item.url}`)
      continue
    }
    const node = new Konva.Image({
      image,
      x: 0,
      y: 0,
      width,
      height,
      opacity: props.projectionOpacity,
      listening: false,
    })
    group.add(node)
  }
  projectionLayer?.batchDraw()
}

/** 重建投影层：帧 / 设置 / 选中对象变化时调用 */
async function renderProjection() {
  if (!projectionLayer) return
  const token = ++projectionToken
  clearProjectionNodes()
  syncProjectionListening()

  if (!props.projectionEnabled) {
    projectionLayer.listening(false)
    projectionLayer.batchDraw()
    return
  }

  projectionImageGroup = new Konva.Group({ listening: false })
  projectionShapeGroup = new Konva.Group({ listening: props.tool === 'select' })
  projectionLayer.add(projectionImageGroup)
  projectionLayer.add(projectionShapeGroup)

  renderProjectionShapes()
  syncProjectionListening()
  projectionLayer.batchDraw()

  await renderProjectionImages(token)
}

/** 结束/取消当前绘制，清理 overlayLayer 上的临时图形 */
function finishDrawing() {
  if (drawState?.marker) drawState.marker.destroy()
  if (drawState?.node) drawState.node.destroy()
  drawState = null
  overlayLayer?.batchDraw()
}

/** 结束折线/多边形绘制：去除末尾重合点后提交 create */
function finishLine() {
  if (!drawState || !isPolyline(drawState.type)) return
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
  const type = drawState.type
  finishDrawing()
  const minPoints = type === 'polygon' ? 6 : 4
  if (points.length >= minPoints) {
    emit('create', { type, geometry: { points }, frameIndex: props.frameIndex })
  }
}

/** 鼠标按下：平移 / 开始绘制 */
function onMouseDown(event) {
  const evt = event.evt || {}
  const isTouch = (evt.type || '').startsWith('touch')
  const pointer = isTouch ? stage.getPointerPosition() : pointerFromEvent(evt)
  if (!pointer) return

  // Konva 的 dblclick 只看目标与时间、不看距离，快速连续点不同位置也会触发。
  // 这里自行加上距离判断，避免绘制折线/多边形时被误判为双击结束。
  if (isTouch || evt.button === 0) {
    const now = Date.now()
    pendingDoubleClick =
      !!lastPointerClick &&
      now - lastPointerClick.time < 400 &&
      Math.hypot(pointer.x - lastPointerClick.x, pointer.y - lastPointerClick.y) <= 8
    lastPointerClick = { x: pointer.x, y: pointer.y, time: now }
  }

  // 中键或空格进入平移
  if ((!isTouch && evt.button === 1) || spaceHeld) {
    evt.preventDefault?.()
    panState = {
      startX: pointer.x,
      startY: pointer.y,
      offsetX: view.offsetX,
      offsetY: view.offsetY,
    }
    isPanning.value = true
    return
  }
  if (!isTouch && evt.button !== 0) return // 仅左键绘制
  if (props.tool === 'select') return

  const point = screenToImage(pointer, false)
  if (!insideImage(point)) return

  if (props.tool === 'rect') {
    const rect = new Konva.Rect({
      x: point.x,
      y: point.y,
      width: 0,
      height: 0,
      stroke: props.color,
      strokeWidth: 2,
      strokeScaleEnabled: false,
      fill: `${props.color}22`,
      dash: [5 / view.scale, 4 / view.scale],
    })
    overlayLayer.add(rect)
    drawState = { type: 'rect', startX: point.x, startY: point.y, node: rect }
    overlayLayer.batchDraw()
  } else if (props.tool === 'point') {
    // 记录按下位置，抬起时若没有明显拖动才落点
    drawState = { type: 'point', startX: point.x, startY: point.y }
  } else if (props.tool === 'line' || props.tool === 'polygon') {
    // 多边形：点击首顶点闭合
    if (
      props.tool === 'polygon' &&
      drawState?.type === 'polygon' &&
      drawState.points.length >= 6
    ) {
      const firstX = drawState.points[0]
      const firstY = drawState.points[1]
      if (Math.hypot(point.x - firstX, point.y - firstY) <= 8 / view.scale) {
        finishLine()
        return
      }
    }
    // 首次点击创建临时折线节点
    if (!drawState || drawState.type !== props.tool) {
      const line = new Konva.Line({
        points: [],
        stroke: props.color,
        strokeWidth: 2,
        strokeScaleEnabled: false,
        lineJoin: 'round',
        lineCap: 'round',
        closed: props.tool === 'polygon',
        fill: props.tool === 'polygon' ? `${props.color}22` : undefined,
      })
      overlayLayer.add(line)
      let marker = null
      if (props.tool === 'polygon') {
        marker = new Konva.Circle({
          x: point.x,
          y: point.y,
          radius: 5 / view.scale,
          fill: '#ffffff',
          stroke: props.color,
          strokeWidth: 1.5 / view.scale,
          listening: false,
        })
        overlayLayer.add(marker)
      }
      drawState = { type: props.tool, node: line, points: [], marker }
    }
    drawState.points.push(point.x, point.y)
    drawState.node.points([...drawState.points])
    overlayLayer.batchDraw()
  }
}

/** 鼠标移动：更新绘制预览 / 平移 */
function onMouseMove(event) {
  const evt = event?.evt
  updateCursorText()
  if (panState) {
    const pointer = evt ? pointerFromEvent(evt) : null
    if (!pointer) return
    view.offsetX = panState.offsetX + (pointer.x - panState.startX)
    view.offsetY = panState.offsetY + (pointer.y - panState.startY)
    applyView()
    return
  }
  if (!drawState) return
  const point = pointerToImage()
  if (!point) return
  if (drawState.type === 'rect') {
    let dx = point.x - drawState.startX
    let dy = point.y - drawState.startY
    // 按住 Shift 约束为正方形
    if (evt?.shiftKey) {
      const size = Math.max(Math.abs(dx), Math.abs(dy))
      dx = (dx < 0 ? -1 : 1) * size
      dy = (dy < 0 ? -1 : 1) * size
    }
    drawState.node.setAttrs({
      x: Math.min(drawState.startX, drawState.startX + dx),
      y: Math.min(drawState.startY, drawState.startY + dy),
      width: Math.abs(dx),
      height: Math.abs(dy),
    })
    // 绘制中显示尺寸读数
    cursorText.value = `${Math.round(Math.abs(dx))} × ${Math.round(Math.abs(dy))}`
    overlayLayer.batchDraw()
  } else if (isPolyline(drawState.type) && drawState.points.length >= 2) {
    // 预览：已确定的点 + 跟随鼠标的最后一个点
    drawState.node.points([...drawState.points, point.x, point.y])
    overlayLayer.batchDraw()
  }
}

/** 提交矩形 / 点（鼠标抬起时） */
function commitDrawable(event) {
  if (!drawState) return
  if (drawState.type === 'rect') {
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
  } else if (drawState.type === 'point') {
    const start = { x: drawState.startX, y: drawState.startY }
    // 明显拖动视为误触，不落点
    if (event) {
      const pointer = pointerFromEvent(event)
      if (pointer) {
        const screenX = start.x * view.scale + view.offsetX
        const screenY = start.y * view.scale + view.offsetY
        if (Math.hypot(pointer.x - screenX, pointer.y - screenY) > 4) {
          finishDrawing()
          return
        }
      }
    }
    finishDrawing()
    emit('create', {
      type: 'point',
      geometry: start,
      frameIndex: props.frameIndex,
    })
  }
}

function onMouseUp(event) {
  if (panState) return
  commitDrawable(event?.evt)
}

/** 窗口级鼠标抬起：避免在画布外松手导致绘制卡死 */
function onWindowMouseUp(event) {
  if (panState) {
    panState = null
    isPanning.value = false
    return
  }
  commitDrawable(event)
}

/** 窗口级鼠标移动：平移时指针可能移出画布 */
function onWindowMouseMove(event) {
  if (panState) onMouseMove({ evt: event })
}

/** 点击空白处取消选中（仅 select 工具下生效） */
function onStageClick(event) {
  if (props.tool !== 'select') return
  if (event.target && event.target.hasName && event.target.hasName('annotation')) return
  if (event.target && event.target.hasName && event.target.hasName('vertex')) return
  // 投影层已 cancelBubble；这里再兜底一次，避免点击投影图形后反选
  if (event.target && event.target.hasName && event.target.hasName('projection-shape')) return
  emit('select', { id: null, additive: false })
}

/** 双击：结束折线绘制 / 在折线上插入顶点 */
function onDblClick(event) {
  // 只接受真正的同位置双击（过滤快速连点不同位置）
  if (!pendingDoubleClick) return
  pendingDoubleClick = false
  if (drawState && isPolyline(drawState.type)) {
    finishLine()
    return
  }
  if (props.tool !== 'select' || !selectedNode || !selectedShape) return
  if (!isPolyline(selectedShape.type)) return
  const target = event.target
  if (!target || target.id() !== selectedShape.id) return
  const point = pointerToImage()
  if (point) insertVertex(selectedNode, selectedShape, point)
}

/** 滚轮缩放（以指针为中心） */
function onWheel(event) {
  event.evt.preventDefault()
  const factor = event.evt.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP
  zoomAt(pointerFromEvent(event.evt), factor)
}

/** 全局键盘：空格平移、Esc 取消、回车结束、Delete 删除 */
function onKeyDown(event) {
  // 输入框内或弹窗打开时不拦截键盘
  if (isTypingTarget(event) || hasOpenOverlay()) return
  if (event.code === 'Space') {
    if (!spaceHeld) {
      spaceHeld = true
      panReady.value = true
    }
    event.preventDefault()
    return
  }
  if (event.key === 'Escape') {
    finishDrawing()
    return
  }
  if (event.key === 'Enter' && drawState && isPolyline(drawState.type)) {
    event.preventDefault()
    finishLine()
    return
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && props.selectedIds.length) {
    event.preventDefault()
    emit('delete-selected')
  }
}

function onKeyUp(event) {
  if (event.code === 'Space') {
    spaceHeld = false
    panReady.value = false
  }
}

/** 窗口失焦时复位平移状态，避免空格键“粘住” */
function onWindowBlur() {
  spaceHeld = false
  panReady.value = false
  panState = null
  isPanning.value = false
  cursorText.value = ''
  resetCursor()
}

/** 指针离开画布时清空坐标读数 */
function onContainerLeave() {
  cursorText.value = ''
  resetCursor()
}

/** 容器尺寸变化：同步 Stage 尺寸；首次或图片尺寸变化时才重新适配视图 */
function handleResize() {
  const container = containerRef.value
  if (!container || !stage) return
  const width = container.clientWidth
  const height = container.clientHeight
  if (!width || !height) return
  stage.width(width)
  stage.height(height)
  if (!naturalWidth || !naturalHeight) return
  // 已手动缩放/平移时保持当前视图，只做边界修正
  const imageWidth = naturalWidth * view.scale
  const imageHeight = naturalHeight * view.scale
  if (imageWidth <= width) view.offsetX = (width - imageWidth) / 2
  if (imageHeight <= height) view.offsetY = (height - imageHeight) / 2
  applyView()
}

/** 加载当前帧图片并重绘（异步：加载期间若帧已切换则丢弃结果） */
async function loadAndRender() {
  const url = props.imageUrl
  if (!url || !stage) return
  imageError.value = false
  imageReady.value = false
  try {
    const image = await loadImage(url)
    if (!stage || props.imageUrl !== url) return // 防竞态：帧已切换
    const width = image.naturalWidth || image.width
    const height = image.naturalHeight || image.height
    const sizeChanged = width !== naturalWidth || height !== naturalHeight
    naturalWidth = width
    naturalHeight = height
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
    if (sizeChanged) fitView()
    else applyView()
    renderShapes()
    if (props.projectionEnabled) renderProjection()
    imageLayer.batchDraw()
    imageReady.value = true
    // 预加载相邻帧，减少切帧等待
    preloadImages(props.preloadUrls.filter(Boolean)).catch(() => {})
  } catch (error) {
    imageError.value = true
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
  // 四个图层：图片 / 投影 / 已确认标注 / 绘制临时层
  imageLayer = new Konva.Layer({ listening: false })
  projectionLayer = new Konva.Layer({ listening: false })
  shapeLayer = new Konva.Layer()
  overlayLayer = new Konva.Layer()
  stage.add(imageLayer)
  stage.add(projectionLayer)
  stage.add(shapeLayer)
  stage.add(overlayLayer)

  stage.on('mousedown touchstart', onMouseDown)
  stage.on('mousemove touchmove', onMouseMove)
  stage.on('mouseup touchend', onMouseUp)
  stage.on('dblclick dbltap', onDblClick)
  stage.on('click tap', onStageClick)
  stage.on('wheel', onWheel)
  stage.on('contextmenu', (event) => event.evt.preventDefault())
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('mousemove', onWindowMouseMove)
  window.addEventListener('mouseup', onWindowMouseUp)
  window.addEventListener('blur', onWindowBlur)
  container.addEventListener('mouseleave', onContainerLeave)

  // 容器尺寸自适应
  resizeObserver = new ResizeObserver(handleResize)
  resizeObserver.observe(container)
  handleResize()
  loadAndRender()
})

// 切换帧图片：清理未完成的绘制并重新加载
watch(
  () => props.imageUrl,
  () => {
    finishDrawing()
    loadAndRender()
  },
)

// 相邻帧变化时预加载
watch(
  () => props.preloadUrls,
  (urls) => {
    preloadImages((urls || []).filter((url) => url && url !== props.imageUrl)).catch(() => {})
  },
)

// 投影设置 / 来源帧 / 图形变化时重建投影层
watch(
  () => [
    props.projectionEnabled,
    props.projectionShapes,
    props.projectionImages,
    props.projectionOpacity,
    props.projectionShowLabels,
  ],
  () => {
    renderProjection()
  },
)

// 帧序号 / 图形数据 / 选中项变化时重建图层
watch(
  () => [props.frameIndex, props.shapes, props.selectedIds, props.showLabels],
  () => renderShapes(),
)

// 切换工具时：结束未完成的绘制，并重绘以更新可拖动状态
watch(
  () => props.tool,
  () => {
    finishDrawing()
    resetCursor()
    renderShapes()
    syncProjectionListening()
  },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('mousemove', onWindowMouseMove)
  window.removeEventListener('mouseup', onWindowMouseUp)
  window.removeEventListener('blur', onWindowBlur)
  containerRef.value?.removeEventListener('mouseleave', onContainerLeave)
  resizeObserver?.disconnect()
  projectionToken += 1
  clearProjectionNodes()
  projectionLayer = null
  stage?.destroy()
  stage = null
})

defineExpose({ fitView, zoomIn, zoomOut })
</script>

<template>
  <div
    class="annotation-canvas"
    :class="{
      'is-ready': imageReady,
      'is-drawing': tool !== 'select' && !panReady && !isPanning,
      'is-pan-ready': panReady && !isPanning,
      'is-panning': isPanning,
    }"
    :data-projection-enabled="projectionEnabled"
    :data-projection-shapes="projectionShapes.length"
    :data-projection-images="projectionImages.length"
  >
    <!-- Konva 会清空挂载容器的内容，因此这里必须是独立节点，不能包裹其它 DOM -->
    <div ref="containerRef" class="annotation-canvas__stage" />
    <div v-if="cursorText" class="annotation-canvas__cursor">{{ cursorText }}</div>
    <div v-if="projectionEnabled" class="annotation-canvas__projection">
      投影：{{ projectionSummary }}
    </div>
    <div class="annotation-canvas__zoom">
      <button type="button" title="缩小" @click="zoomOut">−</button>
      <span>{{ zoomPercent }}%</span>
      <button type="button" title="放大" @click="zoomIn">+</button>
      <button type="button" title="适应窗口" @click="fitView">适应</button>
    </div>
    <div v-if="imageError" class="annotation-canvas__error">图片加载失败</div>
  </div>
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

/* Konva Stage 的挂载节点：铺满容器，且不包含任何 Vue 管理的子节点 */
.annotation-canvas__stage {
  position: absolute;
  inset: 0;
}

/* 绘制工具激活时显示十字光标 */
.annotation-canvas.is-drawing {
  cursor: crosshair;
}

.annotation-canvas.is-pan-ready {
  cursor: grab;
}

.annotation-canvas.is-panning {
  cursor: grabbing;
}

/* 指针坐标 / 绘制尺寸读数 */
.annotation-canvas__cursor {
  position: absolute;
  left: 12px;
  top: 12px;
  z-index: 2;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  user-select: none;
}

/* 投影状态条 */
.annotation-canvas__projection {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
  max-width: 60%;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  user-select: none;
}

/* 缩放控件 */
.annotation-canvas__zoom {  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 12px;
  user-select: none;
}

.annotation-canvas__zoom button {
  padding: 0 6px;
  min-width: 22px;
  height: 22px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #fff;
  cursor: pointer;
  font-size: 13px;
}

.annotation-canvas__zoom button:hover {
  background: rgba(255, 255, 255, 0.18);
}

.annotation-canvas__zoom span {
  min-width: 44px;
  text-align: center;
}

.annotation-canvas__error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #f56c6c;
  font-size: 14px;
  pointer-events: none;
}
</style>
