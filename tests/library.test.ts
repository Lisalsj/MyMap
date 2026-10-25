import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LibraryService } from '../src/backend/library'
import sharp from 'sharp'

const roots: string[] = []
const services: LibraryService[] = []
const folder = () => {
  const path = mkdtempSync(join(tmpdir(), 'mymap-test-'))
  roots.push(path)
  return path
}
const library = () => {
  const value = new LibraryService(folder())
  services.push(value)
  return value
}
afterEach(() => {
  services.forEach((value) => value.close())
  services.length = 0
  roots.forEach((path) => rmSync(path, { recursive: true, force: true }))
  roots.length = 0
})
const visit = (tripId: string, cityId = 'cn-hangzhou') => ({
  tripId,
  name: '西湖',
  kind: 'scenic' as const,
  cityId,
  cityName: '杭州',
  country: '中国',
  lat: 30.2,
  lon: 120.1,
  date: '2025-03-01',
  note: ''
})

describe('durable relational library', () => {
  it('persists journals and repeat visits while keeping same-name places in separate cities', () => {
    const db = library()
    const trip = db.saveTrip({ title: '春游', startDate: '2025-03-01', endDate: '2025-03-03' })
    const first = db.saveVisit(visit(trip.id))
    const second = db.saveVisit(visit(trip.id))
    db.saveVisit(visit(trip.id, 'cn-other'))
    db.saveEntry({ tripId: trip.id, visitId: first.id, title: '第一天', markdown: '# 春天' })
    db.reorderVisits(trip.id, [second.id, first.id, db.snapshot().visits[2].id])
    expect(db.snapshot().places).toHaveLength(2)
    expect(db.snapshot().visits.find((v) => v.id === second.id)?.sortOrder).toBe(0)
    const path = db.snapshot().library.path
    db.close()
    const reopened = new LibraryService(path)
    services.push(reopened)
    expect(reopened.snapshot().entries[0].markdown).toBe('# 春天')
  })
  it('rejects invalid dates, foreign associations, partial reorder and competing writers', () => {
    const db = library()
    const a = db.saveTrip({ title: 'A' })
    const b = db.saveTrip({ title: 'B' })
    const v = db.saveVisit(visit(a.id))
    expect(() => db.saveTrip({ title: 'bad', startDate: '2025-02-30' })).toThrow()
    expect(() => db.saveEntry({ tripId: b.id, visitId: v.id, title: 'bad', markdown: '' })).toThrow()
    expect(() => db.reorderVisits(a.id, [])).toThrow()
    expect(() => new LibraryService(db.snapshot().library.path)).toThrow(/占用|锁|open|lock/i)
  })
  it('does not let changing trip dates strand an existing visit outside the trip', () => {
    const db = library()
    const trip = db.saveTrip({ title: 'A' })
    db.saveVisit(visit(trip.id))
    expect(() => db.saveTrip({ ...trip, startDate: '2025-03-02', endDate: '2025-03-03' })).toThrow()
    expect(db.snapshot().trips[0].startDate).toBe('')
  })
  it('restores soft-deleted trips and clears dependent references on permanent deletion', async () => {
    const db = library()
    const trip = db.saveTrip({ title: 'A' })
    const v = db.saveVisit(visit(trip.id))
    const entry = db.saveEntry({ tripId: trip.id, visitId: v.id, title: '日记', markdown: '' })
    db.deleteVisit(v.id)
    expect(db.snapshot().entries[0].visitId).toBeNull()
    db.trash('trip', trip.id)
    expect(db.snapshot().trips[0].deletedAt).toBeTruthy()
    db.restore('trip', trip.id)
    expect(db.snapshot().trips[0].deletedAt).toBeNull()
    db.trash('entry', entry.id)
    await db.emptyTrash()
    expect(db.snapshot().entries).toHaveLength(0)
  })
  it('backs up consistent data, validates hashes, and rejects overwrites and unsafe manifests', async () => {
    const db = library()
    db.saveTrip({ title: '备份' })
    const backup = folder()
    await db.backup(backup)
    const destination = folder()
    await LibraryService.restoreBackup(backup, destination)
    const restored = new LibraryService(destination)
    services.push(restored)
    expect(restored.snapshot().trips[0].title).toBe('备份')
    await expect(db.backup(backup)).rejects.toThrow()
    const manifestPath = join(backup, 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.files[0].path = '../escape.sqlite'
    writeFileSync(manifestPath, JSON.stringify(manifest))
    await expect(LibraryService.restoreBackup(backup, folder())).rejects.toThrow()
  })
  it('keeps demo data in demo libraries and seeds several cities only once', async () => {
    const assets = folder()
    mkdirSync(join(assets, 'demo'))
    await sharp({ create: { width: 12, height: 8, channels: 3, background: '#caa' } })
      .png()
      .toFile(join(assets, 'demo', 'one.png'))
    writeFileSync(
      join(assets, 'cities.json'),
      JSON.stringify([
        { id: 'geonames:1808926', name: '杭州', country: 'CN', lat: 30.29, lon: 120.16, aliases: '' }
      ])
    )
    const personal = new LibraryService(folder(), { assetsPath: assets })
    services.push(personal)
    await personal.seedDemo()
    expect(personal.snapshot().trips).toHaveLength(0)
    const demo = new LibraryService(folder(), { isDemo: true, assetsPath: assets })
    services.push(demo)
    await demo.seedDemo()
    await demo.seedDemo()
    expect(demo.snapshot().trips).toHaveLength(3)
    expect(new Set(demo.snapshot().places.map((p) => p.cityId)).size).toBeGreaterThan(3)
    expect(demo.snapshot().attachments).toHaveLength(3)
    expect(demo.snapshot().places.find((p) => p.cityName === '杭州')?.cityId).toBe('geonames:1808926')
  })
  it('blocks writes while backup is copying and rejects changed backup bytes', async () => {
    const db = library()
    db.saveTrip({ title: '原库' })
    const backup = folder()
    const pending = db.backup(backup)
    expect(() => db.saveTrip({ title: '备份中' })).toThrow()
    await pending
    const sqlite = join(backup, 'library.sqlite')
    const bytes = readFileSync(sqlite)
    bytes[bytes.length - 1] ^= 1
    writeFileSync(sqlite, bytes)
    await expect(LibraryService.restoreBackup(backup, folder())).rejects.toThrow(/校验/)
    expect(db.snapshot().trips).toHaveLength(1)
  })
})
