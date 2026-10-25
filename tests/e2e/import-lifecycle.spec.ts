import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'

test('an import completed outside the gallery refreshes map statistics and preserves partial failure details', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mymap-import-lifecycle-'))
  let app: ElectronApplication | undefined
  try {
    const sources = [join(root, 'first.png'), join(root, 'second.png'), join(root, 'broken.jpg')]
    for (const [index, file] of sources.slice(0, 2).entries()) {
      await sharp({
        create: { width: 24, height: 16, channels: 3, background: index ? '#c47c55' : '#2e5d4b' }
      })
        .png()
        .toFile(file)
    }
    writeFileSync(sources[2], 'This synthetic fixture is deliberately not an image.')

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
    const tripId = await page.evaluate(
      async () => (await window.myMap.saveTrip({ title: '后台导入回归' })).id
    )
    // Load the new trip before importing. No refresh or navigation occurs during the import below.
    await page.reload()
    const overview = page.getByRole('region', { name: '资料库总览', exact: true })
    const photoCount = overview.locator('.stats-row > div').filter({ hasText: '张照片' }).locator('strong')
    await expect(
      overview.locator('.stats-row > div').filter({ hasText: '段旅行' }).locator('strong')
    ).toHaveText('01')
    await expect(photoCount).toHaveText('00')
    await expect(page.locator('.gallery-page')).toHaveCount(0)

    // Only the native picker is stubbed; image validation, storage and progress events run normally.
    await app.evaluate(({ dialog }, files) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files })
    }, sources)
    await page.evaluate((id) => {
      void window.myMap.importPhotos(id)
      return true
    }, tripId)
    await expect
      .poll(() => page.evaluate(() => window.myMap.importProgress()))
      .toMatchObject({
        running: false,
        total: 3,
        completed: 3
      })
    const progress = await page.evaluate(() => window.myMap.importProgress())
    expect(progress).toMatchObject({
      running: false,
      total: 3,
      completed: 3,
      imported: 2,
      duplicates: 0,
      cancelled: false
    })
    expect(progress.errors).toHaveLength(1)
    expect(progress.errors[0]).toContain('broken.jpg')

    // This must update while Gallery is unmounted, through App's persistent progress listener.
    await expect(photoCount).toHaveText('02')
    await expect(page.locator('.gallery-page')).toHaveCount(0)
    await page.getByRole('button', { name: '照片馆', exact: true }).click()
    await expect(page.locator('.photo-tile')).toHaveCount(2)
    const failures = page.locator('.import-progress details')
    await expect(failures.locator('summary')).toHaveText('1 个文件未能导入，展开查看')
    await failures.locator('summary').click()
    await expect(failures.locator('li')).toHaveCount(1)
    await expect(failures.locator('li')).toContainText('broken.jpg')
  } finally {
    await app?.close().catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
})
