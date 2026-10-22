import { expect, test } from '@playwright/test'
import {
  activeThumbIndex,
  drawRect,
  stats,
  toolButton,
  waitForApp,
} from './helpers'

test('切换帧时缩略图 active 与统计同步', async ({ page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  await waitForApp(page)
  expect(await activeThumbIndex(page)).toBe(0)

  await page.getByRole('button', { name: '下一帧' }).click()
  await expect.poll(() => activeThumbIndex(page)).toBe(1)
  await expect(stats(page).first()).toContainText('帧 2 / 20')

  await page.locator('.frame-strip__item').nth(0).click()
  await expect.poll(() => activeThumbIndex(page)).toBe(0)
  await expect(stats(page).first()).toContainText('帧 1 / 20')

  expect(errors).toEqual([])
})

test('绘制后切帧仍能正常渲染（Konva/Vue DOM 回归）', async ({ page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  await waitForApp(page)
  await toolButton(page, '矩形').click()
  await drawRect(page)
  await expect(stats(page).nth(1)).toContainText('本帧 1 个')

  // 鼠标在画布上移动会触发坐标读数（历史崩溃点）
  const canvas = await page.locator('.annotation-canvas').boundingBox()
  await page.mouse.move(canvas.x + 20, canvas.y + 20)

  await page.getByRole('button', { name: '下一帧' }).click()
  await expect.poll(() => activeThumbIndex(page)).toBe(1)
  await expect(stats(page).nth(1)).toContainText('本帧 1 个')
  await page.locator('.frame-strip__item').nth(0).click()
  await expect.poll(() => activeThumbIndex(page)).toBe(0)

  expect(errors).toEqual([])
})

test('对象面板选中不再强制跳帧，定位按钮跳到关键帧', async ({ page }) => {
  await waitForApp(page)
  await toolButton(page, '矩形').click()
  await page.locator('.toolbar__field', { hasText: '新建' }).getByText('仅当前帧').click()
  await drawRect(page)

  await page.getByRole('button', { name: '下一帧' }).click()
  await expect.poll(() => activeThumbIndex(page)).toBe(1)

  // 点击行只选中，不跳回第 1 帧
  await page.locator('.object-panel__row .object-panel__sub').click()
  await expect(stats(page).first()).toContainText('帧 2 / 20')

  // 定位按钮跳回最近关键帧（第 1 帧）
  await page.locator('.object-panel__row .object-panel__actions .el-button').nth(1).click()
  await expect(stats(page).first()).toContainText('帧 1 / 20')
})

test('弹窗打开时 Delete 不会删除背后的对象', async ({ page }) => {
  await waitForApp(page)
  await toolButton(page, '矩形').click()
  await drawRect(page)
  await expect(stats(page).nth(2)).toContainText('对象 1 个')

  await page.getByRole('button', { name: '快捷键' }).click()
  await expect(page.locator('.shortcut-help')).toBeVisible()
  await page.keyboard.press('Delete')
  await page.waitForTimeout(300)
  await expect(stats(page).nth(2)).toContainText('对象 1 个')

  await page.keyboard.press('Escape')
  await expect(page.locator('.shortcut-help')).toBeHidden()

  // 关闭弹窗后 Delete 应正常删除
  await page.keyboard.press('Delete')
  await expect(stats(page).nth(2)).toContainText('对象 0 个')
})

test('刷新后恢复上次的数据集与帧', async ({ page }) => {
  await waitForApp(page)
  await page.getByRole('button', { name: '下一帧' }).click()
  await page.getByRole('button', { name: '下一帧' }).click()
  await expect(stats(page).first()).toContainText('帧 3 / 20')

  // 等待会话防抖写入
  await page.waitForTimeout(600)
  await page.reload()
  await page.waitForSelector('.annotation-canvas.is-ready')
  await expect(stats(page).first()).toContainText('帧 3 / 20')
  await expect.poll(() => activeThumbIndex(page)).toBe(2)
})
