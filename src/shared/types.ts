export interface Trip {
  id: string
  title: string
  startDate: string
  endDate: string
  description: string
  tags: string[]
  coverPhotoId: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}
export interface Place {
  id: string
  name: string
  kind: 'city' | 'scenic' | 'custom'
  cityId: string
  cityName: string
  country: string
  lat: number | null
  lon: number | null
}
export interface Visit {
  id: string
  tripId: string
  placeId: string
  date: string
  sortOrder: number
  note: string
}
export interface Entry {
  id: string
  tripId: string
  visitId: string | null
  title: string
  markdown: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}
export interface Photo {
  id: string
  hash: string
  originalName: string
  mime: string
  width: number
  height: number
  size: number
  capturedAt: string
  lat: number | null
  lon: number | null
  originalPath: string
  previewPath: string
  thumbPath: string
  createdAt: string
  deletedAt: string | null
}
export interface PhotoAttachment {
  id: string
  photoId: string
  tripId: string
  visitId: string | null
  entryId: string | null
  caption: string
  sortOrder: number
  deletedAt: string | null
}
export interface LibraryInfo {
  path: string
  isDemo: boolean
  version: number
}
export interface AppSnapshot {
  library: LibraryInfo
  trips: Trip[]
  places: Place[]
  visits: Visit[]
  entries: Entry[]
  photos: Photo[]
  attachments: PhotoAttachment[]
}
export interface City {
  id: string
  name: string
  country: string
  region: string
  lat: number
  lon: number
  aliases: string
  population: number
}
export type TripInput = Partial<Trip> & { title: string }
export type EntryInput = Partial<Entry> & { tripId: string; title: string; markdown: string }
export interface VisitInput {
  id?: string
  tripId: string
  placeId?: string
  name: string
  kind: Place['kind']
  cityId: string
  cityName: string
  country: string
  lat: number | null
  lon: number | null
  date: string
  note: string
}
export interface ImportProgress {
  running: boolean
  completed: number
  total: number
  imported: number
  duplicates: number
  errors: string[]
  current: string
  cancelled: boolean
}
export interface ImportOptions {
  visitId?: string | null
  entryId?: string | null
}
export type EntityKind = 'trip' | 'entry' | 'attachment'
export interface MyMapApi {
  snapshot(): Promise<AppSnapshot>
  saveTrip(input: TripInput): Promise<Trip>
  saveEntry(input: EntryInput): Promise<Entry>
  saveVisit(input: VisitInput): Promise<Visit>
  deleteVisit(id: string): Promise<void>
  reorderVisits(tripId: string, ids: string[]): Promise<void>
  trash(kind: EntityKind, id: string): Promise<void>
  restore(kind: EntityKind, id: string): Promise<void>
  emptyTrash(): Promise<void>
  importPhotos(tripId: string, options?: ImportOptions): Promise<void>
  importDroppedPhotos(tripId: string, files: File[], options?: ImportOptions): Promise<void>
  cancelImport(): Promise<void>
  importProgress(): Promise<ImportProgress>
  updateAttachment(
    id: string,
    patch: { caption?: string; sortOrder?: number; visitId?: string | null; entryId?: string | null }
  ): Promise<void>
  confirmPhotoLocation(photoId: string, attachmentId?: string): Promise<Visit>
  backup(): Promise<string | null>
  restoreBackup(): Promise<string | null>
  chooseLibrary(): Promise<string | null>
  openLibraryFolder(): Promise<void>
  exportEntry(id: string): Promise<string | null>
  setDemo(enabled: boolean): Promise<void>
  cities(query: string): Promise<City[]>
  onProgress(handler: (progress: ImportProgress) => void): () => void
}
export const photoUrl = (id: string, variant: 'thumb' | 'preview' | 'original' = 'thumb') =>
  `mymap-media://photo/${encodeURIComponent(id)}/${variant}`
declare global {
  interface Window {
    myMap: MyMapApi
  }
}
