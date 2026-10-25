import { geoBounds, geoContains } from 'd3-geo'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import type { AppSnapshot, Place, Trip, Visit } from '../../shared/types'

export interface BoundaryProperties {
  id: string
  name: string
  province: string
  kind: 'prefecture' | 'municipality' | 'special'
  center: [number, number]
  aliases: string[]
}
export type BoundaryFeature = Feature<Polygon | MultiPolygon, BoundaryProperties>
export interface BoundaryIndex {
  version: number
  sourceYear: string
  geonames: Record<string, string>
  names: Record<string, string[]>
}
export interface MapFilters {
  tripId?: string
  year?: string
  cityId?: string
}
export interface MapVisit {
  visit: Visit
  place: Place
  trip: Trip
}
export interface CityLight {
  id: string
  visits: MapVisit[]
  tripCount: number
  firstDate: string
  lastDate: string
}

export function validCoordinate(lat: number | null, lon: number | null) {
  return (
    lat !== null &&
    lon !== null &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  )
}
// D3 cuts great-circle routes at the antimeridian instead of crossing the entire map.
export function routeGeometry(points: [number, number][]) {
  return { type: 'LineString' as const, coordinates: points }
}
export function clusterMarkers<T extends { x: number; y: number }>(
  points: T[],
  cellSize = 44
): { x: number; y: number; items: T[] }[] {
  const cells = new Map<string, T[]>()
  for (const point of points) {
    const key = `${Math.floor(point.x / cellSize)},${Math.floor(point.y / cellSize)}`
    const items = cells.get(key) || []
    items.push(point)
    cells.set(key, items)
  }
  return [...cells.values()].map((items) => ({
    x: items.reduce((sum, point) => sum + point.x, 0) / items.length,
    y: items.reduce((sum, point) => sum + point.y, 0) / items.length,
    items
  }))
}

/** Geographic eligibility is independent from whether a stop has a coordinate. */
export function selectEligibleVisits(snapshot: AppSnapshot, filters: MapFilters = {}): MapVisit[] {
  const trips = new Map(snapshot.trips.filter((trip) => !trip.deletedAt).map((trip) => [trip.id, trip]))
  const places = new Map(snapshot.places.map((place) => [place.id, place]))
  return snapshot.visits
    .flatMap((visit) => {
      const trip = trips.get(visit.tripId),
        place = places.get(visit.placeId)
      if (!trip || !place) return []
      if (filters.tripId && filters.tripId !== visit.tripId) return []
      if (
        filters.year &&
        filters.year !== 'all' &&
        !(visit.date || trip.startDate || '').startsWith(filters.year)
      )
        return []
      if (filters.cityId && filters.cityId !== 'all' && filters.cityId !== place.cityId) return []
      return [{ visit, place, trip }]
    })
    .sort(
      (a, b) =>
        a.visit.sortOrder - b.visit.sortOrder || (a.visit.date || '').localeCompare(b.visit.date || '')
    )
}
export function selectMapVisits(snapshot: AppSnapshot, filters: MapFilters = {}): MapVisit[] {
  return selectEligibleVisits(snapshot, filters).filter((item) =>
    validCoordinate(item.place.lat, item.place.lon)
  )
}

export function normalizeCityName(value: string) {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+(?:city|prefecture|municipality)$/i, '')
    .replace(/市$/, '')
    .replace(/[\s·・.'’\-]/g, '')
}
const chinaCountries = new Set([
  'cn',
  'chn',
  'china',
  'prc',
  '中国',
  '中國',
  '中华人民共和国',
  '中華人民共和國'
])
const hongKongCountries = new Set(['hk', 'hkg', '香港', 'hongkong'])
const macaoCountries = new Set(['mo', 'mac', '澳门', '澳門', 'macao', 'macau'])
const countryKey = (country: string) =>
  country.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s/g, '')
