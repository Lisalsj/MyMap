/**
 * Run from the repository root after `npm run build`:
 *   npx tsx scripts/benchmark-map.ts
 *   $env:MYMAP_EXECUTABLE='D:\\...\\MyMap.exe'; npx tsx scripts/benchmark-map.ts
 *
 * Uses a fresh temporary profile and synthetic records. It shows its own Electron
 * window for foreground GPU measurements, closes it, then removes only that profile.
 */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { cpus, platform, release, tmpdir } from 'node:os'
import { performance } from 'node:perf_hooks'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import { LibraryService } from '../src/backend/library'
import { loadCities } from '../src/shared/cities'
import type { City } from '../src/shared/types'
import { createSnapshotIndex, getSnapshotIndex, matchingTrips } from '../src/renderer/model'
import {
  buildCityLights,
  selectEligibleVisits,
  type BoundaryFeature,
  type BoundaryIndex
} from '../src/renderer/map/domain'

const repository = resolve('.')
const appVersion = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')).version
const profilePrefix = 'mymap-map-benchmark-'
const reportPath = join(repository, `docs/reports/map-performance-v${appVersion}.json`)
const screenshotDirectory = join(repository, `docs/screenshots/v${appVersion}`)
const tripCount = 100
const visitsPerTrip = 50
const durationMs = 3000
const interactionTrials = 3
const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))
const round = (value: number) => Math.round(value * 1000) / 1000
let interrupted = false
const onInterrupt = () => {
  interrupted = true
}
const checkInterrupted = () => {
  if (interrupted) throw new Error('Benchmark interrupted')
}

function summary(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const percentile = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]
  return {
    samples: sorted.length,
    p50Ms: sorted.length ? round(percentile(0.5)) : null,
    p95Ms: sorted.length ? round(percentile(0.95)) : null,
    maxMs: sorted.length ? round(sorted.at(-1)!) : null,
    over50Ms: sorted.filter((value) => value > 50).length
  }
}

function measureSync(operation: () => unknown, samples = 60, warmups = 10) {
  for (let index = 0; index < warmups; index++) operation()
  const durations: number[] = []
  for (let index = 0; index < samples; index++) {
    const started = performance.now()
    operation()
    durations.push(performance.now() - started)
  }
  return { warmups, ...summary(durations) }
}

function readAtlas() {
  const boundariesPath = join(repository, 'src/renderer/assets/china-cities.topo.json')
  const indexPath = join(repository, 'src/renderer/assets/china-city-index.json')
  const boundaryBytes = readFileSync(boundariesPath)
  const indexBytes = readFileSync(indexPath)
  const topology = JSON.parse(boundaryBytes.toString('utf8')) as Topology<{ cities: GeometryCollection }>
  const index = JSON.parse(indexBytes.toString('utf8')) as BoundaryIndex
  const regions = (feature(topology, topology.objects.cities) as unknown as { features: BoundaryFeature[] })
    .features
  return {
    index,
    regions,
    hashes: {
      boundariesSha256: createHash('sha256').update(boundaryBytes).digest('hex'),
      concordanceSha256: createHash('sha256').update(indexBytes).digest('hex')
    }
  }
}

function seedCities(index: BoundaryIndex): City[] {
  const cities = loadCities(join(repository, 'resources')).filter(
    (city) => city.country === 'CN' && typeof index.geonames[city.id.replace(/^geonames:/, '')] === 'string'
  )
  const preferredIds = ['geonames:1808926', 'geonames:1816670', 'geonames:1796236', 'geonames:1814906']
  const preferred = preferredIds.flatMap((id) => cities.filter((city) => city.id === id))
  const ordered = [
    ...preferred,
    ...cities.sort((a, b) => b.population - a.population || a.id.localeCompare(b.id))
  ]
  const seen = new Set<string>()
  const seeds = ordered
    .filter((city) => {
      const boundary = index.geonames[city.id.replace(/^geonames:/, '')]
      if (seen.has(boundary)) return false
      seen.add(boundary)
      return true
    })
    .slice(0, 24)
  if (seeds.length < 2) throw new Error('Need at least two distinct mapped cities in the bundled atlas')
  return seeds
}

