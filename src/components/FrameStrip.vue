<script setup>
/**
 * 帧条组件：多帧浏览。
 * 提供上一帧/下一帧、上一标注帧/下一标注帧、滑块、跳帧输入与缩略图列表；
 * 带标注的帧显示绿色圆点。通过 v-model:current 与父组件同步当前帧。
 */
import { computed, nextTick, ref, watch } from 'vue'
import {
  ArrowLeft,
  ArrowLeftBold,
  ArrowRight,
  ArrowRightBold,
  DArrowLeft,
  DArrowRight,
} from '@element-plus/icons-vue'

const props = defineProps({
  frames: { type: Array, default: () => [] }, // [{ index, name, url }]
  current: { type: Number, default: 0 }, // 当前帧序号
  markedFrames: { type: Array, default: () => [] }, // 含标注的帧序号列表
  autoAdvance: { type: Boolean, default: false }, // 画完是否自动跳到下一帧
})

const emit = defineEmits(['update:current', 'update:autoAdvance'])

const jumpValue = ref('')
const listRef = ref(null)

const maxIndex = computed(() => Math.max(props.frames.length - 1, 0))
// 用 Set 加速缩略图上的标注标记判断
const markedSet = computed(() => new Set(props.markedFrames))
const markedSorted = computed(() =>
  [...new Set(props.markedFrames)].sort((a, b) => a - b),
)
// 未标注帧：用于快速检查漏标
const unmarkedSorted = computed(() =>
  props.frames.map((frame) => frame.index).filter((index) => !markedSet.value.has(index)),
)

/** 切换到指定帧（自动夹取到合法范围） */
function go(index) {
  const next = Math.min(Math.max(index, 0), maxIndex.value)
  if (next !== props.current) emit('update:current', next)
}

/** 跳转到上一个 / 下一个含标注的帧 */
function goMarked(direction) {
  const list = markedSorted.value
  if (!list.length) return
  if (direction > 0) {
    const next = list.find((index) => index > props.current)
    if (next != null) go(next)
  } else {
    const prev = [...list].reverse().find((index) => index < props.current)
    if (prev != null) go(prev)
  }
}

/** 跳转到上一个 / 下一个未标注帧 */
function goUnmarked(direction) {
  const list = unmarkedSorted.value
  if (!list.length) return
  if (direction > 0) {
    const next = list.find((index) => index > props.current)
    if (next != null) go(next)
  } else {
    const prev = [...list].reverse().find((index) => index < props.current)
    if (prev != null) go(prev)
  }
}

/** 跳帧输入框提交（用户输入的是 1 基序号） */
function handleJump(event) {
  const value = Number(jumpValue.value)
  if (Number.isInteger(value) && value >= 1) go(value - 1)
  jumpValue.value = ''
  // 提交后移出焦点，避免后续快捷键被输入框吞掉
  event?.target?.blur?.()
}

/**
 * 当前帧缩略图滚动到可视区域。
 * 已在可视范围内时不移动，避免点击相邻帧时列表跳动。
 */
async function ensureActiveVisible() {
  await nextTick()
  const item = listRef.value?.children[props.current]
  if (!item) return
  const wrap = item.closest('.el-scrollbar__wrap')
  if (!wrap) return
  const itemLeft = item.offsetLeft
  const itemRight = itemLeft + item.offsetWidth
  const viewLeft = wrap.scrollLeft
  const viewRight = viewLeft + wrap.clientWidth
  if (itemLeft < viewLeft || itemRight > viewRight) {
    wrap.scrollTo({
      left: itemLeft - (wrap.clientWidth - item.offsetWidth) / 2,
      behavior: 'smooth',
    })
  }
}

watch(() => props.current, ensureActiveVisible, { immediate: true })
</script>

<template>
  <div class="frame-strip">
    <div class="frame-strip__controls">
      <el-button
        :icon="ArrowLeft"
        :disabled="current <= 0"
        @click="go(current - 1)"
      >
        上一帧
      </el-button>
      <el-button
        :icon="DArrowLeft"
        :disabled="!markedSorted.some((index) => index < current)"
        title="上一个标注帧"
        @click="goMarked(-1)"
      />
      <el-button
        :icon="ArrowLeftBold"
        :disabled="!unmarkedSorted.some((index) => index < current)"
        title="上一个未标注帧 (Shift+N)"
        @click="goUnmarked(-1)"
      />
      <el-slider
        class="frame-strip__slider"
        :model-value="current"
        :min="0"
        :max="maxIndex"
        :show-tooltip="false"
        :disabled="frames.length === 0"
        @update:model-value="go"
      />
      <el-button
        :icon="ArrowRightBold"
        :disabled="!unmarkedSorted.some((index) => index > current)"
        title="下一个未标注帧 (N)"
        @click="goUnmarked(1)"
      />
      <el-button
        :icon="DArrowRight"
        :disabled="!markedSorted.some((index) => index > current)"
        title="下一个标注帧"
        @click="goMarked(1)"
      />
      <el-button
        :icon="ArrowRight"
        :disabled="current >= maxIndex"
        @click="go(current + 1)"
      >
        下一帧
      </el-button>

      <div class="frame-strip__jump">
        <span>跳转</span>
        <el-input
          v-model="jumpValue"
          size="small"
          placeholder="帧号"
          class="frame-strip__jump-input"
          @keyup.enter="handleJump"
          @change="handleJump"
        />
      </div>

      <el-checkbox
        :model-value="autoAdvance"
        @update:model-value="emit('update:autoAdvance', $event)"
      >
        画完自动跳帧
      </el-checkbox>
    </div>

    <el-scrollbar class="frame-strip__scroll">
      <div ref="listRef" class="frame-strip__list">
        <button
          v-for="frame in frames"
          :key="frame.index"
          type="button"
          class="frame-strip__item"
          :class="{ 'is-active': frame.index === current }"
          @click="go(frame.index)"
        >
          <img
            class="frame-strip__thumb"
            :src="frame.url"
            :alt="frame.name"
            loading="lazy"
            decoding="async"
          />
          <span class="frame-strip__index">{{ frame.index + 1 }}</span>
          <span
            v-if="markedSet.has(frame.index)"
            class="frame-strip__dot"
          />
        </button>
      </div>
    </el-scrollbar>
  </div>
</template>

<style scoped>
.frame-strip {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.frame-strip__controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.frame-strip__slider {
  flex: 1;
  min-width: 120px;
}

.frame-strip__jump {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #606266;
  white-space: nowrap;
}

.frame-strip__jump-input {
  width: 72px;
}

.frame-strip__scroll {
  width: 100%;
}

.frame-strip__list {
  display: flex;
  gap: 8px;
  padding-bottom: 6px;
}

.frame-strip__item {
  position: relative;
  flex: 0 0 auto;
  padding: 2px;
  border: 2px solid transparent;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  line-height: 0;
  transition: border-color 0.2s;
}

/* 当前帧高亮 */
.frame-strip__item.is-active {
  border-color: #409eff;
}

.frame-strip__thumb {
  width: 96px;
  height: 72px;
  object-fit: cover;
  border-radius: 4px;
  display: block;
}

.frame-strip__index {
  position: absolute;
  left: 4px;
  bottom: 4px;
  padding: 0 6px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 12px;
  line-height: 18px;
}

/* 含标注帧的标记圆点 */
.frame-strip__dot {
  position: absolute;
  right: 6px;
  top: 6px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #67c23a;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.35);
}
</style>
