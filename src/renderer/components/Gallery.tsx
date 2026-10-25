import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
} from '../ui/icons'
import { photoUrl, type AppSnapshot, type ImportProgress, type PhotoAttachment } from '../../shared/types'
import { matches, type SaveState } from '../model'
import { getSnapshotIndex } from '../snapshotIndex'
import { PhotoDraftQueue, type PhotoDraft, type PhotoDraftPatch } from '../photoDraft'
import { isTopDialog, useDialogFocus } from '../ui/useDialogFocus'
import { Empty, Modal, Spinner } from './Common'
import '../styles/gallery.css'

interface Props {
  snapshot: AppSnapshot
  tripId: string
  run: (operation: () => Promise<unknown>, success?: string) => Promise<boolean>
  refresh: () => Promise<void>
  registerFlush: (flush: () => Promise<void>) => void
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
export function Gallery({ snapshot, tripId, run, refresh, registerFlush, confirmTrash }: Props) {
  const [filterTrip, setFilterTrip] = useState(tripId),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [lightbox, setLightbox] = useState<string | null>(null),
    [draft, setDraft] = useState<PhotoDraft | null>(null),
    [status, setStatus] = useState<SaveState>('saved'),
    [saveError, setSaveError] = useState(''),
    [progress, setProgress] = useState(initialProgress),
    [dragging, setDragging] = useState(false),
    [importing, setImporting] = useState(false),
    [error, setError] = useState('')
  const index = useMemo(() => getSnapshotIndex(snapshot), [snapshot])
  const items = useMemo(
    () =>
      index.activeAttachments
        .filter((a) => (!filterTrip || a.tripId === filterTrip) && matches(a.caption, query))
        .sort((a, b) => a.tripId.localeCompare(b.tripId) || a.sortOrder - b.sortOrder),
    [index, filterTrip, query]
  )
  const activeById = useMemo(() => new Map(index.activeAttachments.map((a) => [a.id, a])), [index])
  // Search changes and caption edits must never silently unmount an active draft.
  const selected = lightbox ? activeById.get(lightbox) : undefined
  const pages = Math.max(1, Math.ceil(items.length / 60))
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const revision = useRef(0),
    refreshedRevision = useRef(0),
    flushTask = useRef<Promise<void> | null>(null),
    queue = useRef<PhotoDraftQueue | null>(null)
  if (!queue.current)
    queue.current = new PhotoDraftQueue(
      async ({ id, ...patch }) => {
        await window.myMap.updateAttachment(id, patch)
        revision.current++
      },
      (state, message) => {
        setStatus(state)
        setSaveError(message || '')
      }
    )
  const flushPhoto = useCallback((): Promise<void> => {
    if (flushTask.current) return flushTask.current
    const drain = async () => {
      do {
        await queue.current!.flush()
        if (revision.current !== refreshedRevision.current) {
          const savedRevision = revision.current
          await refreshRef.current()
          refreshedRevision.current = savedRevision
        }
      } while (queue.current!.dirty)
    }
    flushTask.current = drain()
      .catch((cause) => {
        setStatus('error')
        setSaveError(cause instanceof Error ? cause.message : String(cause))
        throw cause
      })
      .finally(() => {
        flushTask.current = null
      })
    return flushTask.current
  }, [])
  useEffect(() => {
    registerFlush(flushPhoto)
    return () => registerFlush(async () => {})
  }, [registerFlush, flushPhoto])
  const edit = (patch: PhotoDraftPatch) => {
    queue.current!.edit(patch)
    setDraft({ ...queue.current!.draft! })
  }
  const guarded = async (action: () => void | Promise<unknown>) => {
    try {
      await flushPhoto()
      await action()
    } catch {
      /* Keep the current draft and its inline error. */
    }
  }
  const openPhoto = (attachment: PhotoAttachment) =>
    guarded(() => {
      queue.current!.open(attachment)
      setDraft({ ...queue.current!.draft! })
      setLightbox(attachment.id)
    })
  const closePhoto = () => guarded(() => setLightbox(null))
  const step = (direction: number) => {
    if (!selected || !items.length) return
    const at = items.findIndex((item) => item.id === selected.id)
    const next = items[(Math.max(0, at) + direction + items.length) % items.length]
    if (next && next.id !== selected.id) void openPhoto(next)
  }
  useEffect(() => {
    setPage(0)
  }, [filterTrip, query])
  useEffect(() => {
    if (page >= pages) setPage(pages - 1)
  }, [pages, page])
  useEffect(() => {
    let current = true,
      receivedProgress = false
    const off = window.myMap.onProgress((value) => {
      receivedProgress = true
      if (current) setProgress(value)
    })
    window.myMap
      .importProgress()
      .then((value) => {
        if (current && !receivedProgress) setProgress(value)
      })
      .catch((cause) => {
        if (current) setError(String(cause))
      })
    return () => {
      current = false
      off()
    }
  }, [])
  async function importPhotos(files?: File[]) {
    if (importing || progress.running) return
    if (!filterTrip) {
      setError('先选择照片所属的旅行，再导入照片。')
      return
    }
    setError('')
    setImporting(true)
    try {
      await flushPhoto()
      if (files) await window.myMap.importDroppedPhotos(filterTrip, files)
      else await window.myMap.importPhotos(filterTrip)
      // App owns the single completion refresh, even when import finishes on another page.
    } catch (cause) {
      setError(String(cause))
    } finally {
      setImporting(false)
    }
  }
  return (
    <section
      className={`gallery-page ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        void importPhotos([...event.dataTransfer.files])
      }}
    >
      <div className="gallery-toolbar">
        <label className="gallery-scope">
          查看与导入旅行
          <select
            aria-label="照片所属旅行"
            value={filterTrip}
            onChange={(event) => {
              const value = event.target.value
              void guarded(() => {
                setFilterTrip(value)
                setLightbox(null)
              })
            }}
          >
            <option value="">所有旅行</option>
            {index.activeTrips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.title}
              </option>
            ))}
          </select>
        </label>
        <label className="gallery-search">
          搜索当前范围
          <span className="input-icon">
            <Search size={20} />
            <input
              aria-label="搜索照片说明"
              placeholder="按照片说明查找"
              value={query}
              onChange={(event) => {
                const value = event.target.value
                void guarded(() => {
                  setQuery(value)
                  setLightbox(null)
                })
              }}
            />
          </span>
        </label>
        <div className="gallery-import-action">
          <span className="photo-count">{items.length} 张照片</span>
          <button
            className="button primary"
            disabled={importing || progress.running || !filterTrip}
            onClick={() => void importPhotos()}
          >
            {importing ? <Spinner /> : <Upload size={20} />}导入照片
          </button>
        </div>
      </div>
      <p className="gallery-hint">
        {filterTrip
          ? '可以拖入照片。照片保存在本地资料库，原文件仍保留。'
          : '选择一段旅行后即可导入照片，也可以把照片拖到这里。'}
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {(progress.running || progress.total > 0) && (
        <div className="import-progress" role="status">
          <div>
            <strong>
              {progress.running ? '正在导入照片' : progress.cancelled ? '已停止导入' : '照片导入已结束'}
            </strong>
            <span>
              {progress.completed} / {progress.total} · 新增 {progress.imported} · 重复 {progress.duplicates}
            </span>
            {progress.running && (
              <button
                className="text-button"
                onClick={() => {
                  void window.myMap.cancelImport().catch((cause) => setError(String(cause)))
                }}
              >
                停止导入
              </button>
            )}
          </div>
          <progress aria-label="照片导入进度" value={progress.completed} max={Math.max(1, progress.total)} />
          {progress.errors.length > 0 && (
            <details>
              <summary>{progress.errors.length} 个文件未能导入，展开查看</summary>
              <ul>
                {progress.errors.map((message, i) => (
                  <li key={i}>{message}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {items.length ? (
        <>
          <div className="photo-grid">
            {items.slice(page * 60, (page + 1) * 60).map((attachment) => {
              const photo = index.photoById.get(attachment.photoId)!,
                trip = index.tripById.get(attachment.tripId)!
              return (
                <button className="photo-tile" key={attachment.id} onClick={() => void openPhoto(attachment)}>
                  <img src={photoUrl(photo.id)} loading="lazy" alt={attachment.caption || '旅行照片'} />
                  <span className="photo-tile-meta">
                    <strong>{attachment.caption || '还没有照片说明'}</strong>
                    <small>{trip.title}</small>
                  </span>
                  {trip.coverPhotoId === attachment.photoId && (
                    <span className="cover-badge">
                      <Star size={16} />
                      旅行封面
                    </span>
                  )}
                  {photo.lat !== null && photo.lon !== null && (
                    <MapPin className="photo-location" size={20} aria-label="含拍摄位置" />
                  )}
                </button>
              )
            })}
          </div>
          <nav className="gallery-pagination" aria-label="照片分页">
            <button className="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
              <ArrowLeft size={20} />
              上一页
            </button>
            <span>
              {page + 1} / {pages} 页<span>每页最多 60 张</span>
            </span>
            <button className="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
              下一页
              <ArrowRight size={20} />
            </button>
          </nav>
        </>
      ) : (
        <Empty
          title={query ? '没有找到匹配的照片' : '把旅途里的光，留在这里'}
          description={
            query
              ? '换一个关键词，或清空搜索查看当前旅行的全部照片。'
              : '先选择所属旅行，再导入沿途拍下的照片。'
          }
          action={filterTrip ? () => void importPhotos() : undefined}
          label="导入旅行照片"
        />
      )}
      {dragging && (
        <div className="drop-overlay">
          <ImagePlus size={48} />
          <h2>松开鼠标，导入照片</h2>
          <p>
            {filterTrip ? `保存到「${index.tripById.get(filterTrip)?.title}」` : '请先选择照片所属的旅行'}
          </p>
        </div>
      )}
      {selected && draft && (
        <PhotoDetail
          attachment={selected}
          snapshot={snapshot}
          draft={draft}
          status={status}
          saveError={saveError}
          edit={edit}
          flush={flushPhoto}
          onClose={() => void closePhoto()}
          onStep={step}
          run={run}
          confirmTrash={() =>
            void guarded(() => {
              setLightbox(null)
              confirmTrash(selected.id)
            })
          }
        />
      )}
    </section>
  )
}

function PhotoDetail({
  attachment,
  snapshot,
  draft,
  status,
  saveError,
  edit,
  flush,
  onClose,
  onStep,
  run,
  confirmTrash
}: {
  attachment: PhotoAttachment
  snapshot: AppSnapshot
  draft: PhotoDraft
  status: SaveState
  saveError: string
  edit: (patch: PhotoDraftPatch) => void
  flush: () => Promise<void>
  onClose: () => void
  onStep: (direction: number) => void
  run: Props['run']
  confirmTrash: () => void
}) {
  const index = getSnapshotIndex(snapshot),
    photo = index.photoById.get(attachment.photoId)!,
    trip = index.tripById.get(attachment.tripId)!
  const [gpsConfirm, setGpsConfirm] = useState(false),
    [gpsBusy, setGpsBusy] = useState(false),
    [gpsError, setGpsError] = useState('')
  const holder = useRef<HTMLDivElement>(null)
  useDialogFocus(holder, () => {
    if (!gpsConfirm) onClose()
  })
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        !isTopDialog(holder.current) ||
        event.defaultPrevented ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      )
        return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        onStep(event.key === 'ArrowLeft' ? -1 : 1)
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [onStep])
  const guarded = async (action?: () => Promise<unknown>) => {
    try {
      await flush()
      await action?.()
    } catch {
      /* Keep the current photo and its draft visible. */
    }
  }
  const group = [...(index.attachmentsByTrip.get(attachment.tripId) || [])].sort(
    (a, b) => a.sortOrder - b.sortOrder
  )
  const position = group.findIndex((item) => item.id === attachment.id)
  const reorder = (direction: number) =>
    guarded(async () => {
      const other = group[position + direction]
      if (other)
        await run(async () => {
          await window.myMap.updateAttachment(attachment.id, { sortOrder: other.sortOrder })
          await window.myMap.updateAttachment(other.id, { sortOrder: attachment.sortOrder })
        })
    })
  async function confirmGps() {
    setGpsBusy(true)
    setGpsError('')
    try {
      await flush()
      const visit = await window.myMap.confirmPhotoLocation(photo.id, attachment.id)
      edit({ visitId: visit.id })
      await flush()
      setGpsConfirm(false)
    } catch (cause) {
      setGpsError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setGpsBusy(false)
    }
  }
  return (
    <div
      ref={holder}
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="照片详情"
      tabIndex={-1}
    >
      <div className="lightbox-stage">
        <button className="lightbox-close icon-button" aria-label="关闭照片" onClick={onClose}>
          <X size={24} />
        </button>
        <button className="lightbox-prev icon-button" aria-label="上一张照片" onClick={() => onStep(-1)}>
          <ArrowLeft size={24} />
        </button>
        <img src={photoUrl(photo.id, 'preview')} alt={draft.caption || '旅行照片'} />
        <button className="lightbox-next icon-button" aria-label="下一张照片" onClick={() => onStep(1)}>
          <ArrowRight size={24} />
        </button>
        <span className="lightbox-tip">← → 切换照片 · Esc 保存并关闭</span>
      </div>
      <aside className="photo-details">
        <header className="photo-detail-heading">
          <span className="section-label">照片详情</span>
          <h2>{trip.title}</h2>
          <p className="photo-save-status" data-state={status} role="status">
            {status === 'saving'
              ? '正在保存…'
              : status === 'pending'
                ? '切换或关闭时自动保存'
                : status === 'error'
                  ? '保存失败，草稿仍在当前照片中'
                  : '照片说明已保存'}
          </p>
        </header>
        {saveError && (
          <div className="inline-error" role="alert">
            {saveError}
            <button className="text-button" onClick={() => void guarded()}>
              重试保存
            </button>
          </div>
        )}
        <label>
          照片说明
          <textarea
            value={draft.caption}
            onChange={(event) => edit({ caption: event.target.value })}
            placeholder="记录这一刻的故事"
            rows={4}
          />
        </label>
        <label>
          关联到访地点
          <select
            value={draft.visitId || ''}
            onChange={(event) => edit({ visitId: event.target.value || null })}
          >
            <option value="">不关联地点</option>
            {(index.orderedVisitsByTrip.get(attachment.tripId) || []).map((visit) => (
              <option value={visit.id} key={visit.id}>
                {index.placeById.get(visit.placeId)?.name} {visit.date}
              </option>
            ))}
          </select>
        </label>
        <label>
          关联旅行手记
          <select
            value={draft.entryId || ''}
            onChange={(event) => edit({ entryId: event.target.value || null })}
          >
            <option value="">不关联手记</option>
            {(index.entriesByTrip.get(attachment.tripId) || []).map((entry) => (
              <option value={entry.id} key={entry.id}>
                {entry.title}
              </option>
            ))}
          </select>
        </label>
        <button className="button primary" disabled={status === 'saving'} onClick={() => void guarded()}>
          <Check size={20} />
          保存照片说明
        </button>
        <section className="photo-actions" aria-label="照片管理">
          <h3>管理这张照片</h3>
          <button
            className="button"
            onClick={() =>
              void guarded(() =>
                run(
                  () => window.myMap.saveTrip({ ...trip, coverPhotoId: attachment.photoId }),
                  '已设为旅行封面'
                )
              )
            }
          >
            <Star size={20} />
            {trip.coverPhotoId === attachment.photoId ? '已是旅行封面' : '设为旅行封面'}
          </button>
          <div className="photo-order-actions">
            <button className="button" disabled={position <= 0} onClick={() => void reorder(-1)}>
              <ArrowUp size={20} />
              向前排序
            </button>
            <button
              className="button"
              disabled={position >= group.length - 1}
              onClick={() => void reorder(1)}
            >
              <ArrowDown size={20} />
              向后排序
            </button>
          </div>
          {photo.lat !== null && photo.lon !== null && (
            <button className="button" onClick={() => setGpsConfirm(true)}>
              <MapPin size={20} />
              将拍摄位置加入足迹
            </button>
          )}
          <button className="button danger" onClick={confirmTrash}>
            <Trash2 size={20} />
            移到回收站
          </button>
        </section>
        <p className="photo-file-meta">
          {photo.width} × {photo.height} · {(photo.size / 1024 / 1024).toFixed(1)} MB
          <br />
          {photo.capturedAt ? `拍摄于 ${photo.capturedAt.slice(0, 10)}` : '未记录拍摄日期'}
        </p>
      </aside>
      {gpsConfirm && (
        <Modal
          title="确认照片中的位置"
          onClose={() => {
            if (!gpsBusy) setGpsConfirm(false)
          }}
        >
          <div className="form">
            <p>确认后，将在所属旅行中添加到访记录，并保留当前照片说明与手记关联。</p>
            <p className="coordinate-readout">
              {Math.abs(photo.lat ?? 0).toFixed(5)}° {(photo.lat ?? 0) < 0 ? 'S' : 'N'} ·{' '}
              {Math.abs(photo.lon ?? 0).toFixed(5)}° {(photo.lon ?? 0) < 0 ? 'W' : 'E'}
            </p>
            <p className="muted">拍摄位置可能存在偏差，请按实际旅程确认。</p>
            {gpsError && (
              <p className="inline-error" role="alert">
                {gpsError}
              </p>
            )}
            <div className="form-actions">
              <button className="button" disabled={gpsBusy} onClick={() => setGpsConfirm(false)}>
                暂不添加
              </button>
              <button className="button primary" disabled={gpsBusy} onClick={() => void confirmGps()}>
                {gpsBusy && <Spinner />}确认并加入足迹
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
