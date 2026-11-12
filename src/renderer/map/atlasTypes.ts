import type { BoundaryProperties, MapVisit } from './domain'

export type MapScope = 'china' | 'world'
export type MapLod = 0 | 1 | 2
export type Bounds = [[number, number], [number, number]]
export interface MapRegion {
  properties: BoundaryProperties
}
export interface AtlasGeometry {
  scope: MapScope
  lod: MapLod
  regions: MapRegion[]
  grid: string
  land: string
  provinceFill: string
  provinceBorders: string
  cityBorders: string
  cities: { region: MapRegion; d: string; bounds: Bounds }[]
}
export interface SerializedLight {
  id: string
  visitIds: string[]
  tripCount: number
  firstDate: string
  lastDate: string
}
export type AtlasTask =
  { action: 'geometry'; scope: MapScope; lod: MapLod } | { action: 'lights'; visits: MapVisit[] }
export type AtlasRequest = AtlasTask & { requestId: number }
export type AtlasResponse = { requestId: number; result?: AtlasGeometry | SerializedLight[]; error?: string }
