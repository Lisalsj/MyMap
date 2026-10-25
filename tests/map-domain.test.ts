import { describe, expect, it } from 'vitest'
import type { AppSnapshot, Place } from '../src/shared/types'
import {
  buildCityLights,
  normalizeCityName,
  resolveCityBoundary,
  selectEligibleVisits,
  type BoundaryFeature,
  type BoundaryIndex
} from '../src/renderer/map/domain'
import { fitBounds, fromScreen, selectLabels, toScreen, zoomViewport } from '../src/renderer/map/geometry'

// Clockwise rings follow d3's small-polygon convention; the hole is counterclockwise.
const region = (id: string, name: string, x: number, aliases: string[] = []): BoundaryFeature => ({
  type: 'Feature',
  properties: { id, name, province: '测试省', kind: 'prefecture', center: [x + 1, 31], aliases },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [x, 30],
        [x, 32],
        [x + 2, 32],
        [x + 2, 30],
        [x, 30]
      ]
    ]
  }
})
const atlas = [
  region('hangzhou', '杭州市', 119, ['Hangzhou City']),
  region('tz-zj', '台州市', 121),
  region('tz-js', '泰州市', 117)
]
const index: BoundaryIndex = {
  version: 1,
  sourceYear: '2017',
  geonames: { '1808926': 'hangzhou' },
  names: { hangzhou: ['hangzhou'], 杭州: ['hangzhou'], taizhou: ['tz-zj', 'tz-js'] }
}
const place = (patch: Partial<Place> = {}): Place => ({
  id: 'p',
  name: '西湖',
  kind: 'scenic',
  cityId: '',
  cityName: '',
  country: 'CN',
  lat: null,
  lon: null,
  ...patch
})
const snapshot = (): AppSnapshot => ({
  library: { path: '', isDemo: false, version: 1 },
  trips: [
    {
      id: 't',
      title: '春游',
      startDate: '2025-03-01',
      endDate: '',
      description: '',
      tags: [],
      coverPhotoId: null,
      createdAt: '',
      updatedAt: '',
      deletedAt: null
    },
    {
      id: 'deleted',
      title: '',
      startDate: '',
      endDate: '',
      description: '',
      tags: [],
      coverPhotoId: null,
      createdAt: '',
      updatedAt: '',
      deletedAt: '2026-01-01'
    }
  ],
  places: [place({ cityId: 'geonames:1808926', cityName: '杭州' })],
  visits: [
    { id: 'v1', tripId: 't', placeId: 'p', date: '', note: '', sortOrder: 0 },
    { id: 'v2', tripId: 't', placeId: 'p', date: '2026-04-01', note: '', sortOrder: 1 },
    { id: 'trash', tripId: 'deleted', placeId: 'p', date: '', note: '', sortOrder: 0 }
  ],
  entries: [],
  photos: [],
  attachments: []
})

