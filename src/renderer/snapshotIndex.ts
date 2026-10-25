import type { AppSnapshot, Entry, Photo, PhotoAttachment, Place, Trip, Visit } from '../shared/types'

export interface SnapshotIndex {
  readonly tripById: ReadonlyMap<string, Trip>
  readonly placeById: ReadonlyMap<string, Place>
  readonly visitById: ReadonlyMap<string, Visit>
  readonly entryById: ReadonlyMap<string, Entry>
  readonly photoById: ReadonlyMap<string, Photo>
  readonly attachmentById: ReadonlyMap<string, PhotoAttachment>
  readonly activeTripIds: ReadonlySet<string>
  readonly activeTrips: readonly Trip[]
  readonly activeVisits: readonly Visit[]
  readonly activeEntries: readonly Entry[]
  readonly activeAttachments: readonly PhotoAttachment[]
  readonly visitsByTrip: ReadonlyMap<string, readonly Visit[]>
  readonly orderedVisitsByTrip: ReadonlyMap<string, readonly Visit[]>
  readonly entriesByTrip: ReadonlyMap<string, readonly Entry[]>
  readonly attachmentsByTrip: ReadonlyMap<string, readonly PhotoAttachment[]>
}

function byId<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  const result = new Map<string, T>()
  for (const row of rows) {
    if (!result.has(row.id)) result.set(row.id, row)
  }
  return result
}

function byTrip<T extends { tripId: string }>(rows: readonly T[]): Map<string, T[]> {
  const result = new Map<string, T[]>()
  for (const row of rows) {
    const group = result.get(row.tripId)
    if (group) group.push(row)
    else result.set(row.tripId, [row])
  }
  return result
}

/** Build joins once; groups retain input order and reference the snapshot's entity rows. */
export function createSnapshotIndex(snapshot: AppSnapshot): SnapshotIndex {
  const tripById = byId(snapshot.trips)
  const placeById = byId(snapshot.places)
  const photoById = byId(snapshot.photos)
  const activeTrips = snapshot.trips
    .filter((trip) => !trip.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt))
  const activeTripIds = new Set(activeTrips.map((trip) => trip.id))
  const activeVisits = snapshot.visits.filter(
    (visit) => activeTripIds.has(visit.tripId) && placeById.has(visit.placeId)
  )
  const activeEntries = snapshot.entries.filter(
    (entry) => !entry.deletedAt && activeTripIds.has(entry.tripId)
  )
  const activePhotoIds = new Set(snapshot.photos.filter((photo) => !photo.deletedAt).map((photo) => photo.id))
  const activeAttachments = snapshot.attachments.filter(
    (attachment) =>
      !attachment.deletedAt && activeTripIds.has(attachment.tripId) && activePhotoIds.has(attachment.photoId)
  )
  const visitsByTrip = byTrip(activeVisits)
  const orderedVisitsByTrip = new Map(
    [...visitsByTrip].map(([tripId, visits]) => [
      tripId,
      [...visits].sort((a, b) => a.sortOrder - b.sortOrder)
    ])
  )
  return {
    tripById,
    placeById,
    visitById: byId(snapshot.visits),
    entryById: byId(snapshot.entries),
    photoById,
    attachmentById: byId(snapshot.attachments),
    activeTripIds,
    activeTrips,
    activeVisits,
    activeEntries,
    activeAttachments,
    visitsByTrip,
    orderedVisitsByTrip,
    entriesByTrip: byTrip(activeEntries),
    attachmentsByTrip: byTrip(activeAttachments)
  }
}

type IndexCache = {
  sources: readonly (readonly unknown[])[]
  lengths: readonly number[]
  index: SnapshotIndex
}
const cache = new WeakMap<AppSnapshot, IndexCache>()

/** Snapshot entity updates replace their arrays; library metadata does not invalidate joins. */
export function getSnapshotIndex(snapshot: AppSnapshot): SnapshotIndex {
  const sources = [
    snapshot.trips,
    snapshot.places,
    snapshot.visits,
    snapshot.entries,
    snapshot.photos,
    snapshot.attachments
  ]
  const previous = cache.get(snapshot)
  if (
    previous &&
    sources.every(
      (source, index) => source === previous.sources[index] && source.length === previous.lengths[index]
    )
  )
    return previous.index
  const index = createSnapshotIndex(snapshot)
  cache.set(snapshot, { sources, lengths: sources.map((source) => source.length), index })
  return index
}
