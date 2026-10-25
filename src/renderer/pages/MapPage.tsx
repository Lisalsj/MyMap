import { useCallback, useMemo } from 'react'
import { ArrowRight, BookOpen, MapPin } from '../ui/icons'
import type { AppSnapshot, Trip } from '../../shared/types'
import { Empty } from '../components/Common'
import { FootprintMap } from '../components/FootprintMap'
import { passport } from '../model'
import { getSnapshotIndex } from '../snapshotIndex'
import { TripCard } from './TripCard'

interface Props {
  snapshot: AppSnapshot
  tripId: string
  year: string
  cityId: string
  filteredTrips: readonly Trip[]
  onTrip: (id: string) => void
  onEntry: (id: string) => void
  onJournal: () => void
  onTrips: () => void
  onNewTrip: () => void
  onClearFilters: () => void
  onPickLocation: (lat: number, lon: number) => void
}
export function MapPage({
  snapshot,
  tripId,
  year,
  cityId,
  filteredTrips,
  onTrip,
  onEntry,
  onJournal,
  onTrips,
  onNewTrip,
  onClearFilters,
  onPickLocation
}: Props) {
  const index = getSnapshotIndex(snapshot)
  const { activeTrips: trips, activeEntries: entries, activeAttachments: attachments } = index
  const stamps = useMemo(() => passport(snapshot), [snapshot])
  const photoCount = useMemo(() => new Set(attachments.map((item) => item.photoId)).size, [attachments])
  const recentEntries = useMemo(
    () => [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3),
    [entries]
  )
  const handleVisitSelect = useCallback(
    (id: string) => {
      const visit = index.visitById.get(id)
      if (visit && index.activeTripIds.has(visit.tripId)) onTrip(visit.tripId)
    },
    [index, onTrip]
  )
  const handlePickLocation = useCallback(
    (lat: number, lon: number) => onPickLocation(lat, lon),
    [onPickLocation]
  )
  return (
    <>
      <div className="home-grid">
        <section className="map-card" aria-label="我的城市版图">
          <div className="home-map">
            <FootprintMap
              snapshot={snapshot}
              tripId={tripId || undefined}
              year={year || undefined}
              cityId={cityId || undefined}
              onVisitSelect={handleVisitSelect}
              onPickLocation={tripId ? handlePickLocation : undefined}
            />
          </div>
        </section>
        <div className="map-context-row">
          <span>
            <MapPin size={16} />
            {tripId
              ? `当前旅行：${index.tripById.get(tripId)?.title || '所选旅行'}`
              : '当前显示所选年份与城市的旅行足迹'}
          </span>
          <span>{tripId ? '使用地图选点，为这段旅行添加地点' : '选择一段旅行后，可以在地图上添加地点'}</span>
        </div>
        <div className="home-aside">
          <section className="stats-card" aria-label="资料库总览">
            <span className="eyebrow">资料库总览 · 全部记录</span>
            <h3>一点点走远，一点点收藏</h3>
            <div className="stats-row">
              <div>
                <strong>{stamps.length.toString().padStart(2, '0')}</strong>
                <span>个城市记录</span>
              </div>
              <div>
                <strong>{trips.length.toString().padStart(2, '0')}</strong>
                <span>段旅行</span>
              </div>
              <div>
                <strong>{photoCount.toString().padStart(2, '0')}</strong>
                <span>张照片</span>
              </div>
            </div>
            <div className="stats-footer">
              <BookOpen size={16} />
              {entries.length} 篇手记，记录了路上的心情
            </div>
          </section>
          <section className="recent-journals">
            <div className="section-title">
              <h3>最近写下</h3>
              <button className="icon-button" aria-label="查看所有手记" onClick={onJournal}>
                <ArrowRight size={20} />
              </button>
            </div>
            {recentEntries.map((entry, i) => (
              <button key={entry.id} className="journal-preview" onClick={() => onEntry(entry.id)}>
                <span className="journal-number">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <h4>{entry.title}</h4>
                  <p>
                    {entry.markdown.replace(/[#*_>![\]()`]/g, '').slice(0, 70) ||
                      '打开这页手记，接着写下去。'}
                  </p>
                  <small>
                    {entry.updatedAt.slice(0, 10).replaceAll('-', '.')}
                    <ArrowRight size={16} />
                  </small>
                </div>
              </button>
            ))}
            {!entries.length && (
              <div className="small-empty">
                <BookOpen size={32} />
                <p>第一篇手记，可以从今天的风景开始。</p>
                <button className="text-button" onClick={onJournal}>
                  写下第一篇
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
      <div className="section-title recent-title">
        <div>
          <span className="eyebrow">按当前筛选展示</span>
          <h2>最近的旅行</h2>
        </div>
        <button className="text-button" onClick={onTrips}>
          查看全部旅行
          <ArrowRight size={16} />
        </button>
      </div>
      {filteredTrips.length ? (
        <div className="trip-grid home-trips">
          {filteredTrips.slice(0, 2).map((trip) => (
            <TripCard key={trip.id} trip={trip} snapshot={snapshot} onClick={() => onTrip(trip.id)} />
          ))}
        </div>
      ) : (
        <Empty
          title={trips.length ? '没有符合筛选的旅行' : '从第一段旅行开始'}
          description={
            trips.length ? '放宽年份或城市条件，找回那段旅程。' : '创建旅行，再把到访地点、照片和手记收进来。'
          }
          action={trips.length ? onClearFilters : onNewTrip}
          label={trips.length ? '清除筛选' : '新建旅行'}
        />
      )}
    </>
  )
}
