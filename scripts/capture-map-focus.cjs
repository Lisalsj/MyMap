// Reproduce pointer and keyboard city focus in an isolated, fictional Wuhu trip.
const { _electron: electron } = require('@playwright/test')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve, basename, dirname } = require('node:path')
const version = require('../package.json').version
const parent = realpathSync(tmpdir()),
  prefix = 'mymap-focus-capture-'
const root = mkdtempSync(join(parent, prefix))
const directory = resolve(`docs/screenshots/v${version}`)
const evidence = []
let app

async function capture(page, scenario) {
  // Let the initial city-light animation and the compositor reach a steady frame.
  await new Promise((done) => setTimeout(done, 850))
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  })
  const data = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64')
  )
  writeFileSync(join(directory, `map-${scenario}.png`), Buffer.from(data, 'base64'))
  const state = await page.locator('.map-city-region[aria-label^="芜湖"]').evaluate((p) => {
    const style = getComputedStyle(p)
    return {
      city: p.getAttribute('aria-label'),
      focused: document.activeElement === p,
      focusVisible: p.matches(':focus-visible'),
      outline: style.outline,
      outlineStyle: style.outlineStyle,
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      vectorEffect: style.vectorEffect,
      selected: p.classList.contains('is-selected'),
      transform: p.closest('.map-viewport').getAttribute('transform')
    }
  })
  evidence.push({ scenario, ...state })
}

async function main() {
  mkdirSync(directory, { recursive: true })
  const env = { ...process.env, MYMAP_TEST_ROOT: root, MYMAP_TEST_HEADLESS: '0', MYMAP_DEMO: '0' }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({
    executablePath: process.env.MYMAP_EXECUTABLE || undefined,
    args: process.env.MYMAP_EXECUTABLE ? [] : [resolve('out/main/index.js')],
    env
  })
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '新建旅行', exact: true }).first().waitFor()
  await page.evaluate(async () => {
    const city = (await window.myMap.cities('芜湖')).find((c) => c.id === 'geonames:1791236')
    if (!city) throw new Error('Missing offline Wuhu fixture')
    const trip = await window.myMap.saveTrip({ title: '城市点击回归' })
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
  const region = page.locator('.map-city-region[aria-label^="芜湖"]')
  await region.waitFor()
  await page.getByRole('button', { name: '芜湖 · 已点亮 · 1 次到访', exact: true }).click()
  await page.getByRole('button', { name: '聚焦这座城市', exact: true }).click()
  await page.getByRole('button', { name: '关闭城市提示', exact: true }).click()
  await region.click({ force: true })
  await capture(page, 'pointer')
  await region.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await capture(page, 'keyboard')
  const report = {
    version,
    electronReportedAppVersion: await app.evaluate(({ app }) => app.getVersion()),
    generatedAtUtc: new Date().toISOString(),
    executable: process.env.MYMAP_EXECUTABLE || 'out/main/index.js',
    fixture:
      'One fictional local trip and one Wuhu city visit; visible Electron window; default GPU; city zoom 15.',
    evidence
  }
  mkdirSync('docs/reports', { recursive: true })
  writeFileSync(`docs/reports/map-focus-v${version}.json`, JSON.stringify(report, null, 2) + '\n')
  if (evidence.some((e) => e.outlineStyle !== 'none' || !e.focused || !e.selected))
    throw new Error('Unexpected city focus/selection state; inspect the recorded evidence')
  if (
    evidence[0].focusVisible ||
    !evidence[1].focusVisible ||
    evidence[1].vectorEffect !== 'non-scaling-stroke'
  )
    throw new Error('Pointer and keyboard focus were not distinguished correctly')
  console.log(JSON.stringify(report, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await app?.close().catch(() => {})
    if (dirname(resolve(root)) !== parent || !basename(root).startsWith(prefix))
      throw new Error('Refusing unexpected capture fixture cleanup')
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
