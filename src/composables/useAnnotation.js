import { reactive } from 'vue'

/**
 * 标注状态管理（跨帧 track 模型）。
 *
 * 数据模型：
 *   track（跨帧对象） = {
 *     id,                       // 对象唯一 id，同一目标在所有帧共享
 *     type: 'rect'|'point'|'line'|'polygon',
 *     label,                    // 对象标签
 *     color,                    // 显示颜色
 *     visible,                  // 是否显示
 *     locked,                   // 是否锁定（锁定后不可拖动/缩放）
 *     startFrame,               // 首个有几何的帧
 *     geometries: {             // 键为帧序号，值为该帧的几何（原图像素坐标）
 *       [frameIndex]: { x, y, width, height }   // rect
 *                   | { x, y }                   // point
 *                   | { points: [x, y, x, y...] } // line / polygon（多边形闭合）
 *     }
 *   }
 *
 * 关键规则：
 *   - 新建对象时，几何会从当前帧一直填充到末帧（多帧画）。
 *   - 编辑某帧的对象时，默认把几何从该帧传播到末帧（之前帧保持不变），
 *     也可通过 mode 指定「仅当前帧」「全部帧」。
 *   - 所有几何均以原图像素坐标存储，与画布缩放无关，便于导出与复用。
 *   - 任何写操作前会调用 onBeforeMutate(snapshot)，供撤销/重做记录历史快照。
 */

/** 折线类型（共用 points 结构；polygon 为闭合多边形） */
const POLYLINE_TYPES = new Set(['line', 'polygon'])
/** 支持的几何类型 */
const GEOMETRY_TYPES = new Set(['rect', 'point', 'line', 'polygon'])

/** 自增序号，用于生成 track id */
let seq = 0

/** 是否为折线类几何 */
export function isPolyline(type) {
  return POLYLINE_TYPES.has(type)
}

/** 取 geometries 的帧序号（升序，过滤非法键） */
function frameKeys(geometries) {
  return Object.keys(geometries || {})
    .map(Number)
    .filter((value) => Number.isInteger(value) && value >= 0)
    .sort((a, b) => a - b)
}

/** 复制一份几何，避免多帧之间共享同一对象引用 */
function cloneGeometry(type, geometry) {
  if (!geometry) return geometry
  if (isPolyline(type)) return { points: [...(geometry.points || [])] }
  if (type === 'point') return { x: geometry.x, y: geometry.y }
  return {
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
  }
}

/** 平移一份几何（复制对象时错开位置，避免完全重叠） */
function translateGeometry(type, geometry, dx, dy) {
  if (isPolyline(type)) {
    const points = geometry.points.map((value, index) =>
      index % 2 === 0 ? value + dx : value + dy,
    )
    return { points }
  }
  return { ...geometry, x: geometry.x + dx, y: geometry.y + dy }
}

/** 校验并规范化一份几何；不合法返回 null */
function normalizeGeometry(type, geometry) {
  if (!geometry) return null
  if (isPolyline(type)) {
    const points = Array.isArray(geometry.points)
      ? geometry.points.filter((value) => Number.isFinite(value))
      : []
    const minPoints = type === 'polygon' ? 6 : 4
    if (points.length < minPoints) return null
    return { points }
  }
  if (type === 'point') {
    if (!Number.isFinite(geometry.x) || !Number.isFinite(geometry.y)) return null
    return { x: geometry.x, y: geometry.y }
  }
  if (!Number.isFinite(geometry.x) || !Number.isFinite(geometry.y)) return null
  if (!Number.isFinite(geometry.width) || !Number.isFinite(geometry.height)) return null
  if (Math.abs(geometry.width) < 0.5 || Math.abs(geometry.height) < 0.5) return null
  return {
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
  }
}

/** 规范化关键帧：过滤掉没有几何的帧；缺失时兼容旧数据，默认起始帧为关键帧 */
function normalizeKeyframes(rawKeyframes, geometries) {
  const keys = frameKeys(geometries)
  if (!keys.length) return []
  if (!Array.isArray(rawKeyframes)) return [keys[0]]
  const valid = [
    ...new Set(
      rawKeyframes
        .map(Number)
        .filter((key) => Number.isInteger(key) && geometries[key]),
    ),
  ].sort((a, b) => a - b)
  return valid.length ? valid : [keys[0]]
}

