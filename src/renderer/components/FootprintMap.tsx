import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { geoGraticule10, geoMercator, geoPath, type GeoPermissibleObjects } from 'd3-geo'
import {
  ArrowUpRight,
  Check,
  Compass,
  Crosshair,
  Globe2,
  Info,
  LocateFixed,
  MapPin,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  X
} from 'lucide-react'
import type { AppSnapshot } from '../../shared/types'
import {
  buildCityLights,
  clusterMarkers,
  routeGeometry,
  selectEligibleVisits,
  validCoordinate,
  type BoundaryFeature,
  type CityLight
} from '../map/domain'
import { fitBounds, fromScreen, selectLabels, toScreen, zoomViewport, type Viewport } from '../map/geometry'
import { loadAtlas, type Atlas } from '../map/atlas'
import './FootprintMap.css'
export { validCoordinate, routeGeometry, clusterMarkers, selectMapVisits } from '../map/domain'

interface Props {
  snapshot: AppSnapshot
  tripId?: string
  year?: string
  cityId?: string
  onVisitSelect?: (visitId: string) => void
  onPickLocation?: (lat: number, lon: number) => void
  playback?: boolean
}
const INITIAL_VIEW: Viewport = { zoom: 1, x: 0, y: 0 }
const worldLabels = [
  ['北京', 116.4, 39.9],
  ['东京', 139.69, 35.68],
  ['新加坡', 103.82, 1.35],
  ['巴黎', 2.35, 48.86],
  ['伦敦', -0.13, 51.51],
  ['纽约', -74, 40.71],
  ['悉尼', 151.21, -33.87],
  ['开普敦', 18.42, -33.92]
] as const

function createGeometry(atlas: Atlas, width: number, height: number, world: boolean) {
  // Keep full geometry: SVG clips the viewport, so panning reveals the cached neighbours.
  const projection = geoMercator()
    .center(world ? [0, 18] : [104, 36])
    .scale(world ? width / 6.5 : Math.min((width - 65) / 1.15, (height - 100) / 0.79))
    .translate([width / 2, height / 2 + (world ? 0 : 5)])
  const path = geoPath(projection).digits(2)
  return {
    projection,
    path,
    land: path(atlas.land as GeoPermissibleObjects) || '',
    grid: path(geoGraticule10()) || '',
    provinceFill: path(atlas.provinces as GeoPermissibleObjects) || '',
    provinceBorders: path(atlas.provinceBorders) || '',
    cityBorders: path(atlas.cityBorders) || '',
    cities: atlas.regions.map((region) => ({ region, d: path(region) || '', bounds: path.bounds(region) }))
  }
}
type Geometry = ReturnType<typeof createGeometry>

// A pan never reconciles hundreds of polygons or rebuilds a path.
const BaseLayer = memo(function BaseLayer({
  geometry,
  world,
  lit,
  selected,
  picking,
  select
}: {
  geometry: Geometry
  world: boolean
  lit: Set<string>
  selected?: string
  picking: boolean
  select: (id: string) => void
}) {
  return (
    <g className="map-base-layer">
      <path d={geometry.grid} className="map-grid" />
      <path d={geometry.land} className="map-land" />
      {!world && (
        <>
          <path d={geometry.provinceFill} className="map-province-fill" />
          {geometry.cities.map(({ region, d }) => (
            <path
              key={region.properties.id}
              d={d}
              className={`map-city-region ${lit.has(region.properties.id) ? 'is-lit' : ''} ${selected === region.properties.id ? 'is-selected' : ''}`}
              data-boundary-id={region.properties.id}
              data-lit={lit.has(region.properties.id)}
              aria-label={`${region.properties.name}${lit.has(region.properties.id) ? '，已点亮' : '，待探索'}`}
              tabIndex={!picking && lit.has(region.properties.id) ? 0 : -1}
              role="button"
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  select(region.properties.id)
                }
              }}
            >
              <title>
                {region.properties.name} · {region.properties.province}
                {lit.has(region.properties.id) ? ' · 已点亮' : ''}
              </title>
            </path>
          ))}
          <path d={geometry.cityBorders} className="map-city-borders" />
          <path d={geometry.provinceBorders} className="map-province-borders" />
          {selected &&
            geometry.cities
              .filter(({ region }) => region.properties.id === selected)
              .map(({ d, region }) => (
                <path key={region.properties.id} d={d} className="map-selected-outline" />
              ))}
        </>
      )}
    </g>
  )
})

