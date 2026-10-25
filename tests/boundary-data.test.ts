import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { geoArea, geoContains } from 'd3-geo'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import { describe, expect, it } from 'vitest'
import type { Place } from '../src/shared/types'
import {
  normalizeCityName,
  resolveCityBoundary,
  type BoundaryFeature,
  type BoundaryIndex
} from '../src/renderer/map/domain'

const topology = JSON.parse(
  readFileSync(resolve('src/renderer/assets/china-cities.topo.json'), 'utf8')
) as Topology<{
  cities: GeometryCollection
  provinces: GeometryCollection
}>
const regions = (feature(topology, topology.objects.cities) as unknown as { features: BoundaryFeature[] })
  .features
const index = JSON.parse(
  readFileSync(resolve('src/renderer/assets/china-city-index.json'), 'utf8')
) as BoundaryIndex
const manifest = JSON.parse(readFileSync(resolve('resources/data-manifest.json'), 'utf8')).boundary
const record = (patch: Partial<Place> = {}): Place => ({
  id: 'test',
  name: '',
  kind: 'city',
  cityId: '',
  cityName: '',
  country: 'CN',
  lat: null,
  lon: null,
  ...patch
})
const resolveRecord = (patch: Partial<Place>) => resolveCityBoundary(record(patch), regions, index)

