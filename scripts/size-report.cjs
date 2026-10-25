const fs = require('node:fs')
const path = require('node:path')
function bytes(target) {
  if (!fs.existsSync(target)) return 0
  const stat = fs.statSync(target)
  return stat.isDirectory()
    ? fs.readdirSync(target).reduce((sum, name) => sum + bytes(path.join(target, name)), 0)
    : stat.size
}
function report(root = 'release/win-unpacked', version = require('../package.json').version) {
  const resources = path.join(root, 'resources')
  const totalBytes = bytes(root)
  return {
    version,
    totalBytes,
    engineBytes: totalBytes - bytes(resources),
    localeBytes: bytes(path.join(root, 'locales')),
    asarBytes: bytes(path.join(resources, 'app.asar')),
    nativeBytes: bytes(path.join(resources, 'app.asar.unpacked')),
    dataBytes: bytes(path.join(resources, 'data')),
    licensesBytes: bytes(path.join(resources, 'data/licenses')),
    citiesBytes:
      bytes(path.join(resources, 'data/cities.json')) + bytes(path.join(resources, 'data/cities.json.gz')),
    artifacts: Object.fromEntries(
      ['Setup', 'Portable'].map((kind) => [`${kind}Bytes`, bytes(`release/MyMap-${version}-${kind}-x64.exe`)])
    )
  }
}
if (require.main === module) {
  const version = process.argv[2] || require('../package.json').version
  const result = report('release/win-unpacked', version)
  fs.mkdirSync('docs/reports', { recursive: true })
  fs.writeFileSync(`docs/reports/size-v${version}.json`, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
}
module.exports = { bytes, report }
