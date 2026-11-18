const { _electron: electron } = require('@playwright/test')
const { copyFileSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, basename, dirname, resolve } = require('node:path')
const temp = realpathSync(tmpdir())
const prefix = 'mymap-gallery-run-'
const round = (n) => Number(n.toFixed(2))
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
const memory = (app) =>
  app.evaluate(({ app }) =>
    app.getAppMetrics().map((p) => ({
      type: p.type,
      name: p.name || p.serviceName || '',
      pid: p.pid,
      workingSetMiB: p.memory.workingSetSize / 1024
    }))
  )
const counts = (app) => app.evaluate(() => ({ ...globalThis.galleryBenchmarkCounts }))

async function frameCadence(app, page) {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false)
  )
  const measure = () =>
    page.evaluate(async () => {
      const intervals = []
      let previous
      for (let index = 0; index < 9; index++) {
        const at = await new Promise((done) => requestAnimationFrame(done))
        if (previous !== undefined) intervals.push(at - previous)
        previous = at
      }
      return intervals
    })
  let hidden = true
  let intervals = await measure()
  if ([...intervals].sort((a, b) => a - b)[4] > 35) {
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.show()
      win.focus()
    })
    hidden = false
    intervals = await measure()
  }
  if ([...intervals].sort((a, b) => a - b)[4] > 35)
    throw Error('Renderer frames are throttled; refusing to report interaction timing')
  return { hidden, intervalsMs: intervals.map(round) }
}

async function usingApp(build, libraryPath, task) {
  const profile = mkdtempSync(join(temp, prefix))
  let app
  try {
    if (libraryPath) writeFileSync(join(profile, 'settings.json'), JSON.stringify({ library: libraryPath }))
    const env = {
      ...process.env,
      MYMAP_TEST_ROOT: profile,
      MYMAP_DEMO: '0',
      MYMAP_TEST_HEADLESS: '1',
      MYMAP_BENCH_ENTRY: join(build, 'out/main/index.js')
    }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_RENDERER_URL
    app = await electron.launch({
      args: [
        resolve('scripts/lib/gallery-benchmark-main.cjs'),
        '--disable-gpu',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling'
      ],
      env
    })
    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))
    const navigation = page.getByRole('button', { name: '照片馆', exact: true }).first()
    await navigation.waitFor()
    await page.waitForFunction(
      () => document.querySelector('.footprint-map')?.getAttribute('aria-busy') === 'false'
    )
    return await task(app, page, profile)
  } finally {
    if (app) await app.close().catch(() => app.process().kill())
    if (
      realpathSync(profile) !== profile ||
      dirname(profile) !== temp ||
      !basename(profile).startsWith(prefix)
    )
      throw Error('Unexpected disposable gallery profile')
    rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 })
  }
}

