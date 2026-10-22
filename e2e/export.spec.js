import fs from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { drawRect, toolButton, waitForApp } from './helpers'

test('导出当前数据集 JSON 并校验内容', async ({ page }) => {
  await waitForApp(page)
  await toolButton(page, '矩形').click()
  await drawRect(page)

  await page.getByRole('button', { name: '导出', exact: true }).click()
  const dialog = page.locator('.el-dialog', { hasText: '导出标注' })
  await expect(dialog).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出', exact: true }).click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toBe('case1-annotations.json')
  const filePath = await download.path()
  const content = JSON.parse(await fs.readFile(filePath, 'utf8'))

  expect(content.dataset).toBe('case1')
  expect(content.frameCount).toBe(20)
  expect(content.tracks).toHaveLength(1)
  expect(content.tracks[0].type).toBe('rect')
  expect(Object.keys(content.tracks[0].frames)).toHaveLength(20)

  await expect(dialog).toBeHidden()
})