describe('bundled city boundary database', () => {
  it('records the historical prefecture source, source hashes, and separate data license', () => {
    expect(index.sourceYear).toBe('2017')
    expect(manifest.sourceYear).toBe('2017')
    expect(manifest.sources.prefectures).toMatchObject({
      url: 'https://www.geoboundaries.org/data/geoBoundaries-3_0_0/CHN/ADM2/geoBoundaries-3_0_0-CHN-ADM2.topojson',
      sha256: '66b46dbef906ff57e212ebc57872a877c7d2e03a0e84aa4fbb96ae68b8a573c7',
      license: 'ODbL-1.0',
      year: '2017'
    })
    expect(manifest.sources.provinces.sha256).toBe(
      '3a00467a0db9b4136facb5f2f3d0edbfd96adb15651cfdf63991da9281030e85'
    )
    expect(manifest.coverage.taiwan).toContain('no city boundary')
    expect(readFileSync(resolve('resources/DATA-LICENSES.md'), 'utf8')).toContain('ODbL')
  })
  it('ships exactly the documented real city regions with Chinese labels and valid small polygons', () => {
    expect(regions).toHaveLength(340)
    expect(new Set(regions.map((region) => region.properties.id)).size).toBe(340)
    expect(topology.objects.provinces.geometries).toHaveLength(34)
    const counts = { prefecture: 0, municipality: 0, special: 0 }
    for (const region of regions) {
      counts[region.properties.kind]++
      expect(region.properties.name).toMatch(/[\u3400-\u9fff]/)
      expect(region.properties.province).toMatch(/[\u3400-\u9fff]/)
      expect(geoArea(region)).toBeGreaterThan(0)
      expect(geoArea(region)).toBeLessThan(2 * Math.PI)
      const polygons =
        region.geometry.type === 'Polygon' ? [region.geometry.coordinates] : region.geometry.coordinates
      for (const polygon of polygons)
        for (const ring of polygon) {
          expect(new Set(ring.map((point) => point.join(','))).size).toBeGreaterThanOrEqual(3)
          expect(ring[0]).toEqual(ring[ring.length - 1])
          for (const [lon, lat] of ring) {
            expect(Number.isFinite(lon) && Number.isFinite(lat)).toBe(true)
            expect(Math.abs(lon)).toBeLessThanOrEqual(180)
            expect(Math.abs(lat)).toBeLessThanOrEqual(90)
          }
        }
    }
    expect(counts).toEqual({ prefecture: 334, municipality: 4, special: 2 })
    expect(regions.some((region) => region.properties.aliases.includes('Laiwu City'))).toBe(true)
    expect(
      regions.some((region) => /Hong Kong Island|Kowloon|New Territories/.test(region.properties.name))
    ).toBe(false)
  })
  it('matches the actual asset bytes to the manifest and keeps the compressed map below 2 MiB', () => {
    let compressedTotal = 0
    for (const asset of Object.values(manifest.assets) as {
      file: string
      bytes: number
      gzipBytes: number
      sha256: string
    }[]) {
      const bytes = readFileSync(resolve(asset.file))
      expect(bytes.length).toBe(asset.bytes)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256)
      const compressed = gzipSync(bytes, { level: 9 }).length
      expect(compressed).toBe(asset.gzipBytes)
      compressedTotal += compressed
    }
    expect(compressedTotal).toBeLessThan(2 * 1024 * 1024)
    const ids = new Set(regions.map((region) => region.properties.id))
    expect(Object.keys(index.geonames)).toHaveLength(manifest.coverage.matchedGeoNamesPoints)
    for (const [key, id] of Object.entries(index.geonames)) {
      expect(key).toMatch(/^\d+$/)
      expect(ids.has(id)).toBe(true)
    }
    for (const [key, matches] of Object.entries(index.names)) {
      expect(key).toBe(normalizeCityName(key))
      expect(matches.every((id) => ids.has(id))).toBe(true)
    }
  })
  it('maps known GeoNames cities and all four municipalities without needing coordinates', () => {
    const samples = [
      ['1808926', '杭州', '浙江省', 'prefecture'],
      ['1816670', '北京', '北京市', 'municipality'],
      ['1796236', '上海', '上海市', 'municipality'],
      ['1814906', '重庆', '重庆市', 'municipality'],
      ['1792947', '天津', '天津市', 'municipality'],
      ['8400694', '台州', '浙江省', 'prefecture']
    ]
    for (const [id, name, province, kind] of samples) {
      const result = resolveRecord({ cityId: `geonames:${id}` })
      expect(result?.properties.name).toContain(name)
      expect(result?.properties).toMatchObject({ province, kind })
    }
  })
  it('preserves the two Suzhou cities and disambiguates manual English names by their actual polygons', () => {
    const suzhou = resolveRecord({ cityId: 'geonames:1886760' })!
    const suzhouAnhui = resolveRecord({ cityId: 'geonames:1793743' })!
    expect(suzhou.properties.name).toBe('苏州市')
    expect(suzhou.properties.province).toBe('江苏省')
    expect(suzhouAnhui.properties.name).toBe('宿州市')
    expect(suzhouAnhui.properties.province).toBe('安徽省')
    expect(suzhou.properties.id).not.toBe(suzhouAnhui.properties.id)
    expect(index.names.suzhou).toHaveLength(2)
    expect(resolveRecord({ cityName: 'Suzhou' })).toBeNull()
    expect(resolveRecord({ cityName: '苏州市' })?.properties.id).toBe(suzhou.properties.id)
    expect(resolveRecord({ cityName: '宿州市' })?.properties.id).toBe(suzhouAnhui.properties.id)
    for (const expected of [suzhou, suzhouAnhui]) {
      const [lon, lat] = expected.properties.center
      expect(geoContains(expected, [lon, lat])).toBe(true)
      expect(resolveRecord({ cityName: 'Suzhou', lon, lat })?.properties.id).toBe(expected.properties.id)
    }
  })
  it('does not conflate Taizhou or Yulin names that occur in different provinces', () => {
    expect(index.names.taizhou).toHaveLength(2)
    expect(index.names.yulin).toHaveLength(2)
    expect(resolveRecord({ cityName: 'Taizhou' })).toBeNull()
    expect(resolveRecord({ cityName: 'Yulin' })).toBeNull()
    expect(resolveRecord({ cityName: '台州' })?.properties.province).toBe('浙江省')
    expect(resolveRecord({ cityName: '泰州' })?.properties.province).toBe('江苏省')
    expect(resolveRecord({ cityName: '玉林' })?.properties.province).toBe('广西壮族自治区')
    expect(resolveRecord({ cityName: '榆林' })?.properties.province).toBe('陕西省')
  })
  it('displays simplified Chinese formal names while retaining traditional Chinese lookup aliases', () => {
    const qiqihar = resolveRecord({ cityName: '齐齐哈尔' })!
    expect(qiqihar.properties.name).toBe('齐齐哈尔市')
    expect(qiqihar.properties.province).toBe('黑龙江省')
    expect(qiqihar.properties.aliases).toEqual(expect.arrayContaining(['齊齊哈爾', '齊齊哈爾市']))
    expect(index.names['齊齊哈爾']).toContain(qiqihar.properties.id)
    expect(resolveRecord({ cityName: '齊齊哈爾市' })?.properties.id).toBe(qiqihar.properties.id)
  })
  it('uses the prefecture identity rather than a district, historical name, or an incorrect province', () => {
    const samples = [
      ['Xinxiang City', '新乡市', '河南省'],
      ['Huzhou City', '湖州市', '浙江省'],
      ['Zhoushan City', '舟山市', '浙江省'],
      ['Huangshan City', '黄山市', '安徽省'],
      ['Luoyang City', '洛阳市', '河南省'],
      ['Xuchang City', '许昌市', '河南省'],
      ['Tongliao City', '通辽市', '内蒙古自治区'],
      ['Chifeng City', '赤峰市', '内蒙古自治区'],
      ['Yibin City', '宜宾市', '四川省'],
      ['Tongling City', '铜陵市', '安徽省'],
      ['Baise City', '百色市', '广西壮族自治区'],
      ['Yuncheng City', '运城市', '山西省'],
      ['Foshan City', '佛山市', '广东省'],
      ['Yancheng City', '盐城市', '江苏省'],
      ['Siping City', '四平市', '吉林省']
    ]
    for (const [alias, name, province] of samples) {
      const region = regions.find((candidate) => candidate.properties.aliases.includes(alias))
      expect(region?.properties, alias).toMatchObject({ name, province, kind: 'prefecture' })
      expect(resolveRecord({ cityName: name })?.properties.id, name).toBe(region?.properties.id)
    }
  })
  it('retains the Ali prefecture seat inside the restored Ngari city region', () => {
    const ngari = resolveRecord({ cityId: 'geonames:1280003' })
    expect(ngari?.properties.name).toBe('阿里地区')
    expect(ngari?.properties.province).toBe('西藏自治区')
    expect(ngari && geoContains(ngari, [80.09758, 32.50124])).toBe(true)
    expect(resolveRecord({ country: '', lat: 32.50124, lon: 80.09758 })?.properties.id).toBe(
      ngari?.properties.id
    )
  })
  it('uses whole Hong Kong and Macao regions and keeps manual records inside their declared coverage', () => {
    const hongKong = resolveRecord({ cityId: 'geonames:1819729', country: 'HK' })!
    const macao = resolveRecord({ cityId: 'geonames:1821274', country: 'MO' })!
    expect(hongKong.properties).toMatchObject({ name: '香港', kind: 'special' })
    expect(macao.properties).toMatchObject({ name: '澳门', kind: 'special' })
    expect(resolveRecord({ cityName: 'Hong Kong', country: 'HK' })?.properties.id).toBe(
      hongKong.properties.id
    )
    expect(resolveRecord({ cityName: '澳門', country: 'MO' })?.properties.id).toBe(macao.properties.id)
    expect(geoContains(hongKong, [113.97157, 22.39175])).toBe(true) // Tuen Mun, outside Hong Kong Island.
    for (const country of ['HK', 'MO', 'TW', 'US']) {
      expect(resolveRecord({ cityName: '杭州', country })).toBeNull()
      expect(resolveRecord({ lat: 30.29365, lon: 120.16142, country })).toBeNull()
    }
  })
  it('does not overlap Hong Kong city or province geometry with Shenzhen districts', () => {
    const shenzhen = regions.find((region) => region.properties.aliases.includes('Shenzhen City'))!
    const hongKong = regions.find((region) => region.properties.name === '香港')!
    const provinceFeatures = feature(topology, topology.objects.provinces).features
    const hongKongProvince = provinceFeatures.find(
      (province) => (province.properties as { name?: string } | null)?.name === '香港特别行政区'
    )!
    expect(hongKongProvince).toBeDefined()
    const shenzhenPoints: [number, number][] = [
      [114.13149, 22.54721], // Luohu.
      [114.0771, 22.53589], // Futian east.
      [114.06136, 22.54033] // Futian civic center.
    ]
    for (const point of shenzhenPoints) {
      const containing = regions.filter((region) => geoContains(region, point))
      expect(
        containing.map((region) => region.properties.id),
        point.join(',')
      ).toEqual([shenzhen.properties.id])
      expect(geoContains(hongKong, point), point.join(',')).toBe(false)
      expect(geoContains(hongKongProvince, point), point.join(',')).toBe(false)
      expect(resolveRecord({ country: '', lat: point[1], lon: point[0] })?.properties.id).toBe(
        shenzhen.properties.id
      )
    }
  })
  it('lights Hong Kong Island, Kowloon, and the outlying islands as one city', () => {
    const hongKong = regions.find((region) => region.properties.name === '香港')!
    const points: [number, number][] = [
      [114.17469, 22.27832], // Hong Kong Island.
      [114.17, 22.32], // Kowloon.
      [113.95, 22.25], // Lantau Island.
      [114.029, 22.209] // Cheung Chau outlying island.
    ]
    for (const point of points) {
      expect(geoContains(hongKong, point), point.join(',')).toBe(true)
      expect(resolveRecord({ country: 'HK', lat: point[1], lon: point[0] })?.properties.id).toBe(
        hongKong.properties.id
      )
    }
  })
  it('leaves Taiwan cities unlit rather than using a province outline or a mainland namesake', () => {
    expect(index.geonames['1668341']).toBeUndefined()
    expect(
      resolveRecord({
        cityId: 'geonames:1668341',
        cityName: '台北',
        country: 'TW',
        lat: 25.05306,
        lon: 121.52639
      })
    ).toBeNull()
    expect(resolveRecord({ cityName: '台北', country: 'CN', lat: 25.05306, lon: 121.52639 })).toBeNull()
  })
})
