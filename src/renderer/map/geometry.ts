export interface Viewport {
  zoom: number
  x: number
  y: number
}
export type Point = readonly [number, number]
export function toScreen(point: Point, view: Viewport): [number, number] {
  return [point[0] * view.zoom + view.x, point[1] * view.zoom + view.y]
}
export function fromScreen(point: Point, view: Viewport): [number, number] {
  return [(point[0] - view.x) / view.zoom, (point[1] - view.y) / view.zoom]
}

/** Project and group visible markers without copying each member on every viewport update. */
export function clusterProjectedMarkers<T extends { base: Point }>(
  points: readonly T[],
  view: Viewport,
  width: number,
  height: number,
  cellSize = 44
): { x: number; y: number; items: T[] }[] {
  const cells = new Map<string, { x: number; y: number; items: T[] }>()
  for (const point of points) {
    const x = point.base[0] * view.zoom + view.x,
      y = point.base[1] * view.zoom + view.y
    if (!(x >= -25 && x < width + 25 && y >= -25 && y < height + 25)) continue
    const key = `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`
    let cell = cells.get(key)
    if (!cell) {
      cell = { x: 0, y: 0, items: [] }
      cells.set(key, cell)
    }
    cell.x += x
    cell.y += y
    cell.items.push(point)
  }
  const clusters = [...cells.values()]
  for (const cluster of clusters) {
    cluster.x /= cluster.items.length
    cluster.y /= cluster.items.length
  }
  return clusters
}

export function zoomViewport(view: Viewport, factor: number, anchor: Point, min = 0.55, max = 24): Viewport {
  const zoom = Math.min(max, Math.max(min, view.zoom * factor))
  const ratio = zoom / view.zoom
  return { zoom, x: anchor[0] - (anchor[0] - view.x) * ratio, y: anchor[1] - (anchor[1] - view.y) * ratio }
}
export function fitBounds(
  bounds: readonly [Point, Point],
  width: number,
  height: number,
  padding = 70,
  maxZoom = 18
): Viewport {
  const [[left, top], [right, bottom]] = bounds
  const zoom = Math.min(
    maxZoom,
    Math.max(
      0.55,
      Math.min(
        Math.max(1, width - padding * 2) / Math.max(0.001, right - left),
        Math.max(1, height - padding * 2) / Math.max(0.001, bottom - top)
      )
    )
  )
  return { zoom, x: width / 2 - ((left + right) / 2) * zoom, y: height / 2 - ((top + bottom) / 2) * zoom }
}

export interface MapLabel {
  id: string
  x: number
  y: number
  text: string
  priority?: number
}
export interface LabelOptions {
  fontSize?: number
  padding?: number
  gap?: number
  reserved?: readonly (readonly [number, number, number, number])[]
}
/** Labels use screen coordinates and centered text. A small spatial grid avoids quadratic collision scans. */
export function selectLabels<T extends MapLabel>(
  labels: readonly T[],
  width: number,
  height: number,
  options: LabelOptions = {}
): T[] {
  const { fontSize = 11, padding = 14, gap = 6, reserved = [] } = options
  const cellSize = 64
  type Rect = readonly [number, number, number, number]
  const grid = new Map<string, Rect[]>()
  const cells = (rect: Rect) => {
    const keys: string[] = []
    for (let x = Math.floor(rect[0] / cellSize); x <= Math.floor(rect[2] / cellSize); x++)
      for (let y = Math.floor(rect[1] / cellSize); y <= Math.floor(rect[3] / cellSize); y++)
        keys.push(`${x},${y}`)
    return keys
  }
  const add = (rect: Rect) => {
    for (const key of cells(rect)) {
      const bucket = grid.get(key) || []
      bucket.push(rect)
      grid.set(key, bucket)
    }
  }
  for (const rect of reserved) add(rect)
  const selected: T[] = []
  for (const label of [...labels].sort((a, b) => (b.priority || 0) - (a.priority || 0))) {
    if (!Number.isFinite(label.x) || !Number.isFinite(label.y)) continue
    const textWidth =
      [...label.text].reduce((sum, char) => sum + (char.codePointAt(0)! > 255 ? 1 : 0.58), 0) * fontSize
    const halfWidth = textWidth / 2 + gap,
      halfHeight = fontSize / 2 + gap
    const rect: Rect = [label.x - halfWidth, label.y - halfHeight, label.x + halfWidth, label.y + halfHeight]
    if (rect[0] < padding || rect[1] < padding || rect[2] > width - padding || rect[3] > height - padding)
      continue
    const collision = cells(rect).some((key) =>
      (grid.get(key) || []).some(
        (other) => rect[0] < other[2] && rect[2] > other[0] && rect[1] < other[3] && rect[3] > other[1]
      )
    )
    if (collision) continue
    selected.push(label)
    add(rect)
  }
  return selected
}
