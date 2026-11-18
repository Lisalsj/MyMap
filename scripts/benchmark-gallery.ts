import { createHash, randomUUID } from 'node:crypto'
import {
  constants,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { cpus, release, tmpdir, totalmem } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import sharp from 'sharp'
import type { LibraryService } from '../src/backend/library'

// Run from the project root. A comparison build has out/main and src/backend at its root.
const [action, resultsArg, label = 'current', buildArg = '.', roundsArg = '3'] = process.argv.slice(2)
const usage =
  'tsx scripts/benchmark-gallery.ts prepare|import|ui|capture|finish <results-directory> [label] [build-root] [rounds=3]'
const rounds = Number(roundsArg)
const temp = realpathSync(tmpdir())
const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
const output = (file: string, data: unknown) => writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
const roundMs = (n: number) => Number(n.toFixed(2))
const values = (n: number) => Array.from({ length: n }, (_, i) => i)
const requireModule = createRequire(import.meta.url)

function temporary(prefix: string) {
  return mkdtempSync(join(temp, prefix))
}
function removeTemporary(root: string, prefix: string) {
  if (realpathSync(root) !== root || dirname(root) !== temp || !basename(root).startsWith(prefix))
    throw Error('Unexpected gallery benchmark temporary directory')
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
function loadService(build: string): typeof LibraryService {
  return requireModule(join(build, 'src/backend/library.ts')).LibraryService
}
function texture(width: number, height: number, variant: number) {
  const bytes = Buffer.alloc(width * height * 3)
  let state = (variant + 1) * 1234567
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 3
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      const noise = (state >>> 27) - 16
      bytes[at] = (variant * 7 + x / 4 + y / 7 + noise) & 255
      bytes[at + 1] = (variant * 13 + y / 3 + noise) & 255
      bytes[at + 2] = (variant * 19 + x / 5 + 40 * Math.sin(y / 32) + noise) & 255
    }
  }
  return bytes
}

async function prepare(results: string, build: string) {
  const manifest = join(results, 'fixture.json')
  if (existsSync(manifest)) throw Error('This result directory already has a fixture')
  const root = temporary('mymap-gallery-fixture-')
  try {
    const fixtureId = randomUUID()
    output(join(root, '.gallery-benchmark.json'), { fixtureId, results })
    const camera = join(root, 'camera')
    const tiny = join(root, 'tiny')
    mkdirSync(camera)
    mkdirSync(tiny)
    const hashes = createHash('sha256')
    for (const i of values(300)) {
      const source = join(camera, `${i}.jpg`)
      await sharp(texture(320, 240, i), { raw: { width: 320, height: 240, channels: 3 } })
        .resize(4000, 3000)
        .jpeg({ quality: 88, chromaSubsampling: '4:2:0' })
        .toFile(source)
      hashes.update(digest(source))
    }
    console.log('Prepared 300 distinct 4000×3000 JPEG inputs')
    const paths: string[] = []
    for (const i of values(5000)) {
      const source = join(tiny, `${i}.png`)
      const image = texture(32, 24, i)
      image.writeUInt32LE(i, 0)
      await sharp(image, { raw: { width: 32, height: 24, channels: 3 } })
        .png()
        .toFile(source)
      paths.push(source)
    }
    const Service = loadService(build)
    const libraryPath = join(root, 'Library')
    const service = new Service(libraryPath)
    try {
      const trip = service.saveTrip({ title: '合成图库 · 五千张照片' })
      let milestone = 0
      const progress = await service.importPhotos(paths, trip.id, {}, (p) => {
        if (p.completed >= milestone + 1000) {
          milestone = p.completed
          console.log(`Prepared ${milestone}/5000 gallery photos`)
        }
      })
      if (progress.imported !== paths.length || progress.errors.length)
        throw Error('Incomplete gallery fixture')
    } finally {
      service.close()
    }
    const db = new DatabaseSync(join(libraryPath, 'library.sqlite'))
    try {
      db.exec("UPDATE attachments SET caption = printf('合成照片 %04d · 路线 %02d',sortOrder,sortOrder % 20)")
    } finally {
      db.close()
    }
    copyFileSync(join(libraryPath, 'library.sqlite'), join(root, 'seed.sqlite'), constants.COPYFILE_EXCL)
    output(manifest, {
      root,
      fixtureId,
      cameraSha256: hashes.digest('hex'),
      databaseSha256: digest(join(libraryPath, 'library.sqlite')),
      camera:
        '300 unique textured 4000×3000 JPEGs, quality 88, no EXIF; synthetic, not a field camera sample',
      gallery:
        '5000 distinct imported 32×24 PNGs, one trip, unique searchable captions, real on-disk derivatives'
    })
  } catch (error) {
    removeTemporary(root, 'mymap-gallery-fixture-')
    throw error
  }
}

