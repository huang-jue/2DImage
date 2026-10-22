/**
 * 本地图片目录导入。
 *
 * 优先使用 File System Access API（showDirectoryPicker），
 * 不支持时降级为 <input type="file" webkitdirectory>。
 *
 * 说明：本地图片通过 URL.createObjectURL 加载，刷新页面后失效，
 * 需要重新导入（标注本身会保留，重新导入同名目录可继续）。
 */

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|bmp|gif)$/i

/** 是否为图片文件 */
export function isImageFile(file) {
  if (!file) return false
  if (file.type && file.type.startsWith('image/')) return true
  return IMAGE_EXTENSIONS.test(file.name || '')
}

/** 自然排序（001.jpg < 002.jpg < 010.jpg） */
function naturalCompare(a, b) {
  return a.fileName.localeCompare(b.fileName, undefined, { numeric: true })
}

/**
 * 把 File 列表转换为帧数组（按文件名自然排序）。
 * @param {File[]} files
 * @returns {Array<{ index: number, name: string, url: string }>}
 */
export function buildFrames(files) {
  return (files || [])
    .filter(isImageFile)
    .map((file) => ({ fileName: file.name, file }))
    .sort(naturalCompare)
    .map((item, index) => ({
      index,
      name: item.fileName,
      url: URL.createObjectURL(item.file),
    }))
}

/** 释放帧对应的对象 URL */
export function releaseFrames(frames) {
  for (const frame of frames || []) {
    if (frame?.url) URL.revokeObjectURL(frame.url)
  }
}

/** 降级方案：目录选择 input */
function pickWithInput() {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.webkitdirectory = true
    input.multiple = true
    input.accept = 'image/*'
    input.onchange = () => {
      const files = [...(input.files || [])].filter(isImageFile)
      if (!files.length) {
        resolve(null)
        return
      }
      const relative = files[0].webkitRelativePath || ''
      const name = relative.split('/')[0] || '本地数据集'
      resolve({ name, files })
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

/**
 * 选择本地图片目录。
 * @returns {Promise<{ name: string, files: File[] } | null>} 用户取消时返回 null
 */
export async function pickLocalDirectory() {
  if (typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function') {
    try {
      const handle = await window.showDirectoryPicker()
      const files = []
      for await (const entry of handle.values()) {
        if (entry.kind !== 'file') continue
        const file = await entry.getFile()
        if (isImageFile(file)) files.push(file)
      }
      if (!files.length) return null
      return { name: handle.name || '本地数据集', files }
    } catch (error) {
      if (error?.name === 'AbortError') return null
      // 权限或环境问题，降级到 input
    }
  }
  return pickWithInput()
}

/** 由目录名生成稳定的数据集 id（重新导入同名目录可接续原有标注） */
export function datasetIdFromName(name) {
  const safe = (name || 'local').trim().replace(/[\\/:*?"<>|]/g, '_')
  return `local-${safe || 'local'}`
}