function seedLibrary(library: LibraryService, seeds: readonly City[]) {
  let lastPlaceName = ''
  for (let tripIndex = 0; tripIndex < tripCount; tripIndex++) {
    checkInterrupted()
    const trip = library.saveTrip({
      title: `合成性能测试 · 旅行 ${String(tripIndex + 1).padStart(3, '0')}`,
      description: 'Synthetic benchmark fixture; these records are not personal travel history.',
      tags: ['合成性能测试'],
      startDate: '2025-01-01',
      endDate: '2025-12-31'
    })
    for (let stopIndex = 0; stopIndex < visitsPerTrip; stopIndex++) {
      const number = tripIndex * visitsPerTrip + stopIndex
      const city = seeds[number % seeds.length]
      lastPlaceName = `合成停留 ${String(number).padStart(5, '0')} · ${city.name}`
      const unlocated = number % 10 === 0
      library.saveVisit({
        tripId: trip.id,
        name: lastPlaceName,
        kind: 'scenic',
        cityId: city.id,
        cityName: city.name,
        country: city.country,
        lat: unlocated ? null : city.lat,
        lon: unlocated ? null : city.lon,
        date: `2025-06-${String((stopIndex % 28) + 1).padStart(2, '0')}`,
        note: 'Synthetic stop at a bundled city center; every tenth stop is deliberately unlocated.'
      })
    }
  }
  return lastPlaceName
}

// Plain JavaScript text avoids transpiler helpers in Playwright's browser context.
// Frames collect numbers only. The observer counts d writes without reading path strings.
const installProbe = String.raw`(() => {
  let current;
  const api = {
    start() {
      if (current) throw new Error('A map probe is already running');
      const base = document.querySelector('.map-base-layer');
      if (!base) throw new Error('Map base layer is missing');
      const viewport = base.parentElement;
      const state = { start: performance.now(), previous: null, intervals: [], longTasks: [],
        pathDWrites: 0, viewportTransformWrites: 0, pointerMoves: 0, wheelEvents: 0,
        base, viewport, frame: 0, startTransform: viewport.getAttribute('transform') };
      const mutations = records => {
        for (const record of records) {
          if (record.attributeName === 'd') state.pathDWrites++;
          if (record.target === viewport && record.attributeName === 'transform') state.viewportTransformWrites++;
        }
      };
      state.mutations = new MutationObserver(mutations);
      state.mutations.observe(base, { subtree: true, attributes: true, attributeFilter: ['d'] });
      state.mutations.observe(viewport, { attributes: true, attributeFilter: ['transform'] });
      state.longTaskSupported = typeof PerformanceObserver !== 'undefined' &&
        PerformanceObserver.supportedEntryTypes.includes('longtask');
      if (state.longTaskSupported) {
        state.performance = new PerformanceObserver(list => {
          for (const entry of list.getEntries())
            if (entry.startTime >= state.start) state.longTasks.push(entry.duration);
        });
        state.performance.observe({ type: 'longtask', buffered: false });
      }
      state.pointer = () => state.pointerMoves++;
      state.wheel = () => state.wheelEvents++;
      const svg = document.querySelector('.footprint-map > svg');
      svg.addEventListener('pointermove', state.pointer, true);
      svg.addEventListener('wheel', state.wheel, true);
      state.svg = svg;
      const tick = timestamp => {
        if (state.previous !== null) state.intervals.push(timestamp - state.previous);
        state.previous = timestamp;
        state.frame = requestAnimationFrame(tick);
      };
      current = state;
      state.frame = requestAnimationFrame(tick);
    },
    stop() {
      const state = current;
      if (!state) throw new Error('No map probe is running');
      cancelAnimationFrame(state.frame);
      for (const record of state.mutations.takeRecords()) {
        if (record.attributeName === 'd') state.pathDWrites++;
        if (record.target === state.viewport && record.attributeName === 'transform') state.viewportTransformWrites++;
      }
      state.mutations.disconnect();
      if (state.performance) {
        for (const entry of state.performance.takeRecords())
          if (entry.startTime >= state.start) state.longTasks.push(entry.duration);
        state.performance.disconnect();
      }
      state.svg.removeEventListener('pointermove', state.pointer, true);
      state.svg.removeEventListener('wheel', state.wheel, true);
      current = undefined;
      return { measuredMs: performance.now() - state.start, intervals: state.intervals,
        longTasks: state.longTasks, longTaskSupported: state.longTaskSupported,
        pathDWrites: state.pathDWrites, viewportTransformWrites: state.viewportTransformWrites,
        pointerMoves: state.pointerMoves, wheelEvents: state.wheelEvents,
        baseLayerRetained: state.base === document.querySelector('.map-base-layer'),
        startTransform: state.startTransform, endTransform: state.viewport.getAttribute('transform'),
        visibilityState: document.visibilityState, hasFocus: document.hasFocus() };
    }
  };
  window.__myMapBenchmark = api;
})()`

