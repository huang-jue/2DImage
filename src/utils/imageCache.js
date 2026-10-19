/**
 * 图片加载缓存工具。
 *
 * 标注画布会频繁切换帧，同一个 URL 可能被反复请求。
 * 这里用 Map 以 URL 为键缓存加载中的 Promise，避免重复创建 Image 对象与重复下载。
 */

/** @type {Map<string, Promise<HTMLImageElement>>} URL -> 图片加载 Promise */
const cache = new Map()

/**
 * 加载图片（带缓存）。
 * @param {string} url 图片地址（Vite 静态资源 URL）
 * @returns {Promise<HTMLImageElement>} 加载完成的图片元素
 */
export function loadImage(url) {
  if (cache.has(url)) return cache.get(url)
  const promise = new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
    img.src = url
  })
  cache.set(url, promise)
  return promise
}

/**
 * 预加载一组图片，失败项以 null 占位（用于相邻帧预加载，不阻塞主流程）。
 * @param {string[]} urls
 * @returns {Promise<Array<HTMLImageElement | null>>}
 */
export function preloadImages(urls) {
  return Promise.all(urls.map((url) => loadImage(url).catch(() => null)))
}
