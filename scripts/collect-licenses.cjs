const fs = require('node:fs')
const path = require('node:path')

// These development dependencies ship inside renderer JS/CSS/font bundles.
const rendererEntries = [
  '@fontsource/noto-serif-sc',
  'd3-geo',
  'topojson-client',
  'lucide-react',
  'react',
  'react-dom',
  'react-markdown',
  'remark-gfm'
]

function supportsTarget(values, target) {
  if (!values?.length) return true
  const allowed = values.filter((value) => !value.startsWith('!'))
  return !values.includes(`!${target}`) && (!allowed.length || allowed.includes(target))
}

function resolveDependency(packages, importer, name) {
  let directory = importer
  for (;;) {
    if (path.posix.basename(directory) !== 'node_modules') {
      const candidate = directory ? `${directory}/node_modules/${name}` : `node_modules/${name}`
      if (packages[candidate]) return candidate
    }
    if (!directory) return undefined
    const parent = path.posix.dirname(directory)
    directory = parent === '.' ? '' : parent
  }
}

function selectDistributionPackages(lock, manifest, { platform = 'win32', arch = 'x64' } = {}) {
  const packages = lock.packages
  if (!packages) throw new Error('A package-lock.json with a packages map is required')
  const selected = new Map()
  function visit(importer, name, optional = false) {
    const directory = resolveDependency(packages, importer, name)
    if (!directory) {
      if (optional) return
      throw new Error(`Missing dependency ${name} required by ${importer || 'application'}`)
    }
    const record = packages[directory]
    if (!supportsTarget(record.os, platform) || !supportsTarget(record.cpu, arch)) {
      if (optional) return
      throw new Error(`Dependency ${name} does not support ${platform}-${arch}`)
    }
    if (selected.has(directory)) return
    selected.set(directory, record)
    const optionalDependencies = record.optionalDependencies || {}
    for (const dependency of Object.keys({ ...record.dependencies, ...optionalDependencies })) {
      visit(directory, dependency, Object.hasOwn(optionalDependencies, dependency))
    }
  }
  const optionalDependencies = manifest.optionalDependencies || {}
  for (const name of Object.keys({ ...manifest.dependencies, ...optionalDependencies })) {
    visit('', name, Object.hasOwn(optionalDependencies, name))
  }
  for (const name of rendererEntries) visit('', name)
  return [...selected].sort(([a], [b]) => a.localeCompare(b))
}

function generatedDirectory(destination, packageName) {
  // Only package paths written by this collector can name directories for cleanup.
  const name = '(?:@[a-zA-Z0-9_.-]+/)?[a-zA-Z0-9_.-]+'
  if (
    typeof packageName !== 'string' ||
    !new RegExp(`^${name}(?:/node_modules/${name})*$`).test(packageName) ||
    packageName.split('/').some((segment) => segment === '.' || segment === '..')
  )
    throw new Error(`Invalid generated license package: ${packageName}`)
  const target = path.resolve(destination, packageName.replaceAll('/', '__'))
  if (path.dirname(target) !== destination) throw new Error(`Unsafe license cleanup target: ${target}`)
  if (fs.existsSync(target) && fs.realpathSync(target) !== target) {
    throw new Error(`Refusing linked license directory: ${target}`)
  }
  return target
}

function collectLicenses(root = process.cwd()) {
  const workspace = fs.realpathSync(root)
  const lock = JSON.parse(fs.readFileSync(path.join(workspace, 'package-lock.json'), 'utf8'))
  const manifest = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8'))
  const selected = selectDistributionPackages(lock, manifest)
  const destination = path.resolve(workspace, 'resources', 'licenses')
  fs.mkdirSync(destination, { recursive: true })
  if (fs.realpathSync(destination) !== destination) {
    throw new Error(`License destination must be inside the workspace: ${destination}`)
  }
  const indexPath = path.join(destination, 'index.json')
  const previous = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : []
  // Validate every target before any deletion; preserve data/font/project notices and manual files.
  const cleanup = previous.map((entry) => generatedDirectory(destination, entry.package))
  const index = []
  const copies = []
  for (const [directory, record] of selected) {
    const source = path.join(workspace, directory)
    const files = fs
      .readdirSync(source)
      .filter(
        (name) =>
          /^(license|licence|copying|notice|ofl)(\b|[-_.])/i.test(name) &&
          fs.statSync(path.join(source, name)).isFile()
      )
    if (!files.length) continue
    const packageName = directory.replace(/^node_modules\//, '')
    const target = generatedDirectory(destination, packageName)
    copies.push({ source, target, files })
    index.push({
      package: packageName,
      version: record.version,
      license: record.license || 'see included text',
      files
    })
  }
  for (const target of cleanup) fs.rmSync(target, { recursive: true, force: true })
  for (const { source, target, files } of copies) {
    fs.mkdirSync(target, { recursive: true })
    for (const file of files) fs.copyFileSync(path.join(source, file), path.join(target, file))
  }
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n')
  return index
}

if (require.main === module) {
  if (process.argv.includes('--dry-run')) {
    const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))
    const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    console.log(
      JSON.stringify(
        selectDistributionPackages(lock, manifest).map(([directory, record]) => ({
          directory,
          version: record.version,
          license: record.license || 'see included text'
        })),
        null,
        2
      )
    )
  } else {
    console.log(`Collected license text for ${collectLicenses().length} distributed dependencies`)
  }
}

module.exports = { selectDistributionPackages, collectLicenses }
