import { describe, expect, it } from 'vitest'
import type { AppSnapshot, Entry, Photo, PhotoAttachment, Place, Trip, Visit } from '../src/shared/types'
import {
  activeAttachments,
  activeEntries,
  activeTrips,
  activeVisits,
  matchingTrips,
  orderedVisits,
  passport
} from '../src/renderer/model'

const trip = (id: string, changes: Partial<Trip> = {}): Trip => ({
  id,
  title: id,
  startDate: '2025-01-01',
  endDate: '',
  description: '',
  tags: [],
  coverPhotoId: null,
  createdAt: '2025-01-01',
  updatedAt: '2025-01-01',
  deletedAt: null,
  ...changes
})
const place = (id: string, changes: Partial<Place> = {}): Place => ({
  id,
  name: id,
  kind: 'city',
  cityId: 'city-a',
  cityName: '杭州',
  country: 'CN',
  lat: null,
  lon: null,
  ...changes
})
const visit = (id: string, changes: Partial<Visit> = {}): Visit => ({
  id,
  tripId: 'a',
  placeId: 'p',
  date: '',
  sortOrder: 0,
  note: '',
  ...changes
})
const entry = (id: string, changes: Partial<Entry> = {}): Entry => ({
  id,
  tripId: 'a',
  visitId: null,
  title: id,
  markdown: '',
  createdAt: '',
  updatedAt: '',
  deletedAt: null,
  ...changes
})
const photo = (id: string, changes: Partial<Photo> = {}): Photo => ({
  id,
  hash: id,
  originalName: id,
  mime: 'image/jpeg',
  width: 1,
  height: 1,
  size: 1,
  capturedAt: '',
  lat: null,
  lon: null,
  originalPath: '',
  previewPath: '',
  thumbPath: '',
  createdAt: '',
  deletedAt: null,
  ...changes
})
const attachment = (id: string, changes: Partial<PhotoAttachment> = {}): PhotoAttachment => ({
  id,
  photoId: 'photo',
  tripId: 'a',
  visitId: null,
  entryId: null,
  caption: '',
  sortOrder: 0,
  deletedAt: null,
  ...changes
})
const snapshot = (changes: Partial<AppSnapshot> = {}): AppSnapshot => ({
  library: { path: 'test', isDemo: false, version: 1 },
  trips: [trip('a')],
  places: [place('p')],
  visits: [],
  entries: [],
  photos: [],
  attachments: [],
  ...changes
})
const ids = (items: { id: string }[]) => items.map((item) => item.id)