interface ProbeResult {
  measuredMs: number
  intervals: number[]
  longTasks: number[]
  longTaskSupported: boolean
  pathDWrites: number
  viewportTransformWrites: number
  pointerMoves: number
  wheelEvents: number
  baseLayerRetained: boolean
  startTransform: string | null
  endTransform: string | null
  visibilityState: string
  hasFocus: boolean
}
const settleFrames = (page: Page) =>
  page.evaluate('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))')

async function freeMapPoint(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate(() => {
    const svg = document.querySelector('.footprint-map > svg')!
    const rect = svg.getBoundingClientRect()
    for (const fy of [0.5, 0.6, 0.7, 0.4]) {
      for (const fx of [0.5, 0.4, 0.6, 0.3, 0.7]) {
        const x = rect.left + rect.width * fx,
          y = rect.top + rect.height * fy
        const target = document.elementFromPoint(x, y)
        if (target?.closest('svg') === svg && !target.closest('.map-city-label,.map-marker'))
          return { x, y, width: rect.width, height: rect.height }
      }
    }
    throw new Error('No unobstructed SVG point is available for a real mouse drag')
  })
}

async function measureInteraction(page: Page, kind: 'drag' | 'zoom') {
  await page.getByRole('button', { name: '重置地图', exact: true }).click()
  await settleFrames(page)
  const anchor = await freeMapPoint(page)
  await page.mouse.move(anchor.x, anchor.y)
  await page.evaluate('window.__myMapBenchmark.start()')
  let mouseDown = false
  const started = performance.now()
  try {
    if (kind === 'drag') {
      await page.mouse.down()
      mouseDown = true
    }
    while (performance.now() - started < durationMs) {
      checkInterrupted()
      const frameStarted = performance.now()
      const elapsed = frameStarted - started
      if (kind === 'drag') {
        const angle = (elapsed / 1500) * Math.PI * 2
        await page.mouse.move(
          anchor.x + Math.sin(angle) * Math.min(85, anchor.width * 0.12),
          anchor.y + (Math.cos(angle) - 1) * Math.min(35, anchor.height * 0.07)
        )
      } else {
        await page.mouse.wheel(0, Math.floor(elapsed / 750) % 2 === 0 ? -12 : 12)
      }
      await delay(Math.max(0, 1000 / 60 - (performance.now() - frameStarted)))
    }
  } finally {
    if (mouseDown) await page.mouse.up()
  }
  const inputDurationMs = performance.now() - started
  await settleFrames(page)
  const result = await page.evaluate<ProbeResult>('window.__myMapBenchmark.stop()')
  if (!result.baseLayerRetained || result.pathDWrites !== 0)
    throw new Error(`${kind}: cached base geometry changed during viewport interaction`)
  if (
    result.viewportTransformWrites === 0 ||
    (kind === 'drag' ? result.pointerMoves === 0 : result.wheelEvents === 0)
  )
    throw new Error(`${kind}: input did not produce viewport changes`)
  if (result.visibilityState !== 'visible' || !result.hasFocus)
    throw new Error(`${kind}: benchmark window lost foreground visibility/focus`)
  return {
    kind,
    requestedInputDurationMs: durationMs,
    inputDurationMs: round(inputDurationMs),
    sampledDurationMs: round(result.measuredMs),
    rafIntervals: summary(result.intervals),
    longTasks: {
      supported: result.longTaskSupported,
      count: result.longTasks.length,
      over50Ms: result.longTasks.filter((duration) => duration > 50).length,
      maxMs: result.longTasks.length ? round(Math.max(...result.longTasks)) : 0
    },
    pathDWrites: result.pathDWrites,
    viewportTransformWrites: result.viewportTransformWrites,
    pointerMoves: result.pointerMoves,
    wheelEvents: result.wheelEvents,
    actualInputEventsPerSecond: round(
      ((kind === 'drag' ? result.pointerMoves : result.wheelEvents) / inputDurationMs) * 1000
    ),
    baseLayerRetained: result.baseLayerRetained,
    visibilityState: result.visibilityState,
    hasFocus: result.hasFocus,
    startTransform: result.startTransform,
    endTransform: result.endTransform
  }
}

