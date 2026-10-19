const cache = new Map()

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

export function preloadImages(urls) {
  return Promise.all(urls.map((url) => loadImage(url).catch(() => null)))
}
