import { expect, test } from '@playwright/test'
import {
  drawRect,
  exportCurrentJson,
  fillModeOption,
  jumpToFrame,
  stats,
  toolButton,
  waitForApp,
} from './helpers'

test('仅当前帧关键帧 + 插入关键帧 + 插值补全', async ({ page }) => {
  await waitForApp(page)
  await toolButton(page, '矩形').click()
  await fillModeOption(page, '仅当前帧').click()
  await drawRect(page)
  await expect(stats(page).nth(1)).toContainText('本帧 1 个')

  await jumpToFrame(page, 20)
  await expect(stats(page).nth(1)).toContainText('本帧 0 个')

  await page.locator('.toolbar__actions').getByRole('button', { name: '插入关键帧' }).click()
  await expect(stats(page).nth(1)).toContainText('本帧 1 个')

  await page.getByRole('button', { name: '插值补全' }).click()
  await expect(page.locator('.el-message').last()).toContainText('已插值补全 18 帧')
  await expect(page.locator('.frame-strip__dot')).toHaveCount(20)

  await jumpToFrame(page, 5)
  await expect(stats(page).nth(1)).toContainText('本帧 1 个')
  await expect(page.locator('.object-panel__sub').first()).toContainText('1–20 帧')
})

test('拆分与合并对象', async ({ page }) => {
  await waitForApp(page)
  await toolButton(page, '矩形').click()
  await drawRect(page)

  await jumpToFrame(page, 5)
  await page.getByRole('button', { name: '拆分', exact: true }).click()
  await expect(stats(page).nth(2)).toContainText('对象 2 个')

  const subs = page.locator('.object-panel__sub')
  await expect(subs.nth(0)).toContainText('1–4 帧')
  await expect(subs.nth(1)).toContainText('5–20 帧')

  // 选中两个对象后合并
  await subs.nth(0).click()
  await page.keyboard.down('Shift')
  await subs.nth(1).click()
  await page.keyboard.up('Shift')
  await expect(page.locator('.object-panel__batch')).toContainText('已选 2')

  await page.getByRole('button', { name: '合并', exact: true }).click()
  const confirm = page.locator('.el-message-box')
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: '合并' }).click()

  await expect(stats(page).nth(2)).toContainText('对象 1 个')
  await expect(page.locator('.object-panel__sub').first()).toContainText('1–20 帧')
})

test('Ctrl+C / Ctrl+V 复制粘贴对象', async ({ page }) => {
  await waitForApp(page)
  await toolButton(page, '矩形').click()
  await drawRect(page)
  await expect(stats(page).nth(2)).toContainText('对象 1 个')

  await page.keyboard.press('Control+c')
  await expect(page.locator('.el-message').last()).toContainText('已复制 1 个对象')

  await jumpToFrame(page, 3)
  await page.keyboard.press('Control+v')
  await expect(page.locator('.el-message').last()).toContainText('已粘贴 1 个对象')
  await expect(stats(page).nth(2)).toContainText('对象 2 个')
  await expect(stats(page).nth(1)).toContainText('本帧 2 个')

  const subs = page.locator('.object-panel__sub')
  await expect(subs.nth(1)).toContainText('3–20 帧')
})

test('N / Shift+N 在未标注帧之间跳转', async ({ page }) => {
  await waitForApp(page)
  await toolButton(page, '矩形').click()
  await fillModeOption(page, '仅当前帧').click()

  await drawRect(page)
  await jumpToFrame(page, 3)
  await drawRect(page)

  await jumpToFrame(page, 1)
  await page.keyboard.press('n')
  await expect(stats(page).first()).toContainText('帧 2 / 20')
  await page.keyboard.press('n')
  await expect(stats(page).first()).toContainText('帧 4 / 20')
  await page.keyboard.press('Shift+n')
  await expect(stats(page).first()).toContainText('帧 2 / 20')
})

test('多边形点击首顶点闭合', async ({ page }) => {
  await waitForApp(page)
  await toolButton(page, '多边形').click()
  const box = await page.locator('.konvajs-content').boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const points = [
    [cx - 50, cy - 40],
    [cx + 50, cy - 40],
    [cx, cy + 50],
  ]
  for (const [x, y] of points) {
    await page.mouse.click(x, y)
    await page.waitForTimeout(180)
  }
  // 点击首顶点闭合
  await page.mouse.click(points[0][0], points[0][1])
  await page.waitForTimeout(300)

  await expect(stats(page).nth(1)).toContainText('本帧 1 个')
  await expect(stats(page).nth(2)).toContainText('对象 1 个')
})

test('方向键：选中时微调，未选中时切帧', async ({ page }) => {
  await waitForApp(page)
  await toolButton(page, '矩形').click()
  await drawRect(page)
  await toolButton(page, '选择').click()
  await page.waitForTimeout(200)

  const before = await exportCurrentJson(page)
  await page.keyboard.press('ArrowRight')
  const after = await exportCurrentJson(page)
  expect(after.tracks[0].frames['0'].x).toBeCloseTo(before.tracks[0].frames['0'].x + 1)
  await expect(stats(page).first()).toContainText('帧 1 / 20')

  // 切到选择工具并点击空白处取消选中后，方向键切帧
  await toolButton(page, '选择').click()
  await page.waitForTimeout(300)
  const canvas = await page.locator('.konvajs-content').boundingBox()
  await page.mouse.click(canvas.x + 20, canvas.y + 20)
  await page.waitForTimeout(300)
  await page.keyboard.press('ArrowRight')
  await expect(stats(page).first()).toContainText('帧 2 / 20')
})
