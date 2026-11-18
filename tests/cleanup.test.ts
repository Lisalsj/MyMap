import { afterEach, expect, it } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  realpathSync,
  symlinkSync,
  readdirSync,
  lstatSync,
  unlinkSync,
  rmdirSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const cleanup = require('../scripts/lib/cleanup.cjs')
const local = require('../scripts/lib/local-release.cjs')
const cli = require('../scripts/local-release.cjs')
const roots: string[] = []
const hash = (value: string, algorithm = 'sha256', encoding: 'hex' | 'base64' = 'hex') =>
  createHash(algorithm).update(value).digest(encoding)
function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'mymap-cleanup-中文 空格-'))
  roots.push(root)
  const put = (name: string, data = 'generated') => {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), data)
  }
  put(
    'package.json',
    JSON.stringify({
      name: 'mymap-travel-journal',
      version: '0.6.0',
      build: {
        publish: { provider: 'github', owner: 'Lisalsj', repo: 'MyMap' },
        directories: { output: 'release' }
      }
    })
  )
  put('package-lock.json', JSON.stringify({ version: '0.6.0', packages: { '': { version: '0.6.0' } } }))
  const current = local.config(root)
  put('release/' + current.names[0], 'setup')
  put('release/' + current.names[1], 'portable')
  put(
    'release/latest.yml',
    require('js-yaml').dump({
      version: '0.6.0',
      path: current.names[0],
      sha512: hash('setup', 'sha512', 'base64'),
      files: [{ url: current.names[0], size: 5, sha512: hash('setup', 'sha512', 'base64') }]
    })
  )
  put(
    'release/SHA256SUMS.txt',
    `${hash('setup')}  ${current.names[0]}\n${hash('portable')}  ${current.names[1]}\n`
  )
  put('out/main/index.js')
  put('release/MyMap-0.5.0-Setup-x64.exe')
  put('release/win-unpacked/MyMap.exe')
  put('test-results/update-lifecycle-Ab1234/Library/library.sqlite')
  put('test-results/build-tools/nsis/makensis.exe', 'keep')
  put('node_modules/runtime/file', 'keep')
  put('Library/user.sqlite', 'personal')
  return { root, put, plan: () => cleanup.createPlan(root, { tracked: [], active: [] }) }
}
const apply = (plan: any, extra = {}) => cleanup.applyPlan(plan, { tracked: [], active: () => [], ...extra })
afterEach(() => {
  for (const root of roots.splice(0)) {
    const actual = realpathSync(root)
    if (dirname(actual) !== realpathSync(tmpdir()) || !basename(actual).startsWith('mymap-cleanup-'))
      throw Error('Unexpected cleanup test path')
    const remove = (file: string) => {
      const stat = lstatSync(file)
      if (stat.isSymbolicLink()) {
        unlinkSync(file)
        return
      }
      if (stat.isDirectory()) {
        for (const child of readdirSync(file)) remove(join(file, child))
        rmdirSync(file)
      } else unlinkSync(file)
    }
    remove(actual)
  }
})

it('previews without writing, then deletes only known generated files and preserves the current release', async () => {
  const f = fixture()
  f.put('test-results/unknown-research/notes.txt', 'keep')
  f.put('release/personal-photo.jpg', 'keep')
  f.put('test-results/pastel-refresh/review.md', 'all open visual findings')
  f.put('test-results/pastel-refresh/baseline/app.exe')
  f.put('test-results/reports/navigation-baseline.json')
  const before = await local.artifacts(f.root, local.config(f.root))
  const plan = f.plan()
  expect(existsSync(join(f.root, 'test-results/.cleanup.lock'))).toBe(false)
  expect(existsSync(join(f.root, 'test-results/reports/design-review.md'))).toBe(false)
  expect(existsSync(join(f.root, 'out/main/index.js'))).toBe(true)
  const result = await apply(plan)
  expect(result.status).toBe('passed')
  expect(result.freedBytes).toBe(plan.estimatedBytes)
  expect(await local.artifacts(f.root, local.config(f.root))).toEqual(before)
  for (const file of [
    'test-results/build-tools/nsis/makensis.exe',
    'node_modules/runtime/file',
    'Library/user.sqlite',
    'test-results/unknown-research/notes.txt',
    'release/personal-photo.jpg'
  ])
    expect(existsSync(join(f.root, file))).toBe(true)
  for (const file of [
    'out',
    'release/win-unpacked',
    'release/MyMap-0.5.0-Setup-x64.exe',
    'test-results/pastel-refresh',
    'test-results/update-lifecycle-Ab1234',
    'test-results/reports/navigation-baseline.json'
  ])
    expect(existsSync(join(f.root, file)), file).toBe(false)
  expect(readFileSync(join(f.root, 'test-results/reports/design-review.md'), 'utf8')).toBe(
    'all open visual findings'
  )
  expect(f.plan().candidates).toHaveLength(0)
  expect((await apply(f.plan())).freedBytes).toBe(0)
})

