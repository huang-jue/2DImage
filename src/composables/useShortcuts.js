import { onBeforeUnmount, onMounted } from 'vue'
import { hasOpenOverlay, isTypingTarget } from '../utils/dom'

/**
 * 全局快捷键。
 *
 * 用法：
 *   useShortcuts({
 *     'mod+z': undo,
 *     'shift+mod+z': redo,
 *     'arrowright': nextFrame,
 *   })
 *
 * 组合键统一用 + 连接，修饰键为 mod（Ctrl / Cmd）、shift、alt；
 * 单个字母统一小写，方向键为 arrowleft/arrowright/arrowup/arrowdown，
 * 空格为 space，加号为 plus，减号为 minus。
 */

/** 把键盘事件归一化为快捷键字符串 */
function normalize(event) {
  let key = event.key
  let ignoreShift = false
  if (key === ' ') key = 'space'
  else if (key === '+') {
    key = 'plus'
    // “+” 通常需要 Shift，按键本身已表达意图，不再叠加 shift
    ignoreShift = true
  } else if (key === '-') key = 'minus'
  else key = key.toLowerCase()

  const parts = []
  if (event.ctrlKey || event.metaKey) parts.push('mod')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey && !ignoreShift) parts.push('shift')
  parts.push(key)
  return parts.join('+')
}

/**
 * @param {Record<string, (event: KeyboardEvent) => void>} bindings
 * @param {{ enabled?: () => boolean }} [options]
 */
export function useShortcuts(bindings, options = {}) {
  function onKeyDown(event) {
    if (options.enabled && !options.enabled()) return
    if (isTypingTarget(event) || hasOpenOverlay()) return
    const handler = bindings[normalize(event)]
    if (!handler) return
    event.preventDefault()
    handler(event)
  }

  onMounted(() => window.addEventListener('keydown', onKeyDown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))
}