describe('city lighting domain', () => {
  it('keeps unlocated visits eligible and applies the trip date fallback', () => {
    const s = snapshot()
    expect(selectEligibleVisits(s).map((item) => item.visit.id)).toEqual(['v1', 'v2'])
    expect(selectEligibleVisits(s, { year: '2025' }).map((item) => item.visit.id)).toEqual(['v1'])
    expect(selectEligibleVisits(s, { year: '2026' }).map((item) => item.visit.id)).toEqual(['v2'])
    expect(selectEligibleVisits(s, { cityId: 'other' })).toEqual([])
  })
  it('lights an unlocated city from a stable GeoNames ID rather than its editable name', () => {
    expect(
      resolveCityBoundary(place({ cityId: 'geonames:1808926', cityName: 'another name' }), atlas, index)
        ?.properties.id
    ).toBe('hangzhou')
    expect(resolveCityBoundary(place({ cityId: '1808926' }), atlas, index)?.properties.id).toBe('hangzhou')
  })
  it('normalizes Chinese and English suffixes for manually entered cities', () => {
    expect(normalizeCityName(' Ｈａｎｇｚｈｏｕ City ')).toBe('hangzhou')
    expect(normalizeCityName('杭州市')).toBe('杭州')
    expect(
      resolveCityBoundary(
        place({ cityId: 'manual:中国:杭州市', cityName: '杭州市', country: '中国' }),
        atlas,
        index
      )?.properties.id
    ).toBe('hangzhou')
    expect(resolveCityBoundary(place({ cityName: 'Hangzhou', country: 'US' }), atlas, index)).toBeNull()
  })
  it('does not choose an arbitrary same-name city; a coordinate can disambiguate', () => {
    expect(resolveCityBoundary(place({ cityName: 'Taizhou' }), atlas, index)).toBeNull()
    expect(
      resolveCityBoundary(place({ cityName: 'Taizhou', lon: 122, lat: 31 }), atlas, index)?.properties.id
    ).toBe('tz-zj')
    expect(resolveCityBoundary(place({ cityName: 'Taizhou', lon: 120, lat: 31 }), atlas, index)).toBeNull()
  })
  it('does not match a Hong Kong, Macao, or Taiwan manual record to a mainland namesake', () => {
    for (const country of ['HK', '香港', 'HKG', 'MO', '澳门', 'Macao', 'TW', 'Taiwan', '臺灣']) {
      expect(resolveCityBoundary(place({ country, cityName: '杭州' }), atlas, index)).toBeNull()
      expect(resolveCityBoundary(place({ country, lat: 31, lon: 120 }), atlas, index)).toBeNull()
    }
  })
  it('limits Hong Kong and Macao manual matches to their own special region', () => {
    const hongKong = region('hk', '香港', 113, ['Hong Kong SAR'])
    hongKong.properties.kind = 'special'
    const macao = region('mo', '澳门', 110, ['Macao'])
    macao.properties.kind = 'special'
    const specialAtlas = [...atlas, hongKong, macao]
    expect(
      resolveCityBoundary(place({ country: 'Hong Kong', cityName: '香港' }), specialAtlas, index)?.properties
        .id
    ).toBe('hk')
    expect(
      resolveCityBoundary(place({ country: 'MO', cityName: 'Macao' }), specialAtlas, index)?.properties.id
    ).toBe('mo')
    expect(resolveCityBoundary(place({ country: 'HK', cityName: '澳门' }), specialAtlas, index)).toBeNull()
    expect(resolveCityBoundary(place({ country: 'MO', cityName: '香港' }), specialAtlas, index)).toBeNull()
    expect(
      resolveCityBoundary(place({ country: '中国', cityName: '香港' }), specialAtlas, index)?.properties.id
    ).toBe('hk')
  })
  it('continues to trust the authoritative GeoNames mapping even without a coordinate', () => {
    expect(
      resolveCityBoundary(place({ country: 'TW', cityId: 'geonames:1808926' }), atlas, index)?.properties.id
    ).toBe('hangzhou')
  })
  it('treats constructor and __proto__ as unmatched user names rather than inherited index keys', () => {
    for (const name of ['constructor', '__proto__']) {
      const record = place({ cityName: name, cityId: `manual:cn:${name}` })
      expect(() => resolveCityBoundary(record, atlas, index)).not.toThrow()
      expect(resolveCityBoundary(record, atlas, index)).toBeNull()
    }
  })
  it('ignores malformed index values and does not resolve inherited GeoNames keys', () => {
    const malformed: BoundaryIndex = {
      ...index,
      geonames: Object.create({ '1808926': 'hangzhou' }) as Record<string, string>,
      names: { invalid: {} as string[], mixed: [123 as unknown as string] }
    }
    expect(resolveCityBoundary(place({ cityId: 'geonames:1808926' }), atlas, malformed)).toBeNull()
    expect(() => resolveCityBoundary(place({ cityName: 'invalid' }), atlas, malformed)).not.toThrow()
    expect(resolveCityBoundary(place({ cityName: 'mixed' }), atlas, malformed)).toBeNull()
  })
  it('resolves a coordinate-only custom stop while respecting holes and multiple polygons', () => {
    const withHole: BoundaryFeature = {
      ...region('multi', '测试市', 100),
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [100, 30],
              [100, 34],
              [104, 34],
              [104, 30],
              [100, 30]
            ],
            [
              [101, 31],
              [103, 31],
              [103, 33],
              [101, 33],
              [101, 31]
            ]
          ],
          [
            [
              [110, 30],
              [110, 31],
              [111, 31],
              [111, 30],
              [110, 30]
            ]
          ]
        ]
      }
    }
    expect(
      resolveCityBoundary(place({ country: '', lat: 30.5, lon: 110.5 }), [withHole], index)?.properties.id
    ).toBe('multi')
    expect(resolveCityBoundary(place({ lat: 32, lon: 102 }), [withHole], index)).toBeNull()
  })
  it('deduplicates a lit region, retains every visit, and counts separate trips', () => {
    const s = snapshot()
    const lights = buildCityLights(selectEligibleVisits(s), atlas, index)
    expect(lights.size).toBe(1)
    expect(lights.get('hangzhou')).toMatchObject({
      id: 'hangzhou',
      tripCount: 1,
      firstDate: '2025-03-01',
      lastDate: '2026-04-01'
    })
    expect(lights.get('hangzhou')?.visits.map((item) => item.visit.id)).toEqual(['v1', 'v2'])
    s.trips[1].deletedAt = null
    expect(buildCityLights(selectEligibleVisits(s), atlas, index).get('hangzhou')?.tripCount).toBe(2)
    s.trips[0].deletedAt = '2026-01-01'
    expect(buildCityLights(selectEligibleVisits(s, { tripId: 't' }), atlas, index).size).toBe(0)
  })
})

describe('map viewport and labels', () => {
  it('inverts a transformed point for picking at every zoom', () => {
    const view = { zoom: 3.25, x: -710, y: 145 }
    const point: [number, number] = [124, 345]
    expect(fromScreen(toScreen(point, view), view)).toEqual(point)
  })
  it('keeps the cursor anchor stationary during zoom, including limits', () => {
    const view = { zoom: 2, x: 30, y: -40 }
    const anchor: [number, number] = [450, 280]
    const mapPoint = fromScreen(anchor, view)
    expect(toScreen(mapPoint, zoomViewport(view, 2, anchor))).toEqual(anchor)
    expect(zoomViewport(view, 100, anchor).zoom).toBe(24)
    expect(zoomViewport(view, 0.001, anchor).zoom).toBe(0.55)
  })
  it('fits a selected city with padding and a bounded zoom', () => {
    const view = fitBounds(
      [
        [100, 200],
        [300, 300]
      ],
      900,
      600,
      50
    )
    expect(view.zoom).toBe(4)
    expect(toScreen([200, 250], view)).toEqual([450, 300])
    expect(
      fitBounds(
        [
          [100, 200],
          [100, 200]
        ],
        900,
        600
      ).zoom
    ).toBeLessThanOrEqual(18)
  })
  it('prioritizes lit/selected cities and avoids overlapping labels and viewport edges', () => {
    const labels = [
      { id: 'normal', x: 100, y: 100, text: '邻近城市', priority: 0 },
      { id: 'lit', x: 102, y: 100, text: '点亮城市', priority: 10 },
      { id: 'distant', x: 400, y: 200, text: '另一座城', priority: 0 },
      { id: 'edge', x: 2, y: 2, text: '边缘', priority: 99 }
    ]
    expect(selectLabels(labels, 600, 400).map((item) => item.id)).toEqual(['lit', 'distant'])
  })
})
