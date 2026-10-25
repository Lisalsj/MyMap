import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, rmdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { LibraryService } from '../src/backend/library'
const paths: string[] = []
const services: LibraryService[] = []
const folder = () => {
  const path = mkdtempSync(join(tmpdir(), 'mymap-media-'))
  paths.push(path)
  return path
}
afterEach(() => {
  services.forEach((db) => db.close())
  services.length = 0
  paths.forEach((path) => rmSync(path, { force: true, recursive: true }))
  paths.length = 0
})
it('copies and deduplicates originals, skips corrupt files and exports portable Markdown', async () => {
  const external = folder()
  const source = join(external, 'image.png')
  await sharp({ create: { width: 40, height: 30, channels: 3, background: '#d59262' } })
    .png()
    .toFile(source)
  const bad = join(external, 'bad.jpg')
  writeFileSync(bad, 'not a photo')
  const db = new LibraryService(folder())
  services.push(db)
  const trip = db.saveTrip({ title: '相册' })
  const progress = await db.importPhotos([source, bad, source], trip.id, {}, () => {})
  expect(progress.imported).toBe(1)
  expect(progress.duplicates).toBe(1)
  expect(progress.errors).toHaveLength(1)
  expect(db.snapshot().photos).toHaveLength(1)
  expect(db.snapshot().attachments).toHaveLength(1)
  const photo = db.snapshot().photos[0]
  expect(photo.originalPath).not.toContain(external)
  expect((await sharp(db.photoPath(photo.id, 'thumb')).metadata()).format).toBe('webp')
  const entry = db.saveEntry({ tripId: trip.id, title: '游记', markdown: `![照片](mymap-photo:${photo.id})` })
  const destination = folder()
  const exported = await db.exportEntry(entry.id, destination)
  expect(readFileSync(exported, 'utf8')).toContain(`assets/${photo.id}.png`)
  const attachment = db.snapshot().attachments[0]
  db.trash('attachment', attachment.id)
  await db.emptyTrash()
  expect(db.snapshot().photos).toHaveLength(1) // journal still references the photo
  db.trash('entry', entry.id)
  await db.emptyTrash()
  expect(db.snapshot().photos).toHaveLength(0)
  expect(existsSync(source)).toBe(true)
})
it.each([
  ['named colon entity', (id: string) => `![照片](mymap-photo&colon;${id})`],
  ['decimal colon entity', (id: string) => `![照片](mymap-photo&#58;${id})`],
  ['hex colon entity', (id: string) => `![照片](mymap-photo&#x3a;${id})`],
  ['reference image', (id: string) => `![照片][photo]\n\n[photo]: mymap-photo&colon;${id}`],
  ['reference media URL', (id: string) => `![照片][photo]\n\n[photo]: mymap-media&#58;//photo/${id}/original`]
])('protects and exports photo URLs normalized from %s', async (_label, markdown) => {
  const external = folder()
  const source = join(external, 'photo.png')
  await sharp({ create: { width: 9, height: 7, channels: 3, background: '#876' } })
    .png()
    .toFile(source)
  const db = new LibraryService(folder())
  services.push(db)
  const trip = db.saveTrip({ title: '引用' })
  await db.importPhotos([source], trip.id, {}, () => {})
  const photo = db.snapshot().photos[0]
  const entry = db.saveEntry({ tripId: trip.id, title: '实体与引用', markdown: markdown(photo.id) })
  db.trash('attachment', db.snapshot().attachments[0].id)
  await db.emptyTrash()
  expect(db.snapshot().photos).toHaveLength(1)
  expect(existsSync(db.photoPath(photo.id, 'original'))).toBe(true)
  const target = folder()
  const exported = await db.exportEntry(entry.id, target)
  const text = readFileSync(exported, 'utf8')
  expect(text).not.toMatch(/mymap-(?:photo|media)/)
  expect(text).toContain(`assets/${photo.id}.png`)
  expect(readFileSync(join(target, 'assets', `${photo.id}.png`))).toEqual(readFileSync(source))
})
it('validates normalized photo references against their owning trip', async () => {
  const external = folder()
  const source = join(external, 'photo.png')
  await sharp({ create: { width: 9, height: 7, channels: 3, background: '#876' } })
    .png()
    .toFile(source)
  const db = new LibraryService(folder())
  services.push(db)
  const owner = db.saveTrip({ title: 'Owner' })
  const other = db.saveTrip({ title: 'Other' })
  await db.importPhotos([source], owner.id, {}, () => {})
  const photo = db.snapshot().photos[0]
  expect(() =>
    db.saveEntry({ tripId: other.id, title: '越界引用', markdown: `![照片](mymap-photo&colon;${photo.id})` })
  ).toThrow()
})
it('keeps GFM journal content intact while normalizing exported photo URLs', async () => {
  const db = new LibraryService(folder())
  services.push(db)
  const trip = db.saveTrip({ title: '格式' })
  const entry = db.saveEntry({
    tripId: trip.id,
    title: '格式',
    markdown: '| 名称 | 天气 |\n| --- | --- |\n| 湖边 | 晴 |\n\n- [x] 出发\n\n~~海边~~'
  })
  const exported = await db.exportEntry(entry.id, folder())
  const text = readFileSync(exported, 'utf8')
  expect(text).toMatch(/\| 名称\s*\| 天气\s*\|/)
  expect(text).toContain('- [x] 出发')
  expect(text).toContain('~~海边~~')
})
it('retains shared originals across trips, supports cancel, and blocks writes during backup/import', async () => {
  const external = folder()
  const source = join(external, 'photo.webp')
  await sharp({ create: { width: 20, height: 20, channels: 3, background: 'white' } })
    .webp()
    .toFile(source)
  const db = new LibraryService(folder())
  services.push(db)
  const a = db.saveTrip({ title: 'A' })
  const b = db.saveTrip({ title: 'B' })
  await db.importPhotos([source], a.id, {}, () => {})
  await db.importPhotos([source], b.id, {}, () => {})
  db.trash('trip', a.id)
  await db.emptyTrash()
  expect(db.snapshot().photos).toHaveLength(1)
  const run = db.importPhotos([source, source], b.id, {}, (p) => {
    if (p.completed === 1) db.cancelImport()
  })
  expect(() => db.saveTrip({ title: 'busy' })).toThrow()
  const progress = await run
  expect(progress.cancelled).toBe(true)
  const backup = folder()
  await db.backup(backup)
  const restore = folder()
  await LibraryService.restoreBackup(backup, restore)
  const restored = new LibraryService(restore)
  services.push(restored)
  expect(existsSync(restored.photoPath(db.snapshot().photos[0].id, 'preview'))).toBe(true)
})
it('rejects a backup database that points a thumbnail at the database itself', async () => {
  const external = folder()
  const source = join(external, 'photo.png')
  await sharp({ create: { width: 5, height: 5, channels: 3, background: 'white' } })
    .png()
    .toFile(source)
  const db = new LibraryService(folder())
  services.push(db)
  const trip = db.saveTrip({ title: 'A' })
  await db.importPhotos([source], trip.id, {}, () => {})
  const backup = folder()
  await db.backup(backup)
  const file = join(backup, 'library.sqlite')
  const malicious = new DatabaseSync(file)
  malicious.prepare("UPDATE photos SET thumbPath='library.sqlite'").run()
  malicious.close()
  const manifestPath = join(backup, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const bytes = readFileSync(file)
  manifest.files[0].hash = createHash('sha256').update(bytes).digest('hex')
  manifest.files[0].size = bytes.length
  writeFileSync(manifestPath, JSON.stringify(manifest))
  await expect(LibraryService.restoreBackup(backup, folder())).rejects.toThrow()
})
async function writeGpsJpeg(source: string, capturedAt?: string, offset?: string): Promise<void> {
  const jpeg = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#caa' } })
    .jpeg()
    .toBuffer()
  const gpsOffset = capturedAt ? 38 : 26
  const latitudeOffset = gpsOffset + 54
  const longitudeOffset = latitudeOffset + 24
  const exifOffset = longitudeOffset + 24
  const exifDirectorySize = offset ? 30 : 18
  const tiff = Buffer.alloc(exifOffset + (capturedAt ? exifDirectorySize + 20 + (offset ? 7 : 0) : 0))
  tiff.write('II')
  tiff.writeUInt16LE(42, 2)
  tiff.writeUInt32LE(8, 4)
  tiff.writeUInt16LE(capturedAt ? 2 : 1, 8)
  tiff.writeUInt16LE(0x8825, 10)
  tiff.writeUInt16LE(4, 12)
  tiff.writeUInt32LE(1, 14)
  tiff.writeUInt32LE(gpsOffset, 18)
  tiff.writeUInt16LE(4, gpsOffset)
  if (capturedAt) {
    tiff.writeUInt16LE(0x8769, 22)
    tiff.writeUInt16LE(4, 24)
    tiff.writeUInt32LE(1, 26)
    tiff.writeUInt32LE(exifOffset, 30)
    tiff.writeUInt16LE(offset ? 2 : 1, exifOffset)
    tiff.writeUInt16LE(0x9003, exifOffset + 2)
    tiff.writeUInt16LE(2, exifOffset + 4)
    tiff.writeUInt32LE(20, exifOffset + 6)
    tiff.writeUInt32LE(exifOffset + exifDirectorySize, exifOffset + 10)
    tiff.write(capturedAt, exifOffset + exifDirectorySize, 19, 'ascii')
    if (offset) {
      tiff.writeUInt16LE(0x9011, exifOffset + 14)
      tiff.writeUInt16LE(2, exifOffset + 16)
      tiff.writeUInt32LE(7, exifOffset + 18)
      tiff.writeUInt32LE(exifOffset + exifDirectorySize + 20, exifOffset + 22)
      tiff.write(offset, exifOffset + exifDirectorySize + 20, 6, 'ascii')
    }
  }
  for (const [index, tag, type, count, value] of [
    [0, 1, 2, 2, 78],
    [1, 2, 5, 3, latitudeOffset],
    [2, 3, 2, 2, 69],
    [3, 4, 5, 3, longitudeOffset]
  ]) {
    const at = gpsOffset + 2 + index * 12
    tiff.writeUInt16LE(tag, at)
    tiff.writeUInt16LE(type, at + 2)
    tiff.writeUInt32LE(count, at + 4)
    tiff.writeUInt32LE(value, at + 8)
  }
  for (const [offset, values] of [
    [latitudeOffset, [30, 15, 0]],
    [longitudeOffset, [120, 9, 0]]
  ] as const)
    values.forEach((value, index) => {
      tiff.writeUInt32LE(value, offset + index * 8)
      tiff.writeUInt32LE(1, offset + index * 8 + 4)
    })
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), tiff])
  const marker = Buffer.alloc(4)
  marker.writeUInt16BE(0xffe1)
  marker.writeUInt16BE(payload.length + 2, 2)
  writeFileSync(source, Buffer.concat([jpeg.subarray(0, 2), marker, payload, jpeg.subarray(2)]))
}
it('preserves the camera local date for a Shanghai photo taken shortly after midnight', async () => {
  const previousTimezone = process.env.TZ
  process.env.TZ = 'Asia/Shanghai'
  try {
    const source = join(folder(), 'early-morning.jpg')
    await writeGpsJpeg(source, '2025:03:01 01:00:00')
    const db = new LibraryService(folder())
    services.push(db)
    const trip = db.saveTrip({ title: '凌晨旅行', startDate: '2025-03-01', endDate: '2025-03-01' })
    const progress = await db.importPhotos([source], trip.id, {}, () => {})
    expect(progress.errors).toHaveLength(0)
    const photo = db.snapshot().photos[0]
    expect(photo.capturedAt).toBe('2025-03-01T01:00:00')
    expect(db.confirmPhotoLocation(photo.id).date).toBe('2025-03-01')
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ
    else process.env.TZ = previousTimezone
  }
})
it.each([
  ['2025:03:01 01:00:00', '+08:00', '2025-03-01T01:00:00+08:00'],
  ['2024:02:29 23:59:59', undefined, '2024-02-29T23:59:59'],
  ['2025:02:30 01:00:00', undefined, '']
])(
  'keeps valid camera calendar dates and optional offsets without UTC normalization (%s)',
  async (date, offset, expected) => {
    const source = join(folder(), 'date.jpg')
    await writeGpsJpeg(source, date, offset)
    const db = new LibraryService(folder())
    services.push(db)
    const trip = db.saveTrip({ title: '拍摄日期' })
    const progress = await db.importPhotos([source], trip.id, {}, () => {})
    expect(progress.errors).toHaveLength(0)
    expect(db.snapshot().photos[0].capturedAt).toBe(expected)
  }
)
it('reads GPS from an EXIF JPEG and only creates its visit after explicit confirmation', async () => {
  const external = folder()
  const source = join(external, 'gps.jpg')
  await writeGpsJpeg(source)
  const db = new LibraryService(folder())
  services.push(db)
  const trip = db.saveTrip({ title: 'A' })
  await db.importPhotos([source], trip.id, {}, () => {})
  const photo = db.snapshot().photos[0]
  expect(photo.lat).toBe(30.25)
  expect(photo.lon).toBe(120.15)
  expect(db.snapshot().visits).toHaveLength(0)
  const visit = db.confirmPhotoLocation(photo.id)
  expect(db.snapshot().places.find((p) => p.id === visit.placeId)?.lat).toBe(30.25)
  expect(db.confirmPhotoLocation(photo.id).id).toBe(visit.id)
  expect(db.snapshot().places.find((p) => p.id === visit.placeId)?.cityId).toBe('')
  const assets = folder()
  writeFileSync(
    join(assets, 'cities.json'),
    JSON.stringify([
      {
        id: 'cn-hangzhou',
        name: '杭州',
        country: '中国',
        region: '浙江',
        lat: 30.25,
        lon: 120.15,
        aliases: '',
        population: 1000000
      }
    ])
  )
  const withCities = new LibraryService(folder(), { assetsPath: assets })
  services.push(withCities)
  const otherTrip = withCities.saveTrip({ title: 'GPS 城市' })
  await withCities.importPhotos([source], otherTrip.id, {}, () => {})
  const confirmed = withCities.confirmPhotoLocation(withCities.snapshot().photos[0].id)
  expect(withCities.snapshot().places.find((p) => p.id === confirmed.placeId)?.cityId).toBe('cn-hangzhou')
})
it('requires a selected attachment for shared GPS photos and updates only its chosen trip', async () => {
  const source = join(folder(), 'gps.jpg')
  await writeGpsJpeg(source)
  const db = new LibraryService(folder())
  services.push(db)
  const a = db.saveTrip({ title: 'A' })
  const b = db.saveTrip({ title: 'B' })
  await db.importPhotos([source], a.id, {}, () => {})
  await db.importPhotos([source], b.id, {}, () => {})
  const photo = db.snapshot().photos[0]
  const bAttachment = db.snapshot().attachments.find((row) => row.tripId === b.id)!
  expect(() => db.confirmPhotoLocation(photo.id)).toThrow(/选择.*旅行|旅行.*选择/)
  expect(db.snapshot().visits).toHaveLength(0)
  const visit = db.confirmPhotoLocation(photo.id, bAttachment.id)
  expect(visit.tripId).toBe(b.id)
  expect(db.snapshot().visits).toHaveLength(1)
  expect(db.snapshot().attachments.find((row) => row.tripId === a.id)?.visitId).toBeNull()
  expect(db.snapshot().attachments.find((row) => row.id === bAttachment.id)?.visitId).toBe(visit.id)
  expect(db.confirmPhotoLocation(photo.id, bAttachment.id).id).toBe(visit.id)
  expect(db.snapshot().visits).toHaveLength(1)
})
it('rejects GPS confirmation against another photo, trashed attachment or trashed trip', async () => {
  const external = folder()
  const source = join(external, 'gps.jpg')
  await writeGpsJpeg(source)
  const otherSource = join(external, 'other.png')
  await sharp({ create: { width: 5, height: 5, channels: 3, background: '#345' } })
    .png()
    .toFile(otherSource)
  const db = new LibraryService(folder())
  services.push(db)
  const trip = db.saveTrip({ title: 'A' })
  await db.importPhotos([source, otherSource], trip.id, {}, () => {})
  const photo = db.snapshot().photos.find((row) => row.lat !== null)!
  const own = db.snapshot().attachments.find((row) => row.photoId === photo.id)!
  const other = db.snapshot().attachments.find((row) => row.photoId !== photo.id)!
  expect(() => db.confirmPhotoLocation(photo.id, other.id)).toThrow()
  expect(db.snapshot().visits).toHaveLength(0)
  db.trash('attachment', own.id)
  expect(() => db.confirmPhotoLocation(photo.id, own.id)).toThrow()
  db.restore('attachment', own.id)
  db.trash('trip', trip.id)
  expect(() => db.confirmPhotoLocation(photo.id, own.id)).toThrow()
  expect(db.snapshot().visits).toHaveLength(0)
})
it('rejects linked media directories without writing or deleting any external file', async () => {
  const external = folder()
  const source = join(external, 'photo.png')
  await sharp({ create: { width: 5, height: 5, channels: 3, background: 'white' } })
    .png()
    .toFile(source)
  const root = folder()
  const db = new LibraryService(root)
  services.push(db)
  const trip = db.saveTrip({ title: 'A' })
  const originals = join(root, 'originals')
  rmdirSync(originals)
  symlinkSync(external, originals, 'junction')
  const progress = await db.importPhotos([source], trip.id, {}, () => {})
  expect(progress.errors).toHaveLength(1)
  expect(db.snapshot().photos).toHaveLength(0)
  expect(existsSync(source)).toBe(true)
})
it('removes a permanently deleted attachment from its trip cover while retaining shared originals', async () => {
  const external = folder()
  const source = join(external, 'photo.png')
  await sharp({ create: { width: 5, height: 5, channels: 3, background: 'white' } })
    .png()
    .toFile(source)
  const db = new LibraryService(folder())
  services.push(db)
  const a = db.saveTrip({ title: 'A' })
  const b = db.saveTrip({ title: 'B' })
  await db.importPhotos([source], a.id, {}, () => {})
  await db.importPhotos([source], b.id, {}, () => {})
  const photo = db.snapshot().photos[0]
  db.saveTrip({ ...b, coverPhotoId: photo.id })
  db.trash('attachment', db.snapshot().attachments.find((p) => p.tripId === b.id)!.id)
  await db.emptyTrash()
  expect(db.snapshot().trips.find((t) => t.id === b.id)?.coverPhotoId).toBeNull()
  expect(db.snapshot().photos).toHaveLength(1)
  db.trash('trip', a.id)
  await db.emptyTrash()
  expect(db.snapshot().photos).toHaveLength(0)
})
