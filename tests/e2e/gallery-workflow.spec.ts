import { expect, test, _electron as electron, type Page } from '@playwright/test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'

async function openGallery(demo = false) {
  const parent = realpathSync(tmpdir())
  const root = mkdtempSync(join(parent, 'mymap-gallery-flow-'))
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined)
    ),
    MYMAP_TEST_ROOT: root,
    MYMAP_TEST_HEADLESS: '1',
    MYMAP_DEMO: demo ? '1' : '0'
  }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    executablePath: process.env.MYMAP_EXECUTABLE || undefined,
    args: process.env.MYMAP_EXECUTABLE ? ['--disable-gpu'] : [resolve('out/main/index.js'), '--disable-gpu'],
    env
  })
  return {
    root,
    app,
    async close() {
      try {
        await app.close()
      } finally {
        const target = realpathSync(root)
        if (dirname(target) !== parent || !basename(target).startsWith('mymap-gallery-flow-'))
          throw Error('Unexpected gallery fixture directory')
        rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      }
    }
  }
}

async function makePhoto(root: string, index: number) {
  const file = join(root, `photo-${index}.png`)
  await sharp({ create: { width: 12, height: 8, channels: 3, background: { r: index, g: 72, b: 85 } } })
    .png()
    .toFile(file)
  return file
}

// Use Chromium's real disk-backed File objects so the normal Electron preload resolves the paths.
async function dropPhoto(page: Page, file: string) {
  await page.locator('.gallery-page').waitFor()
  await page.evaluate(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.hidden = true
    input.id = 'fixture-drop-file'
    document.body.append(input)
  })
  await page.locator('#fixture-drop-file').setInputFiles(file)
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('#fixture-drop-file')!
    const transfer = new DataTransfer()
    transfer.items.add(input.files![0])
    document
      .querySelector('.gallery-page')!
      .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    input.remove()
  })
}

test('dropped files survive choosing or creating a trip and cancel leaves the album unchanged', async () => {
  const fixture = await openGallery()
  try {
    const page = await fixture.app.firstWindow()
    await page.getByRole('button', { name: '照片馆', exact: true }).click()
    const first = await makePhoto(fixture.root, 1)
    await dropPhoto(page, first)
    const editor = page.getByRole('dialog', { name: '一段新的旅程' })
    await editor.getByRole('textbox', { name: '旅行名称' }).fill('照片周末')
    await editor.getByRole('button', { name: '创建旅行' }).click()
    await expect(page.locator('.photo-tile')).toHaveCount(1)
    const scope = page.getByLabel('照片所属旅行', { exact: true })
    await expect(scope).toHaveValue('')
    const tripId = await page.evaluate(async () => (await window.myMap.snapshot()).trips[0].id)
    const second = await makePhoto(fixture.root, 2)
    await dropPhoto(page, second)
    const chooser = page.getByRole('dialog', { name: '选择导入旅行' })
    await chooser.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.locator('.photo-tile')).toHaveCount(1)
    await dropPhoto(page, second)
    await chooser.getByLabel('保存到旅行', { exact: true }).selectOption(tripId)
    await chooser.getByRole('button', { name: '继续导入' }).click()
    await expect(page.locator('.photo-tile')).toHaveCount(2)
    await expect(scope).toHaveValue('')
    expect((await page.evaluate(() => window.myMap.snapshot())).attachments.map((row) => row.tripId)).toEqual(
      [tripId, tripId]
    )
    const search = page.getByRole('textbox', { name: '搜索照片说明' })
    await search.fill('没有这个说明')
    await page.locator('.gallery-page').getByRole('button', { name: '清空搜索', exact: true }).last().click()
    await expect(page.locator('.photo-tile')).toHaveCount(2)
    await expect(page.getByRole('navigation', { name: '照片分页' })).toHaveCount(0)
    const third = await makePhoto(fixture.root, 3)
    await fixture.app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    }, third)
    await page.locator('.gallery-toolbar').getByRole('button', { name: '导入照片' }).click()
    await chooser.getByLabel('保存到旅行', { exact: true }).selectOption(tripId)
    await chooser.getByRole('button', { name: '继续导入' }).click()
    await expect(page.locator('.photo-tile')).toHaveCount(3)
    await expect(scope).toHaveValue('')
  } finally {
    await fixture.close()
  }
})

