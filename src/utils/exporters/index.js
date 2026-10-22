import { strToU8, zipSync } from 'fflate'
import { loadImage } from '../imageCache'
import { bboxOf, isBoxOutOfBounds, isPointOutOfBounds, isPolyline, pointsOf } from './geometry'
import { exportJson } from './json'
import { exportCoco } from './coco'
import { exportYolo } from './yolo'
import { exportMot } from './mot'
import { exportCsv } from './csv'

/**
 * 导出格式注册表。
 * 每个导出器接收 bundle，返回 [{ name, content }]。
 */
export const EXPORTERS = {
  json: { label: '内部 JSON', mime: 'application/json', build: exportJson },
  coco: { label: 'COCO', mime: 'application/json', build: exportCoco },
  yolo: { label: 'YOLO', mime: 'text/plain', build: exportYolo },
  mot: { label: 'MOT', mime: 'text/plain', build: exportMot },
  csv: { label: 'CSV', mime: 'text/csv', build: exportCsv },
}

/** 测量一组帧的实际像素尺寸（带图片缓存，重复调用开销很小） */
export async function measureFrames(frames) {
  const dims = new Map()
  await Promise.all(
    (frames || []).map(async (frame) => {
      try {
        const image = await loadImage(frame.url)
        dims.set(frame.index, {
          width: image.naturalWidth || image.width,
          height: image.naturalHeight || image.height,
        })
      } catch {
        /* 加载失败的帧不写入尺寸 */
      }
    }),
  )
  return dims
}

/**
 * 生成导出文件列表。
 * @param {string} format 格式键名
 * @param {Array<{ dataset: string, frames: Array, tracks: Array }>} bundles
 * @returns {Promise<Array<{ name: string, content: string, mime: string }>>}
 */
export async function buildExportFiles(format, bundles) {
  const exporter = EXPORTERS[format]
  if (!exporter) throw new Error(`未知导出格式：${format}`)
  if (!bundles.length) throw new Error('没有可导出的数据集')

  const files = []
  for (const bundle of bundles) {
    const dims = await measureFrames(bundle.frames)
    const produced = exporter.build(bundle, { dims })
    // 多个数据集时按数据集分目录，避免文件重名
    const prefix = bundles.length > 1 ? `${bundle.dataset}/` : ''
    for (const file of produced) {
      files.push({ name: prefix + file.name, content: file.content, mime: exporter.mime })
    }
  }
  return files
}

/**
 * 导出前校验：空标签、零面积框、越界几何。
 * @returns {Promise<Array<{
 *   level: 'warning'|'error', dataset: string, datasetName: string,
 *   trackId: string, frame: number|null, message: string
 * }>>}
 */
export async function validateBundles(bundles) {
  const issues = []
  for (const bundle of bundles) {
    const dims = await measureFrames(bundle.frames)
    for (const track of bundle.tracks) {
      const label = (track.label || '').trim()
      if (!label) {
        issues.push({
          level: 'warning',
          dataset: bundle.dataset,
          datasetName: bundle.name,
          trackId: track.id,
          frame: null,
          message: '对象没有标签',
        })
      }

      for (const [key, geometry] of Object.entries(track.frames || {})) {
        const frameIndex = Number(key)
        const size = dims.get(frameIndex)
        if (!size) continue
        const box = bboxOf(track.type, geometry)
        if (!box) {
          issues.push({
            level: 'error',
            dataset: bundle.dataset,
            datasetName: bundle.name,
            trackId: track.id,
            frame: frameIndex,
            message: '几何数据无效',
          })
          continue
        }
        if (box.width < 0.5 || box.height < 0.5) {
          issues.push({
            level: 'warning',
            dataset: bundle.dataset,
            datasetName: bundle.name,
            trackId: track.id,
            frame: frameIndex,
            message: '标注面积接近 0',
          })
        }
        if (isBoxOutOfBounds(box, size)) {
          issues.push({
            level: 'warning',
            dataset: bundle.dataset,
            datasetName: bundle.name,
            trackId: track.id,
            frame: frameIndex,
            message: '标注超出图片范围',
          })
          continue
        }
        if (isPolyline(track.type)) {
          const points = pointsOf(geometry)
          for (let index = 0; index < points.length; index += 2) {
            if (isPointOutOfBounds({ x: points[index], y: points[index + 1] }, size)) {
              issues.push({
                level: 'warning',
                dataset: bundle.dataset,
                datasetName: bundle.name,
                trackId: track.id,
                frame: frameIndex,
                message: '折线顶点超出图片范围',
              })
              break
            }
          }
        }
      }
    }
  }
  return issues
}

/** 触发浏览器下载 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/** 把导出文件打成 zip */
export function zipExportFiles(files) {
  const entries = {}
  for (const file of files) entries[file.name] = strToU8(file.content)
  const zipped = zipSync(entries, { level: 6 })
  return new Blob([zipped], { type: 'application/zip' })
}

/**
 * 下载导出结果：单文件直接下载，多文件自动打包 zip。
 * @param {Array<{ name: string, content: string, mime: string }>} files
 * @param {string} baseName zip 文件名（不含扩展名）
 */
export function downloadExportFiles(files, baseName = 'annotations') {
  if (!files.length) return
  if (files.length === 1) {
    const file = files[0]
    downloadBlob(new Blob([file.content], { type: `${file.mime};charset=utf-8` }), file.name)
    return
  }
  downloadBlob(zipExportFiles(files), `${baseName}.zip`)
}

export { exportJson, exportCoco, exportYolo, exportMot, exportCsv }
