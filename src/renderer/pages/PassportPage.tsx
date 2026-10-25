import { useMemo } from 'react'
import { ArrowRight, Globe2, MapPin } from '../ui/icons'
import type { AppSnapshot } from '../../shared/types'
import { Empty } from '../components/Common'
import { effectiveVisitDate, passport } from '../model'
import { getSnapshotIndex } from '../snapshotIndex'
import '../styles/passport.css'

export function PassportPage({
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
  const { stamps, firstTripByCity } = useMemo(() => {
    const index = getSnapshotIndex(snapshot)
    const firstTripByCity = new Map<string, string>()
    for (const visit of index.activeVisits) {
      if (tripId && visit.tripId !== tripId) continue
      if (year && !effectiveVisitDate(visit, index.tripById.get(visit.tripId)!).startsWith(year)) continue
      const place = index.placeById.get(visit.placeId)!
      if (place.cityId && !firstTripByCity.has(place.cityId)) firstTripByCity.set(place.cityId, visit.tripId)
    }
    return {
      stamps: passport(snapshot).filter(
        (stamp) => firstTripByCity.has(stamp.cityId) && (!cityId || cityId === stamp.cityId)
      ),
      firstTripByCity
    }
  }, [snapshot, year, tripId, cityId])

  return (
    <div className="passport-page">
      <section className="passport-banner" aria-label="城市印章收藏">
        <div className="passport-banner-copy">
          <Globe2 size={32} aria-hidden="true" />
          <div>
            <span className="section-label">我的城市收藏</span>
            <h2>每一次抵达，都有迹可循</h2>
            <p>把去过的城市收进护照，随时翻回那段旅程。</p>
          </div>
        </div>
        <div className="passport-total">
          <strong>{stamps.length.toString().padStart(2, '0')}</strong>
          <span>枚城市印章</span>
        </div>
      </section>
      {stamps.length ? (
        <div className="stamp-grid">
          {stamps.map((stamp) => (
            <button
              className="city-stamp"
              key={stamp.cityId}
              onClick={() => {
                const id = firstTripByCity.get(stamp.cityId)
                if (id) onTrip(id)
              }}
            >
              <span className="stamp-art" aria-hidden="true">
                <span className="stamp-top">MYMAP · {stamp.country || '城市足迹'}</span>
                <MapPin size={32} />
                <strong>{stamp.name}</strong>
                <span className="stamp-bottom">已经抵达</span>
              </span>
              <span className="stamp-caption">
                <strong>{stamp.name}</strong>
                <span className="stamp-date">
                  {stamp.date ? `首次到访 ${stamp.date.replaceAll('-', '.')}` : '无日期 · 已抵达'}
                </span>
                <span className="stamp-count">
                  {stamp.count} 次到访
                  <ArrowRight size={18} aria-hidden="true" />
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <Empty
          title="你的世界，等你盖章"
          description="给旅行添加到访城市，城市印章就会出现在这里。换一个筛选条件，也许能找到另一段回忆。"
        />
      )}
      <p className="passport-note">每座城市一枚印章 · 日期记录首次到访 · 次数包含这座城市的全部足迹</p>
    </div>
  )
}
