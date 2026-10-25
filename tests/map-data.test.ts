import { describe, expect, it } from 'vitest'
import { geoArea } from 'd3-geo'
import cities from '../resources/cities.json'
import land from '../src/renderer/assets/world-land.json'
import type { GeoPermissibleObjects } from 'd3-geo'

describe('bundled offline geographic data', () => {
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
