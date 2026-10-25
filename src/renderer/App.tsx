import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Camera,
  Check,
  ChevronRight,
  Compass,
  Map,
  MapPin,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Stamp,
  X
} from './ui/icons'
import type { AppSnapshot, Entry, EntityKind, Trip } from '../shared/types'
import {
  activeTrips,
  activeVisits,
  matches,
  matchingTrips,
  passport,
  tripDates,
  effectiveVisitDate
} from './model'
import { Empty, Modal, Spinner } from './components/Common'
import type { InitialVisit } from './components/Editors'
import { MapPage } from './pages/MapPage'
import { TripCard } from './pages/TripCard'
import { TripDetail } from './pages/TripDetail'
import { PassportPage } from './pages/PassportPage'
import { SettingsPage } from './pages/SettingsPage'
import type { Confirmation, Page } from './pages/types'
import { getSnapshotIndex } from './snapshotIndex'
import { PageSkeleton } from './ui/primitives'
const Gallery = lazy(() => import('./components/Gallery').then((module) => ({ default: module.Gallery })))
const Journal = lazy(() => import('./components/Journal').then((module) => ({ default: module.Journal })))
const TripEditor = lazy(() =>
  import('./components/Editors').then((module) => ({ default: module.TripEditor }))
)
const VisitEditor = lazy(() =>
  import('./components/Editors').then((module) => ({ default: module.VisitEditor }))
)
const loadingPage = <PageSkeleton />

