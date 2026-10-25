import { describe, expect, it } from 'vitest'
import { geoMercator, geoPath } from 'd3-geo'
import {
  clusterMarkers,
  selectMapVisits,
  routeGeometry,
  validCoordinate
} from '../src/renderer/components/FootprintMap'
import type { AppSnapshot } from '../src/shared/types'

describe('offline map geometry', () => {
  it('rejects missing and out-of-range WGS84 coordinates but keeps zero', () => {
    expect(validCoordinate(null, 0)).toBe(false)
    expect(validCoordinate(91, 120)).toBe(false)
    expect(validCoordinate(0, 181)).toBe(false)
    expect(validCoordinate(0, 0)).toBe(true)
  })
  it('clips a route crossing the date line into separate SVG subpaths', () => {
    const path = geoPath(geoMercator().scale(100).translate([400, 200]))(
      routeGeometry([
        [179, 30],
        [-179, 31]
      ])
    )!
    expect((path.match(/M/g) || []).length).toBe(2)
    expect(path).not.toContain('NaN')
  })
  it('clusters in screen pixels and preserves members for later selection', () => {
    const groups = clusterMarkers(
      [
        { id: 'a', x: 10, y: 10 },
        { id: 'b', x: 12, y: 13 },
        { id: 'c', x: 200, y: 10 }
      ],
      40
    )
    expect(groups).toHaveLength(2)
    expect(groups[0].items.map((item) => item.id)).toEqual(['a', 'b'])
    expect(groups[0].x).toBe(11)
  })
  it('filters deleted trips, invalid coordinates, city and year while ordering visits', () => {
    const snapshot = {
      trips: [
        { id: 't', deletedAt: null },
        { id: 'trash', deletedAt: '2026-01-01' }
      ],
      places: [
        { id: 'p', cityId: 'hz', lat: 30.2, lon: 120.1 },
        { id: 'none', cityId: 'hz', lat: null, lon: null }
      ],
      visits: [
        { id: 'second', tripId: 't', placeId: 'p', date: '2026-04-02', sortOrder: 2 },
        { id: 'first', tripId: 't', placeId: 'p', date: '2026-04-01', sortOrder: 1 },
        { id: 'old', tripId: 't', placeId: 'p', date: '2025-04-01', sortOrder: 0 },
        { id: 'deleted', tripId: 'trash', placeId: 'p', date: '2026-04-01', sortOrder: 0 },
        { id: 'unknown', tripId: 't', placeId: 'none', date: '2026-04-01', sortOrder: 0 }
      ]
    } as AppSnapshot
    expect(selectMapVisits(snapshot, { year: '2026', cityId: 'hz' }).map((item) => item.visit.id)).toEqual([
      'first',
      'second'
    ])
    expect(selectMapVisits(snapshot, { cityId: 'other' })).toEqual([])
  })
  it('uses the trip year for undated visits, and gives an explicit visit date priority', () => {
    const snapshot = {
      trips: [{ id: 't', startDate: '2025-04-01', deletedAt: null }],
      places: [{ id: 'p', cityId: 'hz', lat: 30, lon: 120 }],
      visits: [
        { id: 'undated', tripId: 't', placeId: 'p', date: '', sortOrder: 0 },
        { id: 'dated', tripId: 't', placeId: 'p', date: '2026-01-01', sortOrder: 1 }
      ]
    } as AppSnapshot
    expect(selectMapVisits(snapshot, { year: '2025' }).map((item) => item.visit.id)).toEqual(['undated'])
    expect(selectMapVisits(snapshot, { year: '2026' }).map((item) => item.visit.id)).toEqual(['dated'])
  })
})
