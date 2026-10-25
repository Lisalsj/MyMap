import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'

async function gpsJpeg(path: string): Promise<void> {
  const jpeg = await sharp({ create: { width: 24, height: 16, channels: 3, background: '#caa' } })
    .jpeg()
    .toBuffer()
  const tiff = Buffer.alloc(128)
  tiff.write('II')
  tiff.writeUInt16LE(42, 2)
  tiff.writeUInt32LE(8, 4)
  tiff.writeUInt16LE(1, 8)
  tiff.writeUInt16LE(0x8825, 10)
  tiff.writeUInt16LE(4, 12)
  tiff.writeUInt32LE(1, 14)
  tiff.writeUInt32LE(26, 18)
  tiff.writeUInt16LE(4, 26)
  for (const [index, tag, type, count, value] of [
    [0, 1, 2, 2, 78],
    [1, 2, 5, 3, 80],
    [2, 3, 2, 2, 69],
    [3, 4, 5, 3, 104]
  ]) {
    const at = 28 + index * 12
    tiff.writeUInt16LE(tag, at)
    tiff.writeUInt16LE(type, at + 2)
    tiff.writeUInt32LE(count, at + 4)
    tiff.writeUInt32LE(value, at + 8)
  }
  for (const [offset, values] of [
    [80, [30, 15, 0]],
    [104, [120, 9, 0]]
  ] as const)
    values.forEach((value, index) => {
      tiff.writeUInt32LE(value, offset + index * 8)
      tiff.writeUInt32LE(1, offset + index * 8 + 4)
    })
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), tiff])
  const marker = Buffer.alloc(4)
  marker.writeUInt16BE(0xffe1)
  marker.writeUInt16BE(payload.length + 2, 2)
  writeFileSync(path, Buffer.concat([jpeg.subarray(0, 2), marker, payload, jpeg.subarray(2)]))
}

test('GPS confirmation preserves the caption draft and its visit after saving and reconfirming in the same photo detail', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mymap-gps-ui-'))
  let app: ElectronApplication | undefined
  try {
    const source = join(root, 'gps.jpg')
    await gpsJpeg(source)
    const env = Object.fromEntries(
      Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined)
    )
    delete env.ELECTRON_RUN_AS_NODE
    app = await electron.launch({
      executablePath: process.env.MYMAP_EXECUTABLE || undefined,
      args: process.env.MYMAP_EXECUTABLE
        ? ['--disable-gpu']
        : [resolve('out/main/index.js'), '--disable-gpu'],
      env: { ...env, MYMAP_TEST_ROOT: root, MYMAP_TEST_HEADLESS: '1', MYMAP_DEMO: '0' },
      timeout: 40000
    })
    const page = await app.firstWindow()
    await page.waitForFunction(async () => Boolean((await window.myMap.snapshot()).library.path))
    const tripId = await page.evaluate(
      async () => (await window.myMap.saveTrip({ title: 'GPS 说明回归' })).id
    )
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    }, source)
    await page.evaluate((id) => window.myMap.importPhotos(id), tripId)
    await page.reload()
    await page.getByRole('button', { name: '照片馆', exact: true }).click()
    await page.locator('.photo-tile').click()
    const detail = page.getByRole('dialog', { name: '照片详情', exact: true })
    await detail.getByRole('textbox', { name: '照片说明' }).fill('尚未保存的照片说明')
    await detail.getByRole('button', { name: '将拍摄位置加入足迹' }).click()
    await page
      .getByRole('dialog', { name: '确认照片中的位置' })
      .getByRole('button', { name: '确认并加入足迹' })
      .click()
    await expect(page.getByRole('dialog', { name: '确认照片中的位置' })).toHaveCount(0)
    const confirmed = await page.evaluate(() => window.myMap.snapshot())
    expect(confirmed.visits).toHaveLength(1)
    expect(confirmed.photos[0].lat).toBe(30.25)
    expect(confirmed.photos[0].lon).toBe(120.15)
    const visitId = confirmed.visits[0].id
    await expect(detail.getByRole('textbox', { name: '照片说明' })).toHaveValue('尚未保存的照片说明')
    await expect(detail.getByRole('combobox', { name: '关联到访地点' })).toHaveValue(visitId)
    await detail.getByRole('textbox', { name: '照片说明' }).fill('确认位置后继续编辑的说明')
    await detail.getByRole('button', { name: '保存照片说明' }).click()
    await expect(page.getByText('照片说明已保存', { exact: true })).toBeVisible()
    const saved = await page.evaluate(() => window.myMap.snapshot())
    expect(saved.attachments[0].caption).toBe('确认位置后继续编辑的说明')
    expect(saved.attachments[0].visitId).toBe(visitId)
    await detail.getByRole('button', { name: '将拍摄位置加入足迹' }).click()
    await page
      .getByRole('dialog', { name: '确认照片中的位置' })
      .getByRole('button', { name: '确认并加入足迹' })
      .click()
    await expect(page.getByRole('dialog', { name: '确认照片中的位置' })).toHaveCount(0)
    const repeated = await page.evaluate(() => window.myMap.snapshot())
    expect(repeated.visits).toHaveLength(1)
    expect(repeated.attachments[0].visitId).toBe(visitId)
  } finally {
    await app?.close().catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
})
