import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  X,
  Grid,
  List
} from '../ui/icons'
import {
  photoUrl,
  type AppSnapshot,
  type ImportProgress,
  type PhotoAttachment,
  type Trip
} from '../../shared/types'
import type { SaveState } from '../model'
import { getSnapshotIndex, type SnapshotIndex } from '../snapshotIndex'
import { useViewPreference } from '../ui/useViewPreference'
import { PhotoDraftQueue, type PhotoDraft, type PhotoDraftPatch } from '../photoDraft'
import { isTopDialog, useDialogFocus } from '../ui/useDialogFocus'
import { Empty, Modal, Spinner } from './Common'
import '../styles/gallery.css'

interface Props {
  snapshot: AppSnapshot
  tripId: string
  run: (operation: () => Promise<unknown>, success?: string) => Promise<boolean>
  refresh: () => Promise<void>
  onAttachmentSaved: (record: PhotoAttachment) => void
  onCreateImportTrip: (onCreated: (trip: Trip) => void, onCancel: () => void) => void
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
const pageSize = 60
// Snapshot updates replace changed rows. Old captions can be collected with their rows.
const normalizedCaptions = new WeakMap<PhotoAttachment, string>()
function captionIncludes(attachment: PhotoAttachment, term: string) {
  let caption = normalizedCaptions.get(attachment)
  if (caption === undefined) {
    caption = attachment.caption.toLocaleLowerCase()
    normalizedCaptions.set(attachment, caption)
  }
  return caption.includes(term)
}
export function Gallery({
  snapshot,
  tripId,
  run,
  refresh,
  registerFlush,
  confirmTrash,
  onAttachmentSaved,
  onCreateImportTrip
}: Props) {
  const [filterTrip, setFilterTrip] = useState(tripId),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [lightbox, setLightbox] = useState<string | null>(null),
    [draft, setDraft] = useState<PhotoDraft | null>(null),
    [status, setStatus] = useState<SaveState>('saved'),
    [saveError, setSaveError] = useState(''),
    [progress, setProgress] = useState(initialProgress),
    [progressVisible, setProgressVisible] = useState(false),
    [dragging, setDragging] = useState(false),
    [choosingDestination, setChoosingDestination] = useState(false),
    [destination, setDestination] = useState(''),
    [importing, setImporting] = useState(false),
    [error, setError] = useState('')
  const [density, setDensity] = useViewPreference('photo-density', ['comfortable', 'compact'], 'comfortable')
  const [photoSort, setPhotoSort] = useViewPreference('photo-sort', ['custom', 'recent'], 'custom')
  const index = useMemo(() => getSnapshotIndex(snapshot), [snapshot])
  const ordered = useMemo(() => {
    const scoped = filterTrip ? index.attachmentsByTrip.get(filterTrip) || [] : index.activeAttachments
    return [...scoped].sort((a, b) =>
      photoSort === 'recent'
        ? (
            index.photoById.get(b.photoId)?.capturedAt ||
            index.photoById.get(b.photoId)?.createdAt ||
            ''
          ).localeCompare(
            index.photoById.get(a.photoId)?.capturedAt || index.photoById.get(a.photoId)?.createdAt || ''
          ) || a.sortOrder - b.sortOrder
        : a.tripId.localeCompare(b.tripId) || a.sortOrder - b.sortOrder
    )
  }, [index, filterTrip, photoSort])
  const term = query.trim().toLowerCase()
  const items = useMemo(
    () => (term ? ordered.filter((item) => captionIncludes(item, term)) : ordered),
    [ordered, term]
  )
  const activeById = useMemo(() => new Map(index.activeAttachments.map((a) => [a.id, a])), [index])
  // Search changes and caption edits must never silently unmount an active draft.
  const selected = lightbox ? activeById.get(lightbox) : undefined
  const pages = Math.max(1, Math.ceil(items.length / pageSize))
  const currentPage = Math.min(page, pages - 1)
  const pageItems = useMemo(
    () => items.slice(currentPage * pageSize, (currentPage + 1) * pageSize),
    [items, currentPage]
  )
  const searchInput = useRef<HTMLInputElement>(null)
  const gridArea = useRef<HTMLElement>(null)
  const focusAfterClose = useRef<string | null>(null)
  const lastPosition = useRef(0)
  const changingPhoto = useRef(false)
  const savingCallback = useRef(onAttachmentSaved)
  savingCallback.current = onAttachmentSaved
  const pendingImport = useRef<{ files?: File[] } | null>(null)
  const importInFlight = useRef(false)
  const queue = useRef<PhotoDraftQueue | null>(null)
  if (!queue.current)
    queue.current = new PhotoDraftQueue(
      async ({ id, ...patch }) => {
        const record = await window.myMap.updateAttachment(id, patch)
        savingCallback.current(record)
      },
      (state, message) => {
        setStatus(state)
        setSaveError(message || '')
      }
    )
  const flushPhoto = useCallback(() => queue.current!.flush(), [])
  useEffect(() => {
    registerFlush(flushPhoto)
    return () => {
      pendingImport.current = null
      registerFlush(async () => {})
    }
  }, [registerFlush, flushPhoto])
  const edit = (patch: PhotoDraftPatch) => {
    queue.current!.edit(patch)
    setDraft({ ...queue.current!.draft! })
  }
  const guarded = useCallback(
    async (action: () => void) => {
      if (changingPhoto.current) return
      changingPhoto.current = true
      try {
        await flushPhoto()
        action()
      } catch {
        /* Keep the current draft and its inline error. */
      } finally {
        changingPhoto.current = false
      }
    },
    [flushPhoto]
  )
  const openPhoto = useCallback(
    (attachment: PhotoAttachment, position: number) =>
      guarded(() => {
        queue.current!.open(attachment)
        setDraft({ ...queue.current!.draft! })
        setLightbox(attachment.id)
        lastPosition.current = position
        setPage(Math.floor(position / pageSize))
      }),
    [guarded]
  )
  const closePhoto = () =>
    guarded(() => {
      focusAfterClose.current = lightbox
      setLightbox(null)
    })
  useEffect(() => {
    if (lightbox || !focusAfterClose.current) return
    const found = items.findIndex((item) => item.id === focusAfterClose.current)
    const position = found < 0 ? Math.min(lastPosition.current, items.length - 1) : found
    if (position < 0) {
      focusAfterClose.current = null
      searchInput.current?.focus()
      return
    }
    const targetPage = Math.floor(position / pageSize)
    if (targetPage !== currentPage) {
      setPage(targetPage)
      return
    }
    focusAfterClose.current = null
    gridArea.current
      ?.querySelector<HTMLButtonElement>(`[data-attachment-id="${CSS.escape(items[position].id)}"]`)
      ?.focus()
  }, [lightbox, items, currentPage])
  const selectedPosition = useMemo(
    () => (lightbox ? items.findIndex((item) => item.id === lightbox) : -1),
    [items, lightbox]
  )
  useEffect(() => {
    if (selectedPosition >= 0) {
      lastPosition.current = selectedPosition
      setPage(Math.floor(selectedPosition / pageSize))
    }
  }, [selectedPosition])
  const step = (direction: number) => {
    if (!selected || !items.length) return
    // If an edited caption no longer matches, its old slot now contains the following photo.
    const at =
      selectedPosition < 0
        ? Math.min(lastPosition.current, items.length) - (direction > 0 ? 1 : 0)
        : selectedPosition
    const next = (at + direction + items.length) % items.length
    if (items[next].id !== selected.id) void openPhoto(items[next], next)
  }
  useEffect(() => {
    if (page >= pages) setPage(pages - 1)
  }, [pages, page])
  useEffect(() => {
    let current = true,
      receivedProgress = false
    const off = window.myMap.onProgress((value) => {
      receivedProgress = true
      if (current) {
        setProgress(value)
        setProgressVisible(true)
      }
    })
    window.myMap
      .importProgress()
      .then((value) => {
        if (current && !receivedProgress) {
          setProgress(value)
          setProgressVisible(
            value.running || value.errors.length > 0 || (!snapshot.library.isDemo && value.total > 0)
          )
        }
      })
      .catch((cause) => {
        if (current) setError(String(cause))
      })
    return () => {
      current = false
      off()
    }
  }, [])
  function cancelDestination() {
    pendingImport.current = null
    setChoosingDestination(false)
  }
  async function importInto(id: string) {
    const request = pendingImport.current
    if (!request || importInFlight.current || !id) return
    importInFlight.current = true
    pendingImport.current = null
    setChoosingDestination(false)
    setError('')
    setImporting(true)
    try {
      await flushPhoto()
      if (request.files) await window.myMap.importDroppedPhotos(id, request.files)
      else await window.myMap.importPhotos(id)
    } catch (cause) {
      setError(String(cause))
    } finally {
      importInFlight.current = false
      setImporting(false)
    }
  }
  function startImport(files?: File[]) {
    if (pendingImport.current || importInFlight.current || progress.running || (files && !files.length))
      return
    pendingImport.current = { files }
    setError('')
    if (filterTrip && index.activeTripIds.has(filterTrip)) {
      void importInto(filterTrip)
    } else if (index.activeTrips.length) {
      setDestination('')
      setChoosingDestination(true)
    } else {
      onCreateImportTrip((trip) => void importInto(trip.id), cancelDestination)
    }
  }
  const changePage = (next: number) => {
    if (next < 0 || next >= pages) return
    setPage(next)
    requestAnimationFrame(() => gridArea.current?.querySelector<HTMLButtonElement>('.photo-tile')?.focus())
  }
  return (
    <section
      ref={gridArea}
      className={`gallery-page ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        if (!lightbox && !pendingImport.current && !importInFlight.current && !progress.running)
          setDragging(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        setDragging(false)
        if (!lightbox) startImport(Array.from(event.dataTransfer.files))
      }}
    >
      <div className="gallery-toolbar">
        <label className="gallery-scope">
          查看范围
          <select
            aria-label="照片所属旅行"
            value={filterTrip}
            onChange={(event) => {
              setFilterTrip(event.target.value)
              setPage(0)
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
        <div className="gallery-search">
          <label htmlFor="gallery-search-caption">照片说明</label>
          <span className="input-icon">
            <Search size={20} />
            <input
              id="gallery-search-caption"
              aria-label="搜索照片说明"
              ref={searchInput}
              placeholder="搜索当前范围的照片"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(0)
              }}
            />
            {query && (
              <button
                type="button"
                className="icon-button gallery-clear"
                aria-label="清空照片搜索"
                onClick={() => {
                  setQuery('')
                  setPage(0)
                  searchInput.current?.focus()
                }}
              >
                <X size={15} />
              </button>
            )}
          </span>
        </div>
        <div className="gallery-import-action">
          <button
            className="button primary"
            disabled={importing || progress.running}
            onClick={() => startImport()}
          >
            {importing ? <Spinner /> : <Upload size={20} />}导入照片
          </button>
        </div>
      </div>
      <div className="gallery-view-bar">
        <div className="gallery-result-summary">
          <strong className="photo-count">{items.length} 张照片</strong>
          <span className="gallery-hint">支持拖入 JPEG、PNG 和 WebP</span>
        </div>
        <div className="collection-controls">
          <label className="inline-select">
            排序
            <select
              aria-label="照片排序"
              value={photoSort}
              onChange={(e) => {
                setPhotoSort(e.target.value)
                setPage(0)
              }}
            >
              <option value="custom">旅行顺序</option>
              <option value="recent">最近拍摄</option>
            </select>
          </label>
          <div className="segmented-control" role="group" aria-label="照片密度">
            <button
              aria-label="舒展照片"
              aria-pressed={density === 'comfortable'}
              onClick={() => setDensity('comfortable')}
            >
              <List size={18} />
              <span>舒展</span>
            </button>
            <button
              aria-label="紧凑照片"
              aria-pressed={density === 'compact'}
              onClick={() => setDensity('compact')}
            >
              <Grid size={18} />
              <span>紧凑</span>
            </button>
          </div>
        </div>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {(progress.running || (progressVisible && progress.total > 0)) && (
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
            {!progress.running && (
              <button
                className="icon-button"
                aria-label="收起导入结果"
                onClick={() => setProgressVisible(false)}
              >
                <X size={16} />
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
          <PhotoGrid
            items={pageItems}
            index={index}
            density={density}
            start={currentPage * pageSize}
            onOpen={openPhoto}
          />
          {pages > 1 && (
            <nav className="gallery-pagination" aria-label="照片分页">
              <button
                className="button"
                disabled={currentPage === 0}
                onClick={() => changePage(currentPage - 1)}
              >
                <ArrowLeft size={20} />
                上一页
              </button>
              <span>
                {currentPage + 1} / {pages} 页
              </span>
              <button
                className="button"
                disabled={currentPage >= pages - 1}
                onClick={() => changePage(currentPage + 1)}
              >
                下一页
                <ArrowRight size={20} />
              </button>
            </nav>
          )}
        </>
      ) : (
        <Empty
          illustration="gallery"
          title={term ? '没有找到匹配的照片' : !index.activeTrips.length ? '从第一段旅行开始' : '还没有照片'}
          description={
            term
              ? '清空关键词，查看当前范围内的照片。'
              : !index.activeTrips.length
                ? '创建旅行后，就可以把照片收进这段旅程。'
                : filterTrip
                  ? '为这段旅行导入照片，或将照片拖到这里。'
                  : '选择照片和所属旅行，即可在这里浏览和整理。'
          }
          action={
            term
              ? () => {
                  setQuery('')
                  setPage(0)
                  searchInput.current?.focus()
                }
              : importing || progress.running
                ? undefined
                : () => startImport()
          }
          label={term ? '清空搜索' : !index.activeTrips.length ? '新建旅行并导入' : '导入旅行照片'}
        />
      )}
      {choosingDestination && (
        <Modal title="选择导入旅行" onClose={cancelDestination}>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault()
              void importInto(destination)
            }}
          >
            <label>
              保存到旅行
              <select
                aria-label="保存到旅行"
                value={destination}
                required
                onChange={(event) => setDestination(event.target.value)}
              >
                <option value="">请选择旅行</option>
                {index.activeTrips.map((trip) => (
                  <option key={trip.id} value={trip.id}>
                    {trip.title}
                  </option>
                ))}
              </select>
            </label>
            {pendingImport.current?.files && (
              <p className="muted">已选 {pendingImport.current.files.length} 个文件</p>
            )}
            <div className="form-actions">
              <button type="button" className="button" onClick={cancelDestination}>
                取消
              </button>
              <button className="button primary" disabled={!destination}>
                继续导入
              </button>
            </div>
          </form>
        </Modal>
      )}
      {dragging && (
        <div className="drop-overlay">
          <ImagePlus size={48} />
          <h2>松开鼠标，导入照片</h2>
          <p>
            {filterTrip
              ? `保存到「${index.tripById.get(filterTrip)?.title}」`
              : index.activeTrips.length
                ? '下一步选择照片所属的旅行'
                : '下一步创建旅行'}
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
          positionLabel={
            selectedPosition < 0 ? '已移出当前筛选' : `${selectedPosition + 1} / ${items.length}`
          }
          canStep={items.length > (selectedPosition < 0 ? 0 : 1)}
          onLocationSaved={async (visitId) => {
            // Confirming GPS already saves the association in the library.
            const next = { ...queue.current!.draft!, visitId }
            queue.current!.open(next)
            setDraft(next)
            await refresh()
          }}
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

const PhotoGrid = memo(function PhotoGrid({
  items,
  index,
  density,
  start,
  onOpen
}: {
  items: readonly PhotoAttachment[]
  index: SnapshotIndex
  density: string
  start: number
  onOpen: (attachment: PhotoAttachment, position: number) => Promise<void>
}) {
  const grid = useRef<HTMLDivElement>(null)
  const [admitted, setAdmitted] = useState<ReadonlySet<string>>(() => new Set())
  useLayoutEffect(() => {
    const container = grid.current
    if (!container) return
    const tiles = [...container.querySelectorAll<HTMLElement>('[data-attachment-id]')]
    const columns = getComputedStyle(container).gridTemplateColumns.split(' ').length
    // Keep loaded tiles mounted when a caption changes or the search narrows.
    const ids = new Set(
      tiles
        .filter((tile, i) => i < columns || tile.querySelector('img'))
        .map((tile) => tile.dataset.attachmentId!)
    )
    setAdmitted(new Set(ids))
    const observer = new IntersectionObserver(
      (entries) => {
        let changed = false
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          changed = true
          ids.add((entry.target as HTMLElement).dataset.attachmentId!)
          observer.unobserve(entry.target)
        }
        if (changed) setAdmitted(new Set(ids))
      },
      { rootMargin: '96px 0px' }
    )
    for (const tile of tiles) if (!ids.has(tile.dataset.attachmentId!)) observer.observe(tile)
    return () => observer.disconnect()
  }, [items, density])
  return (
    <div ref={grid} className={`photo-grid photo-grid-${density}`}>
      {items.map((attachment, offset) => {
        const photo = index.photoById.get(attachment.photoId)!,
          trip = index.tripById.get(attachment.tripId)!
        return (
          <button
            className="photo-tile"
            data-attachment-id={attachment.id}
            key={attachment.id}
            onClick={() => void onOpen(attachment, start + offset)}
          >
            <span className="photo-tile-image m-zoom">
              {admitted.has(attachment.id) && (
                <img
                  src={photoUrl(photo.id)}
                  width={photo.width}
                  height={photo.height}
                  loading="eager"
                  decoding="async"
                  alt=""
                />
              )}
            </span>
            <span className="photo-tile-meta">
              <strong>{attachment.caption || trip.title}</strong>
              <small>
                {attachment.caption
                  ? trip.title
                  : photo.capturedAt?.slice(0, 10).replaceAll('-', '.') || '点击添加照片说明'}
              </small>
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
  )
})

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
  positionLabel,
  canStep,
  onLocationSaved,
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
  positionLabel: string
  canStep: boolean
  onLocationSaved: (visitId: string) => Promise<void>
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
  const closeButton = useRef<HTMLButtonElement>(null)
  useDialogFocus(
    holder,
    () => {
      if (!gpsConfirm) onClose()
    },
    closeButton
  )
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        !canStep ||
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
  }, [onStep, canStep])
  const guarded = async (action?: () => Promise<unknown>) => {
    try {
      await flush()
      await action?.()
    } catch {
      /* Keep the current photo and its draft visible. */
    }
  }
  const group = useMemo(
    () =>
      [...(index.attachmentsByTrip.get(attachment.tripId) || [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [index, attachment.tripId]
  )
  const position = useMemo(() => group.findIndex((item) => item.id === attachment.id), [group, attachment.id])
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
      await onLocationSaved(visit.id)
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
        <button
          ref={closeButton}
          className="lightbox-close icon-button"
          aria-label="关闭照片"
          onClick={onClose}
        >
          <X size={24} />
        </button>
        {canStep && (
          <button className="lightbox-prev icon-button" aria-label="上一张照片" onClick={() => onStep(-1)}>
            <ArrowLeft size={24} />
          </button>
        )}
        <img src={photoUrl(photo.id, 'preview')} alt={draft.caption || '旅行照片'} />
        {canStep && (
          <button className="lightbox-next icon-button" aria-label="下一张照片" onClick={() => onStep(1)}>
            <ArrowRight size={24} />
          </button>
        )}
        <div className="lightbox-tip">
          <strong role="status">{positionLabel}</strong>
          <span>{canStep && '← → 切换照片 · '}Esc 保存并关闭</span>
        </div>
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
        <button
          className="button primary"
          disabled={status === 'saving' || status === 'saved'}
          onClick={() => void guarded()}
        >
          <Check size={20} />
          保存照片说明
        </button>
        <section className="photo-actions" aria-label="照片管理">
          <h3>管理这张照片</h3>
          <button
            className="button"
            disabled={trip.coverPhotoId === attachment.photoId}
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
