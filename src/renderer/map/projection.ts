import { geoMercator } from 'd3-geo'
import type { Bounds, MapLod } from './atlasTypes'

export const BASE_WIDTH = 1000
export const BASE_HEIGHT = 640
export function mapProjection(world: boolean, width = BASE_WIDTH, height = BASE_HEIGHT) {
  return geoMercator()
    .center(world ? [0, 18] : [104, 36])
    .scale(world ? width / 6.5 : Math.min((width - 65) / 1.15, (height - 100) / 0.79))
    .translate([width / 2, height / 2 + (world ? 0 : 5)])
}
export function mapFrame(world: boolean, width: number, height: number) {
  const projection = mapProjection(world, width, height),
    base = mapProjection(world)
  const ratio = projection.scale() / base.scale()
  const [bx, by] = base.translate(),
    [x, y] = projection.translate()
  const offsetX = x - bx * ratio,
    offsetY = y - by * ratio
  return {
    projection,
    ratio,
    transform: `translate(${offsetX} ${offsetY}) scale(${ratio})`,
    bounds: (bounds: Bounds): Bounds =>
      bounds.map(([px, py]) => [px * ratio + offsetX, py * ratio + offsetY]) as Bounds
  }
}
export function mapLod(effectiveZoom: number): MapLod {
  return effectiveZoom < 2 ? 0 : effectiveZoom < 6 ? 1 : 2
}
