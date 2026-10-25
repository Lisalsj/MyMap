import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const collector = resolve('scripts/collect-licenses.cjs')
const roots: string[] = []
const rendererEntries = [
  '@fontsource-variable/manrope',
  '@fontsource/noto-sans-sc',
  'd3-geo',
  'topojson-client',
  '@phosphor-icons/react',
  'react',
  'react-dom',
  'react-markdown',
  'remark-gfm'
]

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.length = 0
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mymap-licenses-'))
  roots.push(root)
  const manifest = {
    dependencies: { sharp: '1', exifr: '1' },
    devDependencies: Object.fromEntries(
      [...rendererEntries, 'vitest', 'typescript', 'electron-builder', '@playwright/test'].map((name) => [
        name,
        '1'
      ])
    )
  }
  const packages: Record<string, object> = { '': manifest }
  function add(name: string, details: object = {}) {
    const directory = `node_modules/${name}`
    const record = { version: '1.0.0', license: 'MIT', ...details }
    packages[directory] = record
    mkdirSync(join(root, directory), { recursive: true })
    writeFileSync(join(root, directory, 'package.json'), JSON.stringify(record))
    writeFileSync(join(root, directory, 'LICENSE'), `License for ${name}`)
  }
  for (const name of Object.keys(manifest.devDependencies)) add(name, { dev: true })
  add('exifr')
  add('sharp', {
    dependencies: { '@img/colour': '1', 'detect-libc': '1', semver: '1' },
    optionalDependencies: {
      '@img/sharp-win32-x64': '1',
      '@img/sharp-linux-x64': '1',
      '@img/sharp-win32-arm64': '1'
    }
  })
  add('@img/colour')
  add('detect-libc')
  add('semver')
  add('@img/sharp-win32-x64', { os: ['win32'], cpu: ['x64'], optional: true })
  add('@img/sharp-linux-x64', { os: ['linux'], cpu: ['x64'], optional: true })
  add('@img/sharp-win32-arm64', { os: ['win32'], cpu: ['arm64'], optional: true })
  add('react-dom', { dev: true, dependencies: { scheduler: '1' } })
  add('scheduler', { dev: true })
  add('d3-geo', { dev: true, dependencies: { 'd3-array': '1' } })
  add('d3-array', { dev: true, dependencies: { internmap: '1' } })
  add('internmap', { dev: true })
  add('react-markdown', { dev: true, dependencies: { unified: '1' } })
  add('unified', { dev: true, dependencies: { 'shared-version': '1' } })
  add('shared-version', { dev: true })
  add('react-markdown/node_modules/unified', {
    dev: true,
    dependencies: { 'shared-version': '2' }
  })
  add('react-markdown/node_modules/shared-version', { dev: true, version: '2.0.0' })
  mkdirSync(join(root, 'resources/licenses'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ packages }))
  return { root, manifest }
}

function collect(root: string) {
  execFileSync(process.execPath, [collector], { cwd: root })
  return JSON.parse(readFileSync(join(root, 'resources/licenses/index.json'), 'utf8')) as {
    package: string
    version: string
    license: string
    files: string[]
  }[]
}

describe('distributed dependency licenses', () => {
  it('keeps bundled renderer and native runtime licenses while excluding build tools and foreign binaries', () => {
    const { root } = fixture()
    const names = collect(root).map((entry) => entry.package)
    for (const name of [
      ...rendererEntries,
      'exifr',
      'sharp',
      '@img/colour',
      'detect-libc',
      'semver',
      '@img/sharp-win32-x64',
      'scheduler',
      'd3-array',
      'internmap'
    ])
      expect(names).toContain(name)
    for (const name of [
      'vitest',
      'typescript',
      'electron-builder',
      '@playwright/test',
      '@img/sharp-linux-x64',
      '@img/sharp-win32-arm64'
    ])
      expect(names).not.toContain(name)
    expect(readFileSync(join(root, 'resources/licenses/@fontsource__noto-sans-sc/LICENSE'), 'utf8')).toBe(
      'License for @fontsource/noto-sans-sc'
    )
  })

  it('follows the resolved nested dependency rather than an unrelated hoisted version', () => {
    const { root } = fixture()
    const entries = collect(root)
    expect(
      entries.find((entry) => entry.package === 'react-markdown/node_modules/shared-version')
    ).toMatchObject({ version: '2.0.0', files: ['LICENSE'] })
    expect(entries.some((entry) => entry.package === 'unified')).toBe(false)
    expect(entries.some((entry) => entry.package === 'shared-version')).toBe(false)
  })

  it('removes only previously indexed generated package directories during regeneration', () => {
    const { root, manifest } = fixture()
    collect(root)
    writeFileSync(join(root, 'resources/licenses/DATA-LICENSE.txt'), 'Keep data attribution')
    mkdirSync(join(root, 'resources/licenses/handwritten'))
    writeFileSync(join(root, 'resources/licenses/handwritten/NOTICE'), 'Keep manual attribution')
    delete (manifest.dependencies as Partial<typeof manifest.dependencies>).exifr
    writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
    collect(root)
    expect(existsSync(join(root, 'resources/licenses/exifr'))).toBe(false)
    expect(readFileSync(join(root, 'resources/licenses/DATA-LICENSE.txt'), 'utf8')).toBe(
      'Keep data attribution'
    )
    expect(readFileSync(join(root, 'resources/licenses/handwritten/NOTICE'), 'utf8')).toBe(
      'Keep manual attribution'
    )
  })

  it('rejects a previous index that attempts to delete outside its generated package directory', () => {
    const { root } = fixture()
    const preserved = join(root, 'preserved')
    mkdirSync(preserved)
    writeFileSync(join(preserved, 'NOTICE'), 'Keep this')
    writeFileSync(
      join(root, 'resources/licenses/index.json'),
      JSON.stringify([{ package: '../../../preserved' }])
    )
    const result = spawnSync(process.execPath, [collector], { cwd: root, encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(readFileSync(join(preserved, 'NOTICE'), 'utf8')).toBe('Keep this')
  })
})
