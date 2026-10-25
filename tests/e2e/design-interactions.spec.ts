import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

async function launch(root: string): Promise<ElectronApplication> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined)
  )
  delete env.ELECTRON_RUN_AS_NODE
  return electron.launch({
    executablePath: process.env.MYMAP_EXECUTABLE || undefined,
    args: process.env.MYMAP_EXECUTABLE ? ['--disable-gpu'] : [resolve('out/main/index.js'), '--disable-gpu'],
    env: { ...env, MYMAP_TEST_ROOT: root, MYMAP_TEST_HEADLESS: '1', MYMAP_DEMO: '0' },
    timeout: 40000
  })
}

test('a trip detail journal action uses that trip instead of the previously edited journal', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mymap-journal-context-'))
  let app: ElectronApplication | undefined
  try {
    app = await launch(root)
    const page = await app.firstWindow()
    await page.waitForFunction(async () => Boolean((await window.myMap.snapshot()).library.path))
    const records = await page.evaluate(async () => {
      const first = await window.myMap.saveTrip({ title: '杭州上下文回归' })
      const second = await window.myMap.saveTrip({ title: '大理上下文回归' })
      const entry = await window.myMap.saveEntry({ tripId: first.id, title: '杭州旧手记', markdown: '西湖' })
      return { first: first.id, second: second.id, entry: entry.id }
    })
    await page.reload()
    await page.getByRole('button', { name: '旅行手账', exact: true }).click()
    await page.locator('.entry-item').filter({ hasText: '杭州旧手记' }).click()
    await page.getByRole('textbox', { name: 'Markdown 游记正文' }).fill('进入另一段旅行前的最后修改')
    await page.getByRole('button', { name: '我的旅行', exact: true }).click()
    await page.locator('.trip-card').filter({ hasText: '大理上下文回归' }).click()
    await page.getByRole('button', { name: '去写手记', exact: true }).click()
    await expect(page.getByRole('combobox', { name: '手记查看旅行' })).toHaveValue(records.second)
    await expect(page.getByRole('combobox', { name: '新游记所属旅行' })).toHaveValue(records.second)
    await expect(page.locator('.entry-item')).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: '游记标题' })).toHaveCount(0)
    await page.getByRole('button', { name: '写一篇手记', exact: true }).first().click()
    await page.getByRole('textbox', { name: '游记标题' }).fill('大理新手记')
    await page.getByRole('button', { name: '旅行护照', exact: true }).click()
    // Navigation awaits the asynchronous serialized save before showing its destination.
    await expect(page.getByRole('heading', { name: '旅行护照', exact: true, level: 1 })).toBeVisible()
    const saved = await page.evaluate(() => window.myMap.snapshot())
    expect(saved.entries.find((entry) => entry.id === records.entry)?.markdown).toBe(
      '进入另一段旅行前的最后修改'
    )
    expect(saved.entries.find((entry) => entry.title === '大理新手记')?.tripId).toBe(records.second)
  } finally {
    await app?.close().catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
})

test('Control K opens search but leaves an active editor dialog in control of focus', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mymap-search-keyboard-'))
  let app: ElectronApplication | undefined
  try {
    app = await launch(root)
    const page = await app.firstWindow()
    const search = page.getByRole('textbox', { name: '搜索旅行、地点、手记和标签' })
    await expect(search).toBeVisible()
    await page.keyboard.press('Control+k')
    await expect(search).toBeFocused()
    await search.fill('没有匹配的旅行')
    await expect(page.locator('.search-results')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.search-results')).toHaveCount(0)
    const trigger = page.getByRole('button', { name: '新建旅行', exact: true }).first()
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: '一段新的旅程' })
    const title = dialog.getByRole('textbox', { name: '旅行名称' })
    await expect(title).toBeFocused()
    await page.keyboard.press('Control+k')
    await expect(title).toBeFocused()
    await expect(page.locator('.search-results')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
  } finally {
    await app?.close().catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
})

test('optional coordinates open with the keyboard and preserve zero coordinates during edit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mymap-coordinate-keyboard-'))
  let app: ElectronApplication | undefined
  try {
    app = await launch(root)
    const page = await app.firstWindow()
    await page.waitForFunction(async () => Boolean((await window.myMap.snapshot()).library.path))
    await page.evaluate(() => window.myMap.saveTrip({ title: '零坐标之旅' }))
    await page.reload()
    await page.getByRole('button', { name: '我的旅行', exact: true }).click()
    await page.locator('.trip-card').filter({ hasText: '零坐标之旅' }).click()
    await page.getByRole('button', { name: '添加地点', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: '把一个地方，放进回忆' })
    await expect(dialog.locator('.editor-coordinates')).not.toHaveAttribute('open', '')
    await expect(dialog.locator('input[name="lat"]')).toBeHidden()
    await dialog.getByRole('button', { name: '自定义地点', exact: true }).click()
    await dialog.getByRole('textbox', { name: '地点名称', exact: true }).fill('零点坐标')
    const summary = dialog.locator('summary').filter({ hasText: '可选定位' })
    await summary.focus()
    await page.keyboard.press('Enter')
    await expect(dialog.locator('input[name="lat"]')).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(dialog.locator('input[name="lat"]')).toBeFocused()
    await dialog.locator('input[name="lat"]').fill('0')
    await dialog.locator('input[name="lon"]').fill('0')
    await dialog.getByRole('button', { name: '保存到访', exact: true }).click()
    await expect(page.getByText('沿途 · 1 站')).toBeVisible()
    await page.getByRole('button', { name: '编辑零点坐标', exact: true }).click()
    dialog = page.getByRole('dialog', { name: '编辑这条足迹' })
    await expect(dialog.locator('.editor-coordinates')).toHaveAttribute('open', '')
    await expect(dialog.locator('input[name="lat"]')).toHaveValue('0')
    await expect(dialog.locator('input[name="lon"]')).toHaveValue('0')
    await dialog.getByRole('button', { name: '保存修改', exact: true }).click()
    const saved = await page.evaluate(() => window.myMap.snapshot())
    expect(saved.places[0]).toMatchObject({ name: '零点坐标', lat: 0, lon: 0 })
  } finally {
    await app?.close().catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
})
