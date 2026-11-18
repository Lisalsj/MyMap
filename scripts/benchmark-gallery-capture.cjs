const { copyFileSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { join, dirname, resolve, relative, isAbsolute } = require('node:path')
const { usingApp } = require('./benchmark-gallery-ui.cjs')

async function captureGallery(build, library, results, label) {
  const directory = join(results, label + '-shots')
  mkdirSync(directory, { recursive: true })
  const renderer = join(build, 'out/renderer')
  const copiedAssets = new Set()
  function copyAsset(url) {
    if (url.protocol !== 'mymap:' || url.hostname !== 'app') throw Error('Unexpected capture asset URL')
    const name = decodeURIComponent(url.pathname.slice(1))
    const file = resolve(renderer, name)
    if (relative(renderer, file).startsWith('..') || isAbsolute(relative(renderer, file)))
      throw Error('Unexpected capture asset path')
    if (copiedAssets.has(name)) return
    const destination = join(directory, name)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(file, destination)
    copiedAssets.add(name)
    if (name.endsWith('.css')) {
      for (const match of readFileSync(file, 'utf8').matchAll(/url\(([^)]+)\)/g)) {
        const resource = new URL(match[1].trim().replace(/^['"]|['"]$/g, ''), url)
        if (resource.protocol !== 'data:') copyAsset(resource)
      }
    }
  }
  return usingApp(build, library, async (app, page) => {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false)
    )
    const snapshot = await page.evaluate(() => window.myMap.snapshot())
    const byId = new Map(snapshot.photos.map((p) => [p.id, p]))
    const captures = []
    const cdp = await page.context().newCDPSession(page)
    async function save(stem) {
      const kind = stem.split('-').at(-1)
      await page.waitForFunction((state) => {
        const gallery = document.querySelector('.gallery-page')
        const dialog = document.querySelector('[role=dialog]')
        if (!gallery || getComputedStyle(gallery).opacity < 0.999 || document.querySelector('.page-skeleton'))
          return false
        if (state === 'detail') return !!document.querySelector('.lightbox-stage img')?.naturalWidth
        if (state === 'destination') return dialog?.getAttribute('aria-label') === '选择导入旅行'
        if (dialog) return false
        const visible = [...document.querySelectorAll('.photo-tile-image')].filter((tile) => {
          const r = tile.getBoundingClientRect()
          return r.bottom > 0 && r.top < innerHeight
        })
        return visible.length > 0 && visible.every((tile) => tile.querySelector('img')?.naturalWidth)
      }, kind)
      await page.evaluate(async () => {
        await document.fonts.ready
        const finite = document.getAnimations().filter((animation) => {
          const end = animation.effect?.getComputedTiming().endTime
          return typeof end === 'number' && Number.isFinite(end) && animation.playState === 'running'
        })
        await Promise.allSettled(finite.map((animation) => animation.finished))
        await Promise.all(
          [...document.images]
            .filter((img) => img.getClientRects().length)
            .map((img) => img.decode().catch(() => {}))
        )
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
      })
      // Request a new compositor frame. Hidden native window captures may return the previous
      // presented surface after its DOM has already finished navigating.
      const { data } = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false
      })
      writeFileSync(join(directory, stem + '.png'), Buffer.from(data, 'base64'))
      const copied = await page.evaluate(() => {
        const clone = document.documentElement.cloneNode(true)
        clone.querySelectorAll('script,link[rel=modulepreload],link[rel=preload]').forEach((n) => n.remove())
        for (const link of clone.querySelectorAll('link[rel=stylesheet]')) {
          link.setAttribute('href', '.' + new URL(link.getAttribute('href'), location.href).pathname)
          link.removeAttribute('crossorigin')
        }
        // Preserve live select and textarea state in the inert visual evidence.
        const originals = document.querySelectorAll('textarea,select,input')
        clone.querySelectorAll('textarea,select,input').forEach((el, i) => {
          if (el.tagName === 'TEXTAREA') el.textContent = originals[i].value
          if (el.tagName === 'INPUT') el.setAttribute('value', originals[i].value)
          if (el.tagName === 'SELECT')
            [...el.options].forEach((o, j) => o.toggleAttribute('selected', j === originals[i].selectedIndex))
        })
        return {
          html: '<!doctype html>\n' + clone.outerHTML,
          width: innerWidth,
          height: innerHeight,
          theme: document.documentElement.dataset.theme,
          sheets: [...document.styleSheets].map((sheet) => sheet.href),
          focusedControl:
            document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName,
          firstPhoto: document.querySelector('.photo-tile img')?.src,
          galleryOpacity: getComputedStyle(document.querySelector('.gallery-page')).opacity,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          brokenVisibleImages: [...document.images].filter(
            (i) => i.getClientRects().length && (!i.complete || !i.naturalWidth)
          ).length
        }
      })
      for (const href of copied.sheets) if (href) copyAsset(new URL(href))
      const html = copied.html.replace(
        /mymap-media:\/\/photo\/([a-z\d-]+)\/(thumb|preview|original)/gi,
        (_, id, variant) => {
          const photo = byId.get(id)
          if (!photo) throw Error('Unrecognized synthetic photo in visual snapshot')
          const name = 'media/' + photo[variant + 'Path']
          if (!copiedAssets.has(name)) {
            const destination = join(directory, name)
            mkdirSync(dirname(destination), { recursive: true })
            copyFileSync(join(library, photo[variant + 'Path']), destination)
            copiedAssets.add(name)
          }
          return './' + name
        }
      )
      writeFileSync(join(directory, stem + '.html'), html)
      const { html: _html, ...audit } = copied
      captures.push({ stem, ...audit })
    }
    for (const theme of ['forest', 'sky-rose']) {
      await page.evaluate((value) => localStorage.setItem('mymap:view:theme', value), theme)
      await page.reload()
      await page.getByRole('button', { name: '照片馆', exact: true }).first().click()
      for (const [width, height, zoom] of [
        [1440, 900, 1],
        [1100, 800, 1.25],
        [1100, 800, 1.5]
      ]) {
        await app.evaluate(
          ({ BrowserWindow }, [width, height, zoom]) => {
            const win = BrowserWindow.getAllWindows()[0]
            win.setBounds({ width, height })
            win.webContents.setZoomFactor(zoom)
          },
          [width, height, zoom]
        )
        await page.waitForTimeout(250)
        await page.locator('.photo-tile').first().waitFor()
        await page.evaluate(() => {
          document.querySelector('.main')?.scrollTo(0, 0)
          scrollTo(0, 0)
        })
        const base = theme + '-' + width + '-' + Math.round(zoom * 100)
        await save(base + '-gallery')
        await page.locator('.photo-tile').first().click()
        await page.getByRole('dialog', { name: '照片详情', exact: true }).waitFor()
        await save(base + '-detail')
        await page.getByRole('button', { name: '关闭照片', exact: true }).click()
        const startImport = page.getByRole('button', { name: '导入照片', exact: true }).first()
        if (await startImport.isEnabled()) {
          await startImport.click()
          const picker = page.getByRole('dialog', { name: '选择导入旅行', exact: true })
          await picker.waitFor()
          await save(base + '-destination')
          await page.keyboard.press('Escape')
        }
      }
    }
    return { captures }
  })
}
module.exports = { captureGallery }