test('editing across a page boundary keeps the caption, page and focus without reloading the library', async () => {
  test.setTimeout(90000)
  const fixture = await openGallery()
  try {
    const page = await fixture.app.firstWindow()
    await page.getByRole('button', { name: '照片馆', exact: true }).click()
    const tripId = await page.evaluate(async () => (await window.myMap.saveTrip({ title: '跨页照片' })).id)
    const paths = []
    for (let index = 0; index < 62; index++) paths.push(await makePhoto(fixture.root, index))
    await fixture.app.evaluate(({ dialog }, files) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files })
    }, paths)
    await page.evaluate((id) => window.myMap.importPhotos(id), tripId)
    const tiles = page.locator('.photo-tile')
    await expect(tiles).toHaveCount(60)
    await tiles.nth(59).click()
    const detail = page.getByRole('dialog', { name: '照片详情' })
    await expect(detail.getByRole('button', { name: '关闭照片' })).toBeFocused()
    await fixture.app.evaluate(({ ipcMain }) => {
      const registry = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: any[]) => unknown> })
        ._invokeHandlers
      const original = registry.get('mymap:call')!
      ipcMain.removeHandler('mymap:call')
      ipcMain.handle('mymap:call', (event, method, args) => {
        if (method === 'snapshot') throw Error('Editing one photo requested the whole library')
        return original(event, method, args)
      })
    })
    const caption = detail.getByRole('textbox', { name: '照片说明' })
    await caption.fill('第六十张')
    await caption.press('ArrowRight')
    await expect(caption).toHaveValue('第六十张')
    const next = detail.getByRole('button', { name: '下一张照片' })
    await next.focus()
    await next.press('ArrowRight')
    await expect(caption).toHaveValue('')
    await caption.fill('下一页的第一张')
    await caption.press('Escape')
    await expect(detail).toHaveCount(0)
    await expect(tiles).toHaveCount(2)
    await expect(tiles.first()).toContainText('下一页的第一张')
    await expect(tiles.first()).toBeFocused()
    await page.getByRole('button', { name: '上一页', exact: true }).click()
    await expect(tiles.nth(59)).toContainText('第六十张')
  } finally {
    await fixture.close()
  }
})

test('switching from a scoped demo gallery clears its trip and pending photo context', async () => {
  const fixture = await openGallery(true)
  try {
    const page = await fixture.app.firstWindow()
    await page.getByRole('button', { name: '照片馆', exact: true }).click()
    const scope = page.getByLabel('照片所属旅行', { exact: true })
    await scope.selectOption({ index: 1 })
    await expect(page.locator('.photo-tile').first()).toBeVisible()
    const previous = await scope.inputValue()
    await fixture.app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: any[]) => unknown> })
        ._invokeHandlers
      const original = handlers.get('mymap:call')!
      let failSwitch = true
      ipcMain.removeHandler('mymap:call')
      ipcMain.handle('mymap:call', (event, method, args) => {
        if (method === 'setDemo' && failSwitch) {
          failSwitch = false
          throw Error('测试资料库正忙')
        }
        return original(event, method, args)
      })
    })
    await page.locator('.demo-strip').getByRole('button').click()
    await expect(page.getByRole('alert')).toContainText('测试资料库正忙')
    await expect(scope).toHaveValue(previous)
    await page.locator('.demo-strip').getByRole('button').click()
    await expect(page.locator('.demo-strip')).toHaveCount(0)
    await expect(scope).toHaveValue('')
    await expect(page.locator('.photo-tile')).toHaveCount(0)
    await page.locator('.gallery-toolbar').getByRole('button', { name: '导入照片', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '一段新的旅程' })).toBeVisible()
    await page.keyboard.press('Escape')
    expect((await page.evaluate(() => window.myMap.snapshot())).trips).toHaveLength(0)
  } finally {
    await fixture.close()
  }
})

test('a late import snapshot preserves a newer caption and filtering restores focus to its neighbour', async () => {
  const fixture = await openGallery(true)
  try {
    const page = await fixture.app.firstWindow()
    await page.getByRole('button', { name: '照片馆', exact: true }).click()
    const tripId = await page.evaluate(async () => {
      const snapshot = await window.myMap.snapshot()
      for (const row of snapshot.attachments) await window.myMap.updateAttachment(row.id, { caption: '秋游' })
      return snapshot.trips[0].id
    })
    await page.reload()
    await page.getByRole('button', { name: '照片馆', exact: true }).click()
    const tiles = page.locator('.photo-tile')
    const search = page.getByLabel('搜索照片说明')
    await search.fill('秋游')
    await expect(tiles).toHaveCount(3)
    const neighbour = await tiles.nth(2).getAttribute('data-attachment-id')
    await tiles.nth(1).click()
    const detail = page.getByRole('dialog', { name: '照片详情' })
    const file = await makePhoto(fixture.root, 144)
    await fixture.app.evaluate(({ ipcMain, dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: any[]) => unknown> })
        ._invokeHandlers
      const original = handlers.get('mymap:call')!
      ipcMain.removeHandler('mymap:call')
      let held = false
      ipcMain.handle('mymap:call', async (event, method, args) => {
        const result = await original(event, method, args)
        if (method === 'snapshot' && !held) {
          held = true
          await new Promise<void>((resolveRead) => {
            ;(globalThis as any).__releaseGalleryRead = resolveRead
          })
        }
        return result
      })
    }, file)
    await page.evaluate((id) => window.myMap.importPhotos(id), tripId)
    await expect
      .poll(() => fixture.app.evaluate(() => typeof (globalThis as any).__releaseGalleryRead))
      .toBe('function')
    await detail.getByRole('textbox', { name: '照片说明' }).fill('湖边的树')
    await detail.getByRole('button', { name: '保存照片说明' }).click()
    await expect(tiles).toHaveCount(2)
    await fixture.app.evaluate(() => (globalThis as any).__releaseGalleryRead())
    await detail.getByRole('button', { name: '关闭照片' }).click()
    await expect(tiles).toHaveCount(2)
    await expect(page.locator(`[data-attachment-id="${neighbour}"]`)).toBeFocused()
    await search.fill('')
    await expect(tiles).toHaveCount(4)
    await expect(page.locator('.photo-tile').filter({ hasText: '湖边的树' })).toHaveCount(1)
  } finally {
    await fixture.close()
  }
})