export const FootprintMap = memo(function FootprintMap({
  snapshot,
  tripId,
  year,
  cityId,
  onVisitSelect,
  onPickLocation,
  playback = false
}: Props) {
  const holder = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null)
  const [atlas, setAtlas] = useState<Atlas>(),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0)
  const [size, setSize] = useState({ width: 900, height: 530 }),
    [world, setWorld] = useState(false)
  const [view, setView] = useState<Viewport>(INITIAL_VIEW),
    viewRef = useRef(view),
    frame = useRef(0)
  const [picking, setPicking] = useState(false),
    [selectedId, setSelectedId] = useState<string>()
  const [chosen, setChosen] = useState<string>(),
    [onlyLit, setOnlyLit] = useState(false),
    [showInfo, setShowInfo] = useState(false)
  const [playing, setPlaying] = useState(false),
    [step, setStep] = useState(1)
  const drag = useRef<{ x: number; y: number; start: Viewport; moved: boolean; region?: string } | null>(null)
  const eligible = useMemo(
    () => selectEligibleVisits(snapshot, { tripId, year, cityId }),
    [snapshot.trips, snapshot.places, snapshot.visits, tripId, year, cityId]
  )
  const signature = eligible.map((item) => item.visit.id).join('|')
  const shown = useMemo(
    () => (playback && tripId ? eligible.slice(0, step) : eligible),
    [eligible, playback, tripId, step]
  )
  const locatedShown = useMemo(
    () => shown.filter((item) => validCoordinate(item.place.lat, item.place.lon)),
    [shown]
  )
  const lights = useMemo(
    () =>
      atlas
        ? buildCityLights(playback && tripId ? shown : eligible, atlas.regions, atlas.index)
        : new Map<string, CityLight>(),
    [atlas, eligible, shown, playback, tripId]
  )
  const lit = useMemo(() => new Set<string>(lights.keys()), [lights])
  const geometry = useMemo(
    () => (atlas ? createGeometry(atlas, size.width, size.height, world) : undefined),
    [atlas, size.width, size.height, world]
  )
  const updateView = useCallback((next: Viewport) => {
    viewRef.current = next
    if (!frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = 0
        setView(viewRef.current)
      })
  }, [])
  const select = useCallback((id: string) => {
    setSelectedId(id)
    setChosen(undefined)
  }, [])
  const reset = () => updateView(INITIAL_VIEW)
  const zoom = (factor: number, anchor: [number, number] = [size.width / 2, size.height / 2]) =>
    updateView(zoomViewport(viewRef.current, factor, anchor))
  useEffect(() => {
    let active = true
    setError('')
    loadAtlas()
      .then((data) => {
        if (active) setAtlas(data)
      })
      .catch((e) => {
        if (active) setError(String(e))
      })
    return () => {
      active = false
    }
  }, [attempt])
  useEffect(() => {
    if (!holder.current) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) {
        setSize({ width, height })
        updateView(INITIAL_VIEW)
      }
    })
    observer.observe(holder.current)
    return () => {
      observer.disconnect()
      if (frame.current) cancelAnimationFrame(frame.current)
      frame.current = 0
    }
  }, [updateView])
  useEffect(() => {
    if (!onPickLocation) setPicking(false)
  }, [onPickLocation])
  useEffect(() => {
    setStep(1)
    setPlaying(false)
    setChosen(undefined)
  }, [signature, playback])
  useEffect(() => {
    if (!playing || !playback || eligible.length < 2) return
    const timer = window.setInterval(
      () =>
        setStep((value) => {
          if (value >= eligible.length) {
            setPlaying(false)
            return value
          }
          return value + 1
        }),
      1050
    )
    return () => clearInterval(timer)
  }, [playing, playback, eligible.length])
  const localPoint = (event: { clientX: number; clientY: number }): [number, number] => {
    const rect = svg.current!.getBoundingClientRect()
    return [
      ((event.clientX - rect.left) * size.width) / rect.width,
      ((event.clientY - rect.top) * size.height) / rect.height
    ]
  }
  const wheelAction = useRef<(event: WheelEvent) => void>(() => {})
  wheelAction.current = (event) => {
    event.preventDefault()
    zoom(Math.exp(-event.deltaY * 0.0015), localPoint(event))
  }
  useEffect(() => {
    const element = svg.current
    const listener = (event: WheelEvent) => wheelAction.current(event)
    element?.addEventListener('wheel', listener, { passive: false })
    return () => element?.removeEventListener('wheel', listener)
  }, [])
  const points = useMemo(
    () =>
      locatedShown.flatMap((item) => {
        const base = geometry?.projection([item.place.lon!, item.place.lat!])
        return base ? [{ ...item, base }] : []
      }),
    [locatedShown, geometry]
  )
  const clusters = useMemo(
    () =>
      clusterMarkers(
        points.flatMap(({ base, ...item }) => {
          const [x, y] = toScreen(base as [number, number], view)
          return x >= -25 && x < size.width + 25 && y >= -25 && y < size.height + 25
            ? [{ ...item, x, y }]
            : []
        })
      ),
    [points, view, size]
  )
  const route = useMemo(
    () =>
      tripId && locatedShown.length > 1
        ? geometry?.path(routeGeometry(locatedShown.map((item) => [item.place.lon!, item.place.lat!])))
        : undefined,
    [geometry, tripId, locatedShown]
  )
  const selected = atlas?.regions.find((region) => region.properties.id === selectedId),
    selectedLight = selectedId ? lights.get(selectedId) : undefined
  const selectedVisit = eligible.find((item) => item.visit.id === chosen)
  const matchedVisits = useMemo(
    () => new Set([...lights.values()].flatMap((light) => light.visits.map((item) => item.visit.id))).size,
    [lights]
  )
  const labels = useMemo(() => {
    if (!geometry || !atlas) return []
    const candidates = world
      ? worldLabels.map(([text, lon, lat]) => ({
          id: text as string,
          text: text as string,
          coordinate: [lon, lat] as [number, number],
          priority: 1,
          lit: false
        }))
      : atlas.regions
          .map((region) => ({
            id: region.properties.id,
            text: region.properties.name.replace(/(?:市|地区)$/u, ''),
            coordinate: region.properties.center,
            priority: selectedId === region.properties.id ? 100 : lit.has(region.properties.id) ? 70 : 0,
            lit: lit.has(region.properties.id)
          }))
          .filter((item) => !onlyLit || item.lit)
    return selectLabels(
      candidates.flatMap((item) => {
        const base = geometry.projection(item.coordinate)
        if (!base) return []
        const [x, y] = toScreen(base as [number, number], view)
        return [{ ...item, x, y: y - (item.lit ? 25 : 14) }]
      }),
      size.width,
      size.height,
      {
        fontSize: 12,
        padding: 26,
        gap: view.zoom < 1.8 ? 30 : 7,
        reserved: [
          [0, 0, size.width, 75],
          ...(!world ? [[0, 65, 210, 205] as [number, number, number, number]] : []),
          [0, size.height - 60, size.width, size.height],
          ...(selected
            ? [
                [size.width - 295, size.height - 320, size.width, size.height] as [
                  number,
                  number,
                  number,
                  number
                ]
              ]
            : [])
        ]
      }
    )
  }, [atlas, geometry, world, lit, onlyLit, selectedId, selected, view, size])
  function focusCity(region: BoundaryFeature) {
    const bounds = geometry?.cities.find((item) => item.region.properties.id === region.properties.id)?.bounds
    if (bounds)
      updateView(
        fitBounds(
          bounds as [[number, number], [number, number]],
          size.width,
          size.height,
          Math.min(size.width * 0.24, 130),
          15
        )
      )
  }
  return (
    <div
      className={`footprint-map ${picking ? 'is-picking' : ''} ${onlyLit ? 'only-lit' : ''}`}
      ref={holder}
      data-scope={world ? 'world' : 'china'}
      aria-busy={!atlas && !error}
    >
      <svg
        ref={svg}
        viewBox={`0 0 ${size.width} ${size.height}`}
        role="group"
        tabIndex={0}
        aria-label="完全离线旅行足迹地图，方向键平移，正负号缩放"
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          const deltas: Record<string, [number, number]> = {
            ArrowLeft: [50, 0],
            ArrowRight: [-50, 0],
            ArrowUp: [0, 50],
            ArrowDown: [0, -50]
          }
          if (deltas[event.key]) {
            event.preventDefault()
            const [dx, dy] = deltas[event.key]
            updateView({ ...viewRef.current, x: viewRef.current.x + dx, y: viewRef.current.y + dy })
          } else if (['+', '=', '-'].includes(event.key)) {
            event.preventDefault()
            zoom(event.key === '-' ? 1 / 1.4 : 1.4)
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          const [x, y] = localPoint(event)
          const region =
            (event.target as Element).closest('[data-boundary-id]')?.getAttribute('data-boundary-id') ||
            undefined
          drag.current = { x, y, start: viewRef.current, moved: false, region }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const d = drag.current
          if (!d) return
          const [x, y] = localPoint(event)
          if (Math.hypot(x - d.x, y - d.y) > 4) d.moved = true
          if (d.moved) updateView({ ...d.start, x: d.start.x + x - d.x, y: d.start.y + y - d.y })
        }}
        onPointerUp={(event) => {
          const d = drag.current
          drag.current = null
          if (svg.current?.hasPointerCapture(event.pointerId))
            svg.current.releasePointerCapture(event.pointerId)
          if (!d || d.moved) return
          if (picking && onPickLocation && geometry) {
            const point = geometry.projection.invert!(fromScreen(localPoint(event), viewRef.current))
            if (point && validCoordinate(point[1], point[0]) && Math.abs(point[1]) < 85.05113)
              onPickLocation(Number(point[1].toFixed(6)), Number(point[0].toFixed(6)))
          } else if (d.region) select(d.region)
          else {
            setSelectedId(undefined)
            setChosen(undefined)
          }
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
      >
        <rect width="100%" height="100%" className="map-water" />
        <g className="map-viewport" transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          {geometry && (
            <BaseLayer
              geometry={geometry}
              world={world}
              lit={lit}
              selected={selectedId}
              picking={picking}
              select={select}
            />
          )}
          {route && (
            <g className="map-route-layer">
              <path d={route} className="map-route-halo" />
              <path d={route} className="map-route" />
            </g>
          )}
        </g>
        <g className="map-city-labels">
          {labels.map((label) => (
            <g
              key={label.id}
              transform={`translate(${label.x} ${label.y})`}
              className={`map-city-label ${label.lit ? 'is-lit' : ''}`}
              role={world ? undefined : 'button'}
              tabIndex={world || picking ? -1 : 0}
              aria-label={
                world
                  ? undefined
                  : `${label.text} · ${label.lit ? `已点亮 · ${lights.get(label.id)?.visits.length || 0} 次到访` : '待探索'}`
              }
              onPointerDown={(event) => {
                if (!picking) event.stopPropagation()
              }}
              onClick={(event) => {
                if (!world && !picking) {
                  event.stopPropagation()
                  select(label.id)
                }
              }}
              onKeyDown={(event) => {
                if (!world && !picking && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault()
                  select(label.id)
                }
              }}
            >
              <text textAnchor="middle" className={label.lit ? 'lit-label' : ''}>
                {label.text}
              </text>
            </g>
          ))}
        </g>
        <g className="map-markers">
          {clusters.map((cluster) => {
            const count = cluster.items.length,
              item = cluster.items[0]
            const activate = () => {
              if (picking) return
              if (
                count > 1 &&
                view.zoom < 22 &&
                cluster.items.some((p) => p.place.lon !== item.place.lon || p.place.lat !== item.place.lat)
              ) {
                zoom(1.8, [cluster.x, cluster.y])
                return
              }
              const next = cluster.items[(cluster.items.findIndex((p) => p.visit.id === chosen) + 1) % count]
              setChosen(next.visit.id)
              setSelectedId(undefined)
            }
            return (
              <g
                key={cluster.items.map((p) => p.visit.id).join(',')}
                className={`map-marker ${cluster.items.some((p) => p.visit.id === chosen) ? 'selected' : ''}`}
                transform={`translate(${cluster.x} ${cluster.y})`}
                role="button"
                tabIndex={picking ? -1 : 0}
                aria-label={`${count > 1 ? `${count} 个旅行停留点，点击展开；` : ''}${item.place.name} · ${item.trip.title}`}
                onPointerDown={(event) => {
                  if (!picking) event.stopPropagation()
                }}
                onClick={activate}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    activate()
                  }
                }}
              >
                <circle className="marker-aura" r={count > 1 ? 19 : 12} />
                <circle className="marker-body" r={count > 1 ? 13 : 6} />
                {count > 1 && (
                  <text textAnchor="middle" y="4">
                    {count}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      <div className="map-topline">
        <div className="map-offline">
          <span /> 全离线 <span className="map-offline-separator">/</span> 城市足迹
        </div>
        <div className="map-region-switch" aria-label="地图范围">
          <button
            className={!world ? 'active' : ''}
            onClick={() => {
              setWorld(false)
              reset()
              setSelectedId(undefined)
            }}
          >
            中国
          </button>
          <button
            className={world ? 'active' : ''}
            onClick={() => {
              setWorld(true)
              reset()
              setSelectedId(undefined)
            }}
          >
            <Globe2 size={13} /> 世界
          </button>
        </div>
      </div>
      {!world && atlas && (
        <div className="map-light-summary">
          <span className="map-summary-eyebrow">CITIES I HAVE LIT UP</span>
          <div>
            <strong data-testid="city-light-count">{lit.size}</strong>
            <span>
              座城市
              <br />
              留下了我的故事
            </span>
          </div>
          <button aria-pressed={onlyLit} onClick={() => setOnlyLit((value) => !value)}>
            {onlyLit ? <Check size={12} /> : <Sparkles size={12} />}
            {onlyLit ? '显示全部城市' : '只看已点亮'}
          </button>
        </div>
      )}
      <div className="map-compass" aria-hidden="true">
        <span>N</span>
        <Compass size={30} strokeWidth={1} />
      </div>
      <div className="map-zoom-controls">
        <button aria-label="放大地图" title="放大" onClick={() => zoom(1.4)}>
          <Plus size={17} />
        </button>
        <button aria-label="缩小地图" title="缩小" onClick={() => zoom(1 / 1.4)}>
          <Minus size={17} />
        </button>
        <button aria-label="重置地图" title="返回全图" onClick={reset}>
          <LocateFixed size={17} />
        </button>
        {onPickLocation && (
          <button
            aria-label="地图选点"
            aria-pressed={picking}
            className={picking ? 'active' : ''}
            onClick={() => {
              setPicking(!picking)
              setSelectedId(undefined)
              setChosen(undefined)
            }}
          >
            <Crosshair size={17} />
          </button>
        )}
      </div>
      {!atlas && (
        <div className="map-loading" role="status">
          <Compass size={28} />
          <strong>{error ? '离线地图暂时未能打开' : '正在展开你的地图…'}</strong>
          {error && <button onClick={() => setAttempt((n) => n + 1)}>重新加载地图</button>}
        </div>
      )}
      {picking && (
        <div className="map-pick-hint">
          <Crosshair size={14} /> 点击地图添加地点 · 拖动与缩放仍可使用
        </div>
      )}
      {atlas && !eligible.length && !picking && (
        <div className="map-empty">
          <MapPin size={21} strokeWidth={1.2} />
          <strong>点亮第一座，故事就开始了。</strong>
          <span>为旅行添加城市，收藏属于你的绿色版图</span>
        </div>
      )}
      {selected && !picking && (
        <section className="map-city-inspector" aria-label="城市回忆">
          <div className="map-inspector-heading">
            <span className={`map-city-status ${selectedLight ? 'lit' : ''}`}>
              {selectedLight ? '已点亮' : '等待你的故事'}
            </span>
            <button aria-label="关闭城市提示" onClick={() => setSelectedId(undefined)}>
              <X size={15} />
            </button>
          </div>
          <h3>{selected.properties.name}</h3>
          <p>
            {selected.properties.province} ·{' '}
            {selected.properties.kind === 'municipality'
              ? '直辖市'
              : selected.properties.kind === 'special'
                ? '特别行政区'
                : '市域足迹'}
          </p>
          {selectedLight ? (
            <>
              <div className="map-city-numbers">
                <span>
                  <strong>{selectedLight.visits.length}</strong> 次到访
                </span>
                <span>
                  <strong>{selectedLight.tripCount}</strong> 段旅行
                </span>
              </div>
              <div className="map-city-visit-list">
                {selectedLight.visits.slice(0, 8).map((item) => (
                  <button
                    key={item.visit.id}
                    onClick={() => {
                      if (onVisitSelect) onVisitSelect(item.visit.id)
                      else {
                        setSelectedId(undefined)
                        setChosen(item.visit.id)
                      }
                    }}
                  >
                    <span>
                      {item.trip.title}
                      <small>
                        {item.visit.date || item.trip.startDate || '未填写日期'} · {item.place.name}
                      </small>
                    </span>
                    <ArrowUpRight size={14} />
                  </button>
                ))}
              </div>
              {selectedLight.visits.length > 8 && (
                <small>还有 {selectedLight.visits.length - 8} 次到访，可在旅行中查看</small>
              )}
            </>
          ) : (
            <div className="map-city-await">下一次出发，也许就在这里。</div>
          )}
          <button className="map-focus-city" aria-label="聚焦这座城市" onClick={() => focusCity(selected)}>
            <LocateFixed size={13} /> 聚焦这座城市
          </button>
        </section>
      )}
      {selectedVisit && !picking && (
        <div className="map-selected">
          <span className="map-selected-dot" />
          <div>
            <strong>{selectedVisit.place.name}</strong>
            <span>
              {selectedVisit.visit.date || selectedVisit.trip.startDate || '未填写日期'} ·{' '}
              {selectedVisit.trip.title}
            </span>
          </div>
          {onVisitSelect && (
            <button aria-label="打开这段旅行" onClick={() => onVisitSelect(selectedVisit.visit.id)}>
              <ArrowUpRight size={16} />
            </button>
          )}
          <button aria-label="关闭地点提示" onClick={() => setChosen(undefined)}>
            <X size={14} />
          </button>
        </div>
      )}
      {playback && tripId && eligible.length > 0 && (
        <div className="map-playback">
          <button
            disabled={eligible.length < 2}
            aria-label={playing ? '暂停轨迹' : '播放轨迹'}
            onClick={() => {
              if (step >= eligible.length) setStep(1)
              setPlaying((value) => !value)
            }}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <div>
            <strong>{shown.at(-1)?.place.name}</strong>
            <span>
              {step} / {eligible.length} 站 ·{' '}
              {validCoordinate(shown.at(-1)?.place.lat ?? null, shown.at(-1)?.place.lon ?? null)
                ? playing
                  ? '沿着记忆前行'
                  : '回放旅行轨迹'
                : '此站未定位，保留城市回忆'}
            </span>
          </div>
          <progress aria-label="轨迹回放进度" max={eligible.length} value={step} />
          <button
            aria-label="重新播放轨迹"
            disabled={eligible.length < 2}
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
          <i className="map-legend-lit" /> 已点亮 <i className="map-legend-empty" /> 待探索
          {!world && eligible.length > matchedVisits && (
            <small title="海外、未匹配城市及没有城市归属的记录仍保留在旅行中">
              {' '}
              · {eligible.length - matchedVisits} 条未匹配市域
            </small>
          )}
        </span>
        <button
          aria-label="地图数据说明"
          title="地图数据、许可与边界年份"
          aria-expanded={showInfo}
          onClick={() => setShowInfo(!showInfo)}
        >
          <Info size={12} />{' '}
          {world ? 'Natural Earth · 数据说明' : 'geoBoundaries · © OpenStreetMap contributors'}
        </button>
      </div>
      {showInfo && (
        <div className="map-data-info">
          <strong>离线概略足迹图</strong>
          <button aria-label="关闭地图数据说明" onClick={() => setShowInfo(false)}>
            <X size={14} />
          </button>
          <p>
            市域参考 geoBoundaries 3.0.0 的 2017
            年快照（含地级市、自治州等），补充四直辖市、香港与澳门。台湾保留省域轮廓，海外暂以地点足迹展示。莱芜等后续区划变动未合并。
          </p>
          <p>
            © OpenStreetMap contributors · ODbL 1.0 / geoBoundaries；陆地 Natural
            Earth。WGS84。用于旅行回忆，不提供导航或现行行政区划查询。
          </p>
        </div>
      )}
    </div>
  )
})
