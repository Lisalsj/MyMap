const { chromium } = require('@playwright/test')
const { spawn } = require('node:child_process')
const { mkdtempSync, writeFileSync, mkdirSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const net = require('node:net')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function freePort() {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}
async function main() {
  const version = require('../package.json').version
  const profile = mkdtempSync(join(tmpdir(), 'mymap-portable-smoke-'))
  const executable = resolve(process.argv[2] || `release/MyMap-${version}-Portable-x64.exe`)
  const elapsed = []
  for (let round = 0; round < 2; round++) {
    const port = await freePort()
    const start = Date.now()
    const env = { ...process.env, MYMAP_TEST_ROOT: profile, MYMAP_TEST_HEADLESS: '1', MYMAP_DEMO: '0' }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(executable, [`--remote-debugging-port=${port}`, '--disable-gpu'], {
      env,
      windowsHide: true,
      stdio: 'ignore'
    })
    const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)))
    let browser
    try {
      let connected = false
      for (let attempt = 0; attempt < 240; attempt++) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/json/version`)
          if (response.ok) {
            connected = true
            break
          }
        } catch {}
        await delay(250)
      }
      if (!connected) throw new Error('Executable did not start its local test debugger')
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
      const context = browser.contexts()[0]
      const page = context.pages()[0] || (await context.waitForEvent('page', { timeout: 30000 }))
      await page.getByRole('button', { name: '新建旅行', exact: true }).first().waitFor()
      const snapshot = await page.evaluate(() => window.myMap.snapshot())
      if (round === 0) await page.evaluate(() => window.myMap.saveTrip({ title: '便携版重启验证' }))
      else if (snapshot.trips.length !== 1 || snapshot.trips[0].title !== '便携版重启验证')
        throw new Error('Executable restart did not retain its local library')
      const offline = await page.evaluate(async () => {
        try {
          await fetch('https://example.com/')
          return false
        } catch {
          return true
        }
      })
      if (!offline) throw new Error('Distributed application allowed an external network request')
      elapsed.push(Date.now() - start)
      await page.evaluate(() => window.close()).catch(() => {})
      const exitCode = await Promise.race([
        exited,
        delay(30000).then(() => {
          throw new Error('Executable did not close cleanly')
        })
      ])
      if (exitCode !== 0) throw new Error(`Executable exited with ${exitCode}`)
    } finally {
      await browser?.close().catch(() => {})
      if (child.exitCode === null) child.kill()
    }
  }
  const report = {
    date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }),
    version,
    executable: require('node:path').basename(executable),
    launches: 2,
    launchAndUiReadyMs: elapsed,
    persistence: 'passed',
    externalNetworkBlocked: true,
    cleanExit: true
  }
  const reportName =
    require('node:path').basename(executable) === 'MyMap.exe'
      ? `installed-smoke-v${version}.json`
      : `portable-smoke-v${version}.json`
  mkdirSync('docs/reports', { recursive: true })
  writeFileSync(`docs/reports/${reportName}`, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