async function main() {
  if (action === '--help') return console.log(usage)
  if (
    !['prepare', 'ui', 'import', 'capture', 'finish'].includes(action) ||
    !resultsArg ||
    !/^[\w-]+$/.test(label) ||
    !Number.isInteger(rounds) ||
    rounds < 1 ||
    rounds > 10
  )
    throw Error(usage)
  const results = resolve(resultsArg)
  if (dirname(results) !== resolve('test-results'))
    throw Error('Use a dedicated directory directly under test-results')
  mkdirSync(results, { recursive: true })
  const build = realpathSync(resolve(buildArg))
  if (action === 'prepare') return prepare(results, build)
  const manifest = join(results, 'fixture.json')
  const fixture = JSON.parse(readFileSync(manifest, 'utf8'))
  if (action === 'finish' && fixture.releasedAt && !existsSync(fixture.root)) return
  if (
    realpathSync(fixture.root) !== fixture.root ||
    dirname(fixture.root) !== temp ||
    !basename(fixture.root).startsWith('mymap-gallery-fixture-')
  )
    throw Error('Unexpected fixture path')
  if (action === 'capture') {
    const library = join(fixture.root, 'Visual')
    if (!existsSync(join(library, 'library.sqlite'))) {
      const Service = loadService(build)
      const service = new Service(library, { isDemo: true, assetsPath: resolve('resources') })
      try {
        await service.seedDemo()
      } finally {
        service.close()
      }
    }
    const { captureGallery } = await import('./benchmark-gallery-capture.cjs')
    const report = await captureGallery(build, library, results, label)
    output(join(results, label + '-visual.json'), report)
    console.log('Captured', report.captures.length, 'gallery states for', label)
    return
  }
  if (action === 'finish') {
    const marker = JSON.parse(readFileSync(join(fixture.root, '.gallery-benchmark.json'), 'utf8'))
    if (
      !marker.fixtureId ||
      marker.fixtureId !== fixture.fixtureId ||
      marker.results !== results ||
      existsSync(join(fixture.root, 'Library/.mymap.lock')) ||
      existsSync(join(fixture.root, 'Visual/.mymap.lock'))
    )
      throw Error('Fixture ownership mismatch or active library')
    removeTemporary(fixture.root, 'mymap-gallery-fixture-')
    output(manifest, { ...fixture, releasedAt: new Date().toISOString() })
    return
  }
  const samples = []
  const report = {
    label,
    action,
    build,
    measuredAt: new Date().toISOString(),
    fixture,
    environment: {
      cpu: cpus()[0].model,
      logicalCpus: cpus().length,
      ramGiB: roundMs(totalmem() / 2 ** 30),
      platform: process.platform,
      release: release(),
      arch: process.arch,
      node: process.version,
      sharp: sharp.versions
    },
    buildHashes: {
      main: digest(join(build, 'out/main/index.js')),
      worker: digest(join(build, 'out/main/worker.js')),
      library: digest(join(build, 'src/backend/library.ts')),
      media: digest(join(build, 'src/backend/media.ts'))
    },
    method:
      action === 'import'
        ? 'Fresh Electron, empty library, identical original bytes. File chooser returns fixture paths. Time spans import IPC through commit. Process working sets sampled every 200 ms; Chromium OS caches uncontrolled.'
        : 'Fresh Electron process and profile, identical 5000-photo DB restored per pass. Fixed 1440×900 content viewport, 100% zoom, GPU disabled; observed RAF cadence and visibility recorded. 20 actions per metric. Times from DOM input/click to animation frame with every visible tile image loaded. Searches include filtered first-row and viewport media. IPC counts observed in real main/utility processes. Diagnostic GC after all timings.',
    samples
  }
  const reportFile = join(results, `${label}-${action}.json`)
  const { benchmarkCamera, benchmarkGalleryUi } = await import('./benchmark-gallery-ui.cjs')
  for (const i of values(rounds)) {
    const sample =
      action === 'import'
        ? await benchmarkCamera(build, fixture.root)
        : await benchmarkGalleryUi(build, fixture.root)
    samples.push(sample)
    output(reportFile, report)
    console.log(`${label} ${action} round ${i + 1}:`, JSON.stringify(sample))
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
