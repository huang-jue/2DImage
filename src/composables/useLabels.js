import { reactive, watch } from 'vue'

/**
 * 标签类别管理（全局单例）。
 *
 * 类别在 localStorage 中持久化，所有数据集共享：
 *   { version: 1, labels: [{ id, name, color }] }
 *
 * 快捷键 1–9 对应类别列表的前 9 项，因此列表顺序即快捷键顺序。
 */

const STORAGE_KEY = 'lq2d:labels:v1'
const VERSION = 1

/** 默认类别 */
const DEFAULT_LABELS = [
  { id: 'l1', name: '人员', color: '#409eff' },
  { id: 'l2', name: '车辆', color: '#67c23a' },
  { id: 'l3', name: '非机动车', color: '#e6a23c' },
  { id: 'l4', name: '动物', color: '#f56c6c' },
]

/** 新增类别的备选颜色 */
const PALETTE = ['#409eff', '#67c23a', '#e6a23c', '#f56c6c', '#909399', '#9b59b6', '#00bcd4']

let seq = 0

/** 生成不重复的类别 id */
function nextId(existing) {
  let id = `l${++seq}`
  while (existing.some((item) => item.id === id)) id = `l${++seq}`
  return id
}

/** 读取本地存储的类别 */
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_LABELS.map((item) => ({ ...item }))
    const data = JSON.parse(raw)
    if (data?.version !== VERSION || !Array.isArray(data.labels)) {
      return DEFAULT_LABELS.map((item) => ({ ...item }))
    }
    return data.labels
      .filter((item) => item && typeof item.name === 'string' && item.name)
      .map((item, index) => ({
        id: item.id || `l${index + 1}`,
        name: item.name,
        color: item.color || PALETTE[index % PALETTE.length],
      }))
  } catch {
    return DEFAULT_LABELS.map((item) => ({ ...item }))
  }
}

const labels = reactive(load())

// 同步 id 序号，避免与已有类别冲突
for (const label of labels) {
  const matched = /^l(\d+)$/.exec(label.id)
  if (matched) seq = Math.max(seq, Number(matched[1]))
}

/** 持久化（失败时静默，不阻塞标注） */
function persist() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: VERSION, labels: labels.map((item) => ({ ...item })) }),
    )
  } catch {
    /* 忽略存储配额等错误 */
  }
}

watch(labels, persist, { deep: true })

/** 按名称查找类别 */
function findLabel(name) {
  return labels.find((item) => item.name === name) || null
}

/** 按名称取颜色（找不到时回落到默认色） */
function colorOf(name) {
  return findLabel(name)?.color || '#409eff'
}

/** 新增类别；同名时直接返回已有类别 */
function addLabel({ name, color } = {}) {
  const trimmed = (name || '').trim()
  if (!trimmed) return null
  const existing = findLabel(trimmed)
  if (existing) return existing
  const label = {
    id: nextId(labels),
    name: trimmed,
    color: color || PALETTE[labels.length % PALETTE.length],
  }
  labels.push(label)
  return label
}

/** 修改类别名称 / 颜色 */
function updateLabel(id, patch = {}) {
  const label = labels.find((item) => item.id === id)
  if (!label) return false
  if (typeof patch.name === 'string' && patch.name.trim()) label.name = patch.name.trim()
  if (typeof patch.color === 'string' && patch.color) label.color = patch.color
  return true
}

/** 删除类别（已标注对象保留原有 label/color） */
function removeLabel(id) {
  const index = labels.findIndex((item) => item.id === id)
  if (index < 0) return false
  labels.splice(index, 1)
  return true
}

/** 若名称不存在则自动创建类别 */
function ensureLabel(name) {
  const trimmed = (name || '').trim()
  if (!trimmed) return null
  return findLabel(trimmed) || addLabel({ name: trimmed })
}

export function useLabels() {
  return {
    labels,
    findLabel,
    colorOf,
    addLabel,
    updateLabel,
    removeLabel,
    ensureLabel,
  }
}
