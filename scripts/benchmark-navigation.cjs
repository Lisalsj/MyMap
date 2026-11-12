// Real packaged/source navigation measurements using a fictional, disposable library.
const { _electron: electron } = require('@playwright/test')
const { mkdtempSync, realpathSync, rmSync, cpSync, readFileSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { tmpdir, cpus } = require('node:os')
const { join, resolve, dirname, basename } = require('node:path')
const { writeReport } = require('./lib/artifacts.cjs')

async function main() {
  const parent = realpathSync(tmpdir())
  const root = mkdtempSync(join(parent, 'mymap-navigation-'))
  let app
  try {
    const fixtureArg = process.argv.indexOf('--fixture')
    let fixtureSha256
    if (fixtureArg >= 0) {
      const fixture = realpathSync(process.argv[fixtureArg + 1])
      if (dirname(fixture) !== resolve('test-results') || !basename(fixture).startsWith('navigation-fixture'))
        throw Error('Only generated navigation fixtures under test-results may be copied')
      cpSync(fixture, join(root, 'Demo'), { recursive: true })
      fixtureSha256 = createHash('sha256')
        .update(readFileSync(join(root, 'Demo/library.sqlite')))
        .digest('hex')
    }
    const env = { ...process.env, MYMAP_TEST_ROOT: root, MYMAP_TEST_HEADLESS: '0', MYMAP_DEMO: '1' }
    delete env.ELECTRON_RUN_AS_NODE
    const started = performance.now()
    app = await electron.launch({
      executablePath: process.env.MYMAP_EXECUTABLE || undefined,
      args: process.env.MYMAP_EXECUTABLE ? [] : [resolve('out/main/index.js')],
      env
    })
    const processReadyMs = performance.now() - started
    const page = await app.firstWindow()
    const firstWindowMs = performance.now() - started
    const ready = async () => {
      await page.waitForFunction(() => {
        const map = [...document.querySelectorAll('.footprint-map')].find((p) => p.getClientRects().length)
        return map?.getAttribute('aria-busy') === 'false' && map.querySelector('.map-city-region')
      })
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
      )
    }
    await ready()
    const coldReadyMs = performance.now() - started
    const coldTimeline = await page.evaluate(() => ({
      documentStartedAt: performance.timeOrigin,
      navigation: performance.getEntriesByType('navigation').map((entry) => entry.toJSON()),
      resources: performance.getEntriesByType('resource').map((entry) => entry.toJSON())
    }))
    const workerTimeline = await Promise.all(
      page.workers().map((worker) =>
        worker.evaluate(() => ({
          startedAt: performance.timeOrigin,
          measuredAt: performance.now(),
          resources: performance.getEntriesByType('resource').map((entry) => entry.toJSON())
        }))
      )
    )
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')
    const initialDom = await cdp.send('Memory.getDOMCounters')
    await page.evaluate(() => {
      window.__navigationTasks = []
      new PerformanceObserver((list) =>
        window.__navigationTasks.push(
          ...list.getEntries().map((p) => ({ start: p.startTime, duration: p.duration }))
        )
      ).observe({ type: 'longtask' })
      window.__navigationMap = document.querySelector('.footprint-map')
    })
    const samples = []
    const roundsArg = process.argv.indexOf('--rounds'),
      rounds = roundsArg >= 0 ? Number(process.argv[roundsArg + 1]) : 20
    if (!Number.isSafeInteger(rounds) || rounds < 20 || rounds > 200) throw Error('Use 20–200 returns')
    for (let round = 0; round < rounds; round++) {
      await page.getByRole('button', { name: '我的旅行', exact: true }).click()
      await page.locator('.footprint-map:visible').waitFor({ state: 'hidden' })
      await page.evaluate(() => {
        window.__navigationStart = performance.now()
        ;[...document.querySelectorAll('.nav-item')].find((p) => p.textContent.includes('足迹地图')).click()
      })
      await ready()
      const sample = await page.evaluate(() => ({
        readyMs: performance.now() - window.__navigationStart,
        sameMapInstance: document.querySelector('.footprint-map') === window.__navigationMap,
        longTasks: window.__navigationTasks
          .filter((p) => p.start >= window.__navigationStart)
          .map((p) => p.duration)
      }))
      const metrics = (await cdp.send('Performance.getMetrics')).metrics
      const processes = await app.evaluate(({ app }) =>
        app.getAppMetrics().map(({ type, memory }) => ({ type, workingSetKiB: memory.workingSetSize }))
      )
      samples.push({
        ...sample,
        heapBytes: metrics.find((p) => p.name === 'JSHeapUsedSize')?.value,
        totalWorkingSetKiB: processes.reduce((sum, process) => sum + process.workingSetKiB, 0),
        processes
      })
      console.log(`Map return ${round + 1}/${rounds}: ${Math.round(sample.readyMs)}ms`)
    }
    const sorted = samples.map((p) => p.readyMs).sort((a, b) => a - b)
    await page.waitForTimeout(1000)
    await cdp.send('HeapProfiler.collectGarbage')
    const finalDom = await cdp.send('Memory.getDOMCounters')
    const afterCollection = await app.evaluate(({ app }) =>
      app.getAppMetrics().map(({ type, memory }) => ({ type, workingSetKiB: memory.workingSetSize }))
    )
    const report = {
      generatedAtUtc: new Date().toISOString(),
      version: require('../package.json').version,
      executableReportedVersion: await app.evaluate(({ app }) => app.getVersion()),
      environment: {
        platform: process.platform,
        cpu: cpus()[0]?.model,
        defaultGpu: true,
        visibleWindow: true
      },
      method:
        (fixtureSha256 ? 'Identical prepared fictional library; ' : 'Fresh fictional demo library; ') +
        `one cold process launch and ${rounds} returns from trips; two RAFs after map readiness. OS caches uncontrolled. Times are page readiness, not presented FPS. Final memory is collected after 1s idle and a diagnostic renderer GC, outside timing samples.`,
      fixtureSha256,
      coldReadyMs,
      processReadyMs,
      firstWindowMs,
      coldTimeline,
      workerTimeline,
      returnP50Ms: sorted[Math.ceil(rounds * 0.5) - 1],
      returnP95Ms: sorted[Math.ceil(rounds * 0.95) - 1],
      returnMaxMs: sorted.at(-1),
      initialDom,
      finalDom,
      afterCollection,
      samples
    }
    const output = writeReport(
      (process.argv.includes('--baseline') ? 'navigation-baseline' : 'navigation') +
        (fixtureSha256 ? '-prepared' : '') +
        (rounds !== 20 ? '-stress' : ''),
      report
    )
    console.log(
      JSON.stringify({ output, coldReadyMs, p50: report.returnP50Ms, p95: report.returnP95Ms }, null, 2)
    )
  } finally {
    await app?.close().catch(() => app.process().kill())
    if (dirname(root) !== parent || !basename(root).startsWith('mymap-navigation-'))
      throw Error('Unexpected benchmark cleanup path')
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
