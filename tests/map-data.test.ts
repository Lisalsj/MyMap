import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { geoArea } from 'd3-geo'
import manifest from '../resources/data-manifest.json'
import { loadCities } from '../src/shared/cities'
import land from '../src/renderer/assets/world-land.json'
import type { GeoPermissibleObjects } from 'd3-geo'

const cities = loadCities(resolve('resources'))
const legacyCity = {
  id: 'geonames:1816670',
  name: '北京',
  country: 'CN',
  region: '北京',
  lat: 39.91,
  lon: 116.4,
  aliases: 'Beijing,北京,beijing 北京市',
  population: 1000000
}
const folders: string[] = []
const fixtureFolder = () => {
  const folder = mkdtempSync(join(tmpdir(), 'mymap-cities-'))
  folders.push(folder)
  return folder
}
const compact = () => ({
  format: 'mymap-cities',
  version: 1,
  columns: ['id', 'name', 'country', 'region', 'lat', 'lon', 'aliases', 'population'],
  rows: [['geonames:1808926', '杭州', 'CN', '浙江', 30.29, 120.16, 'Hangzhou,杭州,hangzhou 杭州市', 1000000]]
})
const compressedFixture = (folder: string, data: unknown) =>
  writeFileSync(join(folder, 'cities.json.gz'), gzipSync(JSON.stringify(data)))

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

describe('bundled offline geographic data', () => {
  it('preserves every field, alias and source city when decoding the compressed snapshot', () => {
    expect(cities).toHaveLength(34188)
    expect(createHash('sha256').update(JSON.stringify(cities)).digest('hex')).toBe(
      manifest.cityIndex.canonicalCitySha256
    )
    expect(statSync(resolve('resources/cities.json.gz')).size).toBeLessThan(
      manifest.cityIndex.sourceBytes / 2
    )
  })
  it('keeps city names associated with the correct source ids and WGS84 location', () => {
    // IDs and original names checked against the downloaded source records.
    const examples = [
      ['geonames:1808926', '杭州', 'Hangzhou', 30.29, 120.16],
      ['geonames:1886760', '苏州', 'Suzhou', 31.3, 120.6],
      ['geonames:1797929', '青岛', 'Qingdao', 36.06, 120.38],
      ['geonames:1787093', '烟台', 'Yantai', 37.48, 121.44],
      ['geonames:1790645', '厦门', 'Xiamen', 24.48, 118.08],
      ['geonames:1857910', '京都', 'Kyoto', 35.02, 135.75],
      ['geonames:1853909', '大阪', 'Osaka', 34.69, 135.5],
      ['geonames:1816670', '北京', 'Beijing', 39.91, 116.4],
      ['geonames:1796236', '上海', 'Shanghai', 31.22, 121.46],
      ['geonames:1813253', '丽江', 'Lijiang', 26.87, 100.22],
      ['geonames:1280737', '拉萨', 'Lhasa', 29.65, 91.1],
      ['geonames:1791247', '武汉', 'Wuhan', 30.58, 114.27],
      ['geonames:1799962', '南京', 'Nanjing', 32.06, 118.78]
    ] as const
    for (const [id, chinese, original, lat, lon] of examples) {
      const city = cities.find((item) => item.id === id)!
      expect(city, id).toBeDefined()
      expect(city.name, id).toBe(chinese)
      expect(city.aliases, id).toContain(original)
      expect(city.lat, id).toBeCloseTo(lat, 1)
      expect(city.lon, id).toBeCloseTo(lon, 1)
    }
  })
  it('ships unique stable ids and valid searchable city records', () => {
    expect(cities.length).toBeGreaterThan(25000)
    expect(new Set(cities.map((city) => city.id)).size).toBe(cities.length)
    expect(cities.filter((city) => city.country === 'CN').length).toBeGreaterThan(1000)
    expect(
      cities.every(
        (city) =>
          /^geonames:\d+$/.test(city.id) &&
          city.name &&
          city.aliases &&
          Number.isFinite(city.lat) &&
          Math.abs(city.lat) <= 90 &&
          Math.abs(city.lon) <= 180
      )
    ).toBe(true)
  })
  it('has clockwise land geometry covering roughly 29 percent of the sphere', () => {
    // Reversing GeoJSON rings would incorrectly paint ocean as land in d3-geo.
    const ratio = geoArea(land as GeoPermissibleObjects) / (4 * Math.PI)
    expect(ratio).toBeGreaterThan(0.26)
    expect(ratio).toBeLessThan(0.32)
    expect(land.features.length).toBeGreaterThan(1000)
  })
})