const navigation: { id: Page; label: string; icon: typeof Map; hint: string }[] = [
  { id: 'map', label: '足迹地图', icon: Map, hint: '点亮去过的城市，翻看沿途的故事。' },
  { id: 'trips', label: '我的旅行', icon: Compass, hint: '按一段段旅程，收藏地点、照片与手记。' },
  { id: 'journal', label: '旅行手账', icon: BookOpen, hint: '留一页给风景，也留一页给当时的自己。' },
  { id: 'gallery', label: '照片馆', icon: Camera, hint: '整理沿途拍下的照片，为每一刻写下说明。' },
  { id: 'passport', label: '旅行护照', icon: Stamp, hint: '每一次抵达，都在这里留下印记。' }
]
export default function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null),
    [loadError, setLoadError] = useState(''),
    [page, setPage] = useState<Page>('map'),
    [selectedTrip, setSelectedTrip] = useState(''),
    [detail, setDetail] = useState(false),
    [entryId, setEntryId] = useState<string | null>(null),
    [year, setYear] = useState(''),
    [cityId, setCityId] = useState(''),
    [query, setQuery] = useState(''),
    [searchOpen, setSearchOpen] = useState(false),
    [tripEditor, setTripEditor] = useState<Trip | null | false>(false),
    [visitEditor, setVisitEditor] = useState<{
      tripId: string
      coordinates?: [number, number]
      initial?: InitialVisit
    } | null>(null),
    [confirmation, setConfirmation] = useState<Confirmation | null>(null),
    [busy, setBusy] = useState(0),
    [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null),
    [playback, setPlayback] = useState(false),
    [memory, setMemory] = useState(false)
  const flushRef = useRef<() => Promise<void>>(async () => {}),
    noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    searchInput = useRef<HTMLInputElement>(null)
  const registerFlush = useCallback((flush: () => Promise<void>) => {
    flushRef.current = flush
  }, [])
  const notify = useCallback((message: string, error = false) => {
    setNotice({ message, error })
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    if (!error) noticeTimer.current = setTimeout(() => setNotice(null), 4000)
  }, [])
  const refresh = useCallback(async () => {
    const s = await window.myMap.snapshot()
    setSnapshot(s)
    setLoadError('')
  }, [])
  useEffect(() => {
    refresh().catch((e) => setLoadError(String(e)))
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
    }
  }, [refresh])
  useEffect(() => {
    let active = true
    let wasRunning = false
    let receivedEvents = 0
    const off = window.myMap.onProgress((progress) => {
      receivedEvents++
      const completed = wasRunning && !progress.running
      wasRunning = progress.running
      if (completed) void refresh().catch((error) => notify(String(error), true))
    })
    void window.myMap
      .importProgress()
      .then((progress) => {
        // A progress event is newer than the initial RPC result.
        if (active && receivedEvents === 0) wasRunning = progress.running
      })
      .catch((error) => {
        if (active) notify(String(error), true)
      })
    return () => {
      active = false
      off()
    }
  }, [refresh, notify])
  useEffect(() => {
    const listener = () => {
      flushRef
        .current()
        .then(() => window.dispatchEvent(new Event('mymap:flushed')))
        .catch((e) => {
          notify(`当前修改未能保存：${String(e)}`, true)
          window.dispatchEvent(new CustomEvent('mymap:flush-failed', { detail: String(e) }))
        })
    }
    window.addEventListener('mymap:flush', listener)
    window.dispatchEvent(new Event('mymap:ready'))
    return () => window.removeEventListener('mymap:flush', listener)
  }, [notify])
  const run = useCallback(
    async (operation: () => Promise<unknown>, success?: string) => {
      setBusy((n) => n + 1)
      try {
        const result = await operation()
        await refresh()
        if (success && result !== null) notify(success)
        return result !== null
      } catch (e) {
        notify(String(e), true)
        return false
      } finally {
        setBusy((n) => n - 1)
      }
    },
    [notify, refresh]
  )
  const guarded = useCallback(
    async (action: () => void | Promise<void>) => {
      try {
        await flushRef.current()
        await action()
      } catch (e) {
        notify(`请先保存当前修改：${String(e)}`, true)
      }
    },
    [notify]
  )
  const go = useCallback(
    (next: Page) => {
      void guarded(() => {
        setPage(next)
        setDetail(false)
        setPlayback(false)
        setSearchOpen(false)
      })
    },
    [guarded]
  )
  const openTrip = useCallback(
    (id: string) => {
      void guarded(() => {
        setSelectedTrip(id)
        setPage('trips')
        setDetail(true)
        setPlayback(false)
        setSearchOpen(false)
      })
    },
    [guarded]
  )
  const openEntry = useCallback(
    (id: string) => {
      void guarded(() => {
        setSelectedTrip('')
        setEntryId(id)
        setPage('journal')
        setDetail(false)
        setSearchOpen(false)
      })
    },
    [guarded]
  )
  const openJournal = useCallback(() => go('journal'), [go])
  const openTrips = useCallback(() => go('trips'), [go])
  const createTrip = useCallback(() => setTripEditor(null), [])
  const clearFilters = useCallback(() => {
    setYear('')
    setCityId('')
    setSelectedTrip('')
    setQuery('')
  }, [])
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'k' &&
        !document.querySelector('[role="dialog"][aria-modal="true"]')
      ) {
        event.preventDefault()
        searchInput.current?.focus()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])
  const pickMapLocation = useCallback(
    (lat: number, lon: number) => {
      const index = snapshot && getSnapshotIndex(snapshot)
      const selected = index?.activeTripIds.has(selectedTrip) ? index.tripById.get(selectedTrip) : undefined
      if (selected) setVisitEditor({ tripId: selected.id, coordinates: [lat, lon] })
      else notify('先在上方选择一段旅行，再点击地图添加地点。')
    },
    [snapshot, selectedTrip, notify]
  )
  const trash = (kind: EntityKind, id: string) =>
    setConfirmation({
      title: '把这段回忆暂存起来？',
      description:
        kind === 'trip'
          ? '旅行和其中的手记、照片将从各个视图中隐藏。你随时可以在设置的回收站里恢复。'
          : '移到回收站后，可以在设置中找回。',
      label: '移到回收站',
      action: async () => {
        await window.myMap.trash(kind, id)
        if (kind === 'trip') {
          setDetail(false)
          setSelectedTrip('')
        }
        if (kind === 'entry') setEntryId(null)
      }
    })
  function updateEntry(entry: Entry) {
    setSnapshot((s) =>
      s
        ? {
            ...s,
            entries: s.entries.some((e) => e.id === entry.id)
              ? s.entries.map((e) => (e.id === entry.id ? entry : e))
              : [entry, ...s.entries]
          }
        : s
    )
  }
  const derived = useMemo(() => {
    if (!snapshot) return null
    const index = getSnapshotIndex(snapshot)
    const trips = activeTrips(snapshot),
      visits = activeVisits(snapshot)
    return {
      index,
      trips,
      visits,
      stamps: passport(snapshot),
      years: [
        ...new Set(
          [
            ...trips.filter((t) => !index.visitsByTrip.has(t.id)).map((t) => t.startDate.slice(0, 4)),
            ...visits.map((v) => effectiveVisitDate(v, index.tripById.get(v.tripId)!).slice(0, 4))
          ].filter(Boolean)
        )
      ]
        .sort()
        .reverse()
    }
  }, [snapshot])
  const filteredTrips = useMemo(
    () =>
      snapshot
        ? matchingTrips(snapshot, query, year, cityId).filter((t) => !selectedTrip || t.id === selectedTrip)
        : [],
    [snapshot, query, year, cityId, selectedTrip]
  )
  const searchResults = useMemo(() => {
    if (!snapshot || !searchOpen || !query.trim()) return []
    const index = getSnapshotIndex(snapshot)
    return [
      ...matchingTrips(snapshot, query)
        .slice(0, 5)
        .map((trip) => ({
          id: 't' + trip.id,
          targetId: trip.id,
          kind: 'trip' as const,
          label: trip.title,
          sub: '旅行 · ' + tripDates(trip),
          icon: Compass
        })),
      ...index.activeEntries
        .filter((entry) => matches(entry.title + ' ' + entry.markdown, query))
        .slice(0, 4)
        .map((entry) => ({
          id: 'e' + entry.id,
          targetId: entry.id,
          kind: 'entry' as const,
          label: entry.title,
          sub: '手记 · ' + index.tripById.get(entry.tripId)?.title,
          icon: BookOpen
        })),
      ...index.activeVisits
        .filter((visit) => {
          const place = index.placeById.get(visit.placeId)!
          return matches(place.name + ' ' + place.cityName, query)
        })
        .slice(0, 4)
        .map((visit) => ({
          id: 'v' + visit.id,
          targetId: visit.tripId,
          kind: 'visit' as const,
          label: index.placeById.get(visit.placeId)!.name,
          sub: '足迹 · ' + index.tripById.get(visit.tripId)?.title,
          icon: MapPin
        }))
    ]
  }, [snapshot, query, searchOpen])
  if (!snapshot)
    return (
      <div className="loading-screen">
        <div className="brand-mark">
          <Compass size={32} />
        </div>
        <h1>MyMap</h1>
        <p>把走过的路，变成珍藏的故事。</p>
        {loadError ? (
          <>
            <p className="inline-error" role="alert">
              {loadError}
            </p>
            <button
              className="button primary"
              onClick={() => refresh().catch((e) => setLoadError(String(e)))}
            >
              重新打开资料库
            </button>
          </>
        ) : (
          <Spinner />
        )}
      </div>
    )
  const { index, trips, stamps, years } = derived!
  const trip = index.activeTripIds.has(selectedTrip) ? index.tripById.get(selectedTrip) : undefined,
    currentNav = navigation.find((n) => n.id === page)
  const pickMemory = () => {
    const candidates = trips.filter((t) => index.entriesByTrip.has(t.id) || index.attachmentsByTrip.has(t.id))
    if (!candidates.length) {
      notify('先写一篇手记或导入几张照片，再来拆开回忆。')
      return
    }
    setMemory(true)
    setTimeout(() => {
      setMemory(false)
      openTrip(candidates[Math.floor(Math.random() * candidates.length)].id)
    }, 650)
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到正文
      </a>
      <aside className="sidebar">
        <button className="brand" aria-label="返回足迹地图" onClick={() => go('map')}>
          <div className="brand-mark">
            <Compass size={29} strokeWidth={1.4} />
          </div>
          <span>
            MyMap<small>我的旅行图鉴</small>
          </span>
        </button>
        <div className="sidebar-divider" />
        <p className="nav-caption">去看看世界</p>
        <nav>
          {navigation.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${page === n.id ? 'active' : ''}`}
              aria-label={n.label}
              aria-current={page === n.id ? 'page' : undefined}
              title={n.label}
              onClick={() => go(n.id)}
            >
              <n.icon size={19} strokeWidth={1.7} />
              <span>{n.label}</span>
              {n.id === 'trips' && <small>{trips.length.toString().padStart(2, '0')}</small>}
            </button>
          ))}
        </nav>
        <button
          className={`memory-card ${memory ? 'shuffling' : ''}`}
          onClick={pickMemory}
          aria-label="回忆盲盒"
          title="回忆盲盒：随机翻开一段旅行"
        >
          <span className="memory-stars">
            <Sparkles size={24} />
          </span>
          <span>
            <strong>回忆盲盒</strong>
            <small>随机回到某一段好时光</small>
          </span>
          <Shuffle size={15} />
        </button>
        <div className="sidebar-bottom">
          <div className="offline-status">
            <span />
            所有回忆，只留在你身边
            <small>
              <ShieldCheck size={12} />
              完全离线 · 本地保存
            </small>
          </div>
          <button
            className={`nav-item ${page === 'settings' ? 'active' : ''}`}
            aria-label="设置与资料库"
            aria-current={page === 'settings' ? 'page' : undefined}
            title="设置与资料库"
            onClick={() => go('settings')}
          >
            <Settings size={18} />
            <span>设置与资料库</span>
          </button>
          <div className="sidebar-footer">
            把每一次出发，留在这里。<span>↗</span>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            本地旅行图鉴 <ChevronRight size={16} />
            <span>{currentNav?.label || '设置与资料库'}</span>
            {snapshot.library.isDemo && <b className="demo-badge">独立演示库</b>}
          </div>
          <div className="topbar-actions">
            <div className="global-search">
              <Search size={16} />
              <input
                ref={searchInput}
                aria-label="搜索旅行、地点、手记和标签"
                placeholder="搜索旅行、城市或手记"
                value={query}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setSearchOpen(false)
                }}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSearchOpen(true)
                }}
              />
              {query && (
                <button
                  aria-label="清空搜索"
                  onClick={() => {
                    setQuery('')
                    setSearchOpen(false)
                  }}
                >
                  <X size={13} />
                </button>
              )}
              {searchOpen && query.trim() && (
                <>
                  <div className="search-dismiss" onClick={() => setSearchOpen(false)} />
                  <div className="search-results">
                    <span className="section-label">
                      寻找你的回忆 <small>{searchResults.length} 条结果</small>
                    </span>
                    {searchResults.length ? (
                      searchResults.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => (r.kind === 'entry' ? openEntry(r.targetId) : openTrip(r.targetId))}
                        >
                          <r.icon size={17} />
                          <span>
                            {r.label}
                            <small>{r.sub}</small>
                          </span>
                          <ChevronRight size={13} />
                        </button>
                      ))
                    ) : (
                      <p>还没有找到这段回忆。</p>
                    )}
                  </div>
                </>
              )}
            </div>
            <button
              className={`button ${page === 'map' || page === 'trips' ? 'primary' : ''} new-trip-button`}
              onClick={createTrip}
            >
              <Plus size={16} />
              新建旅行
            </button>
          </div>
        </header>
        {snapshot.library.isDemo && (
          <div className="demo-strip">
            <Sparkles size={14} />
            正在浏览独立演示资料库，演示中的操作不会影响你的真实旅行。
            <button
              className="text-button"
              onClick={() =>
                guarded(() =>
                  run(() => window.myMap.setDemo(false)).then(() => {
                    setSelectedTrip('')
                    setEntryId(null)
                    setDetail(false)
                  })
                )
              }
            >
              回到我的资料库 <ArrowRight size={13} />
            </button>
          </div>
        )}
        <div className={`page-content page-${page}`} id="main-content" tabIndex={-1}>
          <section className="page-heading">
            <div>
              <div className="eyebrow">{snapshot.library.isDemo ? '演示资料库' : '属于你的旅行记录'}</div>
              <h1>{detail && trip ? trip.title : currentNav?.label || '设置与资料库'}</h1>
              <p>
                {detail && trip
                  ? tripDates(trip)
                  : currentNav?.hint || '妥善保管每一段回忆，让故事安心生长。'}
              </p>
            </div>
            {page === 'map' && (
              <span className="map-pill">
                <span /> 城市版图
              </span>
            )}
            {detail && trip && (
              <button
                className="button"
                onClick={() => {
                  setDetail(false)
                  setSelectedTrip('')
                }}
              >
                <ArrowLeft size={15} />
                所有旅行
              </button>
            )}
          </section>
          {!detail && ['map', 'trips', 'passport'].includes(page) && (
            <div className="filter-bar">
              <span className="filter-title">沿途筛选</span>
              <select aria-label="按年份筛选" value={year} onChange={(e) => setYear(e.target.value)}>
                <option value="">所有年份</option>
                {years.map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
              <select aria-label="按城市筛选" value={cityId} onChange={(e) => setCityId(e.target.value)}>
                <option value="">所有城市</option>
                {stamps.map((s) => (
                  <option key={s.cityId} value={s.cityId}>
                    {s.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="按旅行筛选"
                value={selectedTrip}
                onChange={(e) => setSelectedTrip(e.target.value)}
              >
                <option value="">所有旅行</option>
                {trips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
              {(year || cityId || selectedTrip || query) && (
                <button className="text-button" onClick={clearFilters}>
                  清除筛选
                  <X size={12} />
                </button>
              )}
              <span className="filter-note">
                {trips.length ? '每一步，都算数。' : '世界很大，从第一站开始。'}
              </span>
            </div>
          )}
          {page === 'map' && (
            <MapPage
              snapshot={snapshot}
              tripId={selectedTrip}
              year={year}
              cityId={cityId}
              filteredTrips={filteredTrips}
              onTrip={openTrip}
              onEntry={openEntry}
              onJournal={openJournal}
              onTrips={openTrips}
              onNewTrip={createTrip}
              onClearFilters={clearFilters}
              onPickLocation={pickMapLocation}
            />
          )}
          {page === 'trips' &&
            (detail && trip ? (
              <TripDetail
                trip={trip}
                snapshot={snapshot}
                playback={playback}
                setPlayback={setPlayback}
                onEdit={() => setTripEditor(trip)}
                onVisit={() => setVisitEditor({ tripId: trip.id })}
                onEditVisit={(id) => {
                  const visit = index.visitById.get(id)
                  const place = visit && index.placeById.get(visit.placeId)
                  if (visit && place) setVisitEditor({ tripId: trip.id, initial: { visit, place } })
                }}
                onPick={(lat, lon) => setVisitEditor({ tripId: trip.id, coordinates: [lat, lon] })}
                onGallery={() => go('gallery')}
                onEntry={openEntry}
                onJournal={() => {
                  void guarded(() => {
                    setEntryId(null)
                    setPage('journal')
                    setDetail(false)
                    setSearchOpen(false)
                  })
                }}
                run={run}
                confirm={setConfirmation}
                trash={() => trash('trip', trip.id)}
              />
            ) : filteredTrips.length ? (
              <div className="trip-grid">
                {filteredTrips.map((t) => (
                  <TripCard trip={t} snapshot={snapshot} key={t.id} onClick={() => openTrip(t.id)} />
                ))}
                <button className="new-trip-card" onClick={() => setTripEditor(null)}>
                  <span>
                    <Plus size={24} />
                  </span>
                  <h3>下一程，去哪里？</h3>
                  <p>为新的故事，留一个位置</p>
                </button>
              </div>
            ) : (
              <Empty
                title={trips.length ? '还没有匹配的旅行' : '去往心里的那个地方'}
                description="从一个旅行名称开始，慢慢填满沿途的风景与故事。"
                action={() => setTripEditor(null)}
              />
            ))}
          {page === 'journal' && (
            <Suspense fallback={loadingPage}>
              <Journal
                snapshot={snapshot}
                entryId={entryId}
                tripId={selectedTrip}
                setEntryId={setEntryId}
                onSaved={updateEntry}
                registerFlush={registerFlush}
                run={run}
                refresh={refresh}
                confirmTrash={(id) => trash('entry', id)}
              />
            </Suspense>
          )}
          {page === 'gallery' && (
            <Suspense fallback={loadingPage}>
              <Gallery
                snapshot={snapshot}
                tripId={selectedTrip}
                run={run}
                refresh={refresh}
                registerFlush={registerFlush}
                confirmTrash={(id) => trash('attachment', id)}
              />
            </Suspense>
          )}
          {page === 'passport' && (
            <PassportPage
              snapshot={snapshot}
              year={year}
              tripId={selectedTrip}
              cityId={cityId}
              onTrip={openTrip}
            />
          )}
          {page === 'settings' && (
            <SettingsPage
              snapshot={snapshot}
              run={run}
              confirm={setConfirmation}
              guarded={guarded}
              reset={() => {
                setSelectedTrip('')
                setEntryId(null)
                setDetail(false)
              }}
            />
          )}
          <footer className="page-footer">
            <span>MyMap · 让每一段旅程，都有迹可循。</span>
            <span>
              离线地图 · 本地相册 · 旅行手记 <Compass size={16} />
            </span>
          </footer>
        </div>
      </main>
      {tripEditor !== false && (
        <Suspense fallback={loadingPage}>
          <TripEditor
            trip={tripEditor || undefined}
            onClose={() => setTripEditor(false)}
            onSave={async (input) => {
              await flushRef.current()
              const t = await window.myMap.saveTrip(input)
              await refresh()
              if (tripEditor === null) {
                setSelectedTrip(t.id)
                setPage('trips')
                setDetail(true)
              }
              notify('旅行已保存')
            }}
          />
        </Suspense>
      )}
      {visitEditor && (
        <Suspense fallback={loadingPage}>
          <VisitEditor
            tripId={visitEditor.tripId}
            coordinates={visitEditor.coordinates}
            initial={visitEditor.initial}
            onClose={() => setVisitEditor(null)}
            onSave={async (input) => {
              await window.myMap.saveVisit(input)
              await refresh()
              notify('又一个地方，成为了回忆')
            }}
          />
        </Suspense>
      )}
      {confirmation && (
        <Modal
          title={confirmation.title}
          onClose={() => {
            if (!busy) setConfirmation(null)
          }}
        >
          <div className="form">
            <p>{confirmation.description}</p>
            <div className="form-actions">
              <button className="button" disabled={!!busy} onClick={() => setConfirmation(null)}>
                取消
              </button>
              <button
                className="button danger-solid"
                disabled={!!busy}
                onClick={async () => {
                  if (await run(confirmation.action, '操作已完成')) setConfirmation(null)
                }}
              >
                {!!busy && <Spinner />}
                {confirmation.label}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {notice && (
        <div
          className={`toast ${notice.error ? 'toast-error' : ''}`}
          role={notice.error ? 'alert' : 'status'}
        >
          {notice.error ? <span>!</span> : <Check size={16} />}
          <p>{notice.message}</p>
          <button aria-label="关闭通知" className="icon-button" onClick={() => setNotice(null)}>
            <X size={16} />
          </button>
        </div>
      )}
      {busy > 0 && (
        <div className="global-busy" role="status">
          <Spinner />
          正在处理，请稍候…
        </div>
      )}
    </div>
  )
}
