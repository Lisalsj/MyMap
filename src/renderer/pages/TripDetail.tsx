import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Camera,
  Map,
  MapPin,
  Pencil,
  Plus,
  Trash2
} from '../ui/icons'
import type { AppSnapshot, Trip } from '../../shared/types'
import { Cover } from '../components/Common'
import { FootprintMap } from '../components/FootprintMap'
import { getSnapshotIndex } from '../snapshotIndex'
import type { Confirmation, RunOperation } from './types'
import '../styles/trips.css'

export function TripDetail({
  trip,
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
  setPlayback: (value: boolean) => void
  onEdit: () => void
  onVisit: () => void
  onEditVisit: (id: string) => void
  onPick: (lat: number, lon: number) => void
  onGallery: () => void
  onEntry: (id: string) => void
  onJournal: () => void
  run: RunOperation
  confirm: (confirmation: Confirmation) => void
  trash: () => void
}) {
  const index = getSnapshotIndex(snapshot)
  const visits = index.orderedVisitsByTrip.get(trip.id) || []
  const entries = index.entriesByTrip.get(trip.id) || []
  const attachments = index.attachmentsByTrip.get(trip.id) || []
  const reorder = async (id: string, direction: number) => {
    const ids = visits.map((visit) => visit.id)
    const current = ids.indexOf(id)
    const next = current + direction
    if (current < 0 || next < 0 || next >= ids.length) return
    ;[ids[current], ids[next]] = [ids[next], ids[current]]
    await run(() => window.myMap.reorderVisits(trip.id, ids))
  }

  return (
    <div className="trip-detail">
      <section className="trip-intro" aria-label="旅行概览">
        <div className="trip-intro-copy">
          <p>{trip.description || '添加沿途的地点、照片和手记，慢慢留下这一程的故事。'}</p>
          {!!trip.tags.length && (
            <div className="tags">
              {trip.tags.map((tag) => (
                <span key={tag}># {tag}</span>
              ))}
            </div>
          )}
        </div>
        <div className="detail-actions">
          <button className="button" onClick={onEdit}>
            <Pencil size={18} />
            编辑旅行
          </button>
          <button className="button" onClick={() => setPlayback(!playback)} aria-pressed={playback}>
            <Map size={18} />
            {playback ? '结束足迹回放' : '足迹回放'}
          </button>
          <button className="icon-button danger" aria-label="删除旅行" onClick={trash}>
            <Trash2 size={20} />
          </button>
        </div>
      </section>

      <section className="detail-map" aria-label="旅行足迹地图">
        <div className="detail-map-heading">
          <div>
            <span className="section-label">沿途版图</span>
            <h2>这一程，走过的地方</h2>
          </div>
          <span>{visits.length} 处足迹</span>
        </div>
        <div className="detail-map-canvas">
          <FootprintMap snapshot={snapshot} tripId={trip.id} playback={playback} onPickLocation={onPick} />
        </div>
      </section>

      <div className="detail-grid">
        <section className="itinerary-card">
          <div className="section-title">
            <h2>沿途 · {visits.length} 站</h2>
            <button className="button primary" onClick={onVisit}>
              <Plus size={18} />
              添加地点
            </button>
          </div>
          {visits.length ? (
            <ol className="itinerary">
              {visits.map((visit, order) => {
                const place = index.placeById.get(visit.placeId)!
                return (
                  <li key={visit.id}>
                    <div className="visit-number">{String(order + 1).padStart(2, '0')}</div>
                    <div className="visit-content">
                      <span className="visit-date">
                        {visit.date || '无日期的回忆'} ·{' '}
                        {place.kind === 'city' ? '城市' : place.kind === 'scenic' ? '景点' : '地点'}
                      </span>
                      <h3>
                        {place.name}
                        {(place.kind !== 'city' ? place.cityName : place.country) && (
                          <small>{place.kind !== 'city' ? place.cityName : place.country}</small>
                        )}
                      </h3>
                      {visit.note && <p>{visit.note}</p>}
                      <div className="visit-actions">
                        <button
                          className="icon-button"
                          aria-label={`编辑${place.name}`}
                          title="编辑到访记录"
                          onClick={() => onEditVisit(visit.id)}
                        >
                          <Pencil size={18} />
                        </button>
                        <button
                          className="icon-button"
                          disabled={order === 0}
                          aria-label={`上移${place.name}`}
                          onClick={() => void reorder(visit.id, -1)}
                        >
                          <ArrowUp size={18} />
                        </button>
                        <button
                          className="icon-button"
                          disabled={order === visits.length - 1}
                          aria-label={`下移${place.name}`}
                          onClick={() => void reorder(visit.id, 1)}
                        >
                          <ArrowDown size={18} />
                        </button>
                        <button
                          className="icon-button danger"
                          aria-label={`移除${place.name}`}
                          onClick={() =>
                            confirm({
                              title: '移除这条到访记录？',
                              description: '这条足迹将被移除，关联的手记和照片仍会保留在旅行中。',
                              label: '移除记录',
                              action: () => window.myMap.deleteVisit(visit.id)
                            })
                          }
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          ) : (
            <div className="small-empty">
              <MapPin size={32} />
              <h3>从第一站开始记录</h3>
              <p>城市、景点，或一个只有你知道的地方，都可以留下足迹。</p>
              <button className="button primary" onClick={onVisit}>
                <Plus size={18} />
                添加第一站
              </button>
            </div>
          )}
        </section>

        <aside className="detail-extras" aria-label="旅行手记和照片">
          <section className="detail-journals">
            <div className="section-title">
              <h2>
                这一程的手记 <small>{entries.length}</small>
              </h2>
              <button className="text-button" onClick={onJournal}>
                去写手记
                <ArrowRight size={18} />
              </button>
            </div>
            {entries.length ? (
              entries.map((entry) => (
                <button className="detail-entry" key={entry.id} onClick={() => onEntry(entry.id)}>
                  <BookOpen size={22} />
                  <span>
                    <strong>{entry.title || '未命名手记'}</strong>
                    <small>{entry.markdown.replace(/[#*_>]/g, '').slice(0, 70) || '等待写下的故事'}</small>
                  </span>
                  <ArrowRight size={18} />
                </button>
              ))
            ) : (
              <div className="detail-empty">
                <BookOpen size={24} />
                <p>记下这一程值得回味的小事。</p>
              </div>
            )}
          </section>
          <section className="detail-album">
            <div className="section-title">
              <h2>
                旅途相册 <small>{attachments.length}</small>
              </h2>
              <button className="text-button" onClick={onGallery}>
                打开照片馆
                <ArrowRight size={18} />
              </button>
            </div>
            <button
              className="detail-cover-button"
              onClick={onGallery}
              aria-label={`打开${trip.title}的照片馆`}
            >
              <Cover trip={trip} snapshot={snapshot} className="detail-cover" />
              <span>
                <Camera size={18} />
                {attachments.length ? `查看这段旅行的 ${attachments.length} 张照片` : '导入这段旅行的照片'}
                <ArrowRight size={18} />
              </span>
            </button>
          </section>
        </aside>
      </div>
    </div>
  )
}
