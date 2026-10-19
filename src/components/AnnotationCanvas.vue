<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Konva from 'konva'
import { loadImage } from '../utils/imageCache'

const props = defineProps({
  imageUrl: { type: String, default: '' },
  frameIndex: { type: Number, default: 0 },
  shapes: { type: Array, default: () => [] },
  tool: { type: String, default: 'select' },
  selectedId: { type: String, default: null },
  color: { type: String, default: '#409eff' },
})

const emit = defineEmits(['create', 'update', 'select', 'delete'])

const containerRef = ref(null)

let stage = null
let imageLayer = null
let shapeLayer = null
let overlayLayer = null
let transformer = null
let imageNode = null
let resizeObserver = null
let naturalWidth = 0
let naturalHeight = 0
let drawState = null

const view = { scale: 1, offsetX: 0, offsetY: 0 }

function pointerToImage() {
  const pos = stage?.getPointerPosition()
  if (!pos) return null
  return {
    x: (pos.x - view.offsetX) / view.scale,
    y: (pos.y - view.offsetY) / view.scale,
  }
}

function applyView() {
  for (const layer of [imageLayer, shapeLayer, overlayLayer]) {
    if (!layer) continue
    layer.scale({ x: view.scale, y: view.scale })
    layer.position({ x: view.offsetX, y: view.offsetY })
    layer.batchDraw()
  }
}

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

function ensureTransformer() {
  if (!transformer) {
    transformer = new Konva.Transformer({
      rotateEnabled: false,
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

function readGeometry(node, type) {
  if (type === 'rect') {
    return {
      x: node.x(),
      y: node.y(),
      width: node.width() * node.scaleX(),
      height: node.height() * node.scaleY(),
    }
  }
  if (type === 'point') return { x: node.x(), y: node.y() }
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

function commitNode(node, shape) {
  const geometry = readGeometry(node, shape.type)
  node.scaleX(1)
  node.scaleY(1)
  emit('update', { trackId: shape.id, geometry })
}

function createNode(shape) {
  const color = shape.color || props.color
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
      radius: 6 / view.scale,
      fill: color,
    })
  } else {
    node = new Konva.Line({
      ...common,
      points: shape.geometry.points,
      lineJoin: 'round',
      lineCap: 'round',
      hitStrokeWidth: 10 / view.scale,
    })
  }
  node.on('click tap', (event) => {
    event.cancelBubble = true
    emit('select', shape.id)
  })
  node.on('dragend', () => commitNode(node, shape))
  node.on('transformend', () => commitNode(node, shape))
  return node
}

function renderShapes() {
  if (!stage || !shapeLayer) return
  shapeLayer.destroyChildren()
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

function finishDrawing() {
  if (drawState?.node) drawState.node.destroy()
  drawState = null
  overlayLayer?.batchDraw()
}

function finishLine() {
  if (!drawState || drawState.type !== 'line') return
  const points = drawState.points.slice()
  const tolerance = 5 / view.scale
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
    emit('create', {
      type: 'point',
      geometry: { x: point.x, y: point.y },
      frameIndex: props.frameIndex,
    })
  } else if (props.tool === 'line') {
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
    drawState.node.points([...drawState.points, point.x, point.y])
    overlayLayer.batchDraw()
  }
}

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

function onStageClick(event) {
  if (props.tool !== 'select') return
  if (event.target && event.target.hasName && event.target.hasName('annotation')) return
  emit('select', null)
}

function onDblClick() {
  if (drawState?.type === 'line') finishLine()
}

function onKeyDown(event) {
  const tag = (event.target?.tagName || '').toLowerCase()
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

async function loadAndRender() {
  const url = props.imageUrl
  if (!url || !stage) return
  try {
    const image = await loadImage(url)
    if (!stage || props.imageUrl !== url) return
    naturalWidth = image.naturalWidth || image.width
    naturalHeight = image.naturalHeight || image.height
    if (!imageNode) {
      imageNode = new Konva.Image({
        image,
        x: 0,
        y: 0,
        width: naturalWidth,
        height: naturalHeight,
        listening: false,
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

  resizeObserver = new ResizeObserver(handleResize)
  resizeObserver.observe(container)
  handleResize()
  loadAndRender()
})

watch(
  () => props.imageUrl,
  () => loadAndRender(),
)

watch(
  () => [props.frameIndex, props.shapes, props.selectedId],
  () => renderShapes(),
)

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

.annotation-canvas.is-drawing {
  cursor: crosshair;
}
</style>
