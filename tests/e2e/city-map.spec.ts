import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('city areas light once, remain readable while zooming, and follow filters and trash', async () => {
  test.setTimeout(90000)
  const profile = mkdtempSync(join(tmpdir(), 'mymap-city-map-'))
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined)
    ),
    MYMAP_TEST_ROOT: profile,
    MYMAP_TEST_HEADLESS: '1',
    MYMAP_DEMO: '0'
  }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    executablePath: process.env.MYMAP_EXECUTABLE || undefined,
    args: process.env.MYMAP_EXECUTABLE ? [] : [resolve('out/main/index.js')],
    env
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '新建旅行', exact: true }).first()).toBeVisible()
    const tripId = await page.evaluate(async () => {
      const trip = await window.myMap.saveTrip({ title: '城市点亮回归', startDate: '2025-03-01' })
      for (const place of [
        { cityId: 'geonames:1808926', cityName: '杭州', lat: 30.25, lon: 120.15 },
        { cityId: 'geonames:1808926', cityName: '杭州', lat: 30.25, lon: 120.15 },
        { cityId: 'geonames:1816670', cityName: '北京', lat: null, lon: null }
      ])
        await window.myMap.saveVisit({
          tripId: trip.id,
          kind: 'city',
          name: place.cityName,
          country: 'CN',
          date: '',
          note: '',
          ...place
        })
      return trip.id
    })
    await page.reload()
    await expect(page.locator('.map-city-region[data-lit="true"]')).toHaveCount(2)
    await expect(page.getByTestId('city-light-count')).toHaveText('2')
    await page.getByRole('button', { name: '杭州 · 已点亮 · 2 次到访', exact: true }).click()
    await expect(page.locator('.map-city-inspector')).toContainText('2 次到访')
    await expect(page.locator('.map-city-inspector')).toContainText('1 段旅行')
    await page.getByRole('button', { name: '聚焦这座城市' }).click()
    await expect(page.locator('.map-city-inspector')).toContainText('杭州')
    // Viewport changes must not regenerate any land/admin SVG path.
    const original = await page
      .locator('.map-base-layer path')
      .evaluateAll((paths) => paths.map((p) => p.getAttribute('d')))
    await page.getByRole('button', { name: '放大地图', exact: true }).click()
    expect(
      await page.locator('.map-base-layer path').evaluateAll((paths) => paths.map((p) => p.getAttribute('d')))
    ).toEqual(original)
    await page.getByRole('button', { name: '重置地图', exact: true }).click()
    await page.getByRole('combobox', { name: '按年份筛选' }).selectOption('2025')
    await expect(page.locator('.map-city-region[data-lit="true"]')).toHaveCount(2)
    await page.evaluate((id) => window.myMap.trash('trip', id), tripId)
    await page.reload()
    await expect(page.getByTestId('city-light-count')).toHaveText('0')
    await page.evaluate((id) => window.myMap.restore('trip', id), tripId)
    await page.reload()
    await expect(page.getByTestId('city-light-count')).toHaveText('2')
    await page.getByRole('button', { name: /世界/, exact: false }).filter({ hasText: '世界' }).last().click()
    await expect(page.locator('.footprint-map')).toHaveAttribute('data-scope', 'world')
    await expect(page.locator('.map-marker')).toHaveCount(1)
    await page.locator('.trip-card').filter({ hasText: '城市点亮回归' }).click()
    const map = page.locator('.footprint-map')
    await expect(map.locator('.map-city-region[data-lit="true"]')).toHaveCount(2)
    await page.getByRole('button', { name: '放大地图', exact: true }).click()
    await map.locator(':scope > svg').focus()
    await page.keyboard.press('ArrowRight')
    await page.getByRole('button', { name: '地图选点', exact: true }).click()
    await map.locator('.map-marker').first().click()
    const picked = page.getByRole('dialog', { name: '把一个地方，放进回忆' })
    await expect(picked).toBeVisible()
    expect(Number(await picked.locator('input[name="lat"]').inputValue())).toBeCloseTo(30.25, 1)
    expect(Number(await picked.locator('input[name="lon"]').inputValue())).toBeCloseTo(120.15, 1)
    await picked.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('button', { name: '足迹回放', exact: true }).click()
    await page.getByRole('button', { name: '重新播放轨迹' }).click()
    await expect(page.getByRole('progressbar', { name: '轨迹回放进度' })).toHaveAttribute('value', '3', {
      timeout: 8000
    })
    await expect(map.locator('.map-city-region[data-lit="true"]')).toHaveCount(2)
    await expect(map.locator('.map-playback')).toContainText('此站未定位')
  } finally {
    await app.close()
    rmSync(profile, { recursive: true, force: true })
  }
})
