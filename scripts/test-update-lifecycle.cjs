// Build and upgrade a separately named NSIS fixture. Production app IDs/libraries are never used.
require('tsx/cjs')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const net = require('node:net')
const { spawn, execFileSync } = require('node:child_process')
const { chromium } = require('@playwright/test')
const sharp = require('sharp')
const yaml = require('js-yaml')
const { createHash } = require('node:crypto')
const { LibraryService } = require('../src/backend/library.ts')
const { writeReport } = require('./lib/artifacts.cjs')

const workspace = fs.realpathSync('.')
fs.mkdirSync(path.join(workspace, 'test-results'), { recursive: true })
const reuse = process.argv[2] === '--reuse' ? fs.realpathSync(process.argv[3]) : undefined
if (
  reuse &&
  (path.dirname(reuse) !== path.join(workspace, 'test-results') ||
    !path.basename(reuse).startsWith('update-lifecycle-'))
)
  throw Error('Unexpected fixture reuse path')
const root = reuse || fs.mkdtempSync(path.join(workspace, 'test-results/update-lifecycle-'))
const profile = path.join(root, '独立测试资料')
const installDir = path.join(root, 'installed')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const cleanEnv = { ...process.env }
delete cleanEnv.ELECTRON_RUN_AS_NODE
delete cleanEnv.MYMAP_EXECUTABLE
for (const key of ['MYMAP_UPDATE_TEST_URL', 'MYMAP_UPDATE_TEST_ROOT', 'MYMAP_UPDATE_TEST_DEBUG_PORT'])
  delete cleanEnv[key]
