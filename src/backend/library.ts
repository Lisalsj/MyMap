import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  lstatSync,
  copyFileSync,
  realpathSync
} from 'node:fs'
import { join, resolve, extname } from 'node:path'
import { atomicWrite, emptyDirectory, fileHash, managedPath } from './files'
import { createPreviews, inspectImage, removeMedia, validateMediaPaths } from './media'
import { markdownPhotoIds, portableJournalMarkdown } from './markdown'
import type {
  AppSnapshot,
  Trip,
  TripInput,
  Entry,
  EntryInput,
  Visit,
  VisitInput,
  Photo,
  PhotoAttachment,
  EntityKind,
  ImportOptions,
  ImportProgress,
  Place,
  City
} from '../shared/types'

const VERSION = 1
const now = () => new Date().toISOString()
const initialProgress = (): ImportProgress => ({
  running: false,
  completed: 0,
  total: 0,
  imported: 0,
  duplicates: 0,
  errors: [],
  current: '',
  cancelled: false
})
const required = (value: unknown, label: string, max = 1000): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error(`${label}不能为空或过长`)
  return value.trim()
}
function date(value: unknown): string {
  if (value === '' || value == null) return ''
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new Error('日期无效，请使用 YYYY-MM-DD')
  return value
}
function coordinates(lat: number | null, lon: number | null): void {
  if (
    (lat == null) !== (lon == null) ||
    (lat != null && (!Number.isFinite(lat) || Math.abs(lat) > 90)) ||
    (lon != null && (!Number.isFinite(lon) || Math.abs(lon) > 180))
  )
    throw new Error('经纬度无效')
}

