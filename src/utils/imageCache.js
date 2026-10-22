/**
 * 图片加载缓存工具。
 *
 * 标注画布会频繁切换帧，同一个 URL 可能被反复请求。
 * 这里用 Map 以 URL 为键缓存加载中的 Promise，并做 LRU 淘汰，
 * 避免长时间标注时缓存无上限增长。
 */

/** @type {Map<string, Promise<HTMLImageElement>>} URL -> 图片加载 Promise */
const cache = new Map()

/** 最多缓存的图片数量（超出后淘汰最久未使用的条目） */
const MAX_ENTRIES = 200

/**
 * 加载图片（带缓存）。
 * @param {string} url 图片地址（Vite 静态资源 URL）
 * @returns {Promise<HTMLImageElement>} 加载完成的图片元素
 */
export function loadImage(url) {
  const cached = cache.get(url)
  if (cached) {
    // 命中后重新插入，维持 LRU 顺序
    cache.delete(url)
    cache.set(url, cached)
    return cached
  }

  const promise = new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
    img.src = url
  })
  cache.set(url, promise)

  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    cache.delete(oldest)
  }
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

/** 清空缓存（切换项目或释放本地数据集时可选调用） */
export function clearImageCache() {
  cache.clear()
}
