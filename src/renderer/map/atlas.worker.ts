import { feature, mesh } from 'topojson-client'
import { geoGraticule10, geoPath, type GeoPermissibleObjects } from 'd3-geo'
import type { GeometryCollection, Topology } from 'topojson-specification'
import topologyUrl from '../assets/china-cities.topo.json?url'
import overviewUrl from '../assets/china-overview.topo.json?url'
import regionalUrl from '../assets/china-regional.topo.json?url'
import indexUrl from '../assets/china-city-index.json?url'
import worldUrl from '../assets/world-land.json?url'
import contextUrl from '../assets/world-context.json?url'
import {
  buildCityLights,
  resolveCityBoundary,
  supportsCityBoundaryCountry,
  validCoordinate,
  type BoundaryFeature,
  type BoundaryIndex
} from './domain'
import { mapProjection } from './projection'
import type { AtlasGeometry, AtlasRequest, AtlasResponse, Bounds, MapLod, MapScope } from './atlasTypes'

type ChinaTopology = Topology<{
  cities: GeometryCollection<BoundaryFeature['properties']>
  provinces: GeometryCollection
}>
async function json(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw Error('离线地图资源读取失败')
  return response.json()
}
const china = new Map<MapLod, ReturnType<typeof readChina>>()
let indexData: Promise<BoundaryIndex> | undefined
async function readChina(lod: MapLod) {
  const indexPromise = (indexData ??= (json(indexUrl) as Promise<BoundaryIndex>).catch((error) => {
    indexData = undefined
    throw error
  }))
  const [topology, index] = await Promise.all([
    json([overviewUrl, regionalUrl, topologyUrl][lod]) as Promise<ChinaTopology>,
    indexPromise
  ])
  const regions = (feature(topology, topology.objects.cities) as unknown as { features: BoundaryFeature[] })
    .features
  return { topology, index, regions }
}
function getChina(lod: MapLod) {
  let pending = china.get(lod)
  if (!pending) {
    pending = readChina(lod).catch((error) => {
      china.delete(lod)
      throw error
    })
    china.set(lod, pending)
  }
  return pending
}
const geometry = new Map<string, Promise<AtlasGeometry>>()
async function draw(scope: MapScope, lod: MapLod): Promise<AtlasGeometry> {
  const world = scope === 'world',
    projection = mapProjection(world),
    path = geoPath(projection).digits(2)
  const [land, atlas] = await Promise.all([
    json(world ? worldUrl : contextUrl),
    world ? undefined : getChina(lod)
  ])
  const result: AtlasGeometry = {
    scope,
    lod,
    grid: path(geoGraticule10()) || '',
    land: path(land) || '',
    provinceFill: '',
    provinceBorders: '',
    cityBorders: '',
    regions: [],
    cities: []
  }
  if (world) return result
  const topology = atlas!.topology,
    regions = atlas!.regions
  result.regions = atlas!.regions.map(({ properties }) => ({ properties }))
  result.provinceFill = path(feature(topology, topology.objects.provinces) as GeoPermissibleObjects) || ''
  result.cityBorders = path(mesh(topology, topology.objects.cities)) || ''
  result.provinceBorders =
    path(
      mesh(
        topology,
        topology.objects.cities,
        (a, b) =>
          a !== b &&
          (a.properties as BoundaryFeature['properties'])?.province !==
            (b.properties as BoundaryFeature['properties'])?.province
      )
    ) || ''
  result.cities = regions.map((region) => ({
    region: { properties: region.properties },
    d: path(region) || '',
    bounds: path.bounds(region) as Bounds
  }))
  return result
}
self.onmessage = async (event: MessageEvent<AtlasRequest>) => {
  const request = event.data
  const response: AtlasResponse = { requestId: request.requestId }
  try {
    if (request.action === 'geometry') {
      const key = `${request.scope}:${request.lod}`
      let pending = geometry.get(key)
      if (!pending) {
        pending = draw(request.scope, request.lod)
        geometry.set(key, pending)
      }
      try {
        response.result = await pending
      } catch (error) {
        geometry.delete(key)
        throw error
      }
    } else {
      let atlas = await getChina(0)
      // IDs and unambiguous names do not depend on simplification. Coordinate fallback always uses full boundaries.
      const needsFull = request.visits.some(
        ({ place }) =>
          supportsCityBoundaryCountry(place.country) &&
          validCoordinate(place.lat, place.lon) &&
          !resolveCityBoundary({ ...place, lat: null, lon: null }, atlas.regions, atlas.index)
      )
      if (needsFull) atlas = await getChina(2)
      response.result = [...buildCityLights(request.visits, atlas.regions, atlas.index)].map(
        ([id, light]) => ({
          id,
          tripCount: light.tripCount,
          firstDate: light.firstDate,
          lastDate: light.lastDate,
          visitIds: light.visits.map((item) => item.visit.id)
        })
      )
    }
  } catch (error) {
    response.error = error instanceof Error ? error.message : String(error)
  }
  self.postMessage(response)
}