function removeOwnTemporaryProfile(profile: string) {
  const target = resolve(profile)
  if (
    dirname(target) !== resolve(tmpdir()) ||
    !basename(target).startsWith(profilePrefix) ||
    lstatSync(target).isSymbolicLink()
  )
    throw new Error(`Refusing cleanup outside this benchmark's temporary directory: ${target}`)
  rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log(
      'Run from the repository root: npx tsx scripts/benchmark-map.ts [--selectors-only]. Optional MYMAP_EXECUTABLE selects a packaged MyMap.exe. Shows an independent benchmark window; writes the versioned map performance report and screenshots.'
    )
    return
  }
  const selectorsOnly = process.argv.includes('--selectors-only')
  const report: Record<string, unknown> = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    status: 'running',
    command: 'npx tsx scripts/benchmark-map.ts' + (selectorsOnly ? ' --selectors-only' : ''),
    environment: {
      platform: platform(),
      release: release(),
      arch: process.arch,
      node: process.versions.node,
      cpu: cpus()[0]?.model,
      logicalCpuCount: cpus().length,
      appVersion: JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')).version
    },
    methodology: {
      fixture:
        'Synthetic 100 trips × 50 distinct scenic stops; bundled mapped city centers, 24 distinct city regions when available; every tenth stop deliberately has no coordinate. No photos.',
      startup:
        'Fresh Electron process and isolated profile; filesystem/OS caches are uncontrolled. Map readiness includes local atlas decode, geometry and two animation frames.',
      interaction:
        'Foreground visible Electron window, default GPU settings, three 3-second real mouse drags and three 3-second real wheel sequences, targeting 60 input events/second.',
      frames:
        'requestAnimationFrame deltas include compositor and renderer scheduling; not a GPU trace or an assertion of presented-frame FPS.',
      geometry:
        'MutationObserver counts writes to base SVG d attributes; never copies path strings per frame. Also verifies the base layer survives and viewport transforms actually change.'
    }
  }
  let profile: string | undefined
  let library: LibraryService | undefined
  let app: ElectronApplication | undefined
  let failed = false
  process.once('SIGINT', onInterrupt)
  process.once('SIGTERM', onInterrupt)
  try {
    const atlas = readAtlas(),
      seeds = seedCities(atlas.index)
    profile = mkdtempSync(join(tmpdir(), profilePrefix))
    const fixtureStarted = performance.now()
    library = new LibraryService(join(profile, 'Library'))
    const searchQuery = seedLibrary(library, seeds)
    const snapshot = library.snapshot()
    if (
      snapshot.trips.length !== tripCount ||
      snapshot.visits.length !== tripCount * visitsPerTrip ||
      snapshot.places.length !== tripCount * visitsPerTrip ||
      snapshot.photos.length
    )
      throw new Error(
        'Synthetic fixture does not contain exactly 100 trips, 5000 visits, 5000 places and zero photos'
      )
    const lights = buildCityLights(selectEligibleVisits(snapshot), atlas.regions, atlas.index)
    if (lights.size !== seeds.length)
      throw new Error('Synthetic fixture did not light all of its mapped seed regions')
    report.fixture = {
      trips: snapshot.trips.length,
      visits: snapshot.visits.length,
      places: snapshot.places.length,
      unlocatedVisits: snapshot.visits.filter(
        (visit) => getSnapshotIndex(snapshot).placeById.get(visit.placeId)?.lat === null
      ).length,
      photos: snapshot.photos.length,
      litCities: lights.size,
      preparationMs: round(performance.now() - fixtureStarted),
      snapshotBytes: Buffer.byteLength(JSON.stringify(snapshot)),
      ...atlas.hashes,
      seeds: seeds.map((city) => ({
        cityId: city.id,
        name: city.name,
        lat: city.lat,
        lon: city.lon,
        boundaryId: atlas.index.geonames[city.id.replace(/^geonames:/, '')]
      }))
    }
    const snapshotTiming = measureSync(() => library!.snapshot(), 20, 3)
    const indexTiming = measureSync(() => createSnapshotIndex(snapshot))
    getSnapshotIndex(snapshot)
    const searchMatches = matchingTrips(snapshot, searchQuery, '2025')
    if (searchMatches.length !== 1)
      throw new Error('Unique synthetic stop search returned the wrong trip count')
    report.selectors = {
      sqliteSnapshot: snapshotTiming,
      indexBuild: indexTiming,
      emptySearch: measureSync(() => matchingTrips(snapshot, '')),
      stopNameSearch: {
        query: searchQuery,
        expectedTrips: 1,
        ...measureSync(() => matchingTrips(snapshot, searchQuery, '2025'))
      },
      cityLights: measureSync(() =>
        buildCityLights(selectEligibleVisits(snapshot), atlas.regions, atlas.index)
      )
    }
    library.close()
    library = undefined
    checkInterrupted()
    if (selectorsOnly) {
      report.status = 'selectors-only'
      return
    }
    if (!process.env.MYMAP_EXECUTABLE && !existsSync(join(repository, 'out/main/index.js')))
      throw new Error('Build the app before running the Electron benchmark: npm run build')
    const env: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined)
      ),
      MYMAP_TEST_ROOT: profile,
      MYMAP_TEST_HEADLESS: '1',
      MYMAP_DEMO: '0'
    }
    delete env.ELECTRON_RUN_AS_NODE
    const started = performance.now()
    app = await electron.launch({
      executablePath: process.env.MYMAP_EXECUTABLE || undefined,
      args: process.env.MYMAP_EXECUTABLE ? [] : [join(repository, 'out/main/index.js')],
      env,
      timeout: 60000
    })
    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setSize(1440, 940)
      window.show()
      window.focus()
    })
    await page.bringToFront()
    await page.waitForFunction(
      (expected) => {
        const holder = document.querySelector('.footprint-map')
        return (
          holder?.getAttribute('aria-busy') === 'false' &&
          document.querySelectorAll('.map-city-region[data-lit="true"]').length === expected
        )
      },
      seeds.length,
      { timeout: 60000 }
    )
    await page.evaluate('document.fonts.ready')
    await settleFrames(page)
    const mapReadyMs = performance.now() - started
    const actual = await page.evaluate(() => window.myMap.snapshot())
    if (actual.trips.length !== tripCount || actual.visits.length !== 5000 || actual.photos.length)
      throw new Error('Electron did not open the isolated synthetic library')
    report.renderer = {
      mapReadyMs: round(mapReadyMs),
      executable: process.env.MYMAP_EXECUTABLE
        ? resolve(process.env.MYMAP_EXECUTABLE)
        : 'node_modules/electron (out/main/index.js)',
      ...(await app.evaluate(({ app, BrowserWindow }) => ({
        electronReportedAppVersion: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        gpuFeatureStatus: app.getGPUFeatureStatus(),
        visible: BrowserWindow.getAllWindows()[0].isVisible(),
        focused: BrowserWindow.getAllWindows()[0].isFocused(),
        windowBounds: BrowserWindow.getAllWindows()[0].getBounds()
      }))),
      ...(await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        devicePixelRatio,
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
        basePathCount: document.querySelectorAll('.map-base-layer path').length,
        renderedMarkers: document.querySelectorAll('.map-marker').length
      })))
    }
    await page.evaluate(installProbe)
    // Initial fill/inspector CSS animations must finish before steady-state sampling.
    await delay(1100)
    await page.evaluate('window.__myMapBenchmark.start()')
    await delay(1000)
    const idle = await page.evaluate<ProbeResult>('window.__myMapBenchmark.stop()')
    const idleFrames = summary(idle.intervals)
    report.idleCalibration = {
      rafIntervals: idleFrames,
      estimatedRefreshHz: idleFrames.p50Ms ? round(1000 / idleFrames.p50Ms) : null,
      visibilityState: idle.visibilityState,
      hasFocus: idle.hasFocus
    }
    const interactions = []
    for (let trial = 1; trial <= interactionTrials; trial++) {
      for (const kind of ['drag', 'zoom'] as const) {
        console.log(`Map benchmark: ${kind} ${trial}/${interactionTrials}`)
        interactions.push({ trial, ...(await measureInteraction(page, kind)) })
      }
    }
    report.interactions = interactions
    mkdirSync(screenshotDirectory, { recursive: true })
    await page.getByRole('button', { name: '重置地图', exact: true }).click()
    await page.evaluate('window.scrollTo(0, 0)')
    await settleFrames(page)
    await page.screenshot({ path: join(screenshotDirectory, 'map-overview.png') })
    const detailId = atlas.index.geonames[seeds[0].id.replace(/^geonames:/, '')]
    await page.locator(`[data-boundary-id="${detailId}"]`).press('Enter')
    await page.getByRole('button', { name: '聚焦这座城市', exact: true }).click()
    // Focusing an SVG path may scroll its owner document; keep the entire map in frame.
    await page.evaluate('window.scrollTo(0, 0)')
    await delay(300)
    await page.screenshot({ path: join(screenshotDirectory, 'map-city-detail.png') })
    report.screenshots = [
      `docs/screenshots/v${appVersion}/map-overview.png`,
      `docs/screenshots/v${appVersion}/map-city-detail.png`
    ]
    report.status = 'complete'
  } catch (error) {
    failed = true
    report.status = 'failed'
    report.error = error instanceof Error ? error.stack : String(error)
    console.error(report.error)
  } finally {
    library?.close()
    if (app) {
      try {
        await app.close()
      } catch (error) {
        failed = true
        report.closeError = String(error)
        app.process().kill()
      }
    }
    if (profile) {
      try {
        removeOwnTemporaryProfile(profile)
        report.temporaryProfileCleaned = !existsSync(profile)
      } catch (error) {
        failed = true
        report.cleanupError = String(error)
      }
    }
    process.off('SIGINT', onInterrupt)
    process.off('SIGTERM', onInterrupt)
    if (failed) {
      report.status = 'failed'
      process.exitCode = interrupted ? 130 : 1
    }
    report.finishedAt = new Date().toISOString()
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log(
      JSON.stringify({
        status: report.status,
        report: reportPath,
        temporaryProfileCleaned: report.temporaryProfileCleaned
      })
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
