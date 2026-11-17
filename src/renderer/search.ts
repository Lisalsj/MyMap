import type { AppSnapshot, Entry, Place, Trip, Visit } from '../shared/types'
import { getSnapshotIndex, type SnapshotIndex } from './snapshotIndex'

type Text = { fields: readonly string[]; joined?: string }
type SearchCache = {
  text: WeakMap<object, Text>
  query?: string
  trips?: Trip[]
}
// Joins and text share the snapshot's lifetime. Only the latest query is retained;
// replacing entity arrays invalidates the index and releases the previous search cache.
const caches = new WeakMap<SnapshotIndex, SearchCache>()
function cacheFor(index: SnapshotIndex) {
  let cache = caches.get(index)
  if (!cache) {
    cache = { text: new WeakMap() }
    caches.set(index, cache)
  }
  return cache
}
const normalize = (query: string) => query.trim().toLowerCase()
function textFor(cache: SearchCache, row: Trip | Entry | Place): Text {
  let text = cache.text.get(row)
  if (!text) {
    const fields =
      'markdown' in row
        ? [row.title, row.markdown]
        : 'tags' in row
          ? [row.title, row.description, ...row.tags]
          : [row.name, row.cityName]
    text = { fields: fields.map((field) => field.toLocaleLowerCase()) }
    cache.text.set(row, text)
  }
  return text
}
function baseTrips(index: SnapshotIndex, cache: SearchCache, query: string): Trip[] {
  if (cache.query === query && cache.trips) return cache.trips
  const trips = index.activeTrips.filter((trip) => {
    if (!query || textFor(cache, trip).fields.some((field) => field.includes(query))) return true
    for (const visit of index.visitsByTrip.get(trip.id) || []) {
      // Trip search includes the place name; city names belong to quick visit results.
      if (textFor(cache, index.placeById.get(visit.placeId)!).fields[0].includes(query)) return true
    }
    for (const entry of index.entriesByTrip.get(trip.id) || []) {
      if (textFor(cache, entry).fields.some((field) => field.includes(query))) return true
    }
    return false
  })
  cache.query = query
  cache.trips = trips
  return trips
}

export function matchingTrips(snapshot: AppSnapshot, query: string, year = '', cityId = ''): Trip[] {
  const index = getSnapshotIndex(snapshot)
  return baseTrips(index, cacheFor(index), normalize(query)).filter((trip) => {
    const visits = index.visitsByTrip.get(trip.id) || []
    return (
      (!year ||
        (visits.length
          ? visits.some((visit) => (visit.date || trip.startDate).startsWith(year))
          : trip.startDate.startsWith(year))) &&
      (!cityId || visits.some((visit) => index.placeById.get(visit.placeId)!.cityId === cityId))
    )
  })
}

function firstMatches<T>(rows: readonly T[], limit: number, predicate: (row: T) => boolean): T[] {
  const result: T[] = []
  for (const row of rows) {
    if (predicate(row)) result.push(row)
    if (result.length === limit) break
  }
  return result
}
export function quickMatches(
  snapshot: AppSnapshot,
  query: string
): { trips: Trip[]; entries: Entry[]; visits: Visit[] } {
  const index = getSnapshotIndex(snapshot),
    cache = cacheFor(index),
    normalized = normalize(query)
  if (!normalized) return { trips: [], entries: [], visits: [] }
  const joinedMatch = (row: Entry | Place) => {
    const text = textFor(cache, row)
    text.joined ??= text.fields.join(' ')
    return text.joined.includes(normalized)
  }
  return {
    trips: baseTrips(index, cache, normalized).slice(0, 5),
    entries: firstMatches(index.activeEntries, 4, joinedMatch),
    visits: firstMatches(index.activeVisits, 4, (visit) => joinedMatch(index.placeById.get(visit.placeId)!))
  }
}