it('refuses a forged target, path traversal, the wrong workspace, or tracked output', async () => {
  const f = fixture(),
    plan = f.plan()
  expect(() => cleanup.inspect(f.root, '../Library')).toThrow('越界')
  expect(() => cleanup.inspect(f.root, 'C:/Library')).toThrow('越界')
  plan.candidates.push(cleanup.inspect(f.root, 'Library'))
  await expect(apply(plan)).rejects.toThrow('内容发生变化')
  expect(existsSync(join(f.root, 'Library/user.sqlite'))).toBe(true)
  const tracked = cleanup.createPlan(f.root, { tracked: ['out/main/index.js'], active: [] })
  expect(tracked.candidates.some((entry: any) => entry.path === 'out')).toBe(false)
  f.put('package.json', '{}')
  expect(() => f.plan()).toThrow('MyMap')
})

it('rejects changed files or damaged current release files before deleting anything', async () => {
  const f = fixture(),
    plan = f.plan()
  f.put('out/new.js')
  await expect(apply(plan)).rejects.toThrow('内容发生变化')
  const changed = f.plan()
  f.put('release/MyMap-0.6.0-Setup-x64.exe', 'corrupt')
  await expect(apply(changed)).rejects.toThrow('SHA-512')
  expect(existsSync(join(f.root, 'out'))).toBe(true)
})

it('keeps all release files when the current version is incomplete, while cleaning unrelated build output', async () => {
  const f = fixture()
  unlinkSync(join(f.root, 'release/latest.yml'))
  const plan = f.plan()
  expect(plan.candidates.some((entry: any) => entry.path.startsWith('release/'))).toBe(false)
  expect(plan.skipped.some((entry: any) => entry.path === 'release')).toBe(true)
  await apply(plan)
  expect(existsSync(join(f.root, 'release/MyMap-0.5.0-Setup-x64.exe'))).toBe(true)
  expect(existsSync(join(f.root, 'release/MyMap-0.6.0-Setup-x64.exe'))).toBe(true)
  expect(existsSync(join(f.root, 'out'))).toBe(false)
})

it('skips an output tree containing a junction rather than following it', () => {
  const f = fixture(),
    outside = fixture()
  symlinkSync(outside.root, join(f.root, 'out/external'), 'junction')
  const plan = f.plan()
  expect(plan.candidates.some((entry: any) => entry.path === 'out')).toBe(false)
  expect(plan.skipped.some((entry: any) => entry.path === 'out' && entry.reason.includes('链接'))).toBe(true)
  expect(() => cleanup.inspect(f.root, 'out/external/Library')).toThrow('链接')
  expect(existsSync(join(outside.root, 'Library/user.sqlite'))).toBe(true)
})

it('blocks publication, active fixtures and competing cleanup, without killing processes', async () => {
  const f = fixture()
  f.put('test-results/.local-release.lock')
  const plan = f.plan()
  expect(plan.blocked.join()).toContain('.local-release.lock')
  await expect(apply(plan)).rejects.toThrow('活动锁')
  unlinkSync(join(f.root, 'test-results/.local-release.lock'))
  const active = [{ Name: 'MyMap.exe', ProcessId: 123 }]
  expect(cleanup.createPlan(f.root, { tracked: [], active }).blocked.join()).toContain('123')
  await expect(apply(f.plan(), { active: () => active })).rejects.toThrow('活动进程')
  const unlock = cleanup.acquireLock(f.root, '.cleanup.lock')
  try {
    expect(() => cli.lock(f.root)).toThrow('清理正在运行')
    expect(() => cleanup.acquireLock(f.root, '.update-lifecycle.lock', ['.cleanup.lock'])).toThrow('正在运行')
  } finally {
    unlock()
  }
  expect(existsSync(join(f.root, 'out'))).toBe(true)
})

it('preserves conflicting evidence rather than overwriting it', async () => {
  const f = fixture()
  f.put('test-results/pastel-refresh/review.md', 'source')
  f.put('test-results/reports/design-review.md', 'existing')
  await expect(apply(f.plan())).rejects.toThrow('已有不同内容')
  expect(readFileSync(join(f.root, 'test-results/reports/design-review.md'), 'utf8')).toBe('existing')
})

it('rejects a junction introduced after preview before removing any generated tree', async () => {
  const f = fixture(),
    outside = fixture(),
    plan = f.plan()
  symlinkSync(outside.root, join(f.root, 'out/changed-link'), 'junction')
  await expect(apply(plan)).rejects.toThrow('内容发生变化')
  expect(existsSync(join(f.root, 'out/main/index.js'))).toBe(true)
  expect(existsSync(join(outside.root, 'Library/user.sqlite'))).toBe(true)
})

it('reclaims only successful restored upgrade fixtures, retaining failures, reuse and diagnostic opt-ins', () => {
  const f = fixture(),
    directory = join(f.root, 'test-results/update-lifecycle-Ab1234')
  for (const options of [
    { passed: false, restored: true },
    { passed: true, restored: false },
    { passed: true, restored: true, keep: true }
  ]) {
    expect(cleanup.finishUpdateFixture(f.root, directory, options)).toBe(false)
    expect(existsSync(directory)).toBe(true)
  }
  expect(() =>
    cleanup.finishUpdateFixture(f.root, join(f.root, 'Library'), { passed: true, restored: true })
  ).toThrow('越界')
  expect(cleanup.finishUpdateFixture(f.root, directory, { passed: true, restored: true })).toBe(true)
  expect(existsSync(directory)).toBe(false)
  expect(readdirSync(join(f.root, 'test-results'))).toContain('build-tools')
})
