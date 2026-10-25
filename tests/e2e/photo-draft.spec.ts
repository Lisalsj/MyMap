import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'

async function launch(root: string): Promise<ElectronApplication> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined)
  )
  delete env.ELECTRON_RUN_AS_NODE
  return electron.launch({
    executablePath: process.env.MYMAP_EXECUTABLE || undefined,
    args: process.env.MYMAP_EXECUTABLE ? ['--disable-gpu'] : [resolve('out/main/index.js'), '--disable-gpu'],
    env: { ...env, MYMAP_TEST_ROOT: root, MYMAP_TEST_HEADLESS: '1', MYMAP_DEMO: '0' },
    timeout: 40000
  })
}

test('photo caption and associations survive next, previous, Escape, close, navigation and application exit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mymap-photo-draft-'))
  let app: ElectronApplication | undefined
  try {
    const sources = [join(root, 'one.png'), join(root, 'two.png')]
    for (const [index, file] of sources.entries()) {
      await sharp({ create: { width: 24, height: 16, channels: 3, background: index ? '#caa' : '#aca' } })
        .png()
        .toFile(file)
    }
    app = await launch(root)
    let page = await app.firstWindow()
    await page.waitForFunction(async () => Boolean((await window.myMap.snapshot()).library.path))
    const records = await page.evaluate(async () => {
      const trip = await window.myMap.saveTrip({ title: '照片草稿回归' })
      const visit = await window.myMap.saveVisit({
        tripId: trip.id,
        name: '湖边',
        kind: 'custom',
        cityId: '',
        cityName: '',
        country: '',
        lat: null,
        lon: null,
        date: '',
        note: ''
      })
      const entry = await window.myMap.saveEntry({ tripId: trip.id, title: '湖边手记', markdown: '散步' })
      return { trip: trip.id, visit: visit.id, entry: entry.id }
    })
    await app.evaluate(({ dialog }, files) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files })
    }, sources)
    await page.evaluate((id) => window.myMap.importPhotos(id), records.trip)
    await page.reload()
    await page.getByRole('button', { name: '照片馆', exact: true }).click()
    await page.locator('.photo-tile').first().click()
    let detail = page.getByRole('dialog', { name: '照片详情', exact: true })
    await detail.getByRole('textbox', { name: '照片说明' }).fill('切换前的完整草稿')
    await detail.getByRole('combobox', { name: '关联到访地点' }).selectOption(records.visit)
    await detail.getByRole('combobox', { name: '关联旅行手记' }).selectOption(records.entry)
    await detail.getByRole('button', { name: '下一张照片', exact: true }).click()
    await expect(detail.getByRole('textbox', { name: '照片说明' })).toHaveValue('')
    await detail.getByRole('button', { name: '上一张照片', exact: true }).click()
    await expect(detail.getByRole('textbox', { name: '照片说明' })).toHaveValue('切换前的完整草稿')
    await expect(detail.getByRole('combobox', { name: '关联到访地点' })).toHaveValue(records.visit)
    await expect(detail.getByRole('combobox', { name: '关联旅行手记' })).toHaveValue(records.entry)
    await detail.getByRole('textbox', { name: '照片说明' }).fill('按 Esc 前的草稿')
    await page.keyboard.press('Escape')
    await expect(detail).toHaveCount(0)
    await expect(page.locator('.photo-tile').first()).toBeFocused()
    await page.locator('.photo-tile').first().click()
    await expect(detail.getByRole('textbox', { name: '照片说明' })).toHaveValue('按 Esc 前的草稿')
    await detail.getByRole('textbox', { name: '照片说明' }).fill('关闭前的草稿')
    await detail.getByRole('button', { name: '关闭照片', exact: true }).click()
    await page.getByRole('button', { name: '旅行护照', exact: true }).click()
    await page.getByRole('button', { name: '照片馆', exact: true }).click()
    await page.locator('.photo-tile').first().click()
    await expect(detail.getByRole('textbox', { name: '照片说明' })).toHaveValue('关闭前的草稿')
    await detail.getByRole('textbox', { name: '照片说明' }).fill('退出前仍在输入的草稿')
    await app.close()
    app = await launch(root)
    page = await app.firstWindow()
    await page.waitForFunction(async () => (await window.myMap.snapshot()).attachments.length === 2)
    const saved = await page.evaluate(() => window.myMap.snapshot())
    expect(saved.attachments.find((a) => a.caption === '退出前仍在输入的草稿')).toMatchObject({
      visitId: records.visit,
      entryId: records.entry
    })
  } finally {
    await app?.close().catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
})

test('a failed photo save retains the draft and prevents switching or closing until retry succeeds', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mymap-photo-failure-'))
  let app: ElectronApplication | undefined
  try {
    const sources = [join(root, 'first.png'), join(root, 'second.png')]
    for (const [index, file] of sources.entries()) {
      await sharp({ create: { width: 24, height: 16, channels: 3, background: index ? '#aca' : '#caa' } })
        .png()
        .toFile(file)
    }
    app = await launch(root)
    const page = await app.firstWindow()
    await page.waitForFunction(async () => Boolean((await window.myMap.snapshot()).library.path))
    const tripId = await page.evaluate(
      async () => (await window.myMap.saveTrip({ title: '保存失败回归' })).id
    )
    await app.evaluate(({ dialog }, files) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files })
    }, sources)
    await page.evaluate((id) => window.myMap.importPhotos(id), tripId)
    await page.reload()
    await page.getByRole('button', { name: '照片馆', exact: true }).click()
    await page.locator('.photo-tile').first().click()
    const detail = page.getByRole('dialog', { name: '照片详情', exact: true })
    // Inject one storage failure at the IPC boundary; real rendering and draft handling remain active.
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: any[]) => unknown> })
        ._invokeHandlers
      const original = handlers.get('mymap:call')!
      ;(globalThis as any).__allowPhotoSave = false
      ipcMain.removeHandler('mymap:call')
      ipcMain.handle('mymap:call', (event, method, args) => {
        if (method === 'updateAttachment' && !(globalThis as any).__allowPhotoSave)
          throw new Error('测试磁盘写入失败')
        return original(event, method, args)
      })
    })
    await detail.getByRole('textbox', { name: '照片说明' }).fill('写入失败也不能丢失')
    await detail.getByRole('button', { name: '下一张照片', exact: true }).click()
    await expect(detail.getByRole('alert')).toContainText('测试磁盘写入失败')
    await expect(detail.getByRole('textbox', { name: '照片说明' })).toHaveValue('写入失败也不能丢失')
    await page.keyboard.press('Escape')
    await expect(detail).toBeVisible()
    await expect(detail.getByRole('textbox', { name: '照片说明' })).toHaveValue('写入失败也不能丢失')
    await app.evaluate(() => {
      ;(globalThis as any).__allowPhotoSave = true
    })
    await detail.getByRole('button', { name: '重试保存', exact: true }).click()
    await expect(detail.getByRole('alert')).toHaveCount(0)
    await detail.getByRole('button', { name: '下一张照片', exact: true }).click()
    await expect(detail.getByRole('textbox', { name: '照片说明' })).toHaveValue('')
    await detail.getByRole('button', { name: '上一张照片', exact: true }).click()
    await expect(detail.getByRole('textbox', { name: '照片说明' })).toHaveValue('写入失败也不能丢失')
  } finally {
    await app
      ?.evaluate(() => {
        ;(globalThis as any).__allowPhotoSave = true
      })
      .catch(() => {})
    await app?.close().catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
})
