import { describe, expect, it } from 'vitest'
import type { AppSnapshot, Entry, Trip } from '../src/shared/types'
import { matchingTrips, quickMatches } from '../src/renderer/search'

const trip = (id: string): Trip => ({
  id,
  title: id,
  description: '',
  tags: [],
  startDate: '2026-01-01',
  endDate: '',
  coverPhotoId: null,
  createdAt: '',
  updatedAt: '',
  deletedAt: null
})
const entry = (id: string, tripId = 'trip'): Entry => ({
  id,
  tripId,
  visitId: null,
  title: '海边',
  markdown: 'Blue Sky',
  createdAt: '',
  updatedAt: '',
  deletedAt: null
})
const snapshot = (): AppSnapshot => ({
  library: { path: 'test', isDemo: false, version: 1 },
  trips: [trip('trip')],
  entries: [entry('entry')],
  places: [],
  visits: [],
  photos: [],
  attachments: []
})
const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id)

describe('shared travel search', () => {
  it('preserves independent trip fields and joined quick-entry fields, including case and whitespace', () => {
    const s = snapshot()
    expect(ids(matchingTrips(s, ' BLUE SKY '))).toEqual(['trip'])
    expect(matchingTrips(s, '海边 Blue')).toEqual([])
    expect(ids(quickMatches(s, '海边 blue').entries)).toEqual(['entry'])
    expect(quickMatches(s, '   ')).toEqual({ trips: [], entries: [], visits: [] })
  })

  it('invalidates cached hits and misses after edits, deletion, recovery, append and library replacement', () => {
    const s = snapshot()
    expect(matchingTrips(s, 'new')).toHaveLength(0)
    s.entries = [{ ...s.entries[0], markdown: 'New text' }]
    expect(matchingTrips(s, 'new')).toHaveLength(1)
    expect(quickMatches(s, 'new').entries).toHaveLength(1)
    s.entries = [{ ...s.entries[0], deletedAt: '2026-02-01' }]
    expect(matchingTrips(s, 'new')).toHaveLength(0)
    s.entries = [{ ...s.entries[0], deletedAt: null }]
    expect(matchingTrips(s, 'new')).toHaveLength(1)
    s.trips = [{ ...s.trips[0], title: 'Changed', tags: ['tag'] }]
    expect(matchingTrips(s, 'tag')).toHaveLength(1)
    s.trips = [{ ...s.trips[0], deletedAt: '2026-02-01' }]
    expect(matchingTrips(s, 'new')).toHaveLength(0)
    s.trips.push(trip('New trip'))
    expect(ids(matchingTrips(s, 'new'))).toEqual(['New trip'])
    expect(matchingTrips(snapshot(), 'new')).toHaveLength(0)
  })

  it('preserves repeated visit order and quick-result limits without surfacing deleted or orphan entries', () => {
    const s = snapshot()
    s.trips = Array.from({ length: 8 }, (_, i) => trip('trip' + i))
    s.entries = [
      entry('deleted', 'missing'),
      ...Array.from({ length: 8 }, (_, i) => entry('e' + i, 'trip' + i)),
      { ...entry('hidden', 'trip0'), deletedAt: '2026-01-01' }
    ]
    s.places = [
      {
        id: 'place',
        kind: 'scenic',
        name: 'Blue',
        cityId: 'city',
        cityName: 'Sky',
        country: 'CN',
        lat: null,
        lon: null
      }
    ]
    s.visits = Array.from({ length: 8 }, (_, i) => ({
      id: 'v' + i,
      tripId: 'trip0',
      placeId: 'place',
      date: '',
      sortOrder: 8 - i,
      note: ''
    }))
    expect(ids(quickMatches(s, 'blue').trips)).toEqual(['trip0', 'trip1', 'trip2', 'trip3', 'trip4'])
    expect(ids(quickMatches(s, 'blue').entries)).toEqual(['e0', 'e1', 'e2', 'e3'])
    expect(ids(quickMatches(s, 'blue sky').visits)).toEqual(['v0', 'v1', 'v2', 'v3'])
    expect(ids(matchingTrips(s, 'blue', '2026', 'city'))).toEqual(['trip0'])
    s.places = [{ ...s.places[0], name: 'Mountain' }]
    expect(quickMatches(s, 'blue sky').visits).toEqual([])
    expect(ids(matchingTrips(s, 'Mountain'))).toEqual(['trip0'])
  })
})
