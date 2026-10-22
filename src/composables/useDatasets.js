import { computed, ref } from 'vue'
import { loadImage } from '../utils/imageCache'
import { buildFrames, datasetIdFromName, releaseFrames } from './useLocalDataset'

/**
 * 数据集来源。
 *
 * 1. 静态数据集：图片放在 src/assets/datasets/<数据集名>/ 下，
 *    目录名即数据集 id，文件名即帧顺序（按名称自然排序）。
 *    通过 Vite 的 import.meta.glob 在构建期收集，新增数据无需改代码。
 * 2. 本地数据集：运行时选择本地图片目录，图片以对象 URL 加载；
 *    刷新后失效，重新导入同名目录可接续原有标注。
 */

const modules = import.meta.glob('../assets/datasets/**/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG}', {
  eager: true, // 立即收集，返回 { 路径: URL } 的静态映射
  query: '?url', // 只取资源 URL，不做内联
  import: 'default',
})

/** glob 路径前缀，用于把 '../assets/datasets/case1/001.jpg' 拆成目录名与文件名 */
const PREFIX = '../assets/datasets/'

/** 每份数据集建议的最少帧数，用于数据校验 */
export const MIN_FRAMES = 20

/**
 * 把 glob 的模块路径解析为数据集 id 与文件名。
 * @param {string} path 形如 '../assets/datasets/case1/001.jpg'
 * @returns {{ caseId: string, fileName: string }}
 */
function parsePath(path) {
  const clean = path.slice(PREFIX.length) // 'case1/001.jpg'
  const slash = clean.indexOf('/')
  const caseId = clean.slice(0, slash) // 'case1'
  const fileName = clean.slice(slash + 1) // '001.jpg'
  return { caseId, fileName }
}

/**
 * 将 glob 结果按目录分组、排序，构造静态数据集列表。
 * @returns {Array<{ id: string, name: string, source: 'static', frames: Array<{ index: number, name: string, url: string }> }>}
 */
function buildStaticDatasets() {
  // 先按目录名聚合：caseId -> [{ fileName, url }]
  const groups = new Map()
  for (const [path, url] of Object.entries(modules)) {
    const { caseId, fileName } = parsePath(path)
    if (!groups.has(caseId)) groups.set(caseId, [])
    groups.get(caseId).push({ fileName, url })
  }

  // 再对每个目录内部按文件名自然排序，生成带 index 的帧数组
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([id, items]) => {
      items.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }))
      return {
        id,
        name: id.replace(/^case/i, '示例 '), // case1 -> 示例 1
        source: 'static',
        frames: items.map((item, index) => ({
          index, // 帧序号（从 0 开始），标注几何以该序号为键
          name: item.fileName,
          url: item.url,
        })),
      }
    })
}

/** 静态数据集（模块加载时构建一次） */
const staticDatasets = buildStaticDatasets()

/** 运行时导入的本地数据集（模块级单例） */
const localDatasets = ref([])

/** 全量数据集：静态 + 本地 */
const datasets = computed(() => [...staticDatasets, ...localDatasets.value])

/** 数据校验摘要：每份数据集的帧数与建议帧数 */
const report = computed(() =>
  datasets.value.map((dataset) => ({
    id: dataset.id,
    name: dataset.name,
    frames: dataset.frames.length,
    source: dataset.source,
    ok: dataset.frames.length >= MIN_FRAMES,
    recommended: dataset.frames.length >= MIN_FRAMES,
  })),
)

/** 所有数据集的总帧数 */
const totalFrames = computed(() =>
  datasets.value.reduce((sum, dataset) => sum + dataset.frames.length, 0),
)

/**
 * 数据集组合式函数。
 */