function run(file, args, env = cleanEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      cwd: workspace,
      env,
      stdio: 'inherit',
      windowsHide: true
    })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(Error(`Build tool exited ${code}: ${file}`))
    )
  })
}
async function port() {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const value = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return value
}
async function waitFor(operation, timeout = 60000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try {
      const result = await operation()
      if (result) return result
    } catch (error) {
      last = error
    }
    await delay(200)
  }
  throw Error(`Update fixture timed out: ${last?.message || 'condition not met'}`)
}
async function main() {
  let browser,
    installedApp,
    child,
    server,
    restored = false
  const report = {
    generatedAtUtc: new Date().toISOString(),
    fixture:
      'Separate MyMapUpdateTest app ID, installation folder and compiled-in test library; loopback update server; production builds restored afterwards.'
  }
  try {
    const requests = []
    let feedOnline = true,
      slowDownload = false,
      slowBytes = 0,
      slowClosed = false
    let manifest, installer
    server = http.createServer((request, response) => {
      const name = new URL(request.url, 'http://127.0.0.1').pathname.slice(1)
      requests.push(name)
      if (!feedOnline) {
        response.destroy()
        return
      }
      if (name === 'latest.yml' && manifest) {
        response.writeHead(200, { 'Content-Type': 'text/yaml', 'Cache-Control': 'no-store' })
        response.end(manifest)
        return
      }
      if (name !== 'MyMapUpdateTest-0.0.2.exe' || !installer) {
        response.writeHead(404)
        response.end()
        return
      }
      response.writeHead(200, {
        'Content-Length': fs.statSync(installer).size,
        'Content-Type': 'application/octet-stream'
      })
      const stream = fs.createReadStream(installer, { highWaterMark: 256 * 1024 })
      const throttled = slowDownload
      response.on('close', () => {
        if (throttled) slowClosed = true
        stream.destroy()
      })
      if (throttled)
        void (async () => {
          for await (const chunk of stream) {
            if (response.destroyed) return
            response.write(chunk)
            slowBytes += chunk.length
            await delay(100)
          }
          response.end()
        })().catch(() => response.destroy())
      else stream.pipe(response)
    })
    const oldFeed = reuse
      ? JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')).publish.url
      : undefined
    await new Promise((resolve) =>
      server.listen(oldFeed ? Number(new URL(oldFeed).port) : 0, '127.0.0.1', resolve)
    )
    const feed = `http://127.0.0.1:${server.address().port}/`
    const oldMain = reuse
      ? require('@electron/asar')
          .extractFile(
            path.join(root, '0.0.1/win-unpacked/resources/app.asar'),
            path.join('out', 'main', 'index.js')
          )
          .toString()
      : undefined
    const debugPort = oldMain
      ? /appendSwitch\("remote-debugging-port", "(\d+)"\)/.exec(oldMain)[1]
      : String(await port())
    const env = {
      ...cleanEnv,
      MYMAP_UPDATE_TEST_URL: feed,
      MYMAP_UPDATE_TEST_ROOT: profile,
      MYMAP_UPDATE_TEST_DEBUG_PORT: debugPort
    }
    if (!reuse || process.argv.includes('--rebuild-a'))
      await run('node_modules/electron-vite/bin/electron-vite.js', ['build'], env)
    const base = require('../package.json').build
    for (const version of reuse
      ? process.argv.includes('--rebuild-a')
        ? ['0.0.1']
        : []
      : ['0.0.1', '0.0.2']) {
      const output = path.join(root, version)
      const config = {
        ...base,
        compression: 'normal',
        appId: 'com.lisalsj.mymap.update-test',
        productName: 'MyMapUpdateTest',
        directories: { output },
        extraMetadata: { version, name: 'mymap-update-test' },
        publish: { provider: 'generic', url: feed },
        nsis: {
          ...base.nsis,
          artifactName: 'MyMapUpdateTest-${version}.exe',
          createDesktopShortcut: false,
          createStartMenuShortcut: false,
          runAfterFinish: false
        }
      }
      const configPath = path.join(root, 'config.json')
      fs.writeFileSync(configPath, JSON.stringify(config))
      await run(
        'node_modules/electron-builder/cli.js',
        ['--win', 'nsis', '--x64', '--publish', 'never', '--config', configPath],
        env
      )
    }
    installer = path.join(root, '0.0.2/MyMapUpdateTest-0.0.2.exe')
    const properManifest = fs.readFileSync(path.join(root, '0.0.2/latest.yml'), 'utf8')
    const corrupt = yaml.load(properManifest)
    corrupt.files[0].sha512 = Buffer.alloc(64).toString('base64')
    corrupt.sha512 = corrupt.files[0].sha512
    manifest = yaml.dump(corrupt)
    const image = path.join(root, '虚构照片.png')
    await sharp({ create: { width: 64, height: 48, channels: 3, background: '#2e5d4b' } })
      .png()
      .toFile(image)
    const library = new LibraryService(path.join(profile, 'Library'))
    const trip = library.saveTrip({ title: '更新后仍在的旅行' })
    const entry = library.saveEntry({
      tripId: trip.id,
      title: '更新后的手记',
      markdown: '原图与文字保存在独立验收资料库。'
    })
    await library.importPhotos([image], trip.id, {}, () => {})
    const photoHash = library.snapshot().photos[0].hash
    library.close()
    const setup = path.join(root, '0.0.1/MyMapUpdateTest-0.0.1.exe')
    console.log('Installing isolated update fixture A')
    await new Promise((resolve, reject) => {
      const setupChild = spawn(setup, ['/S', `/D=${installDir}`], {
        env: cleanEnv,
        windowsHide: true,
        windowsVerbatimArguments: true,
        stdio: 'ignore'
      })
      setupChild.once('error', reject)
      setupChild.once('exit', (code) =>
        code === 0 ? resolve() : reject(Error(`Fixture installer exited ${code}`))
      )
    })
    const executable = path.join(installDir, 'MyMapUpdateTest.exe')
    child = spawn(executable, [], {
      env: { ...cleanEnv, MYMAP_TEST_HEADLESS: '1' },
      stdio: 'pipe',
      windowsHide: true
    })
    child.on('error', (error) => {
      console.error(error)
    })
    child.stdout.on('data', (chunk) => process.stdout.write(chunk))
    child.stderr.on('data', (chunk) => process.stderr.write(chunk))
    browser = await waitFor(async () =>
      chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 1000 })
    )
    const initialContext = browser.contexts()[0]
    let page = initialContext.pages()[0] || (await initialContext.waitForEvent('page', { timeout: 30000 }))
    await page.getByRole('button', { name: '新建旅行', exact: true }).first().waitFor()
    await page.evaluate(() => window.myMap.setUpdateChecks(false))
    if (requests.length) throw Error('Updater contacted the server before user consent or a manual check')
    report.noRequestsBeforeManualCheck = true
    console.log('Checking disconnected update feed and download cancellation')
    feedOnline = false
    if ((await page.evaluate(() => window.myMap.checkForUpdates())).stage !== 'error')
      throw Error('Disconnected update feed did not report an error')
    report.disconnectedFeedReported = true
    feedOnline = true
    await page.evaluate(() => window.myMap.checkForUpdates())
    slowDownload = true
    const cancelledDownload = page.evaluate(() => window.myMap.downloadUpdate())
    await waitFor(() => slowBytes > 0)
    await page.evaluate(() => window.myMap.cancelUpdateDownload())
    if ((await cancelledDownload).stage !== 'available') throw Error('Cancelled download was not retryable')
    await waitFor(() => slowClosed)
    if (slowBytes >= fs.statSync(installer).size) throw Error('Cancellation did not stop the file transfer')
    report.downloadCancellationVerified = true
    slowDownload = false
    console.log('Checking real downloaded-file checksum rejection')
    const invalid = await page.evaluate(() => window.myMap.downloadUpdate())
    if (invalid.stage !== 'error') throw Error('Corrupted checksum was accepted')
    report.corruptDownloadRejected = true
    manifest = properManifest
    await page.evaluate(() => window.myMap.checkForUpdates())
    console.log('Downloading and installing fixture B through the actual application IPC')
    const downloaded = await page.evaluate(() => window.myMap.downloadUpdate())
    if (downloaded.stage !== 'ready')
      throw Error(`Valid update did not reach ready: ${JSON.stringify(downloaded)}`)
    const before = await page.evaluate(() => window.myMap.snapshot())
    if (
      !before.photos.some((photo) => photo.hash === photoHash) ||
      !before.entries.some((item) => item.id === entry.id)
    )
      throw Error('Fixture data changed before installation')
    await page
      .evaluate(() => window.myMap.installUpdate())
      .catch((error) => {
        if (!/closed|destroyed|Target/i.test(error.message)) throw error
      })
    await browser.close().catch(() => {})
    browser = undefined
    await waitFor(() => {
      try {
        const archive = path.join(installDir, 'resources/app.asar')
        // NSIS replaces this path in place; ASAR caches its header by pathname.
        const asar = require('@electron/asar')
        asar.uncache(archive)
        return JSON.parse(asar.extractFile(archive, 'package.json').toString()).version === '0.0.2'
      } catch {
        return false
      }
    }, 90000)
    const processEnv = { ...cleanEnv, MYMAP_TEST_INSTALL_PATH: executable }
    const processQuery =
      "@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:MYMAP_TEST_INSTALL_PATH -and $_.CommandLine -like '*--updated*' -and $_.CommandLine -notlike '*--type=*' } | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json"
    await waitFor(() => {
      const json = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', processQuery],
        { env: processEnv, windowsHide: true, encoding: 'utf8' }
      ).trim()
      return json && JSON.parse(json)
    }, 30000)
    report.automaticRelaunchProcessObserved = true
    // NSIS starts via Explorer, outside the original CDP connection. Reopen the installed
    // binary with Playwright for deterministic post-upgrade data assertions on CI desktops.
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:MYMAP_TEST_INSTALL_PATH } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }'
      ],
      { env: processEnv, windowsHide: true }
    )
    const { _electron: electron } = require('@playwright/test')
    installedApp = await electron.launch({
      executablePath: executable,
      args: [],
      env: { ...cleanEnv, MYMAP_TEST_ROOT: profile, MYMAP_TEST_HEADLESS: '1' }
    })
    page = await installedApp.firstWindow()
    await page.getByRole('button', { name: '新建旅行', exact: true }).first().waitFor()
    if ((await page.evaluate(() => window.myMap.updateState())).currentVersion !== '0.0.2')
      throw Error('Installed application did not report the target version')
    const after = await page.evaluate(() => window.myMap.snapshot())
    if (
      !after.trips.some((item) => item.id === trip.id) ||
      after.entries.find((item) => item.id === entry.id)?.markdown !== entry.markdown ||
      !after.photos.some((photo) => photo.hash === photoHash)
    )
      throw Error('Library contents changed during update')
    if ((await page.evaluate(() => window.myMap.updateState())).enabled !== false)
      throw Error('Update preference did not survive installation')
    const preservedPhoto = after.photos.find((photo) => photo.hash === photoHash)
    const originalHash = createHash('sha256')
      .update(fs.readFileSync(path.join(profile, 'Library', preservedPhoto.originalPath)))
      .digest('hex')
    if (originalHash !== photoHash) throw Error('Original photograph changed during installation')
    report.actualInstalledVersions = ['0.0.1', '0.0.2']
    report.libraryAndOriginalsPreserved = true
    report.preferencePreserved = true
    report.onlyRequestedFeedFiles = requests.every(
      (name) => name === 'latest.yml' || name === 'MyMapUpdateTest-0.0.2.exe'
    )
    await installedApp.close()
    installedApp = undefined
    await delay(1000)
    const uninstaller = path.join(installDir, 'Uninstall MyMapUpdateTest.exe')
    if (path.dirname(fs.realpathSync(uninstaller)) !== installDir || !installDir.startsWith(root + path.sep))
      throw Error('Unexpected fixture uninstaller')
    execFileSync(uninstaller, ['/S'], { env: cleanEnv, windowsHide: true, timeout: 60000, stdio: 'ignore' })
    report.uninstallKeptTestLibrary = fs.existsSync(path.join(profile, 'Library/library.sqlite'))
    if (!report.uninstallKeptTestLibrary) throw Error('Uninstaller removed the test library')
    report.status = 'passed'
  } catch (error) {
    report.status = 'failed'
    report.error = String(error)
    throw error
  } finally {
    await installedApp?.close().catch(() => {})
    await browser?.close().catch(() => {})
    child?.kill()
    server?.closeAllConnections()
    await new Promise((resolve) => server?.close(resolve) || resolve())
    console.log('Restoring production build (no test feed or test profile)')
    await run('node_modules/electron-vite/bin/electron-vite.js', ['build'])
    restored = true
    report.productionBuildRestored = restored
    writeReport('update-lifecycle', report)
  }
  console.log(JSON.stringify(report, null, 2))
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
