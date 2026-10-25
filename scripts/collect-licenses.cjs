const fs = require('node:fs')
const path = require('node:path')
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))
const destination = 'resources/licenses'
fs.mkdirSync(destination, { recursive: true })
const index = []
for (const [directory, record] of Object.entries(lock.packages)) {
  if (!directory || !fs.existsSync(directory)) continue
  const files = fs
    .readdirSync(directory)
    .filter(
      (name) =>
        /^(license|licence|copying|notice|ofl)(\b|[-_.])/i.test(name) &&
        fs.statSync(path.join(directory, name)).isFile()
    )
  if (!files.length) continue
  const key = directory.replace(/^node_modules\//, '').replaceAll('/', '__')
  fs.mkdirSync(path.join(destination, key), { recursive: true })
  for (const file of files) fs.copyFileSync(path.join(directory, file), path.join(destination, key, file))
  index.push({
    package: directory.replace(/^node_modules\//, ''),
    version: record.version,
    license: record.license || 'see included text',
    files
  })
}
fs.writeFileSync(path.join(destination, 'index.json'), JSON.stringify(index, null, 2) + '\n')
console.log(`Collected license text for ${index.length} dependencies`)
