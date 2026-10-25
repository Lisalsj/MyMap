import { describe, expect, it, vi } from 'vitest'
import type { AppSnapshot, Entry, Trip } from '../src/shared/types'
import {
  activeAttachments,
  activeEntries,
  activeVisits,
  DraftQueue,
  matchingTrips,
  mediaId,
  passport,
  safeMarkdownUrl,
  type Draft
} from '../src/renderer/model'
import { buildVisitInput, effectiveVisitDate, manualCityId } from '../src/renderer/model'

const trip = (id: string, deletedAt: string | null = null): Trip => ({
  id,
  title: id,
  startDate: '2025-05-01',
  endDate: '',
  description: '',
  tags: ['山野'],
  coverPhotoId: null,
  createdAt: '',
  updatedAt: '',
  deletedAt
})
const entry: Entry = {
  id: 'entry-1',
  tripId: 'trip-1',
  visitId: null,
  title: '标题',
  markdown: '最初的文字',
  createdAt: '',
  updatedAt: '',
  deletedAt: null
}
function snapshot(): AppSnapshot {
  return {
    library: { path: 'local', isDemo: false, version: 1 },
    trips: [trip('trip-1'), trip('deleted', '2026-01-01')],
    places: [
      {
        id: 'p1',
        cityId: 'city-a',
        cityName: '杭州',
        name: '西湖',
        country: '中国',
        kind: 'scenic',
        lat: 30,
        lon: 120
      },
      {
        id: 'p2',
        cityId: 'city-a',
        cityName: '杭州',
        name: '杭州',
        country: '中国',
        kind: 'city',
        lat: null,
        lon: null
      }
    ],
    visits: [
      { id: 'v1', tripId: 'trip-1', placeId: 'p1', date: '2025-05-05', sortOrder: 0, note: '' },
      { id: 'v2', tripId: 'trip-1', placeId: 'p2', date: '2024-02-02', sortOrder: 1, note: '' },
      { id: 'v3', tripId: 'trip-1', placeId: 'p1', date: '', sortOrder: 2, note: '' },
      { id: 'v4', tripId: 'deleted', placeId: 'p1', date: '2001-01-01', sortOrder: 0, note: '' }
    ],
    entries: [entry, { ...entry, id: 'hidden-entry', tripId: 'deleted' }],
    photos: [
      {
        id: 'photo-1',
        hash: 'hash',
        originalName: 'photo.jpg',
        mime: 'image/jpeg',
        width: 100,
        height: 100,
        size: 100,
        lat: null,
        lon: null,
        capturedAt: '',
        createdAt: '',
        originalPath: '',
        previewPath: '',
        thumbPath: '',
        deletedAt: null
      }
    ],
    attachments: [
      {
        id: 'a1',
        photoId: 'photo-1',
        tripId: 'trip-1',
        visitId: null,
        entryId: null,
        caption: '照片',
        sortOrder: 0,
        deletedAt: null
      },
      {
        id: 'a2',
        photoId: 'photo-1',
        tripId: 'deleted',
        visitId: null,
        entryId: null,
        caption: '隐藏照片',
        sortOrder: 0,
        deletedAt: null
      }
    ]
  }
}

describe('renderer data rules', () => {
  it('deduplicates city and scenic visits by city and uses earliest dated active visit', () => {
    expect(passport(snapshot())).toEqual([
      { cityId: 'city-a', name: '杭州', country: '中国', date: '2024-02-02', count: 3 }
    ])
  })
  it('excludes deleted trips and their entries, photos and visits from all views', () => {
    const s = snapshot()
    expect(activeVisits(s)).toHaveLength(3)
    expect(activeEntries(s)).toHaveLength(1)
    expect(activeAttachments(s)).toHaveLength(1)
  })
  it('searches tags, places and journal content and combines year and city filters', () => {
    const s = snapshot()
    expect(matchingTrips(s, '山野', '2024', 'city-a')).toHaveLength(1)
    expect(matchingTrips(s, '西湖')).toHaveLength(1)
    expect(matchingTrips(s, '最初的文字')).toHaveLength(1)
    expect(matchingTrips(s, '西湖', '2020')).toHaveLength(0)
  })
  it('accepts only strictly validated internal media identifiers', () => {
    for (const url of [
      'https://example.com/a.jpg',
      'file:///c:/secret',
      'javascript:alert(1)',
      'data:image/png;base64,abc',
      'mymap-photo:../../secret',
      'mymap-media://photo/id/thumb?x=1'
    ]) {
      expect(mediaId(url)).toBeNull()
      expect(safeMarkdownUrl(url)).toBe('')
    }
    expect(mediaId('mymap-photo:abc-123_xyz')).toBe('abc-123_xyz')
    expect(mediaId('mymap-media://photo/abc-123_xyz/preview')).toBe('abc-123_xyz')
  })
})