async function benchmarkCamera(build, fixture) {
  return usingApp(build, null, async (app, page) => {
    const trip = await page.evaluate(() => window.myMap.saveTrip({ title: '相机导入基准' }))
    await page.reload()
    await page.getByRole('button', { name: '照片馆', exact: true }).first().click()
    await page.locator('.gallery-page').waitFor()
    const files = Array.from({ length: 300 }, (_, i) => join(fixture, 'camera', i + '.jpg'))
    await app.evaluate(({ dialog }, files) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files })
    }, files)
    const baseline = await memory(app)
    let peakWorkingSetMiB = 0
    let peakUtilityMiB = 0
    const inspect = (rows) => {
      peakWorkingSetMiB = Math.max(
        peakWorkingSetMiB,
        rows.reduce((total, p) => total + p.workingSetMiB, 0)
      )
      for (const p of rows.filter((p) => p.type === 'Utility' && p.name.includes('MyMap')))
        peakUtilityMiB = Math.max(peakUtilityMiB, p.workingSetMiB)
    }
    inspect(baseline)
    const started = performance.now()
    let finished = false
    const importing = page
      .evaluate((id) => window.myMap.importPhotos(id), trip.id)
      .finally(() => {
        finished = true
      })
    // Await a single sample at a time. The import promise settles independently of the sample interval.
    const polling = (async () => {
      while (!finished) {
        inspect(await memory(app))
        await pause(200)
      }
    })()
    try {
      await importing
    } finally {
      finished = true
    }
    const elapsedMs = round(performance.now() - started)
    await polling
    const result = await page.evaluate(async () => {
      const progress = await window.myMap.importProgress()
      const snapshot = await window.myMap.snapshot()
      return {
        imported: progress.imported,
        errors: progress.errors.length,
        attachments: snapshot.attachments.length,
        dimensionsOk: snapshot.photos.every((p) => p.width === 4000 && p.height === 3000)
      }
    })
    if (result.imported !== 300 || result.attachments !== 300 || result.errors || !result.dimensionsOk)
      throw Error('Incomplete 12 MP camera import: ' + JSON.stringify(result))
    return {
      elapsedMs,
      photosPerSecond: round(300000 / elapsedMs),
      baseline,
      after: await memory(app),
      peakWorkingSetMiB: round(peakWorkingSetMiB),
      peakLibraryUtilityMiB: round(peakUtilityMiB),
      ...result
    }
  })
}

