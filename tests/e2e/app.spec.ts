import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'

const launch = async (profile: string, demo = false): Promise<ElectronApplication> => {
  const environment: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((item): item is [string, string] => item[1] !== undefined)
    ),
    MYMAP_TEST_ROOT: profile,
    MYMAP_TEST_HEADLESS: '1',
    MYMAP_DEMO: demo ? '1' : '0'
  }
  delete environment.ELECTRON_RUN_AS_NODE
  return electron.launch({
    executablePath: process.env.MYMAP_EXECUTABLE || undefined,
    args: process.env.MYMAP_EXECUTABLE ? ['--disable-gpu'] : [resolve('out/main/index.js'), '--disable-gpu'],
    env: environment,
    timeout: 40000
  })
}
test('offline application persists journals and photos across a real Electron restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mymap-electron-中文 '))
  let app: ElectronApplication | undefined
  try {
    const image = join(root, '旅行照片.png')
    await sharp({ create: { width: 96, height: 72, channels: 3, background: '#c47c55' } })
      .png()
      .toFile(image)
    app = await launch(root)
    const page = await app.firstWindow()
    await expect(page.locator('body')).toContainText('MyMap')
    await page.waitForFunction(async () => Boolean((await window.myMap.snapshot()).library.path))
    const records = await page.evaluate(async () => {
      const trip = await window.myMap.saveTrip({
        title: '离线持久化测试',
        startDate: '2025-03-01',
        tags: ['测试']
      })
      const v = {
        tripId: trip.id,
        name: '西湖',
        kind: 'scenic' as const,
        cityId: 'geonames:1808926',
        cityName: '杭州',
        country: 'CN',
        lat: 30.25,
        lon: 120.15,
        date: '',
        note: ''
      }
      await window.myMap.saveVisit(v)
      await window.myMap.saveVisit(v)
      const entry = await window.myMap.saveEntry({
        tripId: trip.id,
        title: '旅行记录',
        markdown: '# 春天\n\n重新打开也要看见。'
      })
      return { tripId: trip.id, entryId: entry.id }
    })
    // Native open-file dialog is stubbed at the Electron boundary; real import and utility-process storage run.
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    }, image)
    await page.evaluate(async (id) => {
      await window.myMap.importPhotos(id)
      await window.myMap.importPhotos(id)
    }, records.tripId)
    const before = await page.evaluate(() => window.myMap.snapshot())
    expect(before.photos).toHaveLength(1)
    expect(before.attachments).toHaveLength(1)
    expect(before.visits).toHaveLength(2)
    const media = await page.evaluate(
      (id) =>
        new Promise<number>((resolveImage, reject) => {
          const image = new Image()
          image.onload = () => resolveImage(image.naturalWidth)
          image.onerror = () => reject(new Error('Local media did not load'))
          image.src = `mymap-media://photo/${id}/preview`
        }),
      before.photos[0].id
    )
    expect(media).toBeGreaterThan(0)
    const offline = await page.evaluate(async () => {
      try {
        await fetch('https://example.com/')
        return false
      } catch {
        return true
      }
    })
    expect(offline).toBe(true)
    await app.close()
    app = await launch(root)
    const reopened = await app.firstWindow()
    await expect(reopened.getByRole('button', { name: '新建旅行', exact: true }).first()).toBeVisible()
    await reopened.waitForFunction(async () => (await window.myMap.snapshot()).trips.length === 1)
    const after = await reopened.evaluate(() => window.myMap.snapshot())
    expect(after.entries[0].markdown).toContain('重新打开也要看见')
    expect(after.photos[0].hash).toBe(before.photos[0].hash)
    const result = await reopened.evaluate(() => ({
      node: typeof (window as any).require,
      scripts: document.querySelectorAll('script[src^="http"]').length
    }))
    expect(result).toEqual({ node: 'undefined', scripts: 0 })
  } finally {
    await app?.close().catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
})

test('demo is separate, renders the map, and supplies a reproducible screenshot', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mymap-demo-'))
  let app: ElectronApplication | undefined
  try {
    app = await launch(root, true)
    const page = await app.firstWindow()
    await page.waitForFunction(async () => (await window.myMap.snapshot()).trips.length >= 3)
    await expect(page.locator('svg').first()).toBeVisible()
    await expect(page.locator('body')).toContainText('演示')
    await page.evaluate(() => document.fonts.ready)
    await expect(page.locator('.map-city-region').first()).toBeVisible()
    await page.waitForTimeout(1000)
    mkdirSync('docs/screenshots', { recursive: true })
    await page.screenshot({ path: 'docs/screenshots/overview.png', fullPage: true })
    await page.evaluate(() => window.myMap.setDemo(false))
    const personal = await page.evaluate(() => window.myMap.snapshot())
    expect(personal.trips).toHaveLength(0)
    expect(personal.library.isDemo).toBe(false)
  } finally {
    await app?.close().catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
})
