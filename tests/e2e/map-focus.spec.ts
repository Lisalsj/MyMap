import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

async function fixture(narrow = false) {
  const parent = realpathSync(tmpdir())
  const root = mkdtempSync(join(parent, 'mymap-map-focus-'))
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
      env: { ...env, MYMAP_TEST_ROOT: root, MYMAP_TEST_HEADLESS: '1', MYMAP_DEMO: '0' }
    })
    const page = await app.firstWindow()
    if (narrow)
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].setBounds({ width: 1100, height: 800 })
      })
    await page.getByRole('button', { name: '新建旅行', exact: true }).first().waitFor()
    await page.evaluate(async () => {
      const city = (await window.myMap.cities('芜湖')).find((item) => item.id === 'geonames:1791236')!
      const trip = await window.myMap.saveTrip({ title: '城市焦点回归' })
      await window.myMap.saveVisit({
        tripId: trip.id,
        kind: 'city',
        name: city.name,
        cityName: city.name,
        cityId: city.id,
        country: city.country,
        lat: city.lat,
        lon: city.lon,
        date: '',
        note: ''
      })
    })
    await page.reload()
    await page.getByRole('button', { name: '芜湖 · 已点亮 · 1 次到访', exact: true }).click()
    await page.getByRole('button', { name: '聚焦这座城市', exact: true }).click()
    await expect(page.locator('.map-viewport')).not.toHaveAttribute('transform', 'translate(0 0) scale(1)')
    await page.getByRole('button', { name: '关闭城市提示', exact: true }).click()
    return { app, page, root, parent }
  } catch (error) {
    await app?.close().catch(() => {})
    if (dirname(resolve(root)) !== parent || !basename(root).startsWith('mymap-map-focus-'))
      throw new Error('Refusing unexpected focus fixture cleanup')
    rmSync(root, { recursive: true, force: true })
    throw error
  }
}
async function clean(f: Awaited<ReturnType<typeof fixture>>) {
  await f.app.close().catch(() => {})
  if (dirname(resolve(f.root)) !== f.parent || !basename(f.root).startsWith('mymap-map-focus-'))
    throw new Error('Refusing unexpected focus fixture cleanup')
  rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
function region(page: Page) {
  return page.locator('.map-city-region[aria-label^="芜湖"]')
}

test('mouse city, label, marker and map clicks do not draw browser focus rectangles at city zoom', async () => {
  const f = await fixture(true)
  try {
    const { page } = f
    const city = region(page)
    await city.click({ force: true })
    await expect(city).toBeFocused()
    await expect.poll(() => city.evaluate((p) => p.matches(':focus-visible'))).toBe(false)
    await expect(city).toHaveCSS('outline-style', 'none')
    await expect(city).toHaveClass(/is-selected/)
    await expect(city).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.map-city-inspector')).toContainText('芜湖市')
    await expect(page.locator('.map-selected-outline')).toBeVisible()

    // The inspector deliberately removes labels it would cover, especially in a
    // narrow window. Close it, then use a label that will remain outside its area.
    await page.getByRole('button', { name: '关闭城市提示', exact: true }).click()
    const labelName = await page.locator('.map-city-label').evaluateAll((labels) => {
      const svg = document.querySelector<SVGSVGElement>('.footprint-map > svg')!
      const box = svg.getBoundingClientRect(),
        ratio = box.width / svg.viewBox.baseVal.width
      return labels
        .find((label) => {
          const rect = label.getBoundingClientRect()
          return (
            rect.left > box.left + 24 * ratio &&
            rect.right < box.right - 420 * ratio &&
            rect.top > box.top + 75 * ratio &&
            rect.bottom < box.bottom - 60 * ratio
          )
        })
        ?.getAttribute('aria-label')
    })
    expect(labelName, 'a label outside the inspector region must be available').toBeTruthy()
    const label = page.getByRole('button', { name: labelName!, exact: true })
    await label.click({ force: true })
    await expect(label).toBeFocused()
    await expect(label).toHaveCSS('outline-style', 'none')
    await expect(label).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: '关闭城市提示', exact: true }).click()
    const marker = page.locator('.map-marker').first()
    await marker.click({ force: true })
    await expect(marker).toBeFocused()
    await expect(marker).toHaveCSS('outline-style', 'none')

    // A city overview covers this pixel with another focusable path. Use the world
    // background to exercise the SVG container's own pointer-focus treatment.
    await page.getByRole('button', { name: '世界', exact: true }).click()
    await expect(page.locator('.footprint-map')).toHaveAttribute('data-scope', 'world')
    const svg = page.locator('.footprint-map > svg')
    const bounds = await svg.boundingBox()
    await svg.click({ position: { x: 5, y: bounds!.height / 2 } })
    await expect(svg).toBeFocused()
    await expect(svg).toHaveCSS('outline-style', 'none')
  } finally {
    await clean(f)
  }
})

test('keyboard city focus follows the boundary at a constant stroke width and still selects the city', async () => {
  const f = await fixture()
  try {
    const { page } = f
    const svg = page.locator('.footprint-map > svg'),
      city = region(page)
    await svg.focus()
    await page.keyboard.press('Tab')
    await expect(city).toBeFocused()
    await expect.poll(() => city.evaluate((p) => p.matches(':focus-visible'))).toBe(true)
    await expect(city).toHaveCSS('outline-style', 'none')
    await expect(city).toHaveCSS('vector-effect', 'non-scaling-stroke')
    const stroke = await city.evaluate((p) => {
      const style = getComputedStyle(p)
      return { color: style.stroke, width: style.strokeWidth }
    })
    expect(stroke.color).not.toBe('none')
    expect(parseFloat(stroke.width)).toBeGreaterThanOrEqual(2)
    expect(parseFloat(stroke.width)).toBeLessThanOrEqual(4)
    await page.keyboard.press('Enter')
    await expect(city).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.map-city-inspector')).toContainText('芜湖市')
    await expect(page.locator('.map-selected-outline')).toHaveCSS('stroke', stroke.color)
    await page.getByRole('button', { name: '重置地图', exact: true }).click()
    await svg.focus()
    await page.keyboard.press('Tab')
    await expect(city).toBeFocused()
    await expect(city).toHaveCSS('stroke-width', stroke.width)
    await svg.focus()
    await expect(svg).toHaveCSS('outline-style', 'solid')
    expect(parseFloat(await svg.evaluate((p) => getComputedStyle(p).outlineOffset))).toBeLessThan(0)
  } finally {
    await clean(f)
  }
})
