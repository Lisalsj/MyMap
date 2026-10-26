import { describe, expect, it } from 'vitest'
import { clusterMarkers } from '../src/renderer/map/domain'
import { clusterProjectedMarkers, toScreen, type Point, type Viewport } from '../src/renderer/map/geometry'

const initialView: Viewport = { zoom: 1, x: 0, y: 0 }

function originalClusters<T extends { id: string; base: Point }>(
  points: readonly T[],
  view: Viewport,
  width: number,
  height: number,
  cellSize = 44
) {
  return clusterMarkers(
    points.flatMap(({ base, ...item }) => {
      const [x, y] = toScreen(base, view)
      return x >= -25 && x < width + 25 && y >= -25 && y < height + 25 ? [{ ...item, x, y }] : []
    }),
    cellSize
  )
}

function comparable<T extends { id: string }>(clusters: { x: number; y: number; items: T[] }[]) {
  return clusters.map(({ x, y, items }) => ({ x, y, ids: items.map((item) => item.id) }))
}

describe('projected marker clustering', () => {
  it('keeps the inclusive left/top and exclusive right/bottom 25px margins', () => {
    const points = [
      { id: 'left', base: [-25, 10] as Point },
      { id: 'top', base: [10, -25] as Point },
      { id: 'inside-right', base: [124.999, 50] as Point },
      { id: 'inside-bottom', base: [50, 124.999] as Point },
      { id: 'outside-left', base: [-25.001, 10] as Point },
      { id: 'outside-top', base: [10, -25.001] as Point },
      { id: 'right', base: [125, 50] as Point },
      { id: 'bottom', base: [50, 125] as Point }
    ]

    expect(comparable(clusterProjectedMarkers(points, initialView, 100, 100))).toStrictEqual([
      { x: -25, y: 10, ids: ['left'] },
      { x: 10, y: -25, ids: ['top'] },
      { x: 124.999, y: 50, ids: ['inside-right'] },
      { x: 50, y: 124.999, ids: ['inside-bottom'] }
    ])
  })

  it('uses floor for negative cells and preserves bucket and member insertion order', () => {
    const points = [
      { id: 'negative-first', base: [-0.1, 10] as Point },
      { id: 'positive', base: [0, 10] as Point },
      { id: 'negative-last', base: [-10, 10] as Point }
    ]

    expect(comparable(clusterProjectedMarkers(points, initialView, 100, 100))).toStrictEqual([
      { x: -5.05, y: 10, ids: ['negative-first', 'negative-last'] },
      { x: 0, y: 10, ids: ['positive'] }
    ])
  })

  it('transforms the viewport before grouping in fixed screen cells', () => {
    const points = [
      { id: 'a', base: [0, 0] as Point },
      { id: 'b', base: [5, 5] as Point },
      { id: 'c', base: [20, 5] as Point }
    ]

    expect(comparable(clusterProjectedMarkers(points, { zoom: 2, x: 10, y: 20 }, 100, 100))).toStrictEqual([
      { x: 15, y: 25, ids: ['a', 'b'] },
      { x: 50, y: 30, ids: ['c'] }
    ])
  })

  it('uses a custom cell size without changing screen-space culling', () => {
    const points = [
      { id: 'a', base: [39, 10] as Point },
      { id: 'b', base: [40, 10] as Point }
    ]

    expect(comparable(clusterProjectedMarkers(points, initialView, 100, 100, 40))).toStrictEqual([
      { x: 39, y: 10, ids: ['a'] },
      { x: 40, y: 10, ids: ['b'] }
    ])
  })

  it('excludes NaN and infinite projected coordinates', () => {
    const points = [
      { id: 'nan-x', base: [NaN, 0] as Point },
      { id: 'nan-y', base: [0, NaN] as Point },
      { id: 'infinite-x', base: [Infinity, 0] as Point },
      { id: 'infinite-y', base: [0, Infinity] as Point },
      { id: 'negative-infinite', base: [-Infinity, -Infinity] as Point },
      { id: 'valid', base: [10, 10] as Point }
    ]

    expect(comparable(clusterProjectedMarkers(points, initialView, 100, 100))).toStrictEqual([
      { x: 10, y: 10, ids: ['valid'] }
    ])
  })

  it('returns no clusters for empty input', () => {
    expect(clusterProjectedMarkers([], initialView, 100, 100)).toStrictEqual([])
  })

  it('retains original members and base references without modifying frozen input', () => {
    const base: Point = Object.freeze([10, 10] as const)
    const first = Object.freeze({ id: 'first', base, metadata: Object.freeze({ value: 'retained' }) })
    const second = Object.freeze({ id: 'second', base: Object.freeze([12, 14] as const) })
    const points = Object.freeze([first, second])

    const clusters = clusterProjectedMarkers(points, initialView, 100, 100)

    expect(comparable(clusters)).toStrictEqual([{ x: 11, y: 12, ids: ['first', 'second'] }])
    expect(clusters[0].items[0]).toBe(first)
    expect(clusters[0].items[0].base).toBe(base)
    expect(clusters[0].items[1]).toBe(second)
    expect(points).toStrictEqual([first, second])
    expect(first).toStrictEqual({ id: 'first', base: [10, 10], metadata: { value: 'retained' } })
  })

  it('matches the previous pipeline exactly for 5000 points across 20 zoom/pan views', () => {
    const width = 1100,
      height = 650
    const points = Array.from({ length: 5000 }, (_, index) => ({
      id: `visit-${index}`,
      base: [
        ((index * 137) % 1700) - 300 + (index % 3) * 0.1,
        ((index * 71) % 1100) - 200 + (index % 7) * 0.03
      ] as Point
    }))
    const views = [0.55, 0.9, 1, 1.018, 1.5, 1.8, 2, 4, 8, 24].flatMap((zoom) =>
      [0, 73].map((offset) => ({
        zoom,
        x: (width / 2) * (1 - zoom) + offset,
        y: (height / 2) * (1 - zoom)
      }))
    )

    for (const view of views) {
      expect(comparable(clusterProjectedMarkers(points, view, width, height))).toStrictEqual(
        comparable(originalClusters(points, view, width, height))
      )
    }
  })
})
