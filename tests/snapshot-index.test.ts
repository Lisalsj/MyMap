import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import type { AppSnapshot } from '../src/shared/types'
import { matchingTrips } from '../src/renderer/model'
import { createSnapshotIndex, getSnapshotIndex } from '../src/renderer/snapshotIndex'

function largeSnapshot(): AppSnapshot {
  return {
    library: { path: 'synthetic', isDemo: false, version: 1 },
    trips: Array.from({ length: 100 }, (_, id) => ({
      id: `t${id}`,
      title: `Travel ${id}`,
      description: '',
      tags: ['Journeys'],
      startDate: '2026-01-01',
      endDate: '',
      coverPhotoId: null,
      createdAt: '',
      updatedAt: '',
      deletedAt: null
    })),
    places: Array.from({ length: 5000 }, (_, id) => ({
      id: `p${id}`,
      name: `Stop ${id}`,
      kind: 'city',
      cityId: `city${id % 100}`,
      cityName: `City ${id % 100}`,
      country: 'CN',
      lat: null,
      lon: null
    })),
    visits: Array.from({ length: 5000 }, (_, id) => ({
      id: `v${id}`,
      tripId: `t${id % 100}`,
      placeId: `p${id}`,
      date: '',
      sortOrder: id,
      note: ''
    })),
    entries: [],
    photos: [],
    attachments: []
  }
}

describe('snapshot index scale', () => {
  it('reuses joins for the same snapshot while library metadata changes', () => {
    const snapshot = largeSnapshot()
    const index = getSnapshotIndex(snapshot)
    snapshot.library = { ...snapshot.library, path: 'renamed' }
    expect(getSnapshotIndex(snapshot)).toBe(index)
    expect(index.placeById.get('p4999')?.name).toBe('Stop 4999')
    expect(index.visitsByTrip.get('t99')).toHaveLength(50)
    expect(createSnapshotIndex(snapshot).orderedVisitsByTrip.get('t99')?.[0].id).toBe('v99')
  })

  it('rebuilds joins when an entity array is replaced so deleted trips disappear immediately', () => {
    const snapshot = largeSnapshot()
    const previous = getSnapshotIndex(snapshot)
    snapshot.trips = snapshot.trips.map((trip) =>
      trip.id === 't99' ? { ...trip, deletedAt: '2026-01-01' } : trip
    )
    const next = getSnapshotIndex(snapshot)
    expect(next).not.toBe(previous)
    expect(next.tripById.get('t99')?.deletedAt).toBe('2026-01-01')
    expect(next.activeTripIds.has('t99')).toBe(false)
    expect(next.activeVisits).toHaveLength(4950)
    expect(next.visitsByTrip.has('t99')).toBe(false)
    expect(matchingTrips(snapshot, 'Stop 4999')).toEqual([])
  })

  it('observes appended records when an existing array grows', () => {
    const snapshot = largeSnapshot()
    const previous = getSnapshotIndex(snapshot)
    snapshot.entries.push({
      id: 'new',
      tripId: 't0',
      visitId: null,
      title: '',
      markdown: 'Hidden Waterfall',
      createdAt: '',
      updatedAt: '',
      deletedAt: null
    })
    expect(getSnapshotIndex(snapshot)).not.toBe(previous)
    expect(matchingTrips(snapshot, 'hidden waterfall').map((trip) => trip.id)).toEqual(['t0'])
  })

  it('keeps a warm 5000-stop query interactive across 100 trips', () => {
    const snapshot = largeSnapshot()
    matchingTrips(snapshot, 'Stop 4999', '2026')
    const started = performance.now()
    const matches = matchingTrips(snapshot, 'Stop 4999', '2026')
    const elapsed = performance.now() - started
    expect(matches.map((trip) => trip.id)).toEqual(['t99'])
    expect(elapsed).toBeLessThan(50)
  })
})
