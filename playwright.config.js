import { defineConfig, devices } from '@playwright/test'

/**
 * E2E 配置：使用 Vite 开发服务器运行页面。
 * CI 中会先安装 Chromium，再执行 `npm run test:e2e`。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // 用构建产物 + preview 运行，避免 dev 服务器在测试写入 trace/截图时被文件监听打断。
    // 显式绑定 IPv4：CI 的 localhost 可能解析到 ::1，导致 Playwright 访问 127.0.0.1 超时。
    command:
      'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