export function useDatasets() {
  /** 按 id 查找数据集 */
  function getDataset(id) {
    return datasets.value.find((item) => item.id === id) || null
  }

  /** 某数据集的帧数（未知数据集返回 0） */
  function getFrameCount(id) {
    return getDataset(id)?.frames.length ?? 0
  }

  /**
   * 添加 / 更新本地数据集。
   * 同名目录重复导入时会复用同一 id，从而接续已有标注。
   * @returns {object|null} 数据集对象
   */
  function addLocalDataset({ name, files } = {}) {
    const frames = buildFrames(files)
    if (!frames.length) return null
    const id = datasetIdFromName(name)
    const existing = localDatasets.value.find((item) => item.id === id)
    if (existing) {
      releaseFrames(existing.frames)
      existing.frames = frames
      if (name) existing.name = name
      return existing
    }
    const dataset = {
      id,
      name: name || '本地数据集',
      source: 'local',
      frames,
    }
    localDatasets.value.push(dataset)
    return dataset
  }

  /** 移除本地数据集（同时释放对象 URL） */
  function removeLocalDataset(id) {
    const index = localDatasets.value.findIndex((item) => item.id === id)
    if (index < 0) return false
    releaseFrames(localDatasets.value[index].frames)
    localDatasets.value.splice(index, 1)
    return true
  }

  /** 是否为本地导入的数据集 */
  function isLocalDataset(id) {
    return localDatasets.value.some((item) => item.id === id)
  }

  /**
   * 逐帧实际解码图片，验证数据是否可正常加载（而非仅看文件是否存在）。
   * 同时检查尺寸一致性（以首帧尺寸为基准）。
   * @returns {Promise<Array<{
   *   id: string, name: string, expected: number,
   *   failures: string[], inconsistent: string[], ok: boolean
   * }>>}
   */
  async function verifyAllFrames() {
    const results = []
    for (const dataset of datasets.value) {
      const failures = []
      const inconsistent = []
      let baseWidth = 0
      let baseHeight = 0
      await Promise.all(
        dataset.frames.map(async (frame) => {
          try {
            const img = await loadImage(frame.url)
            // 尺寸为 0 说明图片解码失败
            if (!img.naturalWidth || !img.naturalHeight) {
              failures.push(frame.name)
              return
            }
            if (!baseWidth) {
              baseWidth = img.naturalWidth
              baseHeight = img.naturalHeight
            } else if (img.naturalWidth !== baseWidth || img.naturalHeight !== baseHeight) {
              inconsistent.push(`${frame.name}（${img.naturalWidth}×${img.naturalHeight}）`)
            }
          } catch {
            failures.push(frame.name)
          }
        }),
      )
      results.push({
        id: dataset.id,
        name: dataset.name,
        expected: dataset.frames.length,
        failures: failures.sort(),
        inconsistent: inconsistent.sort(),
        // ok 仅代表能否正常加载 / 尺寸是否一致；帧数不足只是建议层面的问题
        ok: failures.length === 0 && inconsistent.length === 0,
        recommended: dataset.frames.length >= MIN_FRAMES,
      })
    }
    return results
  }

  /**
   * 检测内容完全相同的帧（按图片字节内容的 SHA-256 判断）。
   * 常见于数据集复制、错误重命名；由调用方决定如何提示。
   * @returns {Promise<Array<Array<{ datasetId: string, datasetName: string, name: string }>>>}
   */
  async function detectDuplicateFrames() {
    if (!globalThis.crypto?.subtle) return []
    const entries = []
    for (const dataset of datasets.value) {
      for (const frame of dataset.frames) {
        entries.push({ datasetId: dataset.id, datasetName: dataset.name, frame })
      }
    }

    const results = await Promise.all(
      entries.map(async (entry) => {
        try {
          const response = await fetch(entry.frame.url)
          const buffer = await response.arrayBuffer()
          const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer)
          const hash = [...new Uint8Array(digest)]
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('')
          return { ...entry, hash }
        } catch {
          return { ...entry, hash: null }
        }
      }),
    )

    const groups = new Map()
    for (const item of results) {
      if (!item.hash) continue
      if (!groups.has(item.hash)) groups.set(item.hash, [])
      groups.get(item.hash).push({
        datasetId: item.datasetId,
        datasetName: item.datasetName,
        name: item.frame.name,
      })
    }
    return [...groups.values()].filter((group) => group.length > 1)
  }

  return {
    datasets,
    staticDatasets,
    localDatasets,
    report,
    totalFrames,
    minFrames: MIN_FRAMES,
    getDataset,
    getFrameCount,
    addLocalDataset,
    removeLocalDataset,
    isLocalDataset,
    verifyAllFrames,
    detectDuplicateFrames,
  }
}
