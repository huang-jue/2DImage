import { expect, test } from '@playwright/test'
import {
  canvasBox,
  drawRect,
  exportCurrentJson,
  fillModeOption,
  jumpToFrame,
  stats,
  toolButton,
  waitForApp,
} from './helpers'

test('投影只读、点击投影图形跳到来源帧并选中对象', async ({ page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  await waitForApp(page)
  await toolButton(page, '矩形').click()
  await fillModeOption(page, '仅当前帧').click()
  await drawRect(page)
  await expect(stats(page).nth(1)).toContainText('本帧 1 个')

  await page.getByRole('button', { name: '下一帧' }).click()
  await expect(stats(page).first()).toContainText('帧 2 / 20')
  await expect(stats(page).nth(1)).toContainText('本帧 0 个')

  // 先取消选中，验证点击投影后会重新选中对应对象
  await toolButton(page, '选择').click()
  const box = await canvasBox(page)
  await page.mouse.click(box.x + 12, box.y + 12)
  await expect(page.locator('.object-panel__row.is-active')).toHaveCount(0)

  await page.keyboard.press('o')
  const canvas = page.locator('.annotation-canvas')
  await expect(canvas).toHaveAttribute('data-projection-enabled', 'true')
  await expect(canvas).toHaveAttribute('data-projection-shapes', '1')
  await expect(page.locator('.annotation-canvas__projection')).toContainText('上一帧')

  // 点击投射到当前帧的矩形内部
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(stats(page).first()).toContainText('帧 1 / 20')
  await expect(page.locator('.object-panel__row.is-active')).toHaveCount(1)

  // 投影不会写入标注数据
  const doc = await exportCurrentJson(page)
  expect(doc.tracks).toHaveLength(1)
  expect(Object.keys(doc.tracks[0].frames)).toEqual(['0'])
  expect(errors).toEqual([])
})

test('绘制工具下点击投影不会跳帧', async ({ page }) => {
  await waitForApp(page)
  await toolButton(page, '矩形').click()
  await fillModeOption(page, '仅当前帧').click()
  await drawRect(page)

  await page.getByRole('button', { name: '下一帧' }).click()
  await page.keyboard.press('o')
  await expect(page.locator('.annotation-canvas')).toHaveAttribute('data-projection-shapes', '1')

  await toolButton(page, '矩形').click()
  const box = await canvasBox(page)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(stats(page).first()).toContainText('帧 2 / 20')
})

test('投影内容可切换为仅图像 / 两者', async ({ page }) => {
  await waitForApp(page)
  await toolButton(page, '矩形').click()
  await fillModeOption(page, '仅当前帧').click()
  await drawRect(page)
  await page.getByRole('button', { name: '下一帧' }).click()

  await page.keyboard.press('o')
  await page.getByRole('button', { name: '投影', exact: true }).click()
  const panel = page.locator('.projection-control')
  const canvas = page.locator('.annotation-canvas')

  await panel.locator('.el-radio', { hasText: '图像' }).click()
  await expect(canvas).toHaveAttribute('data-projection-shapes', '0')
  await expect(canvas).toHaveAttribute('data-projection-images', '1')
  await expect(page.locator('.annotation-canvas__projection')).toContainText('图像')

  await panel.locator('.el-radio', { hasText: '两者' }).click()
  await expect(canvas).toHaveAttribute('data-projection-shapes', '1')
  await expect(canvas).toHaveAttribute('data-projection-images', '1')
})

test('选中对象关键帧投影支持最近与全部关键帧', async ({ page }) => {
  await waitForApp(page)
  await toolButton(page, '矩形').click()
  await fillModeOption(page, '仅当前帧').click()
  await drawRect(page)

  await jumpToFrame(page, 5)
  await page.locator('.toolbar__actions').getByRole('button', { name: '插入关键帧' }).click()
  await jumpToFrame(page, 10)
  await page.locator('.toolbar__actions').getByRole('button', { name: '插入关键帧' }).click()
  await jumpToFrame(page, 7)

  await page.keyboard.press('o')
  await page.getByRole('button', { name: '投影', exact: true }).click()
  const panel = page.locator('.projection-control')
  await expect(panel).toBeVisible()

  await panel.locator('.el-radio', { hasText: '选中对象关键帧' }).click()
  await expect(page.locator('.annotation-canvas')).toHaveAttribute('data-projection-shapes', '2')

  await panel.locator('.el-checkbox', { hasText: '显示全部关键帧' }).click()
  await expect(page.locator('.annotation-canvas')).toHaveAttribute('data-projection-shapes', '3')
  await expect(page.locator('.annotation-canvas__projection')).toContainText('全部关键帧')
})

test('投影设置刷新后恢复', async ({ page }) => {
  await waitForApp(page)
  await page.keyboard.press('o')
  await page.getByRole('button', { name: '投影', exact: true }).click()
  const panel = page.locator('.projection-control')
  await panel.locator('.el-radio', { hasText: '下一帧' }).click()

  await page.waitForTimeout(600)
  await page.reload()
  await page.waitForSelector('.annotation-canvas.is-ready')
  await expect(page.locator('.annotation-canvas')).toHaveAttribute(
    'data-projection-enabled',
    'true',
  )

  await page.getByRole('button', { name: '投影', exact: true }).click()
  await expect(
    page.locator('.projection-control .el-radio.is-checked', { hasText: '下一帧' }),
  ).toBeVisible()
})
