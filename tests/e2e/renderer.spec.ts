import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('Chinese renderer forms, city search, journal flush and trash recovery work through the real UI', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mymap-renderer-'))
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
    await expect(page.getByRole('button', { name: '新建旅行', exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: '新建旅行', exact: true }).first().click()
    const modal = page.getByRole('dialog', { name: '一段新的旅程' })
    await modal.getByRole('textbox', { name: '旅行名称' }).fill('杭州慢慢走')
    await modal.getByRole('textbox', { name: '旅行标签' }).fill('山野，周末')
    await modal.getByRole('button', { name: '创建旅行', exact: true }).click()
    await expect(page.getByRole('heading', { name: '杭州慢慢走', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '添加地点', exact: true }).click()
    const visit = page.getByRole('dialog', { name: '把一个地方，放进回忆' })
    await visit.getByPlaceholder('搜索城市，中英文均可').fill('杭州')
    await visit.getByRole('button').filter({ hasText: '杭州' }).first().click()
    await visit.getByRole('button', { name: '保存到访', exact: true }).click()
    await expect(page.getByText('沿途 · 1 站')).toBeVisible()
    await page.getByRole('button', { name: '去写手记' }).click()
    await page.getByRole('button', { name: '写一篇手记', exact: true }).first().click()
    await page.getByRole('textbox', { name: '游记标题' }).fill('西湖的一天')
    await page.getByRole('textbox', { name: 'Markdown 游记正文' }).fill('# 雨后的西湖\n\n慢慢走，慢慢记。')
    // Leave before the debounce expires. Navigation must await the serialized save.
    await page.getByRole('button', { name: '旅行护照', exact: true }).click()
    await expect(page.getByRole('heading', { name: '旅行护照', exact: true, level: 1 })).toBeVisible()
    const data = await page.evaluate(() => window.myMap.snapshot())
    expect(data.entries[0].title).toBe('西湖的一天')
    expect(data.entries[0].markdown).toContain('慢慢走，慢慢记。')
    expect(data.visits).toHaveLength(1)
    await page.getByRole('button', { name: '我的旅行', exact: false }).first().click()
    await page.getByRole('button').filter({ hasText: '杭州慢慢走' }).last().click()
    await page.getByRole('button', { name: '删除旅行', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '移到回收站', exact: true }).click()
    await page.getByRole('button', { name: '设置与资料库', exact: true }).click()
    await page.getByRole('button', { name: '恢复', exact: true }).first().click()
    const restored = await page.evaluate(() => window.myMap.snapshot())
    expect(restored.trips[0].deletedAt).toBeNull()
  } finally {
    await app?.close().catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
})

test('manual cities, unlocated landmarks and shared-place visit edits persist correctly', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mymap-manual-visits-'))
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
    await expect(page.getByRole('button', { name: '新建旅行', exact: true }).first()).toBeVisible()
    await page.evaluate(() => window.myMap.saveTrip({ title: '未定位的旅程', startDate: '2025-05-01' }))
    await page.reload()
    await expect(page.getByRole('button', { name: '新建旅行', exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: '我的旅行', exact: false }).first().click()
    await page.getByRole('button').filter({ hasText: '未定位的旅程' }).last().click()
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: '添加地点', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '把一个地方，放进回忆' })
      await dialog.getByRole('button', { name: '手动填写城市', exact: true }).click()
      await dialog
        .getByRole('textbox', { name: '手动城市名称', exact: true })
        .fill(i === 0 ? ' 未收录小镇 ' : '未收录小镇')
      await dialog.getByRole('textbox', { name: '手动国家或地区', exact: true }).fill('中国')
      await dialog.getByRole('button', { name: '保存到访', exact: true }).click()
      await expect(page.getByText(`沿途 · ${i + 1} 站`)).toBeVisible()
    }
    let s = await page.evaluate(() => window.myMap.snapshot())
    expect(s.visits).toHaveLength(2)
    expect(s.places).toHaveLength(1)
    expect(s.places[0]).toMatchObject({ cityId: 'manual:中国:未收录小镇', lat: null, lon: null })
    const initialIds = s.visits.map((v) => ({ id: v.id, sortOrder: v.sortOrder, placeId: v.placeId }))
    await page.getByRole('button', { name: '添加地点', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: '把一个地方，放进回忆' })
    await dialog.getByRole('button', { name: '景点 / 地标', exact: true }).click()
    await dialog.getByRole('textbox', { name: '地点名称', exact: true }).fill('山谷里的小屋')
    await dialog.getByRole('button', { name: '保存到访', exact: true }).click()
    await expect(page.getByText('沿途 · 3 站')).toBeVisible()
    s = await page.evaluate(() => window.myMap.snapshot())
    expect(s.places.find((p) => p.name === '山谷里的小屋')).toMatchObject({
      kind: 'custom',
      cityId: '',
      cityName: '',
      lat: null,
      lon: null
    })
    await page.getByRole('button', { name: '编辑未收录小镇', exact: true }).first().click()
    dialog = page.getByRole('dialog', { name: '编辑这条足迹' })
    await expect(dialog.getByRole('textbox', { name: '手动城市名称', exact: true })).toHaveValue('未收录小镇')
    await expect(dialog.locator('input[name="lat"]')).toHaveValue('')
    await dialog.getByRole('textbox', { name: '手动城市名称', exact: true }).fill('另一个小镇')
    await dialog
      .getByRole('textbox', { name: '一句话回忆', exact: true })
      .fill('改正目的地，不改动另一次到访')
    await dialog.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(dialog).toBeHidden()
    s = await page.evaluate(() => window.myMap.snapshot())
    expect(s.visits).toHaveLength(3)
    expect(s.visits.find((v) => v.id === initialIds[0].id)?.sortOrder).toBe(initialIds[0].sortOrder)
    expect(s.visits.find((v) => v.id === initialIds[1].id)?.placeId).toBe(initialIds[1].placeId)
    expect(s.places.find((p) => p.id === initialIds[1].placeId)?.name).toBe('未收录小镇')
    expect(
      s.places.find((p) => p.id === s.visits.find((v) => v.id === initialIds[0].id)?.placeId)?.name
    ).toBe('另一个小镇')
    await page.getByRole('button', { name: '旅行护照', exact: true }).click()
    await page.getByRole('combobox', { name: '按年份筛选', exact: true }).selectOption('2025')
    await expect(page.locator('.city-stamp')).toHaveCount(2)
    await expect(page.locator('.city-stamp').first()).toContainText('无日期')
  } finally {
    await app?.close().catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
})
