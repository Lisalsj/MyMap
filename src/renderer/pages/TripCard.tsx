import { ArrowRight, MapPin } from '../ui/icons'
import type { AppSnapshot, Trip } from '../../shared/types'
import { Cover } from '../components/Common'
import { tripDates } from '../model'
import { getSnapshotIndex } from '../snapshotIndex'
import '../styles/trips.css'

export function TripCard({
  trip,
  snapshot,
  onClick
}: {
  trip: Trip
  snapshot: AppSnapshot
  onClick: () => void
}) {
  const index = getSnapshotIndex(snapshot)
  const visits = index.orderedVisitsByTrip.get(trip.id) || []
  const cities = new Set(visits.map((visit) => index.placeById.get(visit.placeId)?.cityId).filter(Boolean))
  return (
    <button className="trip-card" onClick={onClick}>
      <Cover trip={trip} snapshot={snapshot} />
      <div className="trip-card-body">
        <span className="trip-date">{tripDates(trip)}</span>
        <h3>
          {trip.title}
          <ArrowRight size={20} aria-hidden="true" />
        </h3>
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
