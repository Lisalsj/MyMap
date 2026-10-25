// Real Electron visual QA, using only an isolated fictional demonstration library.
const { _electron: electron } = require('@playwright/test')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { resolve, join, dirname, basename } = require('node:path')
const version = require('../package.json').version
const prefix = 'mymap-design-qa-'
const tempParent = realpathSync(tmpdir())
const profile = mkdtempSync(join(tempParent, prefix))
const directory = resolve(`docs/screenshots/v${version}`)
const results = []
const delay = (ms) => new Promise((done) => setTimeout(done, ms))
let app
async function captureViewport(name) {
  // Full-page Chromium screenshots clip Electron windows with a zoom factor.
  const data = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64')
  )
  writeFileSync(join(directory, name), Buffer.from(data, 'base64'))
}

async function audit(page, name) {
  const report = await page.evaluate(() => {
    const tiny = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim()) continue
      const element = node.parentElement
      if (!element || element.closest('.sr-only, script, style, title') || !element.getClientRects().length)
        continue
      const style = getComputedStyle(element)
      if (style.visibility === 'hidden' || style.display === 'none') continue
      const size = parseFloat(style.fontSize)
      if (size < 12)
        tiny.push({
          text: node.textContent.trim().slice(0, 50),
          fontSize: size,
          className: String(element.className?.baseVal || element.className)
        })
    }
    return {
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      documentWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      tinyText: tiny
    }
  })
  results.push({ page: name, ...report })
  if (report.overflow || report.tinyText.length)
    console.log(
      `UI audit requires review: ${name} overflow=${report.overflow}, small text=${report.tinyText.length}`
    )
  return report
}
async function ready(page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(
      [...document.querySelectorAll('img')].map((img) =>
        img.complete ? Promise.resolve() : img.decode().catch(() => {})
      )
    )
  })
  await delay(250)
}
async function navigate(page, label) {
  await page.getByRole('button', { name: label, exact: true }).first().click()
  if (label === '旅行手账') {
    await page.locator('.journal-layout').waitFor()
    if (await page.locator('.entry-list button').count()) {
      await page.locator('.entry-list button').first().click()
      await page.getByRole('textbox', { name: 'Markdown 游记正文' }).waitFor()
    }
  }
  if (label === '照片馆') await page.locator('.photo-tile').first().waitFor()
  if (label === '足迹地图') await page.locator('.map-city-region').first().waitFor()
  await ready(page)
  await page.evaluate(() => scrollTo(0, 0))
}
async function main() {
  mkdirSync(directory, { recursive: true })
  const env = { ...process.env, MYMAP_TEST_ROOT: profile, MYMAP_TEST_HEADLESS: '0', MYMAP_DEMO: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({
    executablePath: process.env.MYMAP_EXECUTABLE || undefined,
    args: process.env.MYMAP_EXECUTABLE ? ['--disable-gpu'] : [resolve('out/main/index.js'), '--disable-gpu'],
    env
  })
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.show()
    window.focus()
  })
  await page.getByRole('button', { name: '新建旅行', exact: true }).first().waitFor()
  await page.locator('.map-city-region').first().waitFor()
  await page.evaluate(() => document.fonts.load('16px "Noto Sans SC"', '旅行图鉴'))
  const pages = [
    ['足迹地图', 'map'],
    ['我的旅行', 'trips'],
    ['旅行手账', 'journal'],
    ['照片馆', 'gallery'],
    ['旅行护照', 'passport'],
    ['设置与资料库', 'settings']
  ]
  for (const [label, slug] of pages) {
    await navigate(page, label)
    await audit(page, `${slug}-1440-100`)
    await captureViewport(`${slug}.png`)
  }
  await navigate(page, '照片馆')
  await page.locator('.photo-tile').first().click()
  await ready(page)
  await audit(page, 'photo-detail-1440-100')
  await captureViewport('photo-detail.png')
  await page.getByRole('button', { name: '关闭照片', exact: true }).click()
  await navigate(page, '我的旅行')
  await page.locator('.trip-card').filter({ hasText: '江南' }).first().click()
  await page.locator('.detail-map .map-city-region').first().waitFor()
  await ready(page)
  await audit(page, 'trip-detail-1440-100')
  await captureViewport('trip-detail.png')
  await page.getByRole('button', { name: '添加地点', exact: true }).first().click()
  await ready(page)
  await audit(page, 'visit-editor-1440-100')
  await captureViewport('visit-editor.png')
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '新建旅行', exact: true }).first().click()
  await ready(page)
  await audit(page, 'trip-editor-1440-100')
  await captureViewport('trip-editor.png')
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()

  for (const zoom of [1, 1.25, 1.5]) {
    await app.evaluate(({ BrowserWindow }, scale) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setBounds({ width: 1100, height: 800 })
      window.webContents.setZoomFactor(scale)
    }, zoom)
    await delay(250)
    for (const [label, slug] of pages) {
      await navigate(page, label)
      await audit(page, `${slug}-1100-${zoom * 100}`)
      if (zoom === 1.5 && ['map', 'journal', 'settings'].includes(slug)) {
        // Chromium's full-page screenshot clips Electron zoomed windows. Capture the
        // actual native viewport so the evidence matches what a user sees.
        await captureViewport(`${slug}-1100-150.png`)
      }
    }
  }
  await navigate(page, '我的旅行')
  await page.locator('.trip-card').filter({ hasText: '江南' }).first().click()
  await page.getByRole('button', { name: '添加地点', exact: true }).first().click()
  await ready(page)
  await audit(page, 'visit-editor-1100-150')
  await captureViewport('visit-editor-1100-150.png')
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '新建旅行', exact: true }).first().click()
  await ready(page)
  await audit(page, 'trip-editor-1100-150')
  await captureViewport('trip-editor-1100-150.png')
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reducedMotion = await page.evaluate(() => ({
    enabled: matchMedia('(prefers-reduced-motion: reduce)').matches,
    transition: getComputedStyle(document.querySelector('.nav-item')).transitionDuration
  }))
  const report = {
    version,
    executable: process.env.MYMAP_EXECUTABLE || 'node_modules/electron (out/main/index.js)',
    electronReportedAppVersion: await app.evaluate(({ app }) => app.getVersion()),
    generatedAtUtc: new Date().toISOString(),
    environment:
      'Windows Electron; visible foreground window and isolated fictional demo library; GPU disabled for deterministic screenshots; native viewport captures; zoom is Electron webContents zoom, not a change to OS display settings.',
    checks: results,
    reducedMotion,
    screenshotDirectory: `docs/screenshots/v${version}`,
    failures: results.filter((r) => r.overflow || r.tinyText.length).map((r) => r.page)
  }
  mkdirSync('docs/reports', { recursive: true })
  writeFileSync(`docs/reports/design-qa-v${version}.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ pages: results.length, failures: report.failures, reducedMotion }))
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    if (app) await app.close().catch(() => app.process().kill())
    const target = resolve(profile)
    if (dirname(target) !== tempParent || !basename(target).startsWith(prefix))
      throw new Error('Refusing unexpected QA cleanup path')
    rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