describe('indexed renderer selector semantics', () => {
  it('keeps active visit input order and stable per-trip stop order without dropping unlocated cities', () => {
    const s = snapshot({
      trips: [trip('a'), trip('hidden', { deletedAt: '2026-01-01' })],
      visits: [
        visit('second', { sortOrder: 2 }),
        visit('first', { sortOrder: 1 }),
        visit('tie', { sortOrder: 1 }),
        visit('hidden', { tripId: 'hidden' }),
        visit('missing-trip', { tripId: 'absent' }),
        visit('missing-place', { placeId: 'absent' })
      ]
    })
    expect(ids(activeVisits(s))).toEqual(['second', 'first', 'tie'])
    expect(ids(orderedVisits(s, 'a'))).toEqual(['first', 'tie', 'second'])
    expect(orderedVisits(s, 'hidden')).toEqual([])
    expect(orderedVisits(s, 'absent')).toEqual([])
    expect(ids(s.visits)).toEqual(['second', 'first', 'tie', 'hidden', 'missing-trip', 'missing-place'])
  })

  it('sorts active trips by update then creation while retaining stable ties', () => {
    const s = snapshot({
      trips: [
        trip('old'),
        trip('created-later', { createdAt: '2025-02-01' }),
        trip('updated-later', { updatedAt: '2025-03-01' }),
        trip('same-date'),
        trip('hidden', { deletedAt: '2026-01-01', updatedAt: '2030-01-01' })
      ]
    })
    expect(ids(activeTrips(s))).toEqual(['updated-later', 'created-later', 'old', 'same-date'])
    activeTrips(s).reverse()
    expect(ids(activeTrips(s))).toEqual(['updated-later', 'created-later', 'old', 'same-date'])
  })

  it('excludes deleted, orphaned and deleted-photo content while preserving attachment and entry order', () => {
    const s = snapshot({
      trips: [trip('a'), trip('hidden', { deletedAt: '2026-01-01' })],
      entries: [
        entry('second'),
        entry('first'),
        entry('deleted', { deletedAt: '2026-01-01' }),
        entry('hidden', { tripId: 'hidden' }),
        entry('orphan', { tripId: 'absent' })
      ],
      photos: [photo('photo'), photo('deleted-photo', { deletedAt: '2026-01-01' })],
      attachments: [
        attachment('second'),
        attachment('first'),
        attachment('deleted', { deletedAt: '2026-01-01' }),
        attachment('hidden', { tripId: 'hidden' }),
        attachment('orphan-trip', { tripId: 'absent' }),
        attachment('deleted-photo', { photoId: 'deleted-photo' }),
        attachment('orphan-photo', { photoId: 'absent' })
      ]
    })
    expect(ids(activeEntries(s))).toEqual(['second', 'first'])
    expect(ids(activeAttachments(s))).toEqual(['second', 'first'])
    activeEntries(s).pop()
    activeAttachments(s).pop()
    expect(activeEntries(s)).toHaveLength(2)
    expect(activeAttachments(s)).toHaveLength(2)
  })

  it('counts repeated city and scenic visits once per city with earliest explicit dates and undated cities last', () => {
    const s = snapshot({
      places: [
        place('p'),
        place('scenic', { kind: 'scenic', name: '西湖' }),
        place('b', { cityId: 'manual:cn:小镇', cityName: '小镇' }),
        place('landmark', { cityId: '', cityName: '', kind: 'custom' })
      ],
      visits: [
        visit('undated'),
        visit('later', { date: '2026-01-01', placeId: 'scenic' }),
        visit('earliest', { date: '2024-01-01' }),
        visit('still-undated'),
        visit('town', { placeId: 'b' }),
        visit('landmark', { placeId: 'landmark' })
      ]
    })
    expect(passport(s)).toEqual([
      { cityId: 'city-a', name: '杭州', country: 'CN', date: '2024-01-01', count: 4 },
      { cityId: 'manual:cn:小镇', name: '小镇', country: 'CN', date: '', count: 1 }
    ])
  })

  it('uses trip year only for undated stops or trips without valid stops', () => {
    const s = snapshot({
      trips: [trip('a'), trip('b'), trip('empty'), trip('orphan-only')],
      visits: [
        visit('dated', { date: '2024-04-01' }),
        visit('undated', { tripId: 'b' }),
        visit('orphan', { tripId: 'orphan-only', placeId: 'absent' })
      ]
    })
    expect(ids(matchingTrips(s, '', '2024'))).toEqual(['a'])
    expect(ids(matchingTrips(s, '', '2025'))).toEqual(['b', 'empty', 'orphan-only'])
    expect(ids(matchingTrips(s, '', '2025', 'city-a'))).toEqual(['b'])
    s.visits[0].date = ''
    expect(ids(matchingTrips(s, '', '2025', 'city-a'))).toEqual(['a', 'b'])
  })

  it('searches each eligible text field case-insensitively without joining unrelated fields', () => {
    const s = snapshot({
      trips: [
        trip('a', { title: 'Alpha', description: 'Forest', tags: ['WEEKEND'] }),
        trip('hidden', { title: 'Secret', deletedAt: '2026-01-01' })
      ],
      places: [place('p', { name: 'Lakeside', cityName: 'Unsearched City' })],
      visits: [visit('v')],
      entries: [
        entry('e', { title: 'Notebook', markdown: 'Autumn Trail' }),
        entry('deleted', { markdown: 'Erased', deletedAt: '2026-01-01' })
      ]
    })
    for (const query of [' alpha ', 'FOREST', 'weekend', 'LAKESIDE', 'notebook', 'autumn trail', '   ']) {
      expect(ids(matchingTrips(s, query))).toEqual(['a'])
    }
    for (const query of ['secret', 'erased', 'unsearched city', 'alpha forest', 'notebook autumn']) {
      expect(matchingTrips(s, query)).toEqual([])
    }
  })
})
