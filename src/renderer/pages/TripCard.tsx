import { ArrowRight, MapPin } from '../ui/icons'
import type { AppSnapshot, Trip } from '../../shared/types'
import { Cover } from '../components/Common'
import { tripDates } from '../model'
import { getSnapshotIndex } from '../snapshotIndex'
import '../styles/trips.css'

export function TripCard({
  trip,
  snapshot,
  order,
  headingLevel = 3,
  onClick
}: {
  trip: Trip
  snapshot: AppSnapshot
  order?: number
  headingLevel?: 2 | 3
  onClick: () => void
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  const index = getSnapshotIndex(snapshot)
  const visits = index.orderedVisitsByTrip.get(trip.id) || []
  const cities = new Set(visits.map((visit) => index.placeById.get(visit.placeId)?.cityId).filter(Boolean))
  const cityNames = [
    ...new Set(visits.map((visit) => index.placeById.get(visit.placeId)?.cityName).filter(Boolean))
  ]
  return (
    <button className="trip-card" onClick={onClick}>
      <Cover trip={trip} snapshot={snapshot} />
      <div className="trip-card-body">
        <span className="trip-date">
          {tripDates(trip)}
          {order && <small>旅程 {String(order).padStart(2, '0')}</small>}
        </span>
        <Heading className="trip-card-title">
          {trip.title}
          <ArrowRight size={20} aria-hidden="true" />
        </Heading>
        {cityNames.length > 0 && (
          <span className="trip-route">
            {cityNames.slice(0, 4).join('  /  ')}
            {cityNames.length > 4 ? ' …' : ''}
          </span>
        )}
        <p>{trip.description || '在这里收下沿途的地点、照片和故事。'}</p>
        <div className="trip-card-footer">
          <span>
            <MapPin size={16} aria-hidden="true" />
            {cities.size} 座城市<span className="bullet">·</span>
            {visits.length} 处足迹
          </span>
          {trip.tags[0] && <small>{trip.tags[0]}</small>}
        </div>
      </div>
    </button>
  )
}
