import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { feature } from 'topojson-client'
import { geoArea, geoContains } from 'd3-geo'
import type { GeoPermissibleObjects } from 'd3-geo'
import type { Topology, GeometryCollection } from 'topojson-specification'
import { mapFrame, mapLod, mapProjection } from '../src/renderer/map/projection'
import { segmentDistanceSquared, simplifyTopology } from '../src/renderer/map/simplify'

const source = JSON.parse(readFileSync('src/renderer/assets/china-cities.topo.json', 'utf8')) as Topology<{
  cities: GeometryCollection
}>
it('keeps all city identities, valid island rings and shared arcs at both overview levels', () => {
  for (const tolerance of [0.22, 0.075]) {
    const simplified = simplifyTopology(source, mapProjection(false), tolerance)
    expect(simplified.objects).toBe(source.objects)
    const regions = (feature(simplified, simplified.objects.cities) as any).features
    expect(regions).toHaveLength(340)
    for (const region of regions) {
      const polygons =
        region.geometry.type === 'Polygon' ? [region.geometry.coordinates] : region.geometry.coordinates
      for (const rings of polygons)
        for (const ring of rings) {
          expect(new Set(ring.map((p: number[]) => p.join(','))).size).toBeGreaterThanOrEqual(3)
          expect(ring[0]).toEqual(ring.at(-1))
        }
    }
    expect(simplified.arcs.reduce((count, arc) => count + arc.length, 0)).toBeLessThan(
      source.arcs.reduce((count, arc) => count + arc.length, 0)
    )
  }
})
it('bounds every removed source vertex to its replacement segment in projected pixels', () => {
  const full = simplifyTopology(source, mapProjection(false), 0),
    project = mapProjection(false)
  for (const tolerance of [0.22, 0.075]) {
    const simplified = simplifyTopology(source, project, tolerance)
    let maximum = 0
    for (let id = 0; id < full.arcs.length; id++) {
      const original = full.arcs[id],
        reduced = simplified.arcs[id]
      let segment = 0
      for (const point of original) {
        while (
          segment + 1 < reduced.length - 1 &&
          point[0] === reduced[segment + 1][0] &&
          point[1] === reduced[segment + 1][1]
        )
          segment++
        const p = project(point as [number, number])!,
          a = project(reduced[segment] as [number, number])!,
          b = project(reduced[Math.min(segment + 1, reduced.length - 1)] as [number, number])!
        maximum = Math.max(maximum, Math.sqrt(segmentDistanceSquared(p, a, b)))
      }
    }
    expect(maximum).toBeLessThanOrEqual(tolerance + 1e-7)
  }
})
it('uses fixed geometry with a cheap affine transform for resize and respects LOD boundaries', () => {
  for (const world of [false, true]) {
    for (const [width, height] of [
      [900, 530],
      [1120, 584],
      [1800, 1100]
    ]) {
      const base = mapProjection(world),
        layout = mapFrame(world, width, height)
      const point: [number, number] = [120.15, 30.25]
      const actual = layout.projection(point)!,
        normalized = base(point)!
      const bounds = layout.bounds([normalized, normalized])
      expect(bounds[0][0]).toBeCloseTo(actual[0], 8)
      expect(bounds[0][1]).toBeCloseTo(actual[1], 8)
      expect(layout.projection.invert!(actual)![0]).toBeCloseTo(point[0], 8)
    }
  }
  expect([1, 1.99, 2, 5.99, 6, 16].map(mapLod)).toEqual([0, 0, 1, 1, 2, 2])
})

it('keeps shipped overview and regional islands from reversing and painting the ocean as land', () => {
  for (const name of ['china-overview', 'china-regional']) {
    const topology = JSON.parse(readFileSync(`src/renderer/assets/${name}.topo.json`, 'utf8'))
    const regions = feature(topology, topology.objects.cities) as unknown as {
      features: GeoPermissibleObjects[]
    }
    expect(regions.features).toHaveLength(340)
    for (const region of regions.features) {
      expect(geoArea(region)).toBeGreaterThan(0)
      expect(geoArea(region)).toBeLessThan(2 * Math.PI)
      expect(geoContains(region, [140, 20])).toBe(false)
    }
    const provinces = feature(topology, topology.objects.provinces) as GeoPermissibleObjects
    expect(geoContains(provinces, [140, 20])).toBe(false)
  }
  const context = JSON.parse(readFileSync('src/renderer/assets/world-context.json', 'utf8'))
  expect(geoArea(context) / (4 * Math.PI)).toBeGreaterThan(0.26)
  expect(geoArea(context) / (4 * Math.PI)).toBeLessThan(0.32)
  expect(geoContains(context, [140, 20])).toBe(false)
  expect(geoContains(context, [100, 35])).toBe(true)
  for (const feature of context.features) {
    const polygons =
      feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates
    for (const polygon of polygons)
      for (const ring of polygon)
        for (let i = 1; i < ring.length; i++)
          if (Math.abs(ring[i][1]) >= 85 && Math.abs(ring[i - 1][1]) >= 85)
            expect(Math.abs(ring[i][0] - ring[i - 1][0])).toBeLessThanOrEqual(180)
  }
})