/** 把某一帧标记为关键帧（不记录历史，调用方负责） */
function promoteKeyframe(track, frameIndex) {
  if (!track.geometries[frameIndex]) return
  if (!Array.isArray(track.keyframes)) track.keyframes = []
  if (track.keyframes.includes(frameIndex)) return
  track.keyframes.push(frameIndex)
  track.keyframes.sort((a, b) => a - b)
}

/** 深拷贝单条 track（只保留可序列化字段） */
function cloneTrack(track) {
  const geometries = {}
  for (const [key, geometry] of Object.entries(track.geometries || {})) {
    geometries[key] = cloneGeometry(track.type, geometry)
  }
  const keys = frameKeys(geometries)
  return {
    id: track.id,
    type: track.type,
    label: track.label ?? '',
    color: track.color || '#409eff',
    visible: track.visible !== false,
    locked: track.locked === true,
    startFrame: Number.isInteger(track.startFrame) ? track.startFrame : (keys[0] ?? 0),
    keyframes: normalizeKeyframes(track.keyframes, geometries),
    geometries,
  }
}

/** 线性插值 */
function lerp(a, b, t) {
  return a + (b - a) * t
}

/**
 * 在两个关键帧几何之间插值。
 * 点/矩形/折线均支持；折线要求两帧点数一致，否则返回 null（无法插值）。
 */
function interpolateGeometry(type, from, to, t) {
  if (!from || !to) return null
  if (isPolyline(type)) {
    const a = from.points || []
    const b = to.points || []
    if (a.length !== b.length || a.length < 4) return null
    return { points: a.map((value, index) => lerp(value, b[index], t)) }
  }
  if (type === 'point') {
    return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) }
  }
  return {
    x: lerp(from.x, to.x, t),
    y: lerp(from.y, to.y, t),
    width: lerp(from.width, to.width, t),
    height: lerp(from.height, to.height, t),
  }
}

/**
 * 解析外部导入的 track（兼容导出格式 frames 与内部格式 geometries）。
 * @returns {object|null}
 */
function parseTrack(raw) {
  if (!raw || typeof raw !== 'object') return null
  const type = raw.type
  if (!GEOMETRY_TYPES.has(type)) return null
  const source = raw.frames && typeof raw.frames === 'object' ? raw.frames : raw.geometries
  if (!source || typeof source !== 'object') return null

  const geometries = {}
  for (const key of frameKeys(source)) {
    const geometry = normalizeGeometry(type, source[key])
    if (geometry) geometries[key] = geometry
  }
  const keys = frameKeys(geometries)
  if (!keys.length) return null

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `t${++seq}`,
    type,
    label: typeof raw.label === 'string' ? raw.label : '',
    color: typeof raw.color === 'string' && raw.color ? raw.color : '#409eff',
    visible: raw.visible !== false,
    locked: raw.locked === true,
    startFrame: keys[0],
    keyframes: normalizeKeyframes(raw.keyframes, geometries),
    geometries,
  }
}

/**
 * 标注组合式函数。
 * @param {{ onBeforeMutate?: (snapshot: object) => void }} [options]
 *   onBeforeMutate 在任何写操作前被调用，参数为当前全量快照（用于撤销/重做）。
 */