// Start at the DOM input/click event and stop on an animation frame where the requested
// content is available. Excludes Playwright click stability waits and cross-process polling.
async function actionToReady(page, action, value = '') {
  return page.evaluate(
    async ({ action, value }) => {
      const tiles = () => [...document.querySelectorAll('.photo-tile')]
      const caption = (tile) => tile?.querySelector('.photo-tile-meta strong')?.textContent || ''
      const current = () => document.querySelector('.lightbox-stage img')
      const prev = action === 'step' ? current()?.src : caption(tiles()[0])
      const began = performance.now()
      const button = (selector) => {
        const target = document.querySelector(selector)
        if (!target || target.disabled) throw Error('Unavailable benchmark target: ' + selector)
        target.click()
      }
      if (action === 'open')
        [...document.querySelectorAll('.nav-item')].find((e) => e.textContent.includes('照片馆')).click()
      if (action === 'nextPage') button('.gallery-pagination button:last-child')
      if (action === 'detail') button('.photo-tile')
      if (action === 'step') button('.lightbox-next')
      if (action === 'search') {
        const input = document.querySelector('[aria-label="搜索照片说明"]')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const loaded = (image) => image?.complete && image.naturalWidth > 0
      const tileLoaded = (tile) => loaded(tile.querySelector('img'))
      let firstRowMs
      for (;;) {
        await new Promise((done) => requestAnimationFrame(done))
        const elapsed = performance.now() - began
        if (elapsed > 15000) throw Error('Timed out waiting for ' + action + ': ' + value)
        if (action === 'detail' || action === 'step') {
          const image = current()
          if (image && loaded(image) && (action === 'detail' || image.src !== prev)) {
            await image.decode()
            return { readyMs: performance.now() - began, visibleCount: 1 }
          }
          continue
        }
        const cards = tiles()
        const text = caption(cards[0])
        if (!cards.length || (action === 'nextPage' && text === prev)) continue
        if (action === 'search' && (value ? !text.includes(value) : !text.includes('0000'))) continue
        const firstTop = cards[0].getBoundingClientRect().top
        const top = cards.filter((card) => Math.abs(card.getBoundingClientRect().top - firstTop) < 2)
        const shown = cards.filter((card) => {
          const r = card.querySelector('.photo-tile-image').getBoundingClientRect()
          return r.bottom > 0 && r.top < innerHeight
        })
        if (firstRowMs === undefined && top.length && top.every(tileLoaded)) {
          await Promise.all(top.map((tile) => tile.querySelector('img').decode()))
          firstRowMs = performance.now() - began
        }
        if (firstRowMs !== undefined && shown.length && shown.every(tileLoaded)) {
          await Promise.all(shown.map((tile) => tile.querySelector('img').decode()))
          return {
            readyMs: performance.now() - began,
            firstRowMs,
            firstRowCount: top.length,
            visibleCount: shown.length
          }
        }
      }
    },
    { action, value }
  )
}

function distribution(samples) {
  const ordered = [...samples].sort((a, b) => a - b)
  return {
    samplesMs: samples.map(round),
    p50Ms: round(ordered[Math.ceil(ordered.length * 0.5) - 1]),
    p95Ms: round(ordered[Math.ceil(ordered.length * 0.95) - 1])
  }
}

async function benchmarkGalleryUi(build, fixture) {
  const library = join(fixture, 'Library')
  const db = join(library, 'library.sqlite')
  const seed = join(fixture, 'seed.sqlite')
  // The caller has checked this private synthetic fixture. Every round gets identical bytes,
  // including after a failed previous pass; the read-only media files are shared.
  if (existsSync(join(library, '.mymap.lock')) || existsSync(db + '-wal')) {
    // An interrupted benchmark can leave a stale process lock or SQLite journal.
    // The production service recovers dead owners and refuses active ones.
    const { LibraryService } = require(join(build, 'src/backend/library.ts'))
    new LibraryService(library).close()
    if (existsSync(join(library, '.mymap.lock')) || existsSync(db + '-wal')) throw Error('Fixture is open')
  }
  copyFileSync(seed, db)
  return usingApp(build, library, async (app, page) => {
    const cadence = await frameCadence(app, page)
    const startup = await counts(app)
    const opened = await actionToReady(page, 'open')
    const memoryAfterOpen = await memory(app)
    const search = [],
      pagination = [],
      next = [],
      save = []
    for (let i = 0; i < 20; i++)
      search.push((await actionToReady(page, 'search', '路线 ' + String(i).padStart(2, '0'))).readyMs)
    await actionToReady(page, 'search', '')
    for (let i = 0; i < 20; i++) pagination.push((await actionToReady(page, 'nextPage')).readyMs)
    const memoryAfterPagination = await memory(app)
    await actionToReady(page, 'detail')
    for (let i = 0; i < 20; i++) next.push((await actionToReady(page, 'step')).readyMs)
    const beforeSave = await counts(app)
    const captions = []
    const field = page.getByRole('textbox', { name: '照片说明', exact: true })
    for (let i = 0; i < 20; i++) {
      const caption = (await field.inputValue()) + ' · 保存测量'
      captions.push(caption)
      await field.fill(caption)
      save.push((await actionToReady(page, 'step')).readyMs)
    }
    const afterSave = await counts(app)
    // Verification consumes one additional snapshot, outside the observed measurements.
    const persisted = await page.evaluate(async () =>
      (await window.myMap.snapshot()).attachments.map((a) => a.caption)
    )
    if (captions.some((caption) => !persisted.includes(caption))) throw Error('Lost a measured photo draft')
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('HeapProfiler.collectGarbage')
    const heap = await cdp.send('Runtime.getHeapUsage')
    return {
      startup,
      saveIncrement: Object.fromEntries(
        Object.keys(beforeSave).map((key) => [key, afterSave[key] - beforeSave[key]])
      ),
      opened,
      search: distribution(search),
      pagination: distribution(pagination),
      next: distribution(next),
      save: distribution(save),
      memoryAfterOpen,
      memoryAfterPagination,
      memoryAfterGc: await memory(app),
      rendererUsedMiB: round(heap.usedSize / 2 ** 20),
      viewport: await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio
      })),
      electron: await app.evaluate(() => process.versions.electron),
      gpu: 'disabled',
      cadence
    }
  })
}

module.exports = { benchmarkCamera, benchmarkGalleryUi, usingApp, frameCadence }
