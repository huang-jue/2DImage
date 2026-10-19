import { loadImage } from '../utils/imageCache'

const modules = import.meta.glob('../assets/datasets/**/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG}', {
  eager: true,
  query: '?url',
  import: 'default',
})

const PREFIX = '../assets/datasets/'
const MIN_FRAMES = 20

function parsePath(path) {
  const clean = path.slice(PREFIX.length)
  const slash = clean.indexOf('/')
  const caseId = clean.slice(0, slash)
  const fileName = clean.slice(slash + 1)
  return { caseId, fileName }
}

function buildDatasets() {
  const groups = new Map()
  for (const [path, url] of Object.entries(modules)) {
    const { caseId, fileName } = parsePath(path)
    if (!groups.has(caseId)) groups.set(caseId, [])
    groups.get(caseId).push({ fileName, url })
  }

  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([id, items]) => {
      items.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }))
      return {
        id,
        name: id.replace(/^case/i, '示例 '),
        frames: items.map((item, index) => ({
          index,
          name: item.fileName,
          url: item.url,
        })),
      }
    })
}

const datasets = buildDatasets()

const report = datasets.map((dataset) => ({
  id: dataset.id,
  name: dataset.name,
  frames: dataset.frames.length,
  ok: dataset.frames.length >= MIN_FRAMES,
}))

export function useDatasets() {
  const totalFrames = datasets.reduce((sum, dataset) => sum + dataset.frames.length, 0)

  async function verifyAllFrames() {
    const results = []
    for (const dataset of datasets) {
      const failures = []
      await Promise.all(
        dataset.frames.map(async (frame) => {
          try {
            const img = await loadImage(frame.url)
            if (!img.naturalWidth || !img.naturalHeight) failures.push(frame.name)
          } catch (error) {
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