describe('manual and editable visits', () => {
  const form = {
    tripId: 'trip-1',
    kind: 'city' as const,
    name: '',
    manual: true,
    manualCityName: ' ＨＡＮＧＺＨＯＵ ',
    manualCountry: ' CN ',
    city: null,
    lat: '',
    lon: '',
    date: '',
    note: '一段回忆'
  }
  it('canonicalizes repeated manual cities without inventing a location', () => {
    expect(manualCityId(' ＨＡＮＧＺＨＯＵ ', ' CN ')).toBe('manual:cn:hangzhou')
    expect(buildVisitInput(form)).toEqual({
      tripId: 'trip-1',
      name: 'HANGZHOU',
      kind: 'city',
      cityId: 'manual:cn:hangzhou',
      cityName: 'HANGZHOU',
      country: 'CN',
      lat: null,
      lon: null,
      date: '',
      note: '一段回忆'
    })
  })
  it('allows an unlocated named landmark without a city and excludes it from passport cities', () => {
    const input = buildVisitInput({ ...form, kind: 'scenic', name: '山谷里的小屋', manual: false })
    expect(input).toMatchObject({
      name: '山谷里的小屋',
      kind: 'custom',
      cityId: '',
      cityName: '',
      lat: null,
      lon: null
    })
    const s = snapshot()
    s.places.push({
      id: 'custom',
      name: '山谷里的小屋',
      kind: 'custom',
      cityId: '',
      cityName: '',
      country: '',
      lat: null,
      lon: null
    })
    s.visits.push({ id: 'vc', tripId: 'trip-1', placeId: 'custom', date: '', sortOrder: 3, note: '' })
    expect(passport(s)).toHaveLength(1)
  })
  it('keeps built-in city centers while preserving scenic coordinates as optional', () => {
    const city = { id: 'known', name: '杭州', country: 'CN', lat: 30.2, lon: 120.1 }
    expect(buildVisitInput({ ...form, manual: false, city })).toMatchObject({
      cityId: 'known',
      lat: 30.2,
      lon: 120.1
    })
    expect(buildVisitInput({ ...form, kind: 'scenic', name: '西湖', manual: false, city })).toMatchObject({
      kind: 'scenic',
      lat: null,
      lon: null
    })
  })
  it('edits the Visit identifier without submitting the shared Place identifier', () => {
    const input = buildVisitInput({
      ...form,
      id: 'visit-1',
      kind: 'custom',
      name: '修改后的地点',
      manual: false,
      city: null,
      lat: '0',
      lon: '0'
    })
    expect(input).toMatchObject({ id: 'visit-1', name: '修改后的地点', lat: 0, lon: 0 })
    expect(input).not.toHaveProperty('placeId')
  })
  it('uses the visit date first and falls back to trip start for undated visits', () => {
    expect(effectiveVisitDate({ date: '' }, { startDate: '2025-05-01' })).toBe('2025-05-01')
    expect(effectiveVisitDate({ date: '2024-01-01' }, { startDate: '2025-05-01' })).toBe('2024-01-01')
    const s = snapshot()
    s.visits = s.visits.filter((v) => v.id === 'v2')
    expect(matchingTrips(s, '', '2025')).toHaveLength(0)
    expect(matchingTrips(s, '', '2024')).toHaveLength(1)
    s.visits[0].date = ''
    expect(matchingTrips(s, '', '2025')).toHaveLength(1)
  })
})

describe('journal serialized autosave', () => {
  it('drains edits made during an in-flight save without stale overwrites', async () => {
    let release!: () => void
    const writes: string[] = []
    const save = vi.fn(async (d: Draft) => {
      writes.push(d.markdown)
      if (writes.length === 1)
        await new Promise<void>((resolve) => {
          release = resolve
        })
      return { ...entry, ...d }
    })
    const queue = new DraftQueue(
      save,
      () => {},
      () => {}
    )
    queue.open(entry)
    queue.edit({ ...entry, markdown: '第一稿' })
    const flushing = queue.flush()
    queue.edit({ ...entry, markdown: '最新的第二稿' })
    expect(queue.flush()).toBe(flushing)
    release()
    await flushing
    expect(writes).toEqual(['第一稿', '最新的第二稿'])
    expect(queue.dirty).toBe(false)
  })
  it('preserves newest draft after failure and retries successfully before navigation', async () => {
    const state = vi.fn(),
      saved = vi.fn(),
      save = vi
        .fn()
        .mockRejectedValueOnce(new Error('磁盘已满'))
        .mockImplementation(async (d) => ({ ...entry, ...d }))
    const queue = new DraftQueue(save, state, saved)
    queue.open(entry)
    queue.edit({ ...entry, title: '新的标题', markdown: '不能丢失的草稿' })
    await expect(queue.flush()).rejects.toThrow('磁盘已满')
    expect(queue.dirty).toBe(true)
    expect(queue.draft?.markdown).toBe('不能丢失的草稿')
    expect(state).toHaveBeenCalledWith('error', '磁盘已满')
    await queue.flush()
    expect(queue.dirty).toBe(false)
    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({ title: '新的标题', markdown: '不能丢失的草稿' })
    )
  })
  it('does not write an unchanged entry', async () => {
    const save = vi.fn()
    const queue = new DraftQueue(
      save,
      () => {},
      () => {}
    )
    queue.open(entry)
    await queue.flush()
    expect(save).not.toHaveBeenCalled()
  })
})
