<script setup>
import { computed } from 'vue'
import { ArrowLeft, ArrowRight } from '@element-plus/icons-vue'

const props = defineProps({
  frames: { type: Array, default: () => [] },
  current: { type: Number, default: 0 },
  markedFrames: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:current'])

const maxIndex = computed(() => Math.max(props.frames.length - 1, 0))
const markedSet = computed(() => new Set(props.markedFrames))

function go(index) {
  const next = Math.min(Math.max(index, 0), maxIndex.value)
  if (next !== props.current) emit('update:current', next)
}
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
        :icon="ArrowRight"
        :disabled="current >= maxIndex"
        @click="go(current + 1)"
      >
        下一帧
      </el-button>
    </div>

    <el-scrollbar class="frame-strip__scroll">
      <div class="frame-strip__list">
        <button
          v-for="frame in frames"
          :key="frame.index"
          type="button"
          class="frame-strip__item"
          :class="{ 'is-active': frame.index === current }"
          @click="go(frame.index)"
        >
          <img class="frame-strip__thumb" :src="frame.url" :alt="frame.name" />
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
  gap: 16px;
}

.frame-strip__slider {
  flex: 1;
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
