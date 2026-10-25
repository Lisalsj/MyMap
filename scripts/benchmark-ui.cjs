const { _electron: electron } = require('@playwright/test')
const { readFileSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
async function main() {
  const profile = readFileSync('.superpowers/benchmark-profile.txt', 'utf8').trim()
  const env = { ...process.env, MYMAP_TEST_ROOT: profile, MYMAP_TEST_HEADLESS: '1', MYMAP_DEMO: '0' }
  delete env.ELECTRON_RUN_AS_NODE
  const started = performance.now()
  const app = await electron.launch({ args: [resolve('out/main/index.js'), '--disable-gpu'], env })
  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => document.body.innerText.includes('合成图库'))
    const firstScreenMs = Math.round(performance.now() - started)
    const opened = performance.now()
    await page.getByRole('button', { name: '照片馆', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.photo-tile').length === 60)
    await page.waitForFunction(() => {
      const visible = [...document.querySelectorAll('.photo-tile img')].filter((image) => {
        const rect = image.getBoundingClientRect()
        return rect.top < innerHeight && rect.bottom > 0
      })
      return visible.length > 0 && visible.every((image) => image.complete && image.naturalWidth > 0)
    })
    const galleryMs = Math.round(performance.now() - opened)
    const nodes = await page.locator('.photo-tile').count()
    const report = JSON.parse(readFileSync('docs/reports/performance.json', 'utf8'))
    Object.assign(report, {
      electron: await app.evaluate(() => process.versions.electron),
      renderer: {
        firstScreenMs,
        galleryFirstPageMs: galleryMs,
        renderedPhotoCards: nodes,
        totalPhotos: 5000,
        coldLaunchIncludesMainAndUtilityStartup: true
      }
    })
    writeFileSync('docs/reports/performance.json', JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report.renderer, null, 2))
  } finally {
    await app.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
