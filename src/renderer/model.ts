import type { AppSnapshot, City, Entry, Trip, Visit, VisitInput } from '../shared/types'

export const manualCityId = (name: string, country: string) =>
  `manual:${country.normalize('NFKC').trim().toLowerCase()}:${name.normalize('NFKC').trim().toLowerCase()}`
export const effectiveVisitDate = (visit: Pick<Visit, 'date'>, trip: Pick<Trip, 'startDate'>) =>
  visit.date || trip.startDate
export type CitySelection = Pick<City, 'id' | 'name' | 'country'> & { lat: number | null; lon: number | null }
export interface VisitForm {
  id?: string
  tripId: string
  kind: VisitInput['kind']
  name: string
  manual: boolean
  manualCityName: string
  manualCountry: string
  city: CitySelection | null
  lat: string
  lon: string
  date: string
  note: string
}
export function buildVisitInput(form: VisitForm): VisitInput {
  const manualName = form.manualCityName.normalize('NFKC').trim(),
    manualCountry = form.manualCountry.normalize('NFKC').trim()
  const city = form.manual
    ? manualName
      ? {
          id: manualCityId(manualName, manualCountry),
          name: manualName,
          country: manualCountry,
          lat: null,
          lon: null
        }
      : null
    : form.city
  if (form.kind === 'city' && !city) throw new Error('请选择城市，或手动填写城市名称。')
  const kind = city ? form.kind : 'custom',
    name = (kind === 'city' ? city!.name : form.name).trim()
  if (!name) throw new Error('请填写地点名称。')
  const coordinate = (value: string, center: number | null, maximum: number) => {
    if (value.trim() === '') return center
    const number = Number(value)
    if (!Number.isFinite(number) || Math.abs(number) > maximum) throw new Error('请输入有效的经纬度。')
    return number
  }
  return {
    ...(form.id ? { id: form.id } : {}),
    tripId: form.tripId,
    name,
    kind,
    cityId: city?.id || '',
    cityName: city?.name || '',
    country: city?.country || '',
    lat: coordinate(form.lat, kind === 'city' ? (city?.lat ?? null) : null, 90),
    lon: coordinate(form.lon, kind === 'city' ? (city?.lon ?? null) : null, 180),
    date: form.date,
    note: form.note
  }
}

export const activeTrips = (s: AppSnapshot) =>
  s.trips
    .filter((t) => !t.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt))
export const activeVisits = (s: AppSnapshot) => {
  const ids = new Set(activeTrips(s).map((t) => t.id))
  return s.visits.filter((v) => ids.has(v.tripId) && s.places.some((p) => p.id === v.placeId))
}
export const activeEntries = (s: AppSnapshot) => {
  const ids = new Set(activeTrips(s).map((t) => t.id))
  return s.entries.filter((e) => !e.deletedAt && ids.has(e.tripId))
}
export const activeAttachments = (s: AppSnapshot) => {
  const ids = new Set(activeTrips(s).map((t) => t.id))
  const photos = new Set(s.photos.filter((p) => !p.deletedAt).map((p) => p.id))
  return s.attachments.filter((a) => !a.deletedAt && ids.has(a.tripId) && photos.has(a.photoId))
}
export const orderedVisits = (s: AppSnapshot, tripId: string) =>
  activeVisits(s)
    .filter((v) => v.tripId === tripId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
export function passport(s: AppSnapshot) {
  const byCity = new Map<
    string,
    { cityId: string; name: string; country: string; date: string; count: number }
  >()
  for (const v of activeVisits(s)) {
    const p = s.places.find((p) => p.id === v.placeId)!
    if (!p.cityId) continue
    const old = byCity.get(p.cityId)
    byCity.set(p.cityId, {
      cityId: p.cityId,
      name: p.cityName,
      country: p.country,
      date: old?.date && (!v.date || old.date < v.date) ? old.date : v.date,
      count: (old?.count || 0) + 1
    })
  }
  return [...byCity.values()].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))
}
export const tripDates = (t: Trip) =>
  t.startDate
    ? `${t.startDate.replaceAll('-', '.')} ${t.endDate && t.endDate !== t.startDate ? '— ' + t.endDate.replaceAll('-', '.') : ''}`
    : '日期待定 · 随时出发'
export const matches = (value: string, query: string) =>
  value.toLocaleLowerCase().includes(query.trim().toLowerCase())
export function matchingTrips(s: AppSnapshot, query: string, year = '', cityId = '') {
  return activeTrips(s).filter((t) => {
    const visits = orderedVisits(s, t.id)
    const places = visits.map((v) => s.places.find((p) => p.id === v.placeId)!)
    return (
      (!year ||
        (visits.length
          ? visits.some((v) => effectiveVisitDate(v, t).startsWith(year))
          : t.startDate.startsWith(year))) &&
      (!cityId || places.some((p) => p.cityId === cityId)) &&
      (!query.trim() ||
        [
          t.title,
          t.description,
          ...t.tags,
          ...places.map((p) => p.name),
          ...activeEntries(s)
            .filter((e) => e.tripId === t.id)
            .flatMap((e) => [e.title, e.markdown])
        ].some((x) => matches(x, query)))
    )
  })
}
export function mediaId(url: string): string | null {
  const match =
    /^mymap-photo:([a-zA-Z0-9_-]+)$/.exec(url) ||
    /^mymap-media:\/\/photo\/([a-zA-Z0-9_-]+)\/(?:thumb|preview|original)$/.exec(url)
  return match?.[1] || null
}
export function safeMarkdownUrl(url: string) {
  return mediaId(url) ? url : ''
}
export type Draft = Pick<Entry, 'id' | 'tripId' | 'visitId' | 'title' | 'markdown'>
export const draftKey = (d: Draft) => JSON.stringify([d.id, d.tripId, d.visitId, d.title, d.markdown])
export type SaveState = 'saved' | 'saving' | 'pending' | 'error'

/** Serializes writes and drains edits received during an in-flight save. Failure retains the newest draft. */
export class DraftQueue {
  draft: Draft | null = null
  savedKey = ''
  private running: Promise<void> | null = null
  constructor(
    private save: (draft: Draft) => Promise<Entry>,
    private state: (state: SaveState, error?: string) => void,
    private saved: (entry: Entry) => void
  ) {}
  open(entry: Entry) {
    this.draft = { ...entry }
    this.savedKey = draftKey(entry)
    this.state('saved')
  }
  edit(draft: Draft) {
    this.draft = draft
    this.state(this.savedKey === draftKey(draft) ? 'saved' : 'pending')
  }
  get dirty() {
    return !!this.draft && this.savedKey !== draftKey(this.draft)
  }
  flush(): Promise<void> {
    if (this.running) return this.running
    const run = async () => {
      while (this.draft && this.dirty) {
        const next = { ...this.draft }
        this.state('saving')
        try {
          const entry = await this.save(next)
          this.savedKey = draftKey(next)
          this.saved(entry)
        } catch (e) {
          this.state('error', e instanceof Error ? e.message : String(e))
          throw e
        }
      }
      this.state('saved')
    }
    this.running = run().finally(() => {
      this.running = null
    })
    return this.running
  }
}
