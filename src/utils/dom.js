/**
 * 轻量 DOM 判断工具，供全局快捷键与画布共用。
 */

/** 事件目标是否为可编辑控件（输入框、下拉、滑块等） */
export function isTypingTarget(event) {
  const target = event?.target
  if (!target) return false
  const tag = (target.tagName || '').toLowerCase()
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable === true
  )
}

/**
 * 是否存在可见的遮罩层（对话框 / 消息框 / loading）。
 * 用于在弹窗打开时屏蔽画布与全局快捷键。
 */
export function hasOpenOverlay() {
  if (typeof document === 'undefined') return false
  const nodes = document.querySelectorAll(
    '.el-overlay, .el-message-box__wrapper, .el-loading-mask',
  )
  for (const node of nodes) {
    const rect = node.getBoundingClientRect()
    if (!rect.width || !rect.height) continue
    const style = window.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      continue
    }
    return true
  }
  return false
}
