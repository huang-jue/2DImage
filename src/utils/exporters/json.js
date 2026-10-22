/**
 * 内部 JSON 导出（与导入格式一致，可完整往返）。
 */
export function buildJson(bundle) {
  return {
    dataset: bundle.dataset,
    name: bundle.name,
    frameCount: bundle.frames.length,
    exportedAt: new Date().toISOString(),
    tracks: bundle.tracks,
  }
}

/** 生成 JSON 文件列表 */
export function exportJson(bundle) {
  return [
    {
      name: `${bundle.dataset}-annotations.json`,
      content: JSON.stringify(buildJson(bundle), null, 2),
    },
  ]
}
