import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { City } from './types'

const columns = ['id', 'name', 'country', 'region', 'lat', 'lon', 'aliases', 'population'] as const
const cache = new Map<string, { signature: string; cities: City[] }>()

function validateCity(value: unknown, legacy: boolean): asserts value is City {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid city record')
  const city = value as Record<string, unknown>
  if (
    typeof city.id !== 'string' ||
    !city.id ||
    typeof city.name !== 'string' ||
    !city.name ||
    typeof city.country !== 'string' ||
    typeof city.aliases !== 'string' ||
    typeof city.lat !== 'number' ||
    !Number.isFinite(city.lat) ||
    Math.abs(city.lat) > 90 ||
    typeof city.lon !== 'number' ||
    !Number.isFinite(city.lon) ||
    Math.abs(city.lon) > 180 ||
    (!(legacy && city.region === undefined) && typeof city.region !== 'string') ||
    (!(legacy && city.population === undefined) &&
      (typeof city.population !== 'number' || !Number.isSafeInteger(city.population) || city.population < 0))
  )
    throw new Error('Invalid city fields')
}

function decodeCities(value: unknown, legacy: boolean): City[] {
  let cities: unknown[]
  if (legacy && Array.isArray(value)) {
    cities = value
  } else {
    const data = value as Record<string, unknown> | null
    if (
      !data ||
      data.format !== 'mymap-cities' ||
      data.version !== 1 ||
      !Array.isArray(data.columns) ||
      data.columns.length !== columns.length ||
      !columns.every((column, index) => (data.columns as unknown[])[index] === column) ||
      !Array.isArray(data.rows)
    )
      throw new Error('Unsupported city index format or version')
    cities = data.rows.map((row: unknown) => {
      if (!Array.isArray(row) || row.length !== columns.length) throw new Error('Invalid city index row')
      return Object.fromEntries(columns.map((column, index) => [column, row[index]]))
    })
  }
  const ids = new Set<string>()
  for (const city of cities) {
    validateCity(city, legacy)
    if (ids.has(city.id)) throw new Error('Duplicate city id')
    ids.add(city.id)
  }
  return cities as City[]
}

/** Load the bundled lossless city index; old resource directories may still contain City[] JSON. */
export function loadCities(assetsPath: string): City[] {
  let path = join(resolve(assetsPath), 'cities.json.gz')
  let compressed = true
  let stat
  try {
    stat = statSync(path, { bigint: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    path = join(resolve(assetsPath), 'cities.json')
    compressed = false
    stat = statSync(path, { bigint: true })
  }
  // ctime and inode also catch same-size replacements that preserve the old mtime.
  const signature = `${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}:${stat.ino}`
  const previous = cache.get(path)
  if (previous?.signature === signature) return previous.cities
  const bytes = readFileSync(path)
  const cities = decodeCities(
    JSON.parse((compressed ? gunzipSync(bytes) : bytes).toString('utf8')),
    !compressed
  )
  cache.set(path, { signature, cities })
  return cities
}
