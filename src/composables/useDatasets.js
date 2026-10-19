import { loadImage } from '../utils/imageCache'

/**
 * 数据集自动发现。
 *
 * 约定：图片放在 src/assets/datasets/<数据集名>/ 目录下，
 * 目录名即数据集 id（如 case1、case2），文件名即帧顺序（按名称自然排序）。
 * 通过 Vite 的 import.meta.glob 在构建期收集所有图片，新增数据无需改代码。
 */
const modules = import.meta.glob('../assets/datasets/**/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG}', {
  eager: true, // 立即收集，返回 { 路径: URL } 的静态映射
  query: '?url', // 只取资源 URL，不做内联
  import: 'default',
})

/** glob 路径前缀，用于把 '../assets/datasets/case1/001.jpg' 拆成目录名与文件名 */
const PREFIX = '../assets/datasets/'

/** 每份数据集要求的最少帧数，用于数据校验 */
const MIN_FRAMES = 20

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
 * 将 glob 结果按目录分组、排序，构造数据集列表。
 * @returns {Array<{ id: string, name: string, frames: Array<{ index: number, name: string, url: string }> }>}
 */
function buildDatasets() {
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
        frames: items.map((item, index) => ({
          index, // 帧序号（从 0 开始），标注几何以该序号为键
          name: item.fileName,
          url: item.url,
        })),
      }
    })
}

/** 静态数据集列表，模块加载时构建一次 */
const datasets = buildDatasets()

/** 数据校验摘要：每份数据集的帧数是否满足 MIN_FRAMES */
const report = datasets.map((dataset) => ({
  id: dataset.id,
  name: dataset.name,
  frames: dataset.frames.length,
  ok: dataset.frames.length >= MIN_FRAMES,
}))

/**
 * 数据集组合式函数。
 * @returns {{
 *   datasets: typeof datasets,
 *   report: typeof report,
 *   totalFrames: number,
 *   minFrames: number,
 *   verifyAllFrames: () => Promise<Array<{ id: string, name: string, expected: number, failures: string[], ok: boolean }>>
 * }}
 */
export function useDatasets() {
  const totalFrames = datasets.reduce((sum, dataset) => sum + dataset.frames.length, 0)

  /**
   * 逐帧实际解码图片，验证数据是否可正常加载（而非仅看文件是否存在）。
   * @returns {Promise<Array<{ id: string, name: string, expected: number, failures: string[], ok: boolean }>>}
   */
  async function verifyAllFrames() {
    const results = []
    for (const dataset of datasets) {
      const failures = []
      await Promise.all(
        dataset.frames.map(async (frame) => {
          try {
            const img = await loadImage(frame.url)
            // 尺寸为 0 说明图片解码失败
            if (!img.naturalWidth || !img.naturalHeight) failures.push(frame.name)
          } catch {
            failures.push(frame.name)
          }
        }),
      )
      results.push({
        id: dataset.id,
        name: dataset.name,
        expected: dataset.frames.length,
        failures,
        ok: failures.length === 0 && dataset.frames.length >= MIN_FRAMES,
      })
    }
    return results
  }

  return {
    datasets,
    report,
    totalFrames,
    minFrames: MIN_FRAMES,
    verifyAllFrames,
  }
}
