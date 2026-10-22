import fs from 'node:fs/promises'
import { expect } from '@playwright/test'

/** 打开应用并等待首帧图片加载完成 */
export async function waitForApp(page) {
  await page.goto('/')
  await page.waitForSelector('.annotation-canvas.is-ready')
  await page.waitForSelector('.frame-strip__item')
  // 启动校验提示会浮在页面上，移除后避免遮挡点击
  await page.waitForTimeout(200)
  await page.evaluate(() => {
    document.querySelectorAll('.el-message').forEach((node) => node.remove())
  })
}

/** 工具栏工具按钮 */
export function toolButton(page, name) {
  return page.locator('.toolbar__tools .el-radio-button', { hasText: name })
}

/** 新建填充模式 */
export function fillModeOption(page, name) {
  return page.locator('.toolbar__field', { hasText: '新建' }).getByText(name, { exact: true })
}

/** 当前激活的缩略图序号（0 基，找不到返回 -1） */
export function activeThumbIndex(page) {
  return page.$$eval('.frame-strip__item', (items) =>
    items.findIndex((item) => item.classList.contains('is-active')),
  )
}

/** 工具栏统计：帧 / 本帧 / 对象 */
export function stats(page) {
  return page.locator('.toolbar__stats .el-tag')
}

/** 画布实际可交互区域（Konva 内容区，避免外层布局变化导致坐标漂移） */
export function canvasBox(page) {
  return page.locator('.konvajs-content').boundingBox()
}

/** 在画布中心画一个矩形 */
export async function drawRect(page, { dx = 100, dy = 60 } = {}) {
  const canvas = await canvasBox(page)
  const cx = canvas.x + canvas.width / 2
  const cy = canvas.y + canvas.height / 2
  await page.mouse.move(cx - dx, cy - dy)
  await page.mouse.down()
  await page.mouse.move(cx + dx, cy + dy, { steps: 8 })
  await page.mouse.up()
}

/** 通过跳帧输入框切到指定帧（1 基） */
export async function jumpToFrame(page, frameNumber) {
  const input = page.locator('.frame-strip__jump-input input')
  await input.fill(String(frameNumber))
  await input.press('Enter')
  await expect(stats(page).first()).toContainText(`帧 ${frameNumber} /`)
}

/** 当前帧的对象数量（工具栏统计文案） */
export async function objectCount(page) {
  const text = await stats(page).nth(2).textContent()
  return Number((text || '').replace(/[^0-9]/g, '')) || 0
}

/** 通过导出对话框取得当前数据集 JSON（用于验证几何变化） */
export async function exportCurrentJson(page) {
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const dialog = page.locator('.el-dialog', { hasText: '导出标注' })
  await expect(dialog).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出', exact: true }).click()
  const download = await downloadPromise
  const filePath = await download.path()
  const doc = JSON.parse(await fs.readFile(filePath, 'utf8'))
  await expect(dialog).toBeHidden()
  return doc
}
