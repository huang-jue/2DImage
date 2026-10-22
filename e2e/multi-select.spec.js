import { expect, test } from '@playwright/test'
import {
  canvasBox,
  exportCurrentJson,
  objectCount,
  stats,
  toolButton,
  waitForApp,
} from './helpers'

test('Shift 多选、组拖动与批量删除', async ({ page }) => {
  await waitForApp(page)
  await toolButton(page, '矩形').click()

  const box = await canvasBox(page)
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2

  const draw = async (x1, y1, x2, y2) => {
    await page.mouse.move(x1, y1)
    await page.mouse.down()
    await page.mouse.move(x2, y2, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(150)
  }

  await draw(cx - 140, cy - 45, cx - 60, cy + 45)
  await draw(cx + 60, cy - 45, cx + 140, cy + 45)
  await expect(stats(page).nth(2)).toContainText('对象 2 个')

  await toolButton(page, '选择').click()
  const beforeSelect = await canvasBox(page)

  await page.mouse.click(cx - 100, cy)
  await expect(page.locator('.object-panel__batch')).toHaveCount(0)

  await page.keyboard.down('Shift')
  await page.mouse.click(cx + 100, cy)
  await page.keyboard.up('Shift')
  await expect(page.locator('.object-panel__batch')).toContainText('已选 2')

  // 多选后布局不应发生位移（历史问题：工具栏换行导致画布下移）
  const afterSelect = await canvasBox(page)
  expect(Math.abs(afterSelect.y - beforeSelect.y)).toBeLessThan(1)
  expect(Math.abs(afterSelect.height - beforeSelect.height)).toBeLessThan(1)

  const before = await exportCurrentJson(page)
  const beforeById = new Map(before.tracks.map((track) => [track.id, track.frames['0']]))

  // 组拖动：拖左框，右框应同步位移
  const dragBox = await canvasBox(page)
  const dcx = dragBox.x + dragBox.width / 2
  const dcy = dragBox.y + dragBox.height / 2
  await page.mouse.move(dcx - 100, dcy)
  await page.mouse.down()
  await page.mouse.move(dcx - 80, dcy + 20, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(300)

  const doc = await exportCurrentJson(page)
  expect(doc.tracks).toHaveLength(2)
  const deltas = doc.tracks.map((track) => {
    const start = beforeById.get(track.id)
    const end = track.frames['0']
    return { dx: end.x - start.x, dy: end.y - start.y }
  })
  expect(deltas[0].dx).toBeGreaterThan(0)
  expect(deltas[0].dy).toBeGreaterThan(0)
  expect(Math.abs(deltas[0].dx - deltas[1].dx)).toBeLessThan(0.01)
  expect(Math.abs(deltas[0].dy - deltas[1].dy)).toBeLessThan(0.01)

  // 批量删除
  await expect(page.locator('.object-panel__batch')).toContainText('已选 2')
  await page.locator('.toolbar__actions').getByRole('button', { name: '删除对象' }).click()
  await expect.poll(() => objectCount(page)).toBe(0)
})
