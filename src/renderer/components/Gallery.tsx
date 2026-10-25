import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ImagePlus,
  MapPin,
  Search,
  Star,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { photoUrl, type AppSnapshot, type ImportProgress, type PhotoAttachment } from '../../shared/types'
import { activeAttachments, activeEntries, activeTrips, matches, orderedVisits } from '../model'
import { Empty, Modal, Spinner } from './Common'

interface Props {
  snapshot: AppSnapshot
  tripId: string
  run: (operation: () => Promise<unknown>, success?: string) => Promise<boolean>
  refresh: () => Promise<void>
  confirmTrash: (id: string) => void
}
const initialProgress: ImportProgress = {
  running: false,
  completed: 0,
  total: 0,
  imported: 0,
  duplicates: 0,
  errors: [],
  current: '',
  cancelled: false
}
export function Gallery({ snapshot, tripId, run, refresh, confirmTrash }: Props) {
  const [filterTrip, setFilterTrip] = useState(tripId),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [lightbox, setLightbox] = useState<string | null>(null),
    [progress, setProgress] = useState(initialProgress),
    [dragging, setDragging] = useState(false),
    [importing, setImporting] = useState(false),
    [error, setError] = useState('')
  const items = useMemo(
    () =>
      activeAttachments(snapshot)
        .filter((a) => (!filterTrip || a.tripId === filterTrip) && matches(a.caption, query))
        .sort((a, b) => a.tripId.localeCompare(b.tripId) || a.sortOrder - b.sortOrder),
    [snapshot, filterTrip, query]
  )
  const pages = Math.max(1, Math.ceil(items.length / 60))
  const selected = items.find((a) => a.id === lightbox)
  useEffect(() => {
    setPage(0)
  }, [filterTrip, query])
  useEffect(() => {
    if (page >= pages) setPage(pages - 1)
  }, [pages, page])
  useEffect(() => {
    const off = window.myMap.onProgress((p) => {
      setProgress(p)
      if (!p.running) void refresh().catch((e) => setError(String(e)))
    })
    window.myMap
      .importProgress()
      .then(setProgress)
      .catch((e) => setError(String(e)))
    return off
  }, [refresh])
  async function importPhotos(files?: File[]) {
    if (!filterTrip) {
      setError('请先选择这些照片所属的旅行。')
      return
    }
    setError('')
    setImporting(true)
    try {
      if (files) await window.myMap.importDroppedPhotos(filterTrip, files)
      else await window.myMap.importPhotos(filterTrip)
      await refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setImporting(false)
    }
  }
  function step(direction: number) {
    if (!selected) return
    const index = items.indexOf(selected)
    setLightbox(items[(index + direction + items.length) % items.length]?.id || null)
  }
  useEffect(() => {
    if (!lightbox) return
    const listener = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return
      if (e.key === 'ArrowLeft') step(-1)
      if (e.key === 'ArrowRight') step(1)
      if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [lightbox, items])
  return (
    <section
      className={`gallery-page ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        void importPhotos([...e.dataTransfer.files])
      }}
    >
      <div className="gallery-toolbar">
        <div className="input-icon">
          <Search size={16} />
          <input placeholder="寻找照片里的故事…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select aria-label="照片所属旅行" value={filterTrip} onChange={(e) => setFilterTrip(e.target.value)}>
          <option value="">所有旅行 · 导入前请选择</option>
          {activeTrips(snapshot).map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        <span className="muted photo-count">{items.length} 张回忆</span>
        <button
          className="button primary"
          disabled={importing || progress.running || !filterTrip}
          onClick={() => importPhotos()}
        >
          {importing ? <Spinner /> : <Upload size={16} />}导入照片
        </button>
      </div>
      <p className="gallery-hint">把照片拖到这里，也能收藏回忆。原图会保留在原来的位置。</p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {(progress.running || progress.total > 0) && (
        <div className="import-progress">
          <div>
            <strong>
              {progress.running
                ? '正在把回忆收进相册…'
                : progress.cancelled
                  ? '已停止导入'
                  : '照片导入已结束'}
            </strong>
            <span>
              {progress.completed} / {progress.total} · 新增 {progress.imported} · 重复 {progress.duplicates}
            </span>
            {progress.running && (
              <button className="text-button" onClick={() => run(() => window.myMap.cancelImport())}>
                停止导入
              </button>
            )}
          </div>
          <progress value={progress.completed} max={Math.max(1, progress.total)} />
          {progress.errors.length > 0 && (
            <details>
              <summary>{progress.errors.length} 个文件未能导入，展开查看</summary>
              <ul>
                {progress.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {items.length ? (
        <>
          <div className="photo-grid">
            {items.slice(page * 60, (page + 1) * 60).map((a) => {
              const p = snapshot.photos.find((p) => p.id === a.photoId)!
              return (
                <button className="photo-tile" key={a.id} onClick={() => setLightbox(a.id)}>
                  <img src={photoUrl(p.id)} loading="lazy" alt={a.caption || '旅行照片'} />
                  <div className="photo-tile-meta">
                    <span>{a.caption || '未写说明的回忆'}</span>
                    <small>{snapshot.trips.find((t) => t.id === a.tripId)?.title}</small>
                  </div>
                  {snapshot.trips.find((t) => t.id === a.tripId)?.coverPhotoId === a.photoId && (
                    <span className="cover-badge">
                      <Star size={11} />
                      封面
                    </span>
                  )}
                  {p.lat !== null && p.lon !== null && <MapPin className="photo-location" size={16} />}
                </button>
              )
            })}
          </div>
          <div className="pagination">
            <button className="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
              <ArrowLeft size={15} />
              上一页
            </button>
            <span>
              {page + 1} / {pages} 页 · 每页最多 60 张
            </span>
            <button className="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
              下一页
              <ArrowRight size={15} />
            </button>
          </div>
        </>
      ) : (
        <Empty
          title="收藏一束光，一段时光"
          description={
            query
              ? '还没有找到符合条件的照片，换一个词试试。'
              : '选择一段旅行，导入沿途拍下的照片。那些走过的路，会在这里慢慢清晰。'
          }
          action={filterTrip ? () => importPhotos() : undefined}
          label="导入旅行照片"
        />
      )}
      {dragging && (
        <div className="drop-overlay">
          <ImagePlus size={48} />
          <h2>把回忆留在这里</h2>
          <p>{filterTrip ? '松开鼠标，导入到所选旅行' : '先选择一段旅行，再拖入照片'}</p>
        </div>
      )}
      {selected && (
        <PhotoDetail
          key={selected.id}
          attachment={selected}
          snapshot={snapshot}
          onClose={() => setLightbox(null)}
          onStep={step}
          run={run}
          confirmTrash={() => {
            setLightbox(null)
            confirmTrash(selected.id)
          }}
        />
      )}
    </section>
  )
}

function PhotoDetail({
  attachment: a,
  snapshot,
  onClose,
  onStep,
  run,
  confirmTrash
}: {
  attachment: PhotoAttachment
  snapshot: AppSnapshot
  onClose: () => void
  onStep: (d: number) => void
  run: Props['run']
  confirmTrash: () => void
}) {
  const photo = snapshot.photos.find((p) => p.id === a.photoId)!,
    trip = snapshot.trips.find((t) => t.id === a.tripId)!
  const [caption, setCaption] = useState(a.caption),
    [visitId, setVisitId] = useState(a.visitId || ''),
    [entryId, setEntryId] = useState(a.entryId || ''),
    [saving, setSaving] = useState(false),
    [gpsConfirm, setGpsConfirm] = useState(false)
  async function save() {
    setSaving(true)
    await run(
      () =>
        window.myMap.updateAttachment(a.id, { caption, visitId: visitId || null, entryId: entryId || null }),
      '照片说明已保存'
    )
    setSaving(false)
  }
  async function reorder(direction: number) {
    const group = activeAttachments(snapshot)
        .filter((x) => x.tripId === a.tripId)
        .sort((x, y) => x.sortOrder - y.sortOrder),
      i = group.findIndex((x) => x.id === a.id),
      other = group[i + direction]
    if (!other) return
    await run(async () => {
      await window.myMap.updateAttachment(a.id, { sortOrder: other.sortOrder })
      await window.myMap.updateAttachment(other.id, { sortOrder: a.sortOrder })
    })
  }
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="照片详情">
      <div className="lightbox-stage">
        <button className="lightbox-close icon-button" aria-label="关闭照片" onClick={onClose}>
          <X size={22} />
        </button>
        <button className="lightbox-prev icon-button" aria-label="上一张照片" onClick={() => onStep(-1)}>
          <ArrowLeft size={24} />
        </button>
        <img src={photoUrl(photo.id, 'preview')} alt={caption || '旅行照片'} />
        <button className="lightbox-next icon-button" aria-label="下一张照片" onClick={() => onStep(1)}>
          <ArrowRight size={24} />
        </button>
        <span className="lightbox-tip">← → 切换照片 · ESC 关闭</span>
      </div>
      <aside className="photo-details">
        <span className="eyebrow">A MOMENT TO KEEP</span>
        <h2>光阴的切片</h2>
        <p className="muted">{trip.title}</p>
        <label>
          照片说明
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="这一刻，有什么想记下来？"
            rows={4}
          />
        </label>
        <label>
          关联到访地点
          <select value={visitId} onChange={(e) => setVisitId(e.target.value)}>
            <option value="">不关联地点</option>
            {orderedVisits(snapshot, a.tripId).map((v) => (
              <option value={v.id} key={v.id}>
                {snapshot.places.find((p) => p.id === v.placeId)?.name} {v.date}
              </option>
            ))}
          </select>
        </label>
        <label>
          关联旅行手记
          <select value={entryId} onChange={(e) => setEntryId(e.target.value)}>
            <option value="">不关联手记</option>
            {activeEntries(snapshot)
              .filter((e) => e.tripId === a.tripId)
              .map((e) => (
                <option value={e.id} key={e.id}>
                  {e.title}
                </option>
              ))}
          </select>
        </label>
        <button className="button primary" disabled={saving} onClick={save}>
          {saving ? <Spinner /> : <Check size={15} />}保存照片说明
        </button>
        <div className="photo-actions">
          <button
            className="button"
            onClick={() =>
              run(() => window.myMap.saveTrip({ ...trip, coverPhotoId: a.photoId }), '已设为旅行封面')
            }
          >
            <Star size={15} />
            {trip.coverPhotoId === a.photoId ? '已是旅行封面' : '设为旅行封面'}
          </button>
          <div className="form-row">
            <button className="button" onClick={() => reorder(-1)}>
              <ArrowUp size={14} />
              向前排序
            </button>
            <button className="button" onClick={() => reorder(1)}>
              <ArrowDown size={14} />
              向后排序
            </button>
          </div>
          {photo.lat !== null && photo.lon !== null && (
            <button className="button" onClick={() => setGpsConfirm(true)}>
              <MapPin size={15} />
              将拍摄位置加入足迹
            </button>
          )}
          <button className="button danger" onClick={confirmTrash}>
            <Trash2 size={15} />
            移到回收站
          </button>
        </div>
        <small className="muted">
          {photo.width} × {photo.height} · {(photo.size / 1024 / 1024).toFixed(1)} MB
          <br />
          {photo.capturedAt ? `拍摄于 ${photo.capturedAt.slice(0, 10)}` : '未记录拍摄日期'}
        </small>
      </aside>
      {gpsConfirm && (
        <Modal title="确认照片中的位置" onClose={() => setGpsConfirm(false)}>
          <div className="form">
            <p>这张照片带有拍摄位置。确认后，将在所属旅行中添加一条到访记录。</p>
            <p className="coordinate-readout">
              {photo.lat?.toFixed(5)}° N · {photo.lon?.toFixed(5)}° E
            </p>
            <p className="muted">照片中的位置可能存在偏差，请按实际旅程确认。</p>
            <div className="form-actions">
              <button className="button" onClick={() => setGpsConfirm(false)}>
                暂不添加
              </button>
              <button
                className="button primary"
                onClick={async () => {
                  if (
                    await run(async () => {
                      const visit = await window.myMap.confirmPhotoLocation(photo.id, a.id)
                      setVisitId(visit.id)
                    }, '已加入旅行足迹')
                  )
                    setGpsConfirm(false)
                }}
              >
                确认并加入足迹
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
