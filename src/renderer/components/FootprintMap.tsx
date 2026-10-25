import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { geoGraticule10, geoMercator, geoPath, type GeoPermissibleObjects } from 'd3-geo'
import {
  Compass,
  Crosshair,
  Globe2,
  LocateFixed,
  MapPin,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw
} from 'lucide-react'
import type { AppSnapshot } from '../../shared/types'
import land from '../assets/world-land.json'
import './FootprintMap.css'

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
// d3's geographic path cuts this great-circle line at the antimeridian.
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
    x: items.reduce((sum, p) => sum + p.x, 0) / items.length,
    y: items.reduce((sum, p) => sum + p.y, 0) / items.length,
    items
  }))
}
export function selectMapVisits(
  snapshot: AppSnapshot,
  filters: { tripId?: string; year?: string; cityId?: string } = {}
) {
  const trips = new Map(snapshot.trips.filter((trip) => !trip.deletedAt).map((trip) => [trip.id, trip]))
  const places = new Map(snapshot.places.map((place) => [place.id, place]))
  return snapshot.visits
    .flatMap((visit) => {
      const trip = trips.get(visit.tripId)
      const place = places.get(visit.placeId)
      if (!trip || !place || !validCoordinate(place.lat, place.lon)) return []
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
    .sort((a, b) => a.visit.sortOrder - b.visit.sortOrder || a.visit.date.localeCompare(b.visit.date))
}

interface Props {
  snapshot: AppSnapshot
  tripId?: string
  year?: string
  cityId?: string
  onVisitSelect?: (visitId: string) => void
  onPickLocation?: (lat: number, lon: number) => void
  playback?: boolean
}

const labels: [string, number, number, 'cn' | 'world'][] = [
  ['北京', 116.4, 39.9, 'cn'],
  ['上海', 121.47, 31.23, 'cn'],
  ['杭州', 120.15, 30.27, 'cn'],
  ['成都', 104.07, 30.67, 'cn'],
  ['昆明', 102.71, 25.04, 'cn'],
  ['广州', 113.26, 23.13, 'cn'],
  ['西安', 108.94, 34.34, 'cn'],
  ['拉萨', 91.14, 29.65, 'cn'],
  ['乌鲁木齐', 87.62, 43.83, 'cn'],
  ['台北', 121.57, 25.03, 'cn'],
  ['东京', 139.69, 35.68, 'world'],
  ['新加坡', 103.82, 1.35, 'world'],
  ['巴黎', 2.35, 48.86, 'world'],
  ['伦敦', -0.13, 51.51, 'world'],
  ['纽约', -74, 40.71, 'world'],
  ['悉尼', 151.21, -33.87, 'world'],
  ['开普敦', 18.42, -33.92, 'world']
]

export function FootprintMap({
  snapshot,
  tripId,
  year,
  cityId,
  onVisitSelect,
  onPickLocation,
  playback = false
}: Props) {
  const holder = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null)
  const [size, setSize] = useState({ width: 900, height: 530 })
  const [world, setWorld] = useState(false)
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 })
  const [picking, setPicking] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [step, setStep] = useState(1)
  const [chosen, setChosen] = useState<string>()
  const pattern = useId().replace(/:/g, '')
  const visits = useMemo(
    () => selectMapVisits(snapshot, { tripId, year, cityId }),
    [snapshot, tripId, year, cityId]
  )
  const signature = visits.map((item) => item.visit.id).join('|')
  useEffect(() => {
    if (!holder.current) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect
      if (rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height })
    })
    observer.observe(holder.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!onPickLocation) setPicking(false)
  }, [onPickLocation])
  useEffect(() => {
    setStep(1)
    setPlaying(false)
    setChosen(undefined)
  }, [signature, playback])
  useEffect(() => {
    if (!playing || !playback || visits.length < 2) return
    const timer = window.setInterval(
      () =>
        setStep((value) => {
          if (value >= visits.length) {
            setPlaying(false)
            return value
          }
          return value + 1
        }),
      1050
    )
    return () => window.clearInterval(timer)
  }, [playing, playback, visits.length])
  const projection = useMemo(
    () =>
      geoMercator()
        .center(world ? [0, 18] : [104, 35])
        .scale((world ? size.width / 6.65 : Math.min(size.width / 1.24, size.height / 0.82)) * view.zoom)
        .translate([size.width / 2 + view.x, size.height / 2 + view.y])
        .clipExtent([
          [0, 0],
          [size.width, size.height]
        ]),
    [world, size, view]
  )
  const path = useMemo(() => geoPath(projection), [projection])
  const landPath = useMemo(() => path(land as GeoPermissibleObjects) || '', [path])
  const gridPath = useMemo(() => path(geoGraticule10()) || '', [path])
  const shown = playback && tripId ? visits.slice(0, step) : visits
  const points = shown.flatMap((item) => {
    const point = projection([item.place.lon!, item.place.lat!])
    return point &&
      point[0] >= -20 &&
      point[0] <= size.width + 20 &&
      point[1] >= -20 &&
      point[1] <= size.height + 20
      ? [{ ...item, x: point[0], y: point[1] }]
      : []
  })
  const clusters = clusterMarkers(points)
  const route =
    tripId && shown.length > 1
      ? path(routeGeometry(shown.map((item) => [item.place.lon!, item.place.lat!])))
      : null
  const selected = visits.find((item) => item.visit.id === chosen)
  const reset = () => setView({ zoom: 1, x: 0, y: 0 })
  const zoom = (factor: number, x = size.width / 2, y = size.height / 2) =>
    setView((previous) => {
      const next = Math.min(18, Math.max(0.55, previous.zoom * factor))
      const ratio = next / previous.zoom
      return {
        zoom: next,
        x: x - size.width / 2 - (x - size.width / 2 - previous.x) * ratio,
        y: y - size.height / 2 - (y - size.height / 2 - previous.y) * ratio
      }
    })
  const localPoint = (event: { clientX: number; clientY: number }) => {
    const rect = svg.current!.getBoundingClientRect()
    return [
      ((event.clientX - rect.left) * size.width) / rect.width,
      ((event.clientY - rect.top) * size.height) / rect.height
    ] as [number, number]
  }
  // A native non-passive listener keeps scroll zoom inside the map.
  const wheelAction = useRef<(event: WheelEvent) => void>(() => {})
  wheelAction.current = (event) => {
    event.preventDefault()
    const [x, y] = localPoint(event)
    zoom(Math.exp(-event.deltaY * 0.0015), x, y)
  }
  useEffect(() => {
    const element = svg.current
    const handler = (event: WheelEvent) => wheelAction.current(event)
    element?.addEventListener('wheel', handler, { passive: false })
    return () => element?.removeEventListener('wheel', handler)
  }, [])
  return (
    <div className={`footprint-map ${picking ? 'is-picking' : ''}`} ref={holder}>
      <svg
        ref={svg}
        viewBox={`0 0 ${size.width} ${size.height}`}
        role="img"
        aria-label="完全离线旅行足迹地图，支持拖动与滚轮缩放"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          const [x, y] = localPoint(event)
          drag.current = { x, y, panX: view.x, panY: view.y, moved: false }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!drag.current) return
          const [x, y] = localPoint(event)
          const d = drag.current
          if (Math.hypot(x - d.x, y - d.y) > 4) d.moved = true
          if (d.moved) setView((current) => ({ ...current, x: d.panX + x - d.x, y: d.panY + y - d.y }))
        }}
        onPointerUp={(event) => {
          const d = drag.current
          drag.current = null
          if (d && !d.moved && picking && onPickLocation) {
            const point = projection.invert!(localPoint(event))
            if (point && validCoordinate(point[1], point[0]) && Math.abs(point[1]) < 85.05113)
              onPickLocation(Number(point[1].toFixed(6)), Number(point[0].toFixed(6)))
          }
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
      >
        <defs>
          <pattern id={`${pattern}-paper`} width="9" height="9" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r=".55" fill="#809d82" opacity=".17" />
          </pattern>
          <filter id={`${pattern}-shadow`} x="-100%" y="-100%" width="300%" height="300%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#315b49" floodOpacity=".2" />
          </filter>
        </defs>
        <rect width="100%" height="100%" fill="#dfe9df" />
        <path d={gridPath} fill="none" stroke="#b9cdbd" strokeWidth=".65" opacity=".57" />
        <path d={landPath} fill="#f5f2e6" stroke="#aabea9" strokeWidth="1.1" strokeLinejoin="round" />
        <path d={landPath} fill={`url(#${pattern}-paper)`} />
        <g className="map-city-labels">
          {labels
            .filter(([name, , , scope]) => !world || scope === 'world' || ['北京', '上海'].includes(name))
            .map(([name, lon, lat]) => {
              const point = projection([lon, lat])
              if (
                !point ||
                point[0] < 30 ||
                point[0] > size.width - 40 ||
                point[1] < 20 ||
                point[1] > size.height - 30
              )
                return null
              if (points.some((p) => Math.hypot(p.x - point[0], p.y - point[1]) < 40)) return null
              return (
                <g key={name} transform={`translate(${point})`}>
                  <circle r="2" fill="#8b9b82" />
                  <text x="7" y="4">
                    {name}
                  </text>
                </g>
              )
            })}
        </g>
        {route && (
          <>
            <path d={route} className="map-route-halo" />
            <path d={route} className="map-route" />
          </>
        )}
        {clusters.map((cluster) => {
          const item = cluster.items[0]
          const count = cluster.items.length
          const title = cluster.items
            .map((p) => `${p.place.name} · ${p.trip.title} · ${p.visit.date}`)
            .join('\n')
          const activate = () => {
            if (picking) return
            if (
              count > 1 &&
              view.zoom < 17 &&
              cluster.items.some((p) => p.place.lat !== item.place.lat || p.place.lon !== item.place.lon)
            ) {
              zoom(1.8, cluster.x, cluster.y)
              return
            }
            const index = cluster.items.findIndex((p) => p.visit.id === chosen)
            const next = cluster.items[(index + 1) % count]
            setChosen(next.visit.id)
            onVisitSelect?.(next.visit.id)
          }
          return (
            <g
              key={cluster.items.map((p) => p.visit.id).join(',')}
              transform={`translate(${cluster.x} ${cluster.y})`}
              className={`map-marker ${chosen && cluster.items.some((p) => p.visit.id === chosen) ? 'selected' : ''}`}
              tabIndex={picking ? -1 : 0}
              role="button"
              aria-label={count > 1 ? `${count} 个旅行停留点，点击展开；${title}` : title}
              onPointerDown={(event) => {
                if (!picking) event.stopPropagation()
              }}
              onClick={(event) => {
                if (!picking) event.stopPropagation()
                activate()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  activate()
                }
              }}
            >
              <title>{title}</title>
              <circle className="marker-aura" r={count > 1 ? 24 : 19} />
              <circle className="marker-body" r={count > 1 ? 17 : 11} filter={`url(#${pattern}-shadow)`} />
              {count > 1 ? (
                <text textAnchor="middle" y="4">
                  {count}
                </text>
              ) : (
                <circle r="3.5" fill="#fffaf0" />
              )}
            </g>
          )
        })}
      </svg>
      <div className="map-topline">
        <span className="map-offline">
          <span /> 离线地图
        </span>
        <div className="map-region-switch" aria-label="地图范围">
          <button
            type="button"
            className={!world ? 'active' : ''}
            onClick={() => {
              setWorld(false)
              reset()
            }}
          >
            中国
          </button>
          <button
            type="button"
            className={world ? 'active' : ''}
            onClick={() => {
              setWorld(true)
              reset()
            }}
          >
            <Globe2 size={13} /> 世界
          </button>
        </div>
      </div>
      <div className="map-compass" aria-hidden="true">
        <span>N</span>
        <Compass size={35} strokeWidth={1.05} />
      </div>
      <div className="map-zoom-controls">
        <button type="button" aria-label="放大地图" title="放大" onClick={() => zoom(1.4)}>
          <Plus size={18} />
        </button>
        <button type="button" aria-label="缩小地图" title="缩小" onClick={() => zoom(1 / 1.4)}>
          <Minus size={18} />
        </button>
        <button type="button" aria-label="重置地图" title="重置地图" onClick={reset}>
          <LocateFixed size={17} />
        </button>
        {onPickLocation && (
          <button
            type="button"
            className={picking ? 'active' : ''}
            aria-label="地图选点"
            aria-pressed={picking}
            title="地图选点"
            onClick={() => setPicking((value) => !value)}
          >
            <Crosshair size={18} />
          </button>
        )}
      </div>
      {picking && (
        <div className="map-pick-hint">
          <Crosshair size={14} /> 点击地图，选择地点的 WGS84 坐标
        </div>
      )}
      {!visits.length && !picking && (
        <div className="map-empty">
          <MapPin size={23} strokeWidth={1.3} />
          <strong>下一站，会是哪里？</strong>
          <span>为旅行添加地点，把回忆留在地图上</span>
        </div>
      )}
      {selected && !picking && (
        <div className="map-selected">
          <span className="map-selected-dot" />
          <div>
            <strong>{selected.place.name}</strong>
            <span>
              {selected.visit.date} · {selected.trip.title}
            </span>
          </div>
          <button type="button" aria-label="关闭地点提示" onClick={() => setChosen(undefined)}>
            ×
          </button>
        </div>
      )}
      {playback && tripId && visits.length > 0 && (
        <div className="map-playback">
          <button
            type="button"
            disabled={visits.length < 2}
            aria-label={playing ? '暂停轨迹' : '播放轨迹'}
            onClick={() => {
              if (step >= visits.length) setStep(1)
              setPlaying((value) => !value)
            }}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <div>
            <strong>{shown[shown.length - 1]?.place.name}</strong>
            <span>
              {visits.length === 1
                ? '这一站，值得慢慢记住'
                : `${step} / ${visits.length} 站 · ${playing ? '沿着记忆前行' : step >= visits.length ? '旅途已回放完毕' : '回放旅行轨迹'}`}
            </span>
          </div>
          <progress aria-label="轨迹回放进度" max={visits.length} value={step} />
          <button
            type="button"
            aria-label="重新播放轨迹"
            disabled={visits.length < 2}
            onClick={() => {
              setStep(1)
              setPlaying(true)
            }}
          >
            <RotateCcw size={15} />
          </button>
        </div>
      )}
      <div className="map-caption">
        <span>
          {world ? 'WORLD' : 'CHINA'} · {visits.length} 个足迹
        </span>
        <span>Natural Earth · WGS84 · 概略地理底图</span>
      </div>
    </div>
  )
}