export function useAnnotation(options = {}) {
  /** 按数据集 id 隔离的 track 列表：{ [datasetId]: track[] } */
  const tracksByDataset = reactive({})

  /** 写操作前的历史快照钩子 */
  const onBeforeMutate =
    typeof options.onBeforeMutate === 'function' ? options.onBeforeMutate : null

  /** 获取（不存在则创建）某数据集的 track 数组 */
  function ensure(datasetId) {
    if (!tracksByDataset[datasetId]) tracksByDataset[datasetId] = []
    return tracksByDataset[datasetId]
  }

  /** 获取某数据集的所有 track */
  function getTracks(datasetId) {
    return tracksByDataset[datasetId] || []
  }

  /** 查找单条 track */
  function getTrack(datasetId, trackId) {
    return (tracksByDataset[datasetId] || []).find((item) => item.id === trackId) || null
  }

  /** 全量快照（深拷贝，可安全序列化） */
  function exportAll() {
    const snapshot = {}
    for (const [datasetId, list] of Object.entries(tracksByDataset)) {
      snapshot[datasetId] = list.map(cloneTrack)
    }
    return snapshot
  }

  /** 记录历史快照 */
  function beforeMutation() {
    if (onBeforeMutate) onBeforeMutate(exportAll())
  }

  /** 用快照整体替换当前状态（撤销/重做、从存储恢复时使用，不记录历史） */
  function restoreAll(snapshot) {
    for (const datasetId of Object.keys(tracksByDataset)) delete tracksByDataset[datasetId]
    let maxId = 0
    for (const [datasetId, list] of Object.entries(snapshot || {})) {
      if (!Array.isArray(list)) continue
      const used = new Set()
      const tracks = []
      for (const raw of list) {
        if (!raw || !GEOMETRY_TYPES.has(raw.type)) continue
        const track = cloneTrack(raw)
        if (!Object.keys(track.geometries).length) continue
        const matched = /^t(\d+)$/.exec(track.id)
        if (matched) maxId = Math.max(maxId, Number(matched[1]))
        if (typeof track.id !== 'string' || !track.id || used.has(track.id)) {
          track.id = `t${maxId + 1}`
          maxId += 1
        }
        used.add(track.id)
        tracks.push(track)
      }
      tracksByDataset[datasetId] = tracks
    }
    seq = Math.max(seq, maxId)
  }

  /**
   * 取某帧需要渲染的图形列表（跳过隐藏的 track）。
   * @returns {Array<{ id, type, label, color, geometry, locked }>}
   */
  function getFrameShapes(datasetId, frameIndex) {
    const shapes = []
    for (const track of tracksByDataset[datasetId] || []) {
      if (track.visible === false) continue
      const geometry = track.geometries[frameIndex]
      if (!geometry) continue
      shapes.push({
        id: track.id,
        type: track.type,
        label: track.label,
        color: track.color,
        geometry,
        locked: track.locked === true,
      })
    }
    return shapes
  }

  /** 某条 track 的帧范围（基于实际几何） */
  function getTrackFrameRange(track) {
    const keys = frameKeys(track.geometries)
    return {
      start: keys.length ? keys[0] : 0,
      end: keys.length ? keys[keys.length - 1] : 0,
    }
  }

  /**
   * 新建跨帧对象：几何从 frameIndex 一直复制到 lastFrame。
   * @returns {object|null} 新建的 track（几何不合法时返回 null）
   */
  function createTrack(datasetId, {
    type,
    geometry,
    frameIndex,
    lastFrame,
    label = '',
    color = '#409eff',
  }) {
    if (!GEOMETRY_TYPES.has(type)) return null
    const normalized = normalizeGeometry(type, geometry)
    if (!normalized) return null
    if (!Number.isInteger(frameIndex) || !Number.isInteger(lastFrame)) return null
    if (frameIndex > lastFrame) return null

    beforeMutation()
    const list = ensure(datasetId)
    const id = `t${++seq}`
    const geometries = {}
    for (let frame = frameIndex; frame <= lastFrame; frame++) {
      geometries[frame] = cloneGeometry(type, normalized)
    }
    const track = {
      id,
      type,
      label,
      color,
      visible: true,
      locked: false,
      startFrame: frameIndex,
      keyframes: [frameIndex],
      geometries,
    }
    list.push(track)
    return track
  }

  /** 当前帧之后的下一个关键帧（没有则返回 null） */
  function nextKeyframeAfter(track, frameIndex) {
    const keyframes = Array.isArray(track.keyframes) ? track.keyframes : []
    let next = null
    for (const key of keyframes) {
      if (key <= frameIndex) continue
      if (next == null || key < next) next = key
    }
    return next
  }

  /**
   * 某帧编辑时需要更新的帧列表。
   * forward 模式会更新到“下一个关键帧之前”，避免覆盖后续关键帧。
   * @param {'frame'|'forward'|'all'} mode
   */
  function targetFrames(track, frameIndex, lastFrame, mode) {
    const keys = frameKeys(track.geometries)
    if (mode === 'frame') {
      if (frameIndex < track.startFrame) return []
      if (keys.length && frameIndex > keys[keys.length - 1]) return []
      return [frameIndex]
    }
    if (mode === 'all') return keys
    const limit = nextKeyframeAfter(track, frameIndex)
    return keys.filter(
      (key) => key >= frameIndex && key <= lastFrame && (limit == null || key < limit),
    )
  }

  /**
   * 在 frameIndex 帧编辑对象。
   * @param {'frame'|'forward'|'all'} [mode] frame=仅当前帧，forward=当前帧到下一个关键帧前，all=所有已有帧
   * @returns {boolean} 是否有改动
   */
  function updateFromFrame(datasetId, trackId, frameIndex, geometry, lastFrame, mode = 'forward') {
    const track = getTrack(datasetId, trackId)
    if (!track) return false
    const normalized = normalizeGeometry(track.type, geometry)
    if (!normalized) return false

    const targets = targetFrames(track, frameIndex, lastFrame, mode)
    if (!targets.length) return false

    beforeMutation()
    for (const frame of targets) {
      track.geometries[frame] = cloneGeometry(track.type, normalized)
    }
    // 本次编辑的帧自动成为关键帧
    if (targets.includes(frameIndex)) promoteKeyframe(track, frameIndex)
    return true
  }

  /**
   * 批量编辑多个对象（组拖动 / 多选缩放），只记录一次历史。
   * @param {Array<{ trackId: string, geometry: object }>} updates
   * @returns {number} 实际更新的对象数
   */
  function updateManyFromFrame(
    datasetId,
    updates,
    frameIndex,
    lastFrame,
    mode = 'forward',
  ) {
    const prepared = []
    for (const item of updates || []) {
      const track = getTrack(datasetId, item.trackId)
      if (!track || track.locked) continue
      const normalized = normalizeGeometry(track.type, item.geometry)
      if (!normalized) continue
      const targets = targetFrames(track, frameIndex, lastFrame, mode)
      if (!targets.length) continue
      prepared.push({ track, normalized, targets })
    }
    if (!prepared.length) return 0

    beforeMutation()
    for (const { track, normalized, targets } of prepared) {
      for (const frame of targets) {
        track.geometries[frame] = cloneGeometry(track.type, normalized)
      }
      if (targets.includes(frameIndex)) promoteKeyframe(track, frameIndex)
    }
    return prepared.length
  }

  /**
   * 批量修改对象元信息（标签 / 颜色 / 可见 / 锁定），只记录一次历史。
   * @returns {number} 实际修改的对象数
   */
  function updateTracksMeta(datasetId, ids, patch = {}) {
    const next = {}
    if (typeof patch.label === 'string') next.label = patch.label
    if (typeof patch.color === 'string' && patch.color) next.color = patch.color
    if (typeof patch.visible === 'boolean') next.visible = patch.visible
    if (typeof patch.locked === 'boolean') next.locked = patch.locked
    if (!Object.keys(next).length) return 0

    const targets = (ids || [])
      .map((id) => getTrack(datasetId, id))
      .filter(Boolean)
    if (!targets.length) return 0

    beforeMutation()
    for (const track of targets) Object.assign(track, next)
    return targets.length
  }

  /**
   * 按选中对象在当前帧的位移进行微调，只记录一次历史。
   * @returns {number} 实际微调的对象数
   */
  function nudgeTracks(datasetId, ids, frameIndex, dx, dy, lastFrame, mode = 'forward') {
    const updates = []
    for (const id of ids || []) {
      const track = getTrack(datasetId, id)
      if (!track || track.locked) continue
      const geometry = track.geometries[frameIndex]
      if (!geometry) continue
      updates.push({
        trackId: id,
        geometry: translateGeometry(track.type, geometry, dx, dy),
      })
    }
    if (!updates.length) return 0
    return updateManyFromFrame(datasetId, updates, frameIndex, lastFrame, mode)
  }

  /**
   * 把当前帧几何向前补到更早的帧（用于补标对象出现之前的帧）。
   * 从 fromFrame 填充到当前最小帧 - 1；fromFrame 必须早于当前起始帧。
   * @returns {boolean} 是否有改动
   */
  function extendBackward(datasetId, trackId, fromFrame, geometry) {
    const track = getTrack(datasetId, trackId)
    if (!track) return false
    const normalized = normalizeGeometry(track.type, geometry)
    if (!normalized) return false
    const keys = frameKeys(track.geometries)
    if (!keys.length) return false
    const first = keys[0]
    if (!Number.isInteger(fromFrame) || fromFrame < 0 || fromFrame >= first) return false

    beforeMutation()
    for (let frame = fromFrame; frame < first; frame++) {
      track.geometries[frame] = cloneGeometry(track.type, normalized)
    }
    track.startFrame = fromFrame
    // 补标的起点本身是一个新的关键帧
    promoteKeyframe(track, fromFrame)
    return true
  }

  /**
   * 把末帧几何向后延伸到 toFrame（用于 deleteFromFrame 之后恢复对象）。
   * @returns {boolean} 是否有改动
   */
  function extendForward(datasetId, trackId, toFrame) {
    const track = getTrack(datasetId, trackId)
    if (!track) return false
    const keys = frameKeys(track.geometries)
    if (!keys.length) return false
    const last = keys[keys.length - 1]
    if (!Number.isInteger(toFrame) || toFrame <= last) return false

    beforeMutation()
    const geometry = track.geometries[last]
    for (let frame = last + 1; frame <= toFrame; frame++) {
      track.geometries[frame] = cloneGeometry(track.type, geometry)
    }
    // 延伸到的终点作为关键帧，便于后续插值
    promoteKeyframe(track, toFrame)
    return true
  }

  /**
   * 在指定帧插入关键帧（若该帧已有几何则不处理）。
   * 不传 geometry 时复制最近的关键帧几何，随后可直接拖动调整。
   * @param {{ reveal?: boolean }} [options] reveal=true 时若对象被隐藏会自动恢复显示
   * @returns {boolean} 是否插入成功
   */
  function addKeyframe(datasetId, trackId, frameIndex, geometry = null, options = {}) {
    const track = getTrack(datasetId, trackId)
    if (!track) return false
    if (!Number.isInteger(frameIndex) || frameIndex < 0) return false
    if ((track.keyframes || []).includes(frameIndex)) return false

    const keys = frameKeys(track.geometries)
    if (!keys.length) return false

    let base
    if (geometry) {
      base = normalizeGeometry(track.type, geometry)
    } else if (track.geometries[frameIndex]) {
      // 已有几何（例如“到末帧”填充出来的帧）只需标记为关键帧
      base = cloneGeometry(track.type, track.geometries[frameIndex])
    } else {
      let source = keys[0]
      for (const key of keys) {
        if (key <= frameIndex) source = key
      }
      base = cloneGeometry(track.type, track.geometries[source])
    }
    if (!base) return false

    beforeMutation()
    track.geometries[frameIndex] = base
    promoteKeyframe(track, frameIndex)
    // 插入关键帧通常意味着要立即编辑它，隐藏状态会自动恢复到可见
    if (options.reveal && track.visible === false) track.visible = true
    track.startFrame = frameKeys(track.geometries)[0]
    return true
  }

  /**
   * 在整条对象的所有相邻关键帧之间做线性插值。
   * 关键帧之间的帧会被重新计算（覆盖此前的填充值），关键帧本身不变。
   * @returns {number} 重新计算的帧数
   */
  function interpolate(datasetId, trackId) {
    const track = getTrack(datasetId, trackId)
    if (!track) return 0
    const keyframes = (track.keyframes || [])
      .filter((key) => track.geometries[key])
      .sort((a, b) => a - b)
    if (keyframes.length < 2) return 0

    // 先计算需要填充的帧，避免无改动时产生历史记录
    const pending = []
    for (let index = 1; index < keyframes.length; index++) {
      const a = keyframes[index - 1]
      const b = keyframes[index]
      if (b - a < 2) continue
      for (let frame = a + 1; frame < b; frame++) {
        const geometry = interpolateGeometry(
          track.type,
          track.geometries[a],
          track.geometries[b],
          (frame - a) / (b - a),
        )
        if (geometry) pending.push([frame, geometry])
      }
    }
    if (!pending.length) return 0

    beforeMutation()
    for (const [frame, geometry] of pending) track.geometries[frame] = geometry
    return pending.length
  }

  /**
   * 把上一帧存在、当前帧缺失的对象复制到当前帧（并延伸到末帧）。
   * 用于对象在上一帧还有、当前帧被截断或漏标的场景。
   * @returns {number} 复制的对象数量
   */
  function copyFromPreviousFrame(datasetId, frameIndex, lastFrame) {
    if (!Number.isInteger(frameIndex) || frameIndex <= 0) return 0
    const previous = frameIndex - 1
    const list = getTracks(datasetId)
    const candidates = list.filter(
      (track) => track.geometries[previous] && !track.geometries[frameIndex],
    )
    if (!candidates.length) return 0

    beforeMutation()
    for (const track of candidates) {
      const geometry = cloneGeometry(track.type, track.geometries[previous])
      for (let frame = frameIndex; frame <= lastFrame; frame++) {
        if (!track.geometries[frame]) track.geometries[frame] = cloneGeometry(track.type, geometry)
      }
      promoteKeyframe(track, frameIndex)
    }
    return candidates.length
  }

  /** 导出选中对象的快照（用于复制 / 粘贴） */
  function exportTracks(datasetId, ids) {
    const wanted = new Set(ids || [])
    return (tracksByDataset[datasetId] || [])
      .filter((track) => wanted.has(track.id))
      .map((track) => cloneTrack(track))
  }

  /**
   * 粘贴对象快照到当前帧，生成新对象（单次历史）。
   * @param {object} payload { tracks, frameIndex }，frameIndex 为复制时所在帧
   * @param {number} targetFrame 粘贴到的帧
   * @param {'forward'|'frame'} fillMode
   * @returns {object[]} 新建的对象
   */
  function pasteTracks(datasetId, payload, targetFrame, lastFrame, fillMode = 'forward') {
    const snapshots = payload?.tracks
    if (!Array.isArray(snapshots) || !snapshots.length) return []
    const sourceFrame = Number.isInteger(payload.frameIndex) ? payload.frameIndex : null

    const prepared = []
    for (const raw of snapshots) {
      if (!raw || !GEOMETRY_TYPES.has(raw.type)) continue
      const source = cloneTrack(raw)
      const keys = frameKeys(source.geometries)
      if (!keys.length) continue
      const key =
        sourceFrame != null && source.geometries[sourceFrame] ? sourceFrame : keys[0]
      const geometry = translateGeometry(
        source.type,
        source.geometries[key],
        8,
        8,
      )
      prepared.push({ source, geometry })
    }
    if (!prepared.length) return []

    beforeMutation()
    const list = ensure(datasetId)
    const end = fillMode === 'frame' ? targetFrame : Math.max(targetFrame, lastFrame)
    const copies = []
    for (const { source, geometry } of prepared) {
      const geometries = {}
      for (let frame = targetFrame; frame <= end; frame++) {
        geometries[frame] = cloneGeometry(source.type, geometry)
      }
      const copy = {
        id: `t${++seq}`,
        type: source.type,
        label: source.label,
        color: source.color,
        visible: true,
        locked: false,
        startFrame: targetFrame,
        keyframes: [targetFrame],
        geometries,
      }
      list.push(copy)
      copies.push(copy)
    }
    return copies
  }

  /**
   * 从 frameIndex 起拆分对象：该帧及之后的几何迁到新对象。
   * @returns {{ track: object, source: object } | null}
   */
  function splitTrack(datasetId, trackId, frameIndex) {
    const track = getTrack(datasetId, trackId)
    if (!track) return null
    if (!Number.isInteger(frameIndex)) return null
    const keys = frameKeys(track.geometries)
    const before = keys.filter((key) => key < frameIndex)
    const after = keys.filter((key) => key >= frameIndex)
    // 拆分点前后都必须有几何
    if (!before.length || !after.length) return null

    beforeMutation()
    const copy = cloneTrack(track)
    copy.id = `t${++seq}`
    copy.geometries = {}
    for (const key of after) {
      copy.geometries[key] = cloneGeometry(track.type, track.geometries[key])
      delete track.geometries[key]
    }
    copy.startFrame = after[0]
    track.startFrame = before[0]
    // 关键帧按拆分点分配到前后两段，并确保两段起始帧都是关键帧
    const sourceKeyframes = (track.keyframes || []).filter((key) => key < frameIndex)
    const newKeyframes = (copy.keyframes || []).filter((key) => key >= frameIndex)
    if (!sourceKeyframes.includes(before[0])) sourceKeyframes.push(before[0])
    if (!newKeyframes.includes(after[0])) newKeyframes.push(after[0])
    track.keyframes = sourceKeyframes.sort((a, b) => a - b)
    copy.keyframes = newKeyframes.sort((a, b) => a - b)
    ensure(datasetId).push(copy)
    return { track: copy, source: track }
  }

  /**
   * 合并多个对象：以第一个为基准，其余对象补全基准缺失的帧。
   * 重叠帧保留基准对象的几何。
   * @returns {{ track: object, conflicts: number, merged: number } | null}
   */
  function mergeTracks(datasetId, ids) {
    const list = tracksByDataset[datasetId]
    if (!list) return null
    const targets = (ids || []).map((id) => getTrack(datasetId, id)).filter(Boolean)
    if (targets.length < 2) return null
    const base = targets[0]
    // 只允许合并相同类型的对象，避免几何结构不兼容
    if (targets.some((track) => track.type !== base.type)) return null
    beforeMutation()
    let conflicts = 0
    for (const track of targets.slice(1)) {
      for (const key of frameKeys(track.geometries)) {
        if (base.geometries[key]) {
          conflicts++
          continue
        }
        base.geometries[key] = cloneGeometry(base.type, track.geometries[key])
      }
    }
    for (const track of targets.slice(1)) removeTrackSilently(datasetId, track.id)
    base.startFrame = frameKeys(base.geometries)[0] ?? base.startFrame
    // 合并关键帧，并丢弃已没有几何的帧
    const mergedKeyframes = new Set(base.keyframes || [])
    for (const track of targets.slice(1)) {
      for (const key of track.keyframes || []) mergedKeyframes.add(key)
    }
    base.keyframes = [...mergedKeyframes]
      .filter((key) => base.geometries[key])
      .sort((a, b) => a - b)
    if (!base.keyframes.length) base.keyframes = [base.startFrame]
    return { track: base, conflicts, merged: targets.length }
  }

  /** 修改 track 元信息（标签 / 颜色 / 可见 / 锁定），对全部帧生效 */
  function updateTrackMeta(datasetId, trackId, patch = {}) {
    const track = getTrack(datasetId, trackId)
    if (!track) return false
    const next = {}
    if (typeof patch.label === 'string') next.label = patch.label
    if (typeof patch.color === 'string' && patch.color) next.color = patch.color
    if (typeof patch.visible === 'boolean') next.visible = patch.visible
    if (typeof patch.locked === 'boolean') next.locked = patch.locked
    if (!Object.keys(next).length) return false

    beforeMutation()
    Object.assign(track, next)
    return true
  }

  /** 删除整条 track（该对象在所有帧消失） */
  function deleteTrack(datasetId, trackId) {
    const list = tracksByDataset[datasetId]
    if (!list) return false
    const index = list.findIndex((item) => item.id === trackId)
    if (index < 0) return false
    beforeMutation()
    list.splice(index, 1)
    return true
  }

  /** 内部删除，不记录历史（供 deleteAtFrame / deleteFromFrame 复用，避免重复入栈） */
  function removeTrackSilently(datasetId, trackId) {
    const list = tracksByDataset[datasetId]
    if (!list) return
    const index = list.findIndex((item) => item.id === trackId)
    if (index >= 0) list.splice(index, 1)
  }

  /** 批量删除对象，只记录一次历史 */
  function deleteTracks(datasetId, ids) {
    const list = tracksByDataset[datasetId]
    if (!list) return 0
    const wanted = new Set(ids || [])
    const targets = list.filter((track) => wanted.has(track.id))
    if (!targets.length) return 0
    beforeMutation()
    for (const track of targets) removeTrackSilently(datasetId, track.id)
    return targets.length
  }

  /** 仅删除 frameIndex 帧的几何；若删空则移除整条 track */
  function deleteAtFrame(datasetId, trackId, frameIndex) {
    const track = getTrack(datasetId, trackId)
    if (!track || !track.geometries[frameIndex]) return false
    beforeMutation()
    delete track.geometries[frameIndex]
    track.keyframes = (track.keyframes || []).filter((key) => key !== frameIndex)
    const keys = frameKeys(track.geometries)
    if (!keys.length) {
      removeTrackSilently(datasetId, trackId)
    } else {
      track.startFrame = keys[0]
      if (!track.keyframes.length) track.keyframes = [keys[0]]
    }
    return true
  }

  /** 从 frameIndex 帧起删除该对象（移除 frameIndex..末帧 的几何）；若全部删空则移除整条 track */
  function deleteFromFrame(datasetId, trackId, frameIndex) {
    const track = getTrack(datasetId, trackId)
    if (!track) return false
    const keys = frameKeys(track.geometries).filter((key) => key >= frameIndex)
    if (!keys.length) return false

    beforeMutation()
    for (const key of keys) delete track.geometries[key]
    track.keyframes = (track.keyframes || []).filter((key) => key < frameIndex)
    const remaining = frameKeys(track.geometries)
    if (!remaining.length) {
      removeTrackSilently(datasetId, trackId)
    } else {
      track.startFrame = remaining[0]
      if (!track.keyframes.length) track.keyframes = [remaining[0]]
    }
    return true
  }

  /** 复制一条 track（几何、样式全部复制，生成新 id；解锁并轻微错位） */
  function duplicateTrack(datasetId, trackId) {
    const copies = duplicateTracks(datasetId, [trackId])
    return copies[0] || null
  }

  /** 批量复制对象（单次历史），返回副本列表 */
  function duplicateTracks(datasetId, ids) {
    const targets = (ids || []).map((id) => getTrack(datasetId, id)).filter(Boolean)
    if (!targets.length) return []

    beforeMutation()
    const list = ensure(datasetId)
    const copies = []
    for (const track of targets) {
      const copy = cloneTrack(track)
      copy.id = `t${++seq}`
      copy.locked = false
      for (const [key, geometry] of Object.entries(copy.geometries)) {
        copy.geometries[key] = translateGeometry(copy.type, geometry, 8, 8)
      }
      list.push(copy)
      copies.push(copy)
    }
    return copies
  }

  /** 清空某数据集的所有标注 */
  function clearDataset(datasetId) {
    if (!tracksByDataset[datasetId]?.length) return false
    beforeMutation()
    tracksByDataset[datasetId] = []
    return true
  }

  /**
   * 导入标注（合并到现有标注，id 冲突时重新分配）。
   * @param {object|Array} payload 导出格式对象（含 tracks）或 track 数组
   * @returns {number} 导入的 track 数
   */
  function importDataset(datasetId, payload) {
    const raw = Array.isArray(payload) ? payload : payload?.tracks
    if (!Array.isArray(raw)) return 0
    const parsed = raw.map(parseTrack).filter(Boolean)
    if (!parsed.length) return 0

    beforeMutation()
    const list = ensure(datasetId)
    const used = new Set(list.map((track) => track.id))
    let imported = 0
    for (const track of parsed) {
      if (used.has(track.id)) track.id = `t${++seq}`
      else {
        const matched = /^t(\d+)$/.exec(track.id)
        if (matched) seq = Math.max(seq, Number(matched[1]))
      }
      used.add(track.id)
      list.push(track)
      imported++
    }
    return imported
  }

  /** 某数据集的 track 总数 */
  function countTracks(datasetId) {
    return (tracksByDataset[datasetId] || []).length
  }

  /**
   * 导出某数据集标注为可序列化对象（含每帧几何）。
   * @param {object} meta 附加信息，如 { name, frameCount }
   */
  function exportDataset(datasetId, meta = {}) {
    const tracks = (tracksByDataset[datasetId] || []).map((track) => {
      const keys = frameKeys(track.geometries)
      const frames = {}
      for (const key of keys) frames[key] = cloneGeometry(track.type, track.geometries[key])
      return {
        id: track.id,
        type: track.type,
        label: track.label,
        color: track.color,
        visible: track.visible !== false,
        locked: track.locked === true,
        startFrame: keys.length ? keys[0] : track.startFrame,
        endFrame: keys.length ? keys[keys.length - 1] : track.startFrame,
        keyframes: [...(track.keyframes || [])].sort((a, b) => a - b),
        frames,
      }
    })

    return {
      dataset: datasetId,
      name: meta.name || datasetId,
      frameCount: meta.frameCount ?? null,
      exportedAt: new Date().toISOString(),
      tracks,
    }
  }

  return {
    tracksByDataset,
    getTracks,
    getTrack,
    getFrameShapes,
    getTrackFrameRange,
    createTrack,
    updateFromFrame,
    updateManyFromFrame,
    updateTracksMeta,
    nudgeTracks,
    extendBackward,
    extendForward,
    addKeyframe,
    interpolate,
    updateTrackMeta,
    deleteTrack,
    deleteTracks,
    deleteAtFrame,
    deleteFromFrame,
    duplicateTrack,
    duplicateTracks,
    exportTracks,
    pasteTracks,
    splitTrack,
    mergeTracks,
    copyFromPreviousFrame,
    clearDataset,
    importDataset,
    countTracks,
    exportDataset,
    exportAll,
    restoreAll,
  }
}
