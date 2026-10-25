import { feature, mesh } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import type { BoundaryFeature, BoundaryIndex } from './domain'

let pending: ReturnType<typeof readAtlas> | undefined
async function readAtlas() {
  const [boundaries, cities, land] = await Promise.all([
    import('../assets/china-cities.topo.json'),
    import('../assets/china-city-index.json'),
    import('../assets/world-land.json')
  ])
  const topology = boundaries.default as unknown as Topology<{
    cities: GeometryCollection<BoundaryFeature['properties']>
    provinces: GeometryCollection
  }>
  return {
    regions: (feature(topology, topology.objects.cities) as unknown as { features: BoundaryFeature[] })
      .features,
    cityBorders: mesh(topology, topology.objects.cities),
    provinces: feature(topology, topology.objects.provinces),
    // Follow the same real city arcs for province divisions. A coarse reference
    // province outline must not cut across a more detailed lit city polygon.
    provinceBorders: mesh(
      topology,
      topology.objects.cities,
      (a, b) =>
        a !== b &&
        (a.properties as BoundaryFeature['properties'])?.province !==
          (b.properties as BoundaryFeature['properties'])?.province
    ),
    index: cities.default as BoundaryIndex,
    land: land.default
  }
}
/** Immutable local chunks shared by every map; no external requests. */
export function loadAtlas() {
  return (pending ??= readAtlas().catch((error) => {
    pending = undefined
    throw error
  }))
}
export type Atlas = Awaited<ReturnType<typeof readAtlas>>
