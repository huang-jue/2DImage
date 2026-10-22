import { ref, watch } from 'vue'

/**
 * 明暗主题（全局单例）。
 *
 * 通过给 <html> 加 .dark 类切换 Element Plus 暗色变量，
 * 自定义样式在 style.css 中以 html.dark 前缀覆盖。
 * 首次访问跟随系统偏好，之后记住用户选择。
 */

const STORAGE_KEY = 'lq2d:theme'

function loadPreference() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'dark') return true
    if (saved === 'light') return false
  } catch {
    /* 忽略存储错误 */
  }
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

const dark = ref(Boolean(loadPreference()))

function apply(value) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', value)
}

apply(dark.value)

watch(dark, (value) => {
  apply(value)
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'dark' : 'light')
  } catch {
    /* 忽略存储错误 */
  }
})

export function useTheme() {
  function toggleTheme() {
    dark.value = !dark.value
  }
  return { dark, toggleTheme }
}
