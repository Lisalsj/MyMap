import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { mapProjection } from '../../src/renderer/map/projection'

function disposeLibrary(root: string) {
  const resolved = realpathSync(root)
  if (dirname(resolved) !== realpathSync(tmpdir()) || !basename(resolved).startsWith('mymap-theme-'))
    throw Error('Unexpected theme fixture cleanup path')
  rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}

async function launch(root: string): Promise<ElectronApplication> {
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((item): item is [string, string] => item[1] !== undefined)
    ),
    MYMAP_TEST_ROOT: root,
    MYMAP_TEST_HEADLESS: '1',
    MYMAP_DEMO: '1'
  }
  delete env.ELECTRON_RUN_AS_NODE
  return electron.launch({
    executablePath: process.env.MYMAP_EXECUTABLE || undefined,
    args: process.env.MYMAP_EXECUTABLE ? [] : [resolve('out/main/index.js')],
    env
  })
}

test('theme changes preserve the retained map, viewport, filters, draft and offline resources', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mymap-theme-'))
  let app: ElectronApplication | undefined
  try {
    app = await launch(root)
    const page = await app.firstWindow()
    const map = page.locator('.retained-map-page .footprint-map')
    await expect(map).toHaveAttribute('aria-busy', 'false')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'forest')
    const terrain = [
      [100, 50],
      [140, 20]
    ].map(([lon, lat]) => mapProjection(false)([lon, lat])!)
    expect(
      await map
        .locator('.map-land')
        .evaluate(
          (element, points) =>
            points.map(([x, y]) => (element as SVGGeometryElement).isPointInFill(new DOMPoint(x, y))),
          terrain
        )
    ).toEqual([true, false])
    await page.evaluate(() => window.myMap.setUpdateChecks(false))
    await map.getByRole('button', { name: '放大地图', exact: true }).click()
    // Wait for the regional LOD before measuring theme-only resource changes.
    await expect(map).toHaveAttribute('aria-busy', 'false')
    await page.getByRole('button', { name: '旅行手账', exact: true }).click()
    await page.locator('.entry-item').first().click()
    const title = await page.getByRole('textbox', { name: '游记标题' }).inputValue()
    const draft = '晴空樱粉主题中的最后一行草稿，不应丢失。'
    await page.getByRole('textbox', { name: 'Markdown 游记正文' }).fill(draft)
    await page.getByRole('button', { name: '设置与资料库', exact: true }).click()
    await expect(page.getByRole('region', { name: '外观与主题' })).toBeVisible()
    const original = await map.elementHandle()
    const transform = await map.locator('.map-viewport').getAttribute('transform')
    const paths = await map
      .locator('.map-city-region')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('d')))
    const resources = await page
      .workers()[0]
      .evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name))
    await page.evaluate(() => {
      const target = window as unknown as { themeWorkerCalls: number }
      target.themeWorkerCalls = 0
      const originalPost = Worker.prototype.postMessage
      Worker.prototype.postMessage = function (...args: unknown[]) {
        target.themeWorkerCalls++
        return Reflect.apply(originalPost, this, args)
      }
    })
    const pink = page.getByRole('radio', { name: '晴空樱粉', exact: true })
    await pink.check()
    await expect(pink).toBeChecked()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'sky-rose')
    expect(await map.locator('.map-water').evaluate((element) => getComputedStyle(element).fill)).toBe(
      'rgb(222, 235, 246)'
    )
    expect(
      await page.evaluate(() => (window as unknown as { themeWorkerCalls: number }).themeWorkerCalls)
    ).toBe(0)
    await page.getByRole('button', { name: '足迹地图', exact: true }).click()
    await expect(map).toBeVisible()
    expect(
      await original!.evaluate(
        (element) => element === document.querySelector('.retained-map-page .footprint-map')
      )
    ).toBe(true)
    await expect(map.locator('.map-viewport')).toHaveAttribute('transform', transform!)
    expect(
      await map.locator('.map-city-region').evaluateAll((rows) => rows.map((row) => row.getAttribute('d')))
    ).toEqual(paths)
    expect(
      await page
        .workers()[0]
        .evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name))
    ).toEqual(resources)
    const saved = await page.evaluate(() => window.myMap.snapshot())
    expect(saved.entries.find((entry) => entry.title === title)?.markdown).toBe(draft)
    const yearFilter = page.getByRole('combobox', { name: '按年份筛选', exact: true })
    const selectedYear = await yearFilter
      .locator('option')
      .nth(1)
      .evaluate((option) => (option as HTMLOptionElement).value)
    await yearFilter.selectOption(selectedYear)
    await page.getByRole('button', { name: '设置与资料库', exact: true }).click()
    await page.getByRole('radio', { name: '米白森林', exact: true }).focus()
    await page.keyboard.press('Space')
    await expect(page.getByRole('radio', { name: '米白森林', exact: true })).toBeChecked()
    await page.getByRole('button', { name: '足迹地图', exact: true }).click()
    await expect(page.getByRole('combobox', { name: '按年份筛选', exact: true })).toHaveValue(selectedYear)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(
      await page
        .locator('.nav-item .sticker-icon')
        .first()
        .evaluate((element) => getComputedStyle(element).transitionDuration)
    ).toBe('0s')
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setBounds({ width: 1100, height: 800 })
      window.webContents.setZoomFactor(2.5)
    })
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(639)
    await expect(page.locator('.sidebar .settings-label-extra')).toBeHidden()
    expect(
      await page
        .locator('.sidebar-bottom .nav-item > span')
        .evaluate((element) => (element as HTMLElement).innerText)
    ).toBe('设置')
  } finally {
    await app?.close().catch(() => {})
    disposeLibrary(root)
  }
})

test('theme preference survives process restart and falls back safely after corruption', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mymap-theme-restart-'))
  let app: ElectronApplication | undefined
  try {
    app = await launch(root)
    let page = await app.firstWindow()
    await page.getByRole('button', { name: '设置与资料库', exact: true }).click()
    await page.getByRole('radio', { name: '晴空樱粉', exact: true }).check()
    await app.close()
    app = await launch(root)
    page = await app.firstWindow()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'sky-rose')
    await page.evaluate(() => localStorage.setItem('mymap:view:theme', '{damaged'))
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'forest')
    await expect(page.locator('.retained-map-page .footprint-map')).toHaveAttribute('aria-busy', 'false')
  } finally {
    await app?.close().catch(() => {})
    disposeLibrary(root)
  }
})