function allowsBoundary(feature: BoundaryFeature, country: string) {
  if (!country || chinaCountries.has(country)) return true
  if (feature.properties.kind !== 'special') return false
  const names = [
    feature.properties.name,
    feature.properties.province,
    ...(feature.properties.aliases || [])
  ].map(normalizeCityName)
  if (hongKongCountries.has(country))
    return names.some((name) =>
      /^(香港(?:特别行政区|特別行政區)?|hongkong(?:sar|specialadministrativeregion)?)$/.test(name)
    )
  if (macaoCountries.has(country))
    return names.some((name) =>
      /^(澳门(?:特别行政区)?|澳門(?:特別行政區)?|maca[ou](?:sar|specialadministrativeregion)?)$/.test(name)
    )
  return false
}
interface AtlasLookup {
  byId: Map<string, BoundaryFeature>
  names: Map<string, Set<string>>
  bounds: Map<string, [[number, number], [number, number]]>
}
const atlasCache = new WeakMap<readonly BoundaryFeature[], AtlasLookup>()
function lookupAtlas(atlas: readonly BoundaryFeature[]) {
  let lookup = atlasCache.get(atlas)
  if (lookup) return lookup
  lookup = { byId: new Map(), names: new Map(), bounds: new Map() }
  for (const feature of atlas) {
    const { id, name, aliases } = feature.properties
    lookup.byId.set(id, feature)
    lookup.bounds.set(id, geoBounds(feature))
    for (const alias of [name, ...(aliases || [])]) {
      const key = normalizeCityName(alias)
      if (!key) continue
      const ids = lookup.names.get(key) || new Set<string>()
      ids.add(id)
      lookup.names.set(key, ids)
    }
  }
  atlasCache.set(atlas, lookup)
  return lookup
}
function contains(feature: BoundaryFeature, point: [number, number], lookup: AtlasLookup) {
  const [[west, south], [east, north]] = lookup.bounds.get(feature.properties.id)!
  if (point[1] < south || point[1] > north) return false
  if (west <= east ? point[0] < west || point[0] > east : point[0] < west && point[0] > east) return false
  return geoContains(feature, point)
}
function ownValue(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined
}
function ownString(record: Record<string, unknown>, key: string) {
  const value = ownValue(record, key)
  return typeof value === 'string' ? value : undefined
}

/** Stable IDs win. Ambiguous names never light an arbitrary city. */
export function resolveCityBoundary(
  place: Place,
  atlas: readonly BoundaryFeature[],
  index: BoundaryIndex
): BoundaryFeature | null {
  const lookup = lookupAtlas(atlas)
  const cityId = place.cityId || ''
  const mappedId =
    ownString(index.geonames, cityId) || ownString(index.geonames, cityId.replace(/^geonames:/, ''))
  if (mappedId && lookup.byId.has(mappedId)) return lookup.byId.get(mappedId)!
  const country = countryKey(place.country || '')
  // The current atlas has no Taiwan city polygons. Manual TW/overseas records must
  // not be matched to a mainland namesake or a coordinate outside their coverage.
  if (
    country &&
    !chinaCountries.has(country) &&
    !hongKongCountries.has(country) &&
    !macaoCountries.has(country)
  )
    return null
  const key = normalizeCityName(place.cityName || (place.kind === 'city' ? place.name : ''))
  const candidateIds = new Set<string>()
  // Country-less custom coordinates can be located geometrically, but names alone need a country.
  if (country && key) {
    const value = ownValue(index.names, key)
    const indexedNames = Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string')
      : []
    for (const id of [...indexedNames, ...(lookup.names.get(key) || [])]) {
      const feature = lookup.byId.get(id)
      if (feature && allowsBoundary(feature, country)) candidateIds.add(id)
    }
    if (candidateIds.size === 1) return lookup.byId.get([...candidateIds][0])!
  }
  if (!validCoordinate(place.lat, place.lon)) return null
  const point: [number, number] = [place.lon!, place.lat!]
  const candidates = candidateIds.size ? [...candidateIds].map((id) => lookup.byId.get(id)!) : atlas
  const containing = candidates.filter(
    (feature) => allowsBoundary(feature, country) && contains(feature, point, lookup)
  )
  return containing.length === 1 ? containing[0] : null
}

export function buildCityLights(
  visits: readonly MapVisit[],
  atlas: readonly BoundaryFeature[],
  index: BoundaryIndex
): Map<string, CityLight> {
  const lights = new Map<string, CityLight>()
  const resolved = new Map<Place, BoundaryFeature | null>()
  const tripIds = new Map<string, Set<string>>()
  for (const item of visits) {
    if (!resolved.has(item.place)) resolved.set(item.place, resolveCityBoundary(item.place, atlas, index))
    const boundary = resolved.get(item.place)
    if (!boundary) continue
    const id = boundary.properties.id
    const light = lights.get(id) || { id, visits: [], tripCount: 0, firstDate: '', lastDate: '' }
    const ids = tripIds.get(id) || new Set<string>()
    ids.add(item.trip.id)
    tripIds.set(id, ids)
    light.visits.push(item)
    light.tripCount = ids.size
    const date = item.visit.date || item.trip.startDate || ''
    if (date && (!light.firstDate || date < light.firstDate)) light.firstDate = date
    if (date && (!light.lastDate || date > light.lastDate)) light.lastDate = date
    lights.set(id, light)
  }
  return lights
}
