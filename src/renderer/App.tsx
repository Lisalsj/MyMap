import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Camera,
  Check,
  ChevronRight,
  Compass,
  FolderOpen,
  Globe2,
  Map,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Stamp,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import type { AppSnapshot, Entry, EntityKind, Trip } from '../shared/types'
import {
  activeAttachments,
  activeEntries,
  activeTrips,
  activeVisits,
  matches,
  matchingTrips,
  orderedVisits,
  passport,
  tripDates,
  effectiveVisitDate
} from './model'
import { Cover, Empty, Modal, Spinner } from './components/Common'
import { TripEditor, VisitEditor, type InitialVisit } from './components/Editors'
import { FootprintMap } from './components/FootprintMap'
import { Gallery } from './components/Gallery'
import { Journal } from './components/Journal'

type Page = 'map' | 'trips' | 'journal' | 'gallery' | 'passport' | 'settings'
const navigation: { id: Page; label: string; icon: typeof Map; hint: string }[] = [
  { id: 'map', label: '足迹地图', icon: Map, hint: '把世界，走成自己的地图。' },
  { id: 'trips', label: '我的旅行', icon: Compass, hint: '每一次出发，都是生活的新章节。' },
  { id: 'journal', label: '旅行手账', icon: BookOpen, hint: '把沿途的风景，写进日常。' },
  { id: 'gallery', label: '照片馆', icon: Camera, hint: '那些闪闪发光的瞬间。' },
  { id: 'passport', label: '旅行护照', icon: Stamp, hint: '每一枚印章，都是走过的证据。' }
]
interface Confirmation {
  title: string
  description: string
  label: string
  action: () => Promise<unknown>
}
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
    noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    const listener = () => {
      flushRef
        .current()
        .then(() => window.dispatchEvent(new Event('mymap:flushed')))
        .catch((e) => {
          notify(`手记未能保存：${String(e)}`, true)
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
  async function guarded(action: () => void | Promise<void>) {
    try {
      await flushRef.current()
      await action()
    } catch (e) {
      notify(`请先保存当前手记：${String(e)}`, true)
    }
  }
  function go(next: Page) {
    void guarded(() => {
      setPage(next)
      setDetail(false)
      setPlayback(false)
      setSearchOpen(false)
    })
  }
  function openTrip(id: string) {
    void guarded(() => {
      setSelectedTrip(id)
      setPage('trips')
      setDetail(true)
      setPlayback(false)
      setSearchOpen(false)
    })
  }
  function openEntry(id: string) {
    void guarded(() => {
      setSelectedTrip('')
      setEntryId(id)
      setPage('journal')
      setDetail(false)
      setSearchOpen(false)
    })
  }
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
  const trips = activeTrips(snapshot),
    visits = activeVisits(snapshot),
    entries = activeEntries(snapshot),
    attachments = activeAttachments(snapshot),
    stamps = passport(snapshot),
    filteredTrips = matchingTrips(snapshot, query, year, cityId).filter(
      (t) => !selectedTrip || t.id === selectedTrip
    ),
    trip = trips.find((t) => t.id === selectedTrip),
    years = [
      ...new Set(
        [
          ...trips.filter((t) => !visits.some((v) => v.tripId === t.id)).map((t) => t.startDate.slice(0, 4)),
          ...visits.map((v) =>
            effectiveVisitDate(
              v,
              trips.find((t) => t.id === v.tripId)!
            ).slice(0, 4)
          )
        ].filter(Boolean)
      )
    ]
      .sort()
      .reverse(),
    currentNav = navigation.find((n) => n.id === page)
  const searchResults = query.trim()
    ? [
        ...matchingTrips(snapshot, query)
          .slice(0, 5)
          .map((t) => ({
            id: 't' + t.id,
            label: t.title,
            sub: '旅行 · ' + tripDates(t),
            icon: Compass,
            open: () => openTrip(t.id)
          })),
        ...entries
          .filter((e) => matches(e.title + ' ' + e.markdown, query))
          .slice(0, 4)
          .map((e) => ({
            id: 'e' + e.id,
            label: e.title,
            sub: '手记 · ' + trips.find((t) => t.id === e.tripId)?.title,
            icon: BookOpen,
            open: () => openEntry(e.id)
          })),
        ...visits
          .filter((v) => {
            const p = snapshot.places.find((p) => p.id === v.placeId)
            return p && matches(p.name + ' ' + p.cityName, query)
          })
          .slice(0, 4)
          .map((v) => ({
            id: 'v' + v.id,
            label: snapshot.places.find((p) => p.id === v.placeId)!.name,
            sub: '足迹 · ' + trips.find((t) => t.id === v.tripId)?.title,
            icon: MapPin,
            open: () => openTrip(v.tripId)
          }))
      ]
    : []
  const pickMemory = () => {
    const candidates = trips.filter(
      (t) => entries.some((e) => e.tripId === t.id) || attachments.some((a) => a.tripId === t.id)
    )
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
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault()
            go('map')
          }}
        >
          <div className="brand-mark">
            <Compass size={29} strokeWidth={1.4} />
          </div>
          <span>
            MyMap<small>我的旅行 · 我的地图</small>
          </span>
        </a>
        <div className="sidebar-divider" />
        <p className="nav-caption">去看看世界</p>
        <nav>
          {navigation.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${page === n.id ? 'active' : ''}`}
              onClick={() => go(n.id)}
            >
              <n.icon size={19} strokeWidth={1.7} />
              <span>{n.label}</span>
              {n.id === 'trips' && <small>{trips.length.toString().padStart(2, '0')}</small>}
            </button>
          ))}
        </nav>
        <button className={`memory-card ${memory ? 'shuffling' : ''}`} onClick={pickMemory}>
          <span className="memory-stars">✦</span>
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
            onClick={() => go('settings')}
          >
            <Settings size={18} />
            <span>设置与资料库</span>
          </button>
          <div className="sidebar-footer">
            MADE FOR YOUR WANDERLUST <span>↗</span>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            我的旅行空间 <ChevronRight size={12} />
            <span>{currentNav?.label || '设置与资料库'}</span>
            {snapshot.library.isDemo && <b className="demo-badge">独立演示库</b>}
          </div>
          <div className="topbar-actions">
            <div className="global-search">
              <Search size={16} />
              <input
                aria-label="搜索旅行、地点、手记和标签"
                placeholder="搜索旅行、城市、手记…"
                value={query}
                onFocus={() => setSearchOpen(true)}
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
                        <button key={r.id} onClick={r.open}>
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
            <button className="button primary new-trip-button" onClick={() => setTripEditor(null)}>
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
        <div className={`page-content page-${page}`}>
          <section className="page-heading">
            <div>
              <div className="eyebrow">
                {page === 'map'
                  ? 'THE WORLD IS YOUR STORY'
                  : page === 'settings'
                    ? 'A HOME FOR YOUR MEMORIES'
                    : page === 'passport'
                      ? 'COLLECT MOMENTS, NOT THINGS'
                      : 'LITTLE JOURNEYS, LASTING MEMORIES'}
              </div>
              <h1>
                {detail && trip ? trip.title : currentNav?.label || '设置与资料库'}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {detail && trip
                  ? tripDates(trip)
                  : currentNav?.hint || '妥善保管每一段回忆，让故事安心生长。'}
              </p>
            </div>
            {page === 'map' && (
              <div className="heading-quote">
                “ 去过的地方，
                <br />
                终会成为我们的一部分。 ”<span>— 致每一位出发的人</span>
              </div>
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
                <button
                  className="text-button"
                  onClick={() => {
                    setYear('')
                    setCityId('')
                    setSelectedTrip('')
                    setQuery('')
                  }}
                >
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
            <>
              <div className="home-grid">
                <section className="map-card">
                  <div className="map-card-heading">
                    <div>
                      <span className="eyebrow">MY FOOTPRINTS</span>
                      <h2>一步一印，皆是风景</h2>
                    </div>
                    <span className="map-pill">
                      <span />
                      我的足迹
                    </span>
                  </div>
                  <div className="home-map">
                    <FootprintMap
                      snapshot={snapshot}
                      tripId={selectedTrip || undefined}
                      year={year || undefined}
                      cityId={cityId || undefined}
                      onVisitSelect={(id) => {
                        const v = visits.find((v) => v.id === id)
                        if (v) openTrip(v.tripId)
                      }}
                      onPickLocation={(lat, lon) => {
                        if (trip) setVisitEditor({ tripId: trip.id, coordinates: [lat, lon] })
                        else notify('先在上方选择一段旅行，再点击地图添加地点。')
                      }}
                    />
                  </div>
                  <div className="map-bottom-note">
                    <span>
                      <span className="legend-dot" />
                      到访过的城市
                    </span>
                    <span>
                      你的世界，正在一点点展开 <Globe2 size={13} />
                    </span>
                  </div>
                </section>
                <aside className="home-aside">
                  <div className="stats-card">
                    <span className="eyebrow">THE JOURNEY SO FAR</span>
                    <h3>走过的，都是拥有</h3>
                    <div className="stats-row">
                      <div>
                        <strong>{stamps.length.toString().padStart(2, '0')}</strong>
                        <span>座城市</span>
                      </div>
                      <div>
                        <strong>{trips.length.toString().padStart(2, '0')}</strong>
                        <span>段旅行</span>
                      </div>
                      <div>
                        <strong>
                          {new Set(attachments.map((a) => a.photoId)).size.toString().padStart(2, '0')}
                        </strong>
                        <span>张回忆</span>
                      </div>
                    </div>
                    <div className="stats-footer">
                      <MapPin size={13} />
                      {stamps.length ? `世界里，已有 ${stamps.length} 个属于你的坐标` : '下一站，会是哪里？'}
                    </div>
                  </div>
                  <div className="recent-journals">
                    <div className="section-title">
                      <h3>手记一隅</h3>
                      <button className="icon-button" aria-label="查看所有手记" onClick={() => go('journal')}>
                        <ArrowRight size={16} />
                      </button>
                    </div>
                    {entries
                      .slice()
                      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                      .slice(0, 3)
                      .map((e, i) => (
                        <button key={e.id} className="journal-preview" onClick={() => openEntry(e.id)}>
                          <span className="journal-number">0{i + 1}</span>
                          <div>
                            <h4>{e.title}</h4>
                            <p>
                              {e.markdown.replace(/[#*_>![\]()`]/g, '').slice(0, 44) ||
                                '这一页，写着旅途的心情。'}
                            </p>
                            <small>
                              {e.updatedAt.slice(0, 10).replaceAll('-', '.')} <ArrowRight size={12} />
                            </small>
                          </div>
                        </button>
                      ))}
                    {!entries.length && (
                      <div className="small-empty">
                        <BookOpen size={24} strokeWidth={1.1} />
                        <p>
                          远方的故事，
                          <br />
                          等你落笔。
                        </p>
                        <button className="text-button" onClick={() => go('journal')}>
                          写下第一篇 <ArrowRight size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                </aside>
              </div>
              <div className="section-title recent-title">
                <div>
                  <span className="eyebrow">THE LATEST CHAPTERS</span>
                  <h2>最近的旅行</h2>
                </div>
                <button className="text-button" onClick={() => go('trips')}>
                  查看全部旅行
                  <ArrowRight size={15} />
                </button>
              </div>
              {filteredTrips.length ? (
                <div className="trip-grid home-trips">
                  {filteredTrips.slice(0, 3).map((t) => (
                    <TripCard key={t.id} trip={t} snapshot={snapshot} onClick={() => openTrip(t.id)} />
                  ))}
                </div>
              ) : (
                <Empty
                  title={trips.length ? '还没有符合筛选的旅行' : '第一段故事，从这里出发'}
                  description={
                    trips.length
                      ? '换一个年份或城市，看看那些珍贵的足迹。'
                      : '一座想去的城市，一段想记住的日子。建立旅行，再把照片、足迹和心情装进去。'
                  }
                  action={trips.length ? undefined : () => setTripEditor(null)}
                />
              )}
            </>
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
                  const visit = snapshot.visits.find((v) => v.id === id)
                  const place = visit && snapshot.places.find((p) => p.id === visit.placeId)
                  if (visit && place) setVisitEditor({ tripId: trip.id, initial: { visit, place } })
                }}
                onPick={(lat, lon) => setVisitEditor({ tripId: trip.id, coordinates: [lat, lon] })}
                onGallery={() => go('gallery')}
                onEntry={openEntry}
                onJournal={() => {
                  go('journal')
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
          )}
          {page === 'gallery' && (
            <Gallery
              snapshot={snapshot}
              tripId={selectedTrip}
              run={run}
              refresh={refresh}
              confirmTrash={(id) => trash('attachment', id)}
            />
          )}
          {page === 'passport' && (
            <Passport
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
              YOUR MEMORIES, YOURS FOREVER <Compass size={12} />
            </span>
          </footer>
        </div>
      </main>
      {tripEditor !== false && (
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
      )}
      {visitEditor && (
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

function TripCard({
  trip: t,
  snapshot,
  onClick
}: {
  trip: Trip
  snapshot: AppSnapshot
  onClick: () => void
}) {
  const visits = orderedVisits(snapshot, t.id),
    cities = new Set(
      visits.map((v) => snapshot.places.find((p) => p.id === v.placeId)?.cityId).filter(Boolean)
    )
  return (
    <button className="trip-card" onClick={onClick}>
      <Cover trip={t} snapshot={snapshot} />
      <div className="trip-card-body">
        <span className="trip-date">{tripDates(t)}</span>
        <h3>
          {t.title}
          <ArrowRight size={17} />
        </h3>
        <p>{t.description || '风景和故事，都在路上。'}</p>
        <div className="trip-card-footer">
          <span>
            <MapPin size={12} />
            {cities.size} 座城市 <span className="bullet">·</span> {visits.length} 处足迹
          </span>
          {t.tags[0] && <small>{t.tags[0]}</small>}
        </div>
      </div>
    </button>
  )
}

function TripDetail({
  trip: t,
  snapshot,
  playback,
  setPlayback,
  onEdit,
  onVisit,
  onEditVisit,
  onPick,
  onGallery,
  onEntry,
  onJournal,
  run,
  confirm,
  trash
}: {
  trip: Trip
  snapshot: AppSnapshot
  playback: boolean
  setPlayback: (v: boolean) => void
  onEdit: () => void
  onVisit: () => void
  onEditVisit: (id: string) => void
  onPick: (lat: number, lon: number) => void
  onGallery: () => void
  onEntry: (id: string) => void
  onJournal: () => void
  run: (op: () => Promise<unknown>, s?: string) => Promise<boolean>
  confirm: (c: Confirmation) => void
  trash: () => void
}) {
  const visits = orderedVisits(snapshot, t.id),
    entries = activeEntries(snapshot).filter((e) => e.tripId === t.id),
    attachments = activeAttachments(snapshot).filter((a) => a.tripId === t.id)
  const reorder = async (id: string, dir: number) => {
    const ids = visits.map((v) => v.id),
      i = ids.indexOf(id),
      j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    await run(() => window.myMap.reorderVisits(t.id, ids))
  }
  return (
    <div className="trip-detail">
      <div className="trip-intro">
        <p>{t.description || '不必赶路，去感受路。把这一路的风景与心情，慢慢收藏。'}</p>
        <div className="tags">
          {t.tags.map((tag) => (
            <span key={tag}># {tag}</span>
          ))}
        </div>
        <div className="detail-actions">
          <button className="button" onClick={onEdit}>
            <Pencil size={14} />
            编辑旅行
          </button>
          <button className="button" onClick={() => setPlayback(!playback)}>
            <Map size={14} />
            {playback ? '结束足迹回放' : '足迹回放'}
          </button>
          <button className="icon-button danger" aria-label="删除旅行" onClick={trash}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      <div className="detail-grid">
        <div className="itinerary-card">
          <div className="section-title">
            <h2>沿途 · {visits.length} 站</h2>
            <button className="text-button" onClick={onVisit}>
              <Plus size={15} />
              添加地点
            </button>
          </div>
          {visits.length ? (
            <ol className="itinerary">
              {visits.map((v, i) => {
                const p = snapshot.places.find((p) => p.id === v.placeId)!
                return (
                  <li key={v.id}>
                    <div className="visit-number">{String(i + 1).padStart(2, '0')}</div>
                    <div className="visit-content">
                      <span className="visit-date">
                        {v.date || '无日期的回忆'} ·{' '}
                        {p.kind === 'city' ? '城市' : p.kind === 'scenic' ? '景点' : '地点'}
                      </span>
                      <h3>
                        {p.name}
                        <small>{p.kind !== 'city' ? p.cityName : p.country}</small>
                      </h3>
                      {v.note && <p>{v.note}</p>}
                      <div className="visit-actions">
                        <button
                          className="icon-button"
                          aria-label={`编辑${p.name}`}
                          title="编辑到访记录"
                          onClick={() => onEditVisit(v.id)}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          className="icon-button"
                          disabled={i === 0}
                          aria-label={`上移${p.name}`}
                          onClick={() => reorder(v.id, -1)}
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          className="icon-button"
                          disabled={i === visits.length - 1}
                          aria-label={`下移${p.name}`}
                          onClick={() => reorder(v.id, 1)}
                        >
                          <ArrowDown size={13} />
                        </button>
                        <button
                          className="icon-button danger"
                          aria-label={`移除${p.name}`}
                          onClick={() =>
                            confirm({
                              title: '移除这条到访记录？',
                              description: '这条足迹将被移除，关联的手记和照片仍会保留在旅行中。',
                              label: '移除记录',
                              action: () => window.myMap.deleteVisit(v.id)
                            })
                          }
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          ) : (
            <div className="small-empty">
              <MapPin size={28} />
              <p>每一程，都从第一站开始。</p>
              <button className="button primary" onClick={onVisit}>
                <Plus size={15} />
                添加第一站
              </button>
            </div>
          )}
        </div>
        <section className="detail-map">
          <FootprintMap snapshot={snapshot} tripId={t.id} playback={playback} onPickLocation={onPick} />
        </section>
      </div>
      <div className="detail-extras">
        <section>
          <div className="section-title">
            <h2>
              这一程的手记 <small>{entries.length}</small>
            </h2>
            <button className="text-button" onClick={onJournal}>
              去写手记
              <ArrowRight size={14} />
            </button>
          </div>
          {entries.length ? (
            entries.map((e) => (
              <button className="detail-entry" key={e.id} onClick={() => onEntry(e.id)}>
                <BookOpen size={20} />
                <span>
                  <strong>{e.title}</strong>
                  <small>{e.markdown.replace(/[#*_>]/g, '').slice(0, 70) || '等待写下的故事'}</small>
                </span>
                <ArrowRight size={16} />
              </button>
            ))
          ) : (
            <p className="muted">这段旅行，值得一篇手记。</p>
          )}
        </section>
        <section>
          <div className="section-title">
            <h2>
              旅途相册 <small>{attachments.length}</small>
            </h2>
            <button className="text-button" onClick={onGallery}>
              打开照片馆
              <ArrowRight size={14} />
            </button>
          </div>
          <Cover trip={t} snapshot={snapshot} className="detail-cover" />
          {!attachments.length && <p className="muted">把沿途的光影，装进这段旅行。</p>}
        </section>
      </div>
    </div>
  )
}

function Passport({
  snapshot,
  year,
  tripId,
  cityId,
  onTrip
}: {
  snapshot: AppSnapshot
  year: string
  tripId: string
  cityId: string
  onTrip: (id: string) => void
}) {
  const eligible = activeVisits(snapshot).filter(
      (v) =>
        (!tripId || v.tripId === tripId) &&
        (!year ||
          effectiveVisitDate(
            v,
            snapshot.trips.find((t) => t.id === v.tripId)!
          ).startsWith(year))
    ),
    ids = new Set(eligible.map((v) => snapshot.places.find((p) => p.id === v.placeId)?.cityId)),
    stamps = passport(snapshot).filter((s) => ids.has(s.cityId) && (!cityId || cityId === s.cityId))
  return (
    <div className="passport-page">
      <div className="passport-banner">
        <div className="passport-emblem">
          <Globe2 size={43} strokeWidth={1} />
          <span>MYMAP</span>
        </div>
        <div>
          <span className="eyebrow">A PASSPORT TO YOUR OWN WORLD</span>
          <h2>旅 行 护 照</h2>
          <p>不论远近，每一次抵达都值得纪念。</p>
        </div>
        <div className="passport-total">
          <strong>{stamps.length.toString().padStart(3, '0')}</strong>
          <span>枚城市印章</span>
        </div>
      </div>
      {stamps.length ? (
        <div className="stamp-grid">
          {stamps.map((s, i) => {
            const v = eligible.find(
              (v) => snapshot.places.find((p) => p.id === v.placeId)?.cityId === s.cityId
            )
            return (
              <button
                className={`city-stamp stamp-color-${i % 3}`}
                key={s.cityId}
                onClick={() => v && onTrip(v.tripId)}
                style={{ '--tilt': `${((i % 5) - 2) * 1.3}deg` } as React.CSSProperties}
              >
                <span className="stamp-top">MYMAP · {s.country}</span>
                <MapPin size={25} strokeWidth={1.1} />
                <strong>{s.name}</strong>
                <span className="stamp-date">
                  {s.date ? s.date.replaceAll('-', ' . ') : '无日期 · 已抵达'}
                </span>
                <span className="stamp-bottom">FIRST ARRIVAL · {s.count} 次到访</span>
              </button>
            )
          })}
        </div>
      ) : (
        <Empty
          title="你的世界，等你盖章"
          description="给旅行添加到访城市，属于你的城市印章就会出现在这里。同一座城市，只收集一枚初次抵达的印章。"
        />
      )}
      <p className="passport-note">
        每座城市一枚印章 · 按首次到访日期记录 · 没有日期，也是一段值得珍藏的抵达
      </p>
    </div>
  )
}

function SettingsPage({
  snapshot,
  run,
  confirm,
  guarded,
  reset
}: {
  snapshot: AppSnapshot
  run: (op: () => Promise<unknown>, s?: string) => Promise<boolean>
  confirm: (c: Confirmation) => void
  guarded: (action: () => void | Promise<void>) => Promise<void>
  reset: () => void
}) {
  const trashItems = [
    ...snapshot.trips
      .filter((t) => t.deletedAt)
      .map((t) => ({ kind: 'trip' as const, id: t.id, label: t.title, type: '旅行' })),
    ...snapshot.entries
      .filter((e) => e.deletedAt)
      .map((e) => ({ kind: 'entry' as const, id: e.id, label: e.title, type: '手记' })),
    ...snapshot.attachments
      .filter((a) => a.deletedAt)
      .map((a) => ({ kind: 'attachment' as const, id: a.id, label: a.caption || '旅行照片', type: '照片' }))
  ]
  const switchLibrary = (op: () => Promise<unknown>) =>
    guarded(async () => {
      if (await run(op)) reset()
    })
  return (
    <div className="settings-layout">
      <section className="settings-card">
        <div className="settings-icon">
          <FolderOpen size={24} />
        </div>
        <h2>回忆的家</h2>
        <p className="muted">所有旅行、手记和照片，都保存在你自己的电脑上。</p>
        <label className="library-path">
          当前资料库<code>{snapshot.library.path}</code>
        </label>
        <div className="settings-actions">
          <button className="button" onClick={() => run(() => window.myMap.openLibraryFolder())}>
            <FolderOpen size={15} />
            打开资料库文件夹
          </button>
          <button className="button" onClick={() => switchLibrary(() => window.myMap.chooseLibrary())}>
            选择其他资料库
          </button>
        </div>
        <hr />
        <h3>为回忆留一份备份</h3>
        <p className="muted">备份包含旅行记录与照片。建议定期保存在另一块磁盘中。</p>
        <div className="settings-actions">
          <button className="button primary" onClick={() => run(() => window.myMap.backup(), '备份已创建')}>
            <ShieldCheck size={15} />
            创建完整备份
          </button>
          <button
            className="button"
            onClick={() =>
              confirm({
                title: '从备份恢复资料库',
                description: '将打开备份选择窗口。恢复会切换到备份中的资料；请先妥善保存当前资料库。',
                label: '选择备份恢复',
                action: async () => {
                  const result = await window.myMap.restoreBackup()
                  if (result) reset()
                  return result
                }
              })
            }
          >
            <Upload size={15} />
            从备份恢复
          </button>
        </div>
      </section>
      <section className="settings-card demo-setting">
        <Sparkles size={25} />
        <h2>先逛逛，再出发</h2>
        <p>在独立演示库里，体验足迹地图、旅行手记和照片收藏。演示数据与你的旅行分开保存。</p>
        <button
          className="button"
          onClick={() => switchLibrary(() => window.myMap.setDemo(!snapshot.library.isDemo))}
        >
          {snapshot.library.isDemo ? '回到我的资料库' : '打开独立演示库'}
          <ArrowRight size={15} />
        </button>
        <div className="settings-privacy">
          <ShieldCheck size={27} strokeWidth={1.1} />
          <h3>属于你，也只属于你</h3>
          <p>无需账号、无需网络。地图、城市检索、照片和文字，全部在本地运行。</p>
        </div>
      </section>
      <section className="settings-card trash-card">
        <div className="section-title">
          <div>
            <h2>
              回收站 <small>{trashItems.length}</small>
            </h2>
            <p className="muted">暂时收起的回忆，仍可以找回来。</p>
          </div>
          <button
            className="button danger"
            disabled={!trashItems.length}
            onClick={() =>
              confirm({
                title: '永久清空回收站？',
                description: '回收站中的旅行、手记和照片关联将被永久移除，无法恢复。请确认不再需要这些资料。',
                label: '永久清空',
                action: () => window.myMap.emptyTrash()
              })
            }
          >
            <Trash2 size={15} />
            清空回收站
          </button>
        </div>
        {trashItems.length ? (
          <div className="trash-list">
            {trashItems.map((item) => (
              <div className="trash-row" key={item.kind + item.id}>
                <span className="trash-type">{item.type}</span>
                <span>{item.label}</span>
                <button
                  className="text-button"
                  onClick={() => run(() => window.myMap.restore(item.kind, item.id), '已从回收站恢复')}
                >
                  恢复
                  <ArrowRight size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="trash-empty">回收站空空的，回忆都好好地在。</div>
        )}
      </section>
      <p className="settings-version">MyMap 0.1 · 完全离线的私人旅行空间</p>
    </div>
  )
}
