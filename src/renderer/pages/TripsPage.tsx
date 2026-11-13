import { useMemo } from 'react'
import { Grid, List, Plus } from '../ui/icons'
import type { AppSnapshot, Trip } from '../../shared/types'
import { Empty } from '../components/Common'
import { TripCard } from './TripCard'
import { useViewPreference } from '../ui/useViewPreference'

export function TripsPage({
  snapshot,
  trips,
  hasTrips,
  onTrip,
  onNew,
  onClear
}: {
  snapshot: AppSnapshot
  trips: readonly Trip[]
  hasTrips: boolean
  onTrip: (id: string) => void
  onNew: () => void
  onClear: () => void
}) {
  const [layout, setLayout] = useViewPreference('trip-layout', ['grid', 'list'], 'grid')
  const [sort, setSort] = useViewPreference('trip-sort', ['date', 'updated', 'title'], 'date')
  const ordered = useMemo(
    () =>
      [...trips].sort((a, b) => {
        if (sort === 'title') return a.title.localeCompare(b.title, 'zh-CN')
        const left = sort === 'updated' ? a.updatedAt : a.startDate
        const right = sort === 'updated' ? b.updatedAt : b.startDate
        return right.localeCompare(left) || b.createdAt.localeCompare(a.createdAt)
      }),
    [trips, sort]
  )
  return (
    <section className="travel-collection" aria-label="旅行目录">
      <div className="collection-toolbar">
        <p>
          <strong>{trips.length.toString().padStart(2, '0')}</strong> 段旅行
          <span>按一程一程，慢慢收藏。</span>
        </p>
        <div className="collection-controls">
          <label className="inline-select">
            排序
            <select aria-label="旅行排序" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="date">出发日期</option>
              <option value="updated">最近修改</option>
              <option value="title">旅行名称</option>
            </select>
          </label>
          <div className="segmented-control" role="group" aria-label="旅行布局">
            <button aria-label="卡片布局" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}>
              <Grid size={18} />
            </button>
            <button aria-label="目录布局" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}>
              <List size={18} />
            </button>
          </div>
        </div>
      </div>
      {ordered.length ? (
        <div className={`trip-grid collection-${layout}`}>
          {ordered.map((trip, order) => (
            <TripCard
              trip={trip}
              snapshot={snapshot}
              key={trip.id}
              order={order + 1}
              headingLevel={2}
              onClick={() => onTrip(trip.id)}
            />
          ))}
          <button className="new-trip-card" onClick={onNew}>
            <span>
              <Plus size={24} />
            </span>
            <h2>记下下一段旅行</h2>
            <p>从一个名字开始，慢慢补上沿途。</p>
          </button>
        </div>
      ) : (
        <Empty
          title={hasTrips ? '没有匹配的旅行' : '你的第一段旅行'}
          description={hasTrips ? '试着放宽年份或城市条件。' : '记录一座城市、一次散步，或一段长途旅行。'}
          action={hasTrips ? onClear : onNew}
          label={hasTrips ? '清除筛选' : '新建旅行'}
        />
      )}
    </section>
  )
}
