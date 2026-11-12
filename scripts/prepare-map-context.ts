// Rebuild the lightweight China-view context from the bundled public Natural Earth snapshot.
import { readFileSync, writeFileSync } from 'node:fs'
import { topology } from 'topojson-server'
import { feature, quantize } from 'topojson-client'
import { simplifyTopology } from '../src/renderer/map/simplify'
import { mapProjection } from '../src/renderer/map/projection'

const land = JSON.parse(readFileSync('src/renderer/assets/world-land.json', 'utf8'))
const source = topology({ land })
const compact = quantize(simplifyTopology(source, mapProjection(false), 0.6), 1000000)
writeFileSync(
  'src/renderer/assets/world-context.json',
  JSON.stringify(feature(compact, compact.objects.land), (_key, value) =>
    typeof value === 'number' ? Math.round(value * 10000) / 10000 : value
  ) + '\n'
)
const cities = JSON.parse(readFileSync('src/renderer/assets/china-cities.topo.json', 'utf8'))
for (const [name, tolerance] of [
  ['overview', 0.22],
  ['regional', 0.075]
] as const) {
  const result = quantize(simplifyTopology(cities, mapProjection(false), tolerance), 1000000)
  writeFileSync(`src/renderer/assets/china-${name}.topo.json`, JSON.stringify(result) + '\n')
}
