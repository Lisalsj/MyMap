import type { CityLight, MapVisit } from './domain'
import type { AtlasGeometry, AtlasResponse, AtlasTask, MapLod, MapScope, SerializedLight } from './atlasTypes'
let worker: Worker | undefined
let nextId = 0
const requests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
// Scope × LOD has six possible keys; viewport sizes never add cache entries.
const geometryCache = new Map<string, Promise<AtlasGeometry>>()
const lightCache = new WeakMap<readonly MapVisit[], Promise<Map<string, CityLight>>>()
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./atlas.worker.ts', import.meta.url), {
      type: 'module',
      name: 'MyMap 离线地图'
    })
    worker.onmessage = (event: MessageEvent<AtlasResponse>) => {
      const pending = requests.get(event.data.requestId)
      if (!pending) return
      requests.delete(event.data.requestId)
      if (event.data.error) pending.reject(Error(event.data.error))
      else pending.resolve(event.data.result)
    }
    worker.onerror = () => {
      worker?.terminate()
      worker = undefined
      for (const request of requests.values()) request.reject(Error('离线地图后台未能打开，请重试'))
      requests.clear()
      geometryCache.clear()
    }
  }
  return worker
}
function call<T>(task: AtlasTask): Promise<T> {
  return new Promise((resolve, reject) => {
    const target = getWorker(),
      requestId = ++nextId
    requests.set(requestId, { resolve: (value) => resolve(value as T), reject })
    try {
      target.postMessage({ ...task, requestId })
    } catch (error) {
      requests.delete(requestId)
      reject(error)
    }
  })
}
export function loadMapGeometry(scope: MapScope, lod: MapLod) {
  const key = scope + ':' + lod
  let promise = geometryCache.get(key)
  if (!promise) {
    promise = call<AtlasGeometry>({ action: 'geometry', scope, lod }).catch((error) => {
      geometryCache.delete(key)
      throw error
    })
    geometryCache.set(key, promise)
  }
  return promise
}
export function loadMapLights(visits: readonly MapVisit[]) {
  let promise = lightCache.get(visits)
  if (!promise) {
    promise = call<SerializedLight[]>({ action: 'lights', visits: [...visits] })
      .then((lights) => {
        const byId = new Map(visits.map((item) => [item.visit.id, item]))
        return new Map(
          lights.map(({ visitIds, ...light }) => [
            light.id,
            {
              ...light,
              visits: visitIds.flatMap((id) => {
                const visit = byId.get(id)
                return visit ? [visit] : []
              })
            }
          ])
        )
      })
      .catch((error) => {
        lightCache.delete(visits)
        throw error
      })
    lightCache.set(visits, promise)
  }
  return promise
}