describe('offline city resource loading', () => {
  it('decodes tuple columns into complete searchable city records', () => {
    const folder = fixtureFolder()
    compressedFixture(folder, compact())
    expect(loadCities(folder)).toEqual([
      {
        id: 'geonames:1808926',
        name: '杭州',
        country: 'CN',
        region: '浙江',
        lat: 30.29,
        lon: 120.16,
        aliases: 'Hangzhou,杭州,hangzhou 杭州市',
        population: 1000000
      }
    ])
  })
  it('loads old City[] resources when the compressed resource is absent', () => {
    const folder = fixtureFolder()
    writeFileSync(join(folder, 'cities.json'), JSON.stringify([legacyCity]))
    expect(loadCities(folder)).toEqual([legacyCity])
  })
  it('retains compatibility with older partial demo fixtures', () => {
    const folder = fixtureFolder()
    const legacy = [
      { id: 'geonames:1808926', name: '杭州', country: 'CN', lat: 30.29, lon: 120.16, aliases: '' }
    ]
    writeFileSync(join(folder, 'cities.json'), JSON.stringify(legacy))
    expect(loadCities(folder)).toEqual(legacy)
  })
  it('prefers compressed resources and never hides corrupted data behind a legacy fallback', () => {
    const folder = fixtureFolder()
    writeFileSync(join(folder, 'cities.json'), JSON.stringify([legacyCity]))
    compressedFixture(folder, compact())
    expect(loadCities(folder)[0].name).toBe('杭州')
    writeFileSync(join(folder, 'cities.json.gz'), 'broken gzip')
    expect(() => loadCities(folder)).toThrow()
  })
  it.each([
    ['unknown version', () => ({ ...compact(), version: 2 })],
    ['unknown format', () => ({ ...compact(), format: 'other-cities' })],
    ['wrong columns', () => ({ ...compact(), columns: ['name', 'id'] })],
    ['missing fields', () => ({ ...compact(), rows: [['geonames:1808926', '杭州']] })],
    ['invalid latitude', () => ({ ...compact(), rows: [['city', 'name', 'CN', '', 91, 0, '', 1]] })],
    ['missing latitude', () => ({ ...compact(), rows: [['city', 'name', 'CN', '', null, 0, '', 1]] })],
    ['invalid longitude', () => ({ ...compact(), rows: [['city', 'name', 'CN', '', 0, 181, '', 1]] })],
    ['nontext aliases', () => ({ ...compact(), rows: [['city', 'name', 'CN', '', 0, 0, [], 1]] })]
  ])('rejects %s instead of creating an arbitrary city at zero coordinates', (_name, data) => {
    const folder = fixtureFolder()
    compressedFixture(folder, data())
    expect(() => loadCities(folder)).toThrow()
  })
  it('rejects invalid legacy coordinates', () => {
    const folder = fixtureFolder()
    writeFileSync(join(folder, 'cities.json'), JSON.stringify([{ ...legacyCity, lat: null }]))
    expect(() => loadCities(folder)).toThrow()
  })
  it('reuses decoded data while sensing changed compressed files and removed resources', () => {
    const folder = fixtureFolder()
    const path = join(folder, 'cities.json.gz')
    compressedFixture(folder, compact())
    const first = loadCities(folder)
    expect(loadCities(folder)).toBe(first)
    const changed = compact()
    changed.rows[0][1] = '苏州'
    compressedFixture(folder, changed)
    expect(loadCities(folder)[0].name).toBe('苏州')
    rmSync(path)
    expect(() => loadCities(folder)).toThrow()
  })
  it('invalidates the legacy cache even when a same-size rewrite restores the old mtime', () => {
    const folder = fixtureFolder()
    const path = join(folder, 'cities.json')
    writeFileSync(path, JSON.stringify([legacyCity]))
    const before = statSync(path)
    loadCities(folder)
    const changed = [{ ...legacyCity, country: 'ZZ' }]
    writeFileSync(path, JSON.stringify(changed))
    utimesSync(path, before.atime, before.mtime)
    expect(readFileSync(path, 'utf8')).toContain('ZZ')
    expect(loadCities(folder)[0].country).toBe('ZZ')
  })
})
