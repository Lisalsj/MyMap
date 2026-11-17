import type { Topology } from 'topojson-specification'
import { geoArea } from 'd3-geo'

export function segmentDistanceSquared(point: readonly number[], a: readonly number[], b: readonly number[]) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1]
  const t =
    dx || dy
      ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)))
      : 0
  return (point[0] - a[0] - dx * t) ** 2 + (point[1] - a[1] - dy * t) ** 2
}
/** Shared arcs are simplified once in projected pixels, preserving seams and ring anchors. */
export function simplifyTopology(
  source: Topology,
  project: (point: [number, number]) => [number, number] | null,
  tolerance: number
): Topology {
  const { transform, ...rest } = source
  const arcs = source.arcs.map((arc) => {
    let x = 0,
      y = 0
    return arc.map((point) => {
      if (!transform) return [point[0], point[1]]
      x += point[0]
      y += point[1]
      return [
        x * transform.scale[0] + transform.translate[0],
        y * transform.scale[1] + transform.translate[1]
      ]
    })
  })
  const forced = arcs.map((arc) => new Set([0, arc.length - 1]))
  for (const [id, arc] of arcs.entries())
    for (const [index, point] of arc.entries())
      // Near a pole, a straight Mercator segment spanning over 180° becomes a
      // different great-circle edge after decoding. Keep these source anchors.
      if (Math.abs(point[1]) >= 85) forced[id].add(index)
  const ringsToCheck: number[][] = []
  for (const object of Object.values(source.objects)) {
    const geometries = object.type === 'GeometryCollection' ? object.geometries : [object]
    for (const geometry of geometries) {
      const polygons =
        geometry.type === 'Polygon' ? [geometry.arcs] : geometry.type === 'MultiPolygon' ? geometry.arcs : []
      for (const rings of polygons)
        for (const ring of rings) {
          ringsToCheck.push(ring)
          const points = ring.flatMap((ref) => {
            const id = ref < 0 ? ~ref : ref
            return arcs[id].map((p, index) => ({ p, id, index }))
          })
          const kept = new Set(
            points.filter(({ id, index }) => forced[id].has(index)).map(({ p }) => `${p[0]},${p[1]}`)
          )
          const candidates = [
            points[Math.floor(points.length / 3)],
            points[Math.floor((points.length * 2) / 3)],
            ...points
          ]
          for (const candidate of candidates) {
            if (kept.size >= 3) break
            if (!candidate) continue
            const key = `${candidate.p[0]},${candidate.p[1]}`
            if (!kept.has(key)) {
              kept.add(key)
              forced[candidate.id].add(candidate.index)
            }
          }
        }
    }
  }
  const simplified = arcs.map((arc, id) => {
    const projected = arc.map((p) => project(p as [number, number]) || [0, 0])
    const keep = forced[id],
      anchors = [...keep].sort((a, b) => a - b)
    const stack = anchors.slice(1).map((end, index) => [anchors[index], end])
    while (stack.length) {
      const [first, last] = stack.pop()!
      let maximum = tolerance * tolerance,
        chosen = -1
      for (let index = first + 1; index < last; index++) {
        const distance = segmentDistanceSquared(projected[index], projected[first], projected[last])
        if (distance > maximum) {
          maximum = distance
          chosen = index
        }
      }
      if (chosen >= 0) {
        keep.add(chosen)
        stack.push([first, chosen], [chosen, last])
      }
    }
    return arc.filter((_p, index) => keep.has(index))
  })
  const ringArea = (refs: number[], geometry: typeof arcs) =>
    geoArea({
      type: 'Polygon',
      coordinates: [refs.flatMap((ref) => (ref < 0 ? [...geometry[~ref]].reverse() : geometry[ref]))]
    })
  const originalAreas = ringsToCheck.map((refs) => ringArea(refs, arcs))
  // Three distinct vertices alone do not preserve winding in a tiny concave island.
  // D3 paints a reversed ring as the rest of the globe. Restore its shared source
  // arcs, then recheck neighbors affected by the restoration before shipping data.
  let restored: boolean
  do {
    restored = false
    for (let i = 0; i < ringsToCheck.length; i++) {
      const refs = ringsToCheck[i],
        area = ringArea(refs, simplified),
        original = originalAreas[i]
      if (area > 2 * Math.PI === original > 2 * Math.PI && area !== 0 && area !== 4 * Math.PI) continue
      for (const ref of refs) {
        const id = ref < 0 ? ~ref : ref
        if (simplified[id] === arcs[id]) continue
        simplified[id] = arcs[id]
        restored = true
      }
    }
  } while (restored)
  return { ...rest, arcs: simplified } as Topology
}