export class LibraryService {
  private db!: DatabaseSync
  private root: string
  private lockPath: string
  private lockToken = randomUUID()
  private options: { isDemo?: boolean; assetsPath?: string }
  private closed = false
  private busy = false
  private progress = initialProgress()
  constructor(path: string, options: { isDemo?: boolean; assetsPath?: string } = {}) {
    mkdirSync(resolve(path), { recursive: true })
    if (lstatSync(resolve(path)).isSymbolicLink()) throw new Error('资料目录不能是符号链接')
    this.root = realpathSync(path)
    this.options = options
    this.lockPath = join(this.root, '.mymap.lock')
    this.acquireLock()
    try {
      for (const dir of ['originals', 'previews', 'thumbs', 'snapshots']) {
        managedPath(this.root, dir)
        mkdirSync(join(this.root, dir), { recursive: true })
      }
      managedPath(this.root, 'library.sqlite')
      this.db = new DatabaseSync(join(this.root, 'library.sqlite'))
      this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
      this.migrate()
    } catch (error) {
      this.db?.close()
      this.releaseLock()
      throw error
    }
  }
  private acquireLock(): void {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = openSync(this.lockPath, 'wx')
        writeFileSync(fd, JSON.stringify({ pid: process.pid, token: this.lockToken }))
        closeSync(fd)
        return
      } catch (error: any) {
        if (error.code !== 'EEXIST') throw error
        if (lstatSync(this.lockPath).isSymbolicLink()) throw new Error('资料库锁文件不安全')
        let lock: { pid: number }
        try {
          lock = JSON.parse(readFileSync(this.lockPath, 'utf8'))
          if (!Number.isSafeInteger(lock.pid) || lock.pid < 1) throw new Error()
        } catch {
          throw new Error('资料库锁损坏，请关闭所有 MyMap 后检查 .mymap.lock')
        }
        try {
          process.kill(lock.pid, 0)
          throw new Error('资料库已被另一个 MyMap 占用（lock）')
        } catch (e: any) {
          if (e.code === 'ESRCH') {
            unlinkSync(this.lockPath)
            continue
          }
          throw e
        }
      }
    }
    throw new Error('无法获得资料库锁')
  }
  private releaseLock(): void {
    try {
      if (JSON.parse(readFileSync(this.lockPath, 'utf8')).token === this.lockToken) unlinkSync(this.lockPath)
    } catch {}
  }
  private migrate(): void {
    const version = Number((this.db.prepare('PRAGMA user_version').get() as any).user_version)
    if (version > VERSION) throw new Error('资料库由更新版本 MyMap 创建，请先升级应用')
    if (version === VERSION) return
    if (version > 0) {
      this.db.exec('PRAGMA wal_checkpoint(FULL)')
      copyFileSync(
        join(this.root, 'library.sqlite'),
        managedPath(this.root, `snapshots/v${version}-${Date.now()}.sqlite`)
      )
    }
    this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE trips(id TEXT PRIMARY KEY,title TEXT NOT NULL,startDate TEXT NOT NULL,endDate TEXT NOT NULL,description TEXT NOT NULL,tags TEXT NOT NULL,coverPhotoId TEXT REFERENCES photos(id) ON DELETE SET NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,deletedAt TEXT);
      CREATE TABLE places(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL,cityId TEXT NOT NULL,cityName TEXT NOT NULL,country TEXT NOT NULL,lat REAL,lon REAL);
      CREATE TABLE visits(id TEXT PRIMARY KEY,tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,placeId TEXT NOT NULL REFERENCES places(id),date TEXT NOT NULL,sortOrder INTEGER NOT NULL,note TEXT NOT NULL);
      CREATE TABLE entries(id TEXT PRIMARY KEY,tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,visitId TEXT REFERENCES visits(id) ON DELETE SET NULL,title TEXT NOT NULL,markdown TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,deletedAt TEXT);
      CREATE TABLE photos(id TEXT PRIMARY KEY,hash TEXT NOT NULL UNIQUE,originalName TEXT NOT NULL,mime TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,size INTEGER NOT NULL,capturedAt TEXT NOT NULL,lat REAL,lon REAL,originalPath TEXT NOT NULL,previewPath TEXT NOT NULL,thumbPath TEXT NOT NULL,createdAt TEXT NOT NULL,deletedAt TEXT);
      CREATE TABLE attachments(id TEXT PRIMARY KEY,photoId TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,visitId TEXT REFERENCES visits(id) ON DELETE SET NULL,entryId TEXT REFERENCES entries(id) ON DELETE SET NULL,caption TEXT NOT NULL,sortOrder INTEGER NOT NULL,deletedAt TEXT,UNIQUE(photoId,tripId));
      CREATE INDEX visits_trip ON visits(tripId,sortOrder); CREATE INDEX entries_trip ON entries(tripId); CREATE INDEX attachments_trip ON attachments(tripId); PRAGMA user_version = ${VERSION}; COMMIT;`)
  }
  private writable(): void {
    if (this.closed) throw new Error('资料库已关闭')
    if (this.busy) throw new Error('资料库正在导入或备份，请稍后再试')
  }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  private get<T>(table: string, id: string): T {
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id)
    if (!row) throw new Error('找不到指定资料')
    return row as T
  }
  private activeTrip(id: string): Trip {
    const trip = this.get<Trip>('trips', id)
    if (trip.deletedAt) throw new Error('请先恢复回收站中的旅行')
    return trip
  }
  private associations(tripId: string, visitId?: string | null, entryId?: string | null): void {
    this.activeTrip(tripId)
    if (visitId && this.get<Visit>('visits', visitId).tripId !== tripId) throw new Error('到访不属于当前旅行')
    if (entryId) {
      const entry = this.get<Entry>('entries', entryId)
      if (entry.tripId !== tripId || entry.deletedAt) throw new Error('游记不属于当前旅行或已删除')
    }
  }
  private upsert(table: string, record: object): void {
    const keys = Object.keys(record)
    const values = Object.values(record).map((value) =>
      Array.isArray(value) ? JSON.stringify(value) : value
    )
    this.db
      .prepare(
        `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${keys
          .filter((k) => k !== 'id')
          .map((k) => `${k}=excluded.${k}`)
          .join(',')}`
      )
      .run(...values)
  }
  snapshot(): AppSnapshot {
    if (this.closed) throw new Error('资料库已关闭')
    const rows = (table: string) => this.db.prepare(`SELECT * FROM ${table}`).all() as any[]
    return {
      library: { path: this.root, isDemo: !!this.options.isDemo, version: VERSION },
      trips: rows('trips').map((row) => ({ ...row, tags: JSON.parse(row.tags) })),
      places: rows('places'),
      visits: rows('visits').sort((a, b) => a.sortOrder - b.sortOrder),
      entries: rows('entries'),
      photos: rows('photos'),
      attachments: rows('attachments')
    }
  }
  saveTrip(input: TripInput): Trip {
    this.writable()
    const previous = input.id ? this.snapshot().trips.find((t) => t.id === input.id) : undefined
    if (input.id && !previous) throw new Error('旅行不存在')
    const timestamp = now()
    const startDate = date(input.startDate ?? previous?.startDate ?? '')
    const endDate = date(input.endDate ?? previous?.endDate ?? '')
    if (startDate && endDate && startDate > endDate) throw new Error('旅行结束日期不能早于开始日期')
    if (
      previous &&
      this.db
        .prepare(
          "SELECT id FROM visits WHERE tripId=? AND date<>'' AND ((?<>'' AND date<?) OR (?<>'' AND date>?)) LIMIT 1"
        )
        .get(previous.id, startDate, startDate, endDate, endDate)
    )
      throw new Error('旅行日期范围必须包含已有到访日期')
    const tags = input.tags ?? previous?.tags ?? []
    if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string' || t.length > 100) || tags.length > 50)
      throw new Error('标签无效')
    const coverPhotoId =
      input.coverPhotoId === undefined ? previous?.coverPhotoId || null : input.coverPhotoId
    if (coverPhotoId) {
      this.get<Photo>('photos', coverPhotoId)
      if (
        !input.id ||
        !this.db
          .prepare('SELECT id FROM attachments WHERE photoId=? AND tripId=?')
          .get(coverPhotoId, input.id)
      )
        throw new Error('封面照片不属于当前旅行')
    }
    const trip: Trip = {
      id: previous?.id || randomUUID(),
      title: required(input.title, '旅行标题', 200),
      startDate,
      endDate,
      description: input.description ?? previous?.description ?? '',
      tags,
      coverPhotoId,
      createdAt: previous?.createdAt || timestamp,
      updatedAt: timestamp,
      deletedAt: previous?.deletedAt || null
    }
    this.upsert('trips', trip)
    return trip
  }
  saveEntry(input: EntryInput): Entry {
    this.writable()
    this.associations(input.tripId, input.visitId)
    const previous = input.id ? this.get<Entry>('entries', input.id) : undefined
    if (previous && previous.tripId !== input.tripId) throw new Error('不能跨旅行移动游记')
    if (typeof input.markdown !== 'string' || input.markdown.length > 5_000_000)
      throw new Error('游记内容过长')
    const previousPhotos = new Set(markdownPhotoIds(previous?.markdown || ''))
    for (const photoId of markdownPhotoIds(input.markdown))
      if (
        !this.db
          .prepare('SELECT id FROM attachments WHERE photoId=? AND tripId=?')
          .get(photoId, input.tripId) &&
        !previousPhotos.has(photoId)
      )
        throw new Error('游记照片不属于当前旅行')
    const entry: Entry = {
      id: previous?.id || randomUUID(),
      tripId: input.tripId,
      visitId: input.visitId === undefined ? previous?.visitId || null : input.visitId,
      title: required(input.title, '游记标题', 200),
      markdown: input.markdown,
      createdAt: previous?.createdAt || now(),
      updatedAt: now(),
      deletedAt: previous?.deletedAt || null
    }
    this.associations(entry.tripId, entry.visitId)
    this.upsert('entries', entry)
    return entry
  }
  saveVisit(input: VisitInput): Visit {
    this.writable()
    this.activeTrip(input.tripId)
    coordinates(input.lat, input.lon)
    const previous = input.id ? this.get<Visit>('visits', input.id) : undefined
    if (previous && previous.tripId !== input.tripId) throw new Error('不能跨旅行移动到访')
    const visitDate = date(input.date)
    const trip = this.activeTrip(input.tripId)
    if (
      visitDate &&
      ((trip.startDate && visitDate < trip.startDate) || (trip.endDate && visitDate > trip.endDate))
    )
      throw new Error('到访日期必须在旅行日期范围内')
    if (!['city', 'scenic', 'custom'].includes(input.kind)) throw new Error('地点类型无效')
    const name = required(input.name, '地点名称', 300)
    const cityId = input.kind === 'custom' && !input.cityId ? '' : required(input.cityId, '城市编号', 200)
    return this.transaction(() => {
      let place: Place | undefined
      if (input.placeId) {
        place = this.get<Place>('places', input.placeId)
        if (place.cityId !== cityId) throw new Error('地点与城市不匹配')
      } else
        place = this.db
          .prepare('SELECT * FROM places WHERE name=? AND cityId=? AND kind=? AND lat IS ? AND lon IS ?')
          .get(name, cityId, input.kind, input.lat, input.lon) as unknown as Place | undefined
      if (!place) {
        place = {
          id: randomUUID(),
          name,
          kind: input.kind,
          cityId,
          cityName: cityId ? required(input.cityName, '城市名称', 200) : '',
          country: input.country || '',
          lat: input.lat,
          lon: input.lon
        }
        this.upsert('places', place)
      }
      const count = Number(
        (
          this.db
            .prepare('SELECT coalesce(max(sortOrder),-1)+1 AS n FROM visits WHERE tripId=?')
            .get(input.tripId) as any
        ).n
      )
      const visit: Visit = {
        id: previous?.id || randomUUID(),
        tripId: input.tripId,
        placeId: place.id,
        date: visitDate,
        sortOrder: previous?.sortOrder ?? count,
        note: input.note || ''
      }
      this.upsert('visits', visit)
      return visit
    })
  }
  deleteVisit(id: string): void {
    this.writable()
    this.get<Visit>('visits', id)
    this.db.prepare('DELETE FROM visits WHERE id=?').run(id)
  }
  reorderVisits(tripId: string, ids: string[]): void {
    this.writable()
    this.activeTrip(tripId)
    const visits = this.db.prepare('SELECT id FROM visits WHERE tripId=?').all(tripId)
    if (
      !Array.isArray(ids) ||
      ids.length !== visits.length ||
      new Set(ids).size !== ids.length ||
      visits.some((v) => !ids.includes(String(v.id)))
    )
      throw new Error('排序必须包含旅行的全部到访且不能重复')
    this.transaction(() =>
      ids.forEach((id, index) => this.db.prepare('UPDATE visits SET sortOrder=? WHERE id=?').run(index, id))
    )
  }
  private entityTable(kind: EntityKind): string {
    const table = { trip: 'trips', entry: 'entries', attachment: 'attachments' }[kind]
    if (!table) throw new Error('未知资料类型')
    return table
  }
  trash(kind: EntityKind, id: string): void {
    this.writable()
    const table = this.entityTable(kind)
    this.get(table, id)
    this.db.prepare(`UPDATE ${table} SET deletedAt=? WHERE id=?`).run(now(), id)
  }
  restore(kind: EntityKind, id: string): void {
    this.writable()
    const table = this.entityTable(kind)
    const row = this.get<any>(table, id)
    if (kind !== 'trip') this.activeTrip(row.tripId)
    this.db.prepare(`UPDATE ${table} SET deletedAt=NULL WHERE id=?`).run(id)
  }
  async emptyTrash(): Promise<void> {
    this.writable()
    this.busy = true
    try {
      const orphaned = this.transaction(() => {
        this.db.exec(`UPDATE trips SET coverPhotoId=NULL WHERE coverPhotoId IS NOT NULL
          AND EXISTS (SELECT 1 FROM attachments a WHERE a.tripId=trips.id AND a.photoId=trips.coverPhotoId AND a.deletedAt IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.tripId=trips.id AND a.photoId=trips.coverPhotoId AND a.deletedAt IS NULL);
          DELETE FROM attachments WHERE deletedAt IS NOT NULL; DELETE FROM entries WHERE deletedAt IS NOT NULL; DELETE FROM trips WHERE deletedAt IS NOT NULL; DELETE FROM places WHERE id NOT IN (SELECT placeId FROM visits);`)
        const references = new Set(
          this.db
            .prepare('SELECT markdown FROM entries')
            .all()
            .flatMap((row) => markdownPhotoIds(String(row.markdown)))
        )
        const unreferenced = (
          this.db
            .prepare(
              'SELECT * FROM photos WHERE id NOT IN (SELECT photoId FROM attachments) AND id NOT IN (SELECT coverPhotoId FROM trips WHERE coverPhotoId IS NOT NULL)'
            )
            .all() as unknown as Photo[]
        ).filter((p) => !references.has(p.id))
        for (const photo of unreferenced) {
          validateMediaPaths(photo)
          ;[photo.originalPath, photo.previewPath, photo.thumbPath].forEach((path) =>
            managedPath(this.root, path)
          )
          this.db.prepare('DELETE FROM photos WHERE id=?').run(photo.id)
        }
        return unreferenced
      })
      for (const photo of orphaned) removeMedia(this.root, photo)
    } finally {
      this.busy = false
    }
  }
  updateAttachment(
    id: string,
    patch: { caption?: string; sortOrder?: number; visitId?: string | null; entryId?: string | null }
  ): void {
    this.writable()
    const previous = this.get<PhotoAttachment>('attachments', id)
    const next = {
      ...previous,
      caption: patch.caption ?? previous.caption,
      sortOrder: patch.sortOrder ?? previous.sortOrder,
      visitId: patch.visitId === undefined ? previous.visitId : patch.visitId,
      entryId: patch.entryId === undefined ? previous.entryId : patch.entryId
    }
    if (
      typeof next.caption !== 'string' ||
      next.caption.length > 5000 ||
      !Number.isSafeInteger(next.sortOrder) ||
      next.sortOrder < 0
    )
      throw new Error('照片说明或排序无效')
    this.associations(next.tripId, next.visitId, next.entryId)
    this.upsert('attachments', next)
  }
  confirmPhotoLocation(photoId: string, attachmentId?: string): Visit {
    this.writable()
    const photo = this.get<Photo>('photos', photoId)
    if (photo.lat == null || photo.lon == null) throw new Error('照片没有 GPS 坐标')
    const attachments = this.db
      .prepare(
        'SELECT a.* FROM attachments a JOIN trips t ON a.tripId=t.id WHERE a.photoId=? AND a.deletedAt IS NULL AND t.deletedAt IS NULL'
      )
      .all(photoId) as unknown as PhotoAttachment[]
    if (attachmentId === undefined && attachments.length > 1)
      throw new Error('照片属于多个旅行，请先选择所属旅行')
    const attachment =
      attachmentId === undefined ? attachments[0] : attachments.find((row) => row.id === attachmentId)
    if (attachmentId !== undefined && !attachment)
      throw new Error('照片关联不匹配，或所属旅行/照片关联已在回收站')
    if (!attachment) throw new Error('照片需要先归入旅行')
    if (attachment.visitId) {
      this.associations(attachment.tripId, attachment.visitId)
      return this.get<Visit>('visits', attachment.visitId)
    }
    const trip = this.activeTrip(attachment.tripId)
    let visitDate = photo.capturedAt.slice(0, 10)
    if ((trip.startDate && visitDate < trip.startDate) || (trip.endDate && visitDate > trip.endDate))
      visitDate = ''
    const city = this.nearestCity(photo.lat, photo.lon)
    const visit = this.saveVisit({
      tripId: attachment.tripId,
      name: '照片拍摄地点',
      kind: 'custom',
      cityId: city?.id || '',
      cityName: city?.name || '',
      country: city?.country || '',
      lat: photo.lat,
      lon: photo.lon,
      date: visitDate,
      note: '根据照片 GPS，由用户确认添加。'
    })
    this.updateAttachment(attachment.id, { visitId: visit.id })
    return visit
  }
  photoPath(id: string, variant: 'thumb' | 'preview' | 'original'): string {
    if (!['thumb', 'preview', 'original'].includes(variant)) throw new Error('未知照片版本')
    const photo = this.get<Photo>('photos', id)
    validateMediaPaths(photo)
    const target = managedPath(this.root, photo[`${variant}Path`])
    if (!existsSync(target) || !lstatSync(target).isFile()) throw new Error('照片文件缺失')
    return target
  }
  private nearestCity(lat: number, lon: number): City | undefined {
    if (!this.options.assetsPath) return undefined
    try {
      const cities = JSON.parse(readFileSync(join(this.options.assetsPath, 'cities.json'), 'utf8')) as City[]
      let nearest: City | undefined
      let shortest = 75
      const rad = (degrees: number) => (degrees * Math.PI) / 180
      for (const city of cities) {
        if (!city.id || !Number.isFinite(city.lat) || !Number.isFinite(city.lon)) continue
        const a =
          Math.sin(rad(city.lat - lat) / 2) ** 2 +
          Math.cos(rad(lat)) * Math.cos(rad(city.lat)) * Math.sin(rad(city.lon - lon) / 2) ** 2
        const distance = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
        if (distance < shortest) {
          shortest = distance
          nearest = city
        }
      }
      return nearest
    } catch {
      return undefined
    }
  }
  importProgress(): ImportProgress {
    return { ...this.progress, errors: [...this.progress.errors] }
  }
  cancelImport(): void {
    if (this.progress.running) this.progress.cancelled = true
  }
  async importPhotos(
    paths: string[],
    tripId: string,
    options: ImportOptions = {},
    onProgress: (progress: ImportProgress) => void = () => {}
  ): Promise<ImportProgress> {
    this.writable()
    this.associations(tripId, options.visitId, options.entryId)
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string')) throw new Error('导入文件列表无效')
    this.busy = true
    this.progress = { ...initialProgress(), running: true, total: paths.length }
    const publish = () => {
      try {
        onProgress(this.importProgress())
      } catch {
        /* A disconnected viewer must not abort copying. */
      }
    }
    publish()
    try {
      for (const source of paths) {
        if (this.progress.cancelled) break
        this.progress.current = source
        publish()
        let created: Photo | undefined
        try {
          const image = await inspectImage(source)
          let photo = this.db.prepare('SELECT * FROM photos WHERE hash=?').get(image.hash) as unknown as
            Photo | undefined
          if (!photo) {
            const id = randomUUID()
            const { bytes, ext, ...fields } = image
            photo = {
              id,
              ...fields,
              originalPath: `originals/${image.hash}.${ext}`,
              previewPath: `previews/${id}.webp`,
              thumbPath: `thumbs/${id}.webp`,
              createdAt: now(),
              deletedAt: null
            }
            created = photo
            atomicWrite(managedPath(this.root, photo.originalPath), bytes)
            await createPreviews(this.root, photo)
          }
          const already = this.db
            .prepare('SELECT id FROM attachments WHERE photoId=? AND tripId=?')
            .get(photo.id, tripId)
          this.transaction(() => {
            if (created) this.upsert('photos', photo!)
            if (already) this.db.prepare('UPDATE attachments SET deletedAt=NULL WHERE id=?').run(already.id)
            else
              this.upsert('attachments', {
                id: randomUUID(),
                photoId: photo!.id,
                tripId,
                visitId: options.visitId || null,
                entryId: options.entryId || null,
                caption: '',
                sortOrder: Number(
                  (
                    this.db
                      .prepare('SELECT coalesce(max(sortOrder),-1)+1 AS n FROM attachments WHERE tripId=?')
                      .get(tripId) as any
                  ).n
                ),
                deletedAt: null
              })
          })
          if (created) this.progress.imported++
          else this.progress.duplicates++
        } catch (error) {
          let message = error instanceof Error ? error.message : String(error)
          if (created && !this.db.prepare('SELECT id FROM photos WHERE id=?').get(created.id)) {
            try {
              removeMedia(this.root, created)
            } catch (cleanupError) {
              message += `；清理被安全边界阻止：${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
            }
          }
          this.progress.errors.push(`${source}: ${message}`)
        }
        this.progress.completed++
        publish()
        await new Promise<void>((resolveTick) => setImmediate(resolveTick))
      }
    } finally {
      this.progress.running = false
      this.progress.current = ''
      this.busy = false
      publish()
    }
    return this.importProgress()
  }
  async backup(destination: string): Promise<string> {
    this.writable()
    this.busy = true
    try {
      const target = emptyDirectory(destination)
      const sqlite = managedPath(target, 'library.sqlite')
      await sqliteBackup(this.db, sqlite)
      const files: { path: string; hash: string; size: number }[] = [
        { path: 'library.sqlite', hash: fileHash(sqlite), size: lstatSync(sqlite).size }
      ]
      for (const photo of this.snapshot().photos) {
        const original = this.photoPath(photo.id, 'original')
        const output = managedPath(target, photo.originalPath)
        mkdirSync(join(target, 'originals'), { recursive: true })
        copyFileSync(original, output)
        files.push({ path: photo.originalPath, hash: fileHash(output), size: lstatSync(output).size })
      }
      atomicWrite(
        managedPath(target, 'manifest.json'),
        JSON.stringify(
          { format: 'mymap-backup', version: 1, schemaVersion: VERSION, createdAt: now(), files },
          null,
          2
        )
      )
      return target
    } finally {
      this.busy = false
    }
  }
  static async restoreBackup(source: string, destination: string): Promise<void> {
    const backupRoot = resolve(source)
    if (lstatSync(backupRoot).isSymbolicLink()) throw new Error('备份不能是符号链接')
    const manifest = JSON.parse(readFileSync(managedPath(backupRoot, 'manifest.json'), 'utf8'))
    if (
      manifest.format !== 'mymap-backup' ||
      manifest.version !== 1 ||
      manifest.schemaVersion !== VERSION ||
      !Array.isArray(manifest.files) ||
      !manifest.files.some((f: any) => f.path === 'library.sqlite')
    )
      throw new Error('备份版本或清单无效')
    const seen = new Set<string>()
    for (const file of manifest.files) {
      if (
        typeof file.path !== 'string' ||
        (file.path !== 'library.sqlite' && !/^originals\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(file.path)) ||
        seen.has(file.path)
      )
        throw new Error('备份文件路径无效')
      seen.add(file.path)
      const path = managedPath(backupRoot, file.path)
      if (!lstatSync(path).isFile() || lstatSync(path).size !== file.size || fileHash(path) !== file.hash)
        throw new Error('备份校验失败，文件已损坏')
    }
    const target = emptyDirectory(destination)
    const copied: string[] = []
    let service: LibraryService | undefined
    try {
      for (const file of manifest.files) {
        const output = managedPath(target, file.path)
        if (file.path.startsWith('originals/')) mkdirSync(join(target, 'originals'), { recursive: true })
        copyFileSync(managedPath(backupRoot, file.path), output)
        copied.push(output)
      }
      service = new LibraryService(target)
      const integrity = service.db.prepare('PRAGMA integrity_check').get() as any
      if (integrity.integrity_check !== 'ok' || service.db.prepare('PRAGMA foreign_key_check').all().length)
        throw new Error('备份数据库损坏')
      for (const photo of service.snapshot().photos) {
        if (!seen.has(photo.originalPath)) throw new Error('备份缺少原图')
        if (fileHash(service.photoPath(photo.id, 'original')) !== photo.hash)
          throw new Error('照片哈希校验失败')
        await createPreviews(target, photo)
      }
    } catch (error) {
      service?.close()
      for (const file of copied) if (existsSync(file)) unlinkSync(file)
      throw error
    } finally {
      service?.close()
    }
  }
  async exportEntry(id: string, destination: string): Promise<string> {
    this.writable()
    const entry = this.get<Entry>('entries', id)
    const target = emptyDirectory(destination)
    const photos = new Set([
      ...markdownPhotoIds(entry.markdown),
      ...this.snapshot()
        .attachments.filter((a) => a.entryId === id && !a.deletedAt)
        .map((a) => a.photoId)
    ])
    const local = new Map<string, string>()
    for (const photoId of photos) {
      const photo = this.get<Photo>('photos', photoId)
      const relative = `assets/${photoId}${extname(photo.originalPath)}`
      const output = managedPath(target, relative)
      mkdirSync(join(target, 'assets'), { recursive: true })
      copyFileSync(this.photoPath(photoId, 'original'), output)
      local.set(photoId, relative)
    }
    const markdown = portableJournalMarkdown(entry.markdown, entry.title, local)
    const file = managedPath(target, 'journal.md')
    atomicWrite(file, markdown)
    return file
  }
  async seedDemo(): Promise<void> {
    this.writable()
    if (!this.options.isDemo || this.snapshot().trips.length) return
    const stories = [
      {
        title: '江南，慢一点',
        start: '2025-04-12',
        end: '2025-04-15',
        city: '杭州',
        cityId: 'cn-hangzhou',
        country: '中国',
        lat: 30.25,
        lon: 120.15,
        place: '西湖',
        text: '雨停后走过湖边，茶香藏在小巷里。\n\n这是一段虚构的演示旅行，可以放心探索。'
      },
      {
        title: '山海之间',
        start: '2025-07-08',
        end: '2025-07-12',
        city: '青岛',
        cityId: 'cn-qingdao',
        country: '中国',
        lat: 36.06,
        lon: 120.38,
        place: '海边散步',
        text: '把鞋提在手上，让潮水追着脚步。\n\n今天的任务只有一件：看完日落。'
      },
      {
        title: '秋天的远行',
        start: '2025-10-03',
        end: '2025-10-09',
        city: '京都',
        cityId: 'jp-kyoto',
        country: '日本',
        lat: 35.01,
        lon: 135.77,
        place: '鸭川',
        text: '沿着河岸走，收集秋天的光。\n\n照片与文字是演示内容，个人资料库不会加入这些记录。'
      }
    ]
    const demoDir = this.options.assetsPath ? join(this.options.assetsPath, 'demo') : ''
    const demoFiles =
      demoDir && existsSync(demoDir)
        ? readdirSync(demoDir)
            .filter((file) => /\.(jpg|jpeg|png|webp)$/i.test(file))
            .map((file) => join(demoDir, file))
        : []
    const detours = [
      {
        name: '苏州',
        id: 'cn-suzhou',
        country: '中国',
        lat: 31.3,
        lon: 120.58,
        date: '2025-04-14',
        place: '平江路'
      },
      {
        name: '烟台',
        id: 'cn-yantai',
        country: '中国',
        lat: 37.46,
        lon: 121.45,
        date: '2025-07-10',
        place: '沿海公路'
      },
      {
        name: '大阪',
        id: 'jp-osaka',
        country: '日本',
        lat: 34.69,
        lon: 135.5,
        date: '2025-10-07',
        place: '中之岛'
      }
    ]
    let cities: City[] = []
    try {
      if (this.options.assetsPath)
        cities = JSON.parse(readFileSync(join(this.options.assetsPath, 'cities.json'), 'utf8'))
    } catch {}
    const canonical = (name: string, country: string, fallbackId: string) => {
      const code = country === '中国' ? 'CN' : country === '日本' ? 'JP' : country
      const city = cities.find((c) => c.country === code && c.name === name)
      return { cityId: city?.id || fallbackId, cityName: city?.name || name, country: city?.country || code }
    }
    for (const [index, story] of stories.entries()) {
      const trip = this.saveTrip({
        title: story.title,
        startDate: story.start,
        endDate: story.end,
        description: '虚构演示旅行 · 在这里预览你的旅行手账',
        tags: ['演示', index === 1 ? '海边' : '慢旅行']
      })
      const visit = this.saveVisit({
        tripId: trip.id,
        name: story.place,
        kind: 'scenic',
        ...canonical(story.city, story.country, story.cityId),
        lat: story.lat,
        lon: story.lon,
        date: story.start,
        note: '记住这一刻'
      })
      const detour = detours[index]
      this.saveVisit({
        tripId: trip.id,
        name: detour.place,
        kind: 'scenic',
        ...canonical(detour.name, detour.country, detour.id),
        lat: detour.lat,
        lon: detour.lon,
        date: detour.date,
        note: '下一站，也有惊喜。'
      })
      const entry = this.saveEntry({
        tripId: trip.id,
        visitId: visit.id,
        title: `${story.city}的一天`,
        markdown: story.text
      })
      if (demoFiles.length)
        await this.importPhotos(
          [demoFiles[index % demoFiles.length]],
          trip.id,
          { visitId: visit.id, entryId: entry.id },
          () => {}
        )
      const photo = this.snapshot().attachments.find((a) => a.tripId === trip.id)
      if (photo) this.saveTrip({ ...trip, coverPhotoId: photo.photoId })
    }
  }
  close(): void {
    if (this.closed) return
    if (this.busy) {
      this.cancelImport()
      throw new Error('请等待导入或备份完成后关闭资料库')
    }
    this.db.close()
    this.closed = true
    this.releaseLock()
  }
}
