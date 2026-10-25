import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('journal view scope filters the list and flushes the current draft before changing trips', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mymap-journal-scope-'))
  let app: ElectronApplication | undefined
  try {
    const env = Object.fromEntries(
      Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined)
    )
    delete env.ELECTRON_RUN_AS_NODE
    app = await electron.launch({
      executablePath: process.env.MYMAP_EXECUTABLE || undefined,
      args: process.env.MYMAP_EXECUTABLE
        ? ['--disable-gpu']
        : [resolve('out/main/index.js'), '--disable-gpu'],
      env: { ...env, MYMAP_TEST_ROOT: root, MYMAP_TEST_HEADLESS: '1', MYMAP_DEMO: '0' },
      timeout: 40000
    })
    const page = await app.firstWindow()
    await page.waitForFunction(async () => Boolean((await window.myMap.snapshot()).library.path))
    const records = await page.evaluate(async () => {
      const first = await window.myMap.saveTrip({ title: '杭州散步' })
      const second = await window.myMap.saveTrip({ title: '大理慢游' })
      const entry = await window.myMap.saveEntry({ tripId: first.id, title: '西湖', markdown: '散步' })
      await window.myMap.saveEntry({ tripId: second.id, title: '洱海', markdown: '骑行' })
      return { first: first.id, second: second.id, entry: entry.id }
    })
    await page.reload()
    await page.getByRole('button', { name: '旅行手账', exact: true }).click()
    await expect(page.locator('.entry-item')).toHaveCount(2)
    await page.getByRole('combobox', { name: '手记查看旅行' }).selectOption(records.first)
    await expect(page.locator('.entry-item')).toHaveCount(1)
    await expect(page.locator('.entry-item')).toContainText('西湖')
    await page.locator('.entry-item').click()
    await page.getByRole('textbox', { name: 'Markdown 游记正文' }).fill('切换查看范围前的最新文字')
    await page.getByRole('combobox', { name: '手记查看旅行' }).selectOption(records.second)
    await expect(page.locator('.entry-item')).toHaveCount(1)
    await expect(page.locator('.entry-item')).toContainText('洱海')
    await expect(page.getByRole('textbox', { name: '游记标题' })).toHaveValue('洱海')
    const saved = await page.evaluate(() => window.myMap.snapshot())
    expect(saved.entries.find((entry) => entry.id === records.entry)?.markdown).toBe(
      '切换查看范围前的最新文字'
    )
    await page.getByRole('combobox', { name: '手记查看旅行' }).selectOption('')
    await expect(page.locator('.entry-item')).toHaveCount(2)
    await page.getByRole('combobox', { name: '新游记所属旅行' }).selectOption(records.first)
    await page.getByRole('button', { name: '写一篇手记', exact: true }).first().click()
    await expect(page.getByRole('textbox', { name: '游记标题' })).toHaveValue('未命名的旅行手记')
    const created = await page.evaluate(() => window.myMap.snapshot())
    expect(created.entries.find((entry) => entry.title === '未命名的旅行手记')?.tripId).toBe(records.first)
  } finally {
    await app?.close().catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
})
