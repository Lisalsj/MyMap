const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { artifacts, config } = require('./local-release.cjs')

const testDirectories = new Set([
  'design-refresh',
  'e2e',
  'map-reuse',
  'map-worker-smoke',
  'navigation-baseline-app',
  'navigation-fixture',
  'packaged',
  'pastel-refresh',
  'public-update-check',
  'screenshots',
  'source',
  'startup-e2e'
])
const testFiles = new Set([
  '.last-run.json',
  'debug-update-cancel.cjs',
  'local-release-dry-run.txt',
  'local-release-resume-dry-run.txt',
  'public-latest.yml',
  'public-update-smoke.cjs',
  'release-create.json',
  'release-draft.json',
  'release-existing.json',
  'release-notes.md',
  'release-publish.json',
  'release-published.json',
  'release-uploaded.json',
  'remote-SHA256SUMS.txt',
  'tagged-package.json',
  'upload-release.cjs',
  'verify-local-release-deployment.cjs',
  'verify-public-assets.cjs'
])
const oldReports = new Set([
  'cleanup-e2e.log',
  'cleanup-update.log',
  'design-qa.json',
  'local-release-deployment.json',
  'local-release-existing-release.json',
  'map-focus.json',
  'map-performance.json',
  'navigation-baseline-prepared.json',
  'navigation-baseline.json',
  'navigation-before-demo-optimization.json',
  'navigation-prepared-stress.json',
  'navigation-prepared.json',
  'navigation.json',
  'performance.json',
  'public-update-source.json',
  'size.json'
])
const retainedReports = new Set([
  'local-release.json',
  'update-lifecycle.json',
  'portable-smoke.json',
  'installed-smoke.json',
  'design-qa-forest.json',
  'design-qa-sky-rose.json',
  'cleanup.json',
  'cleanup-baseline.json',
  'cleanup-validation.json',
  'design-review.md',
  'design-gate.json',
  'design-waivers.json',
  'search-performance.json',
  'navigation-comparison.json',
  'public-update.json',
  'release-deployment.json',
  'release-notes.md'
])
const evidence = [
  ['review.md', 'design-review.md'],
  ['.taste-skill/gate.json', 'design-gate.json'],
  ['.taste-skill/waivers.json', 'design-waivers.json'],
  ['search-performance.json', 'search-performance.json'],
  ['navigation-comparison.json', 'navigation-comparison.json'],
  ['public-update.json', 'public-update.json'],
  ['deployment.json', 'release-deployment.json'],
  ['release-notes.md', 'release-notes.md']
].map(([source, destination]) => ({
  source: `test-results/pastel-refresh/${source}`,
  destination: `test-results/reports/${destination}`
}))

function workspace(root) {
  const absolute = path.resolve(root)
  if (fs.lstatSync(absolute).isSymbolicLink() || fs.realpathSync(absolute) !== absolute)
    throw Error('清理工作区不能是链接或重定向路径。')
  const pkg = JSON.parse(fs.readFileSync(path.join(absolute, 'package.json'), 'utf8'))
  if (pkg.name !== 'mymap-travel-journal' || pkg.build?.directories?.output !== 'release')
    throw Error('清理仅适用于 MyMap 项目根目录。')
  return absolute
}

/** Verify every ancestor and descendant before a recursive removal; never follow links. */
function inspect(root, relative) {
  const parts = relative.split('/')
  if (
    path.isAbsolute(relative) ||
    relative.includes('\\') ||
    relative.includes(':') ||
    parts.some((part) => !part || part === '.' || part === '..')
  )
    throw Error('清理路径越界。')
  let target = root
  for (const part of parts) {
    target = path.join(target, part)
    if (!fs.existsSync(target) && !fs.lstatSync(target, { throwIfNoEntry: false })) return null
    if (fs.lstatSync(target).isSymbolicLink()) throw Error(`清理路径包含链接：${relative}`)
    if (fs.realpathSync(target) !== target) throw Error(`清理路径发生重定向：${relative}`)
  }
  const entries = []
  let bytes = 0,
    files = 0
  function walk(file, name) {
    const stat = fs.lstatSync(file)
    if (stat.isSymbolicLink()) throw Error(`目录包含链接，保留整个目录：${relative}`)
    if (!stat.isFile() && !stat.isDirectory()) throw Error(`目录包含非普通文件：${relative}`)
    entries.push([name, stat.dev, stat.ino, stat.size, stat.mtimeMs])
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(file).sort()) walk(path.join(file, child), `${name}/${child}`)
    } else {
      bytes += stat.size
      files++
    }
  }
  walk(target, relative)
  return { path: relative, bytes, files, fingerprint: JSON.stringify(entries) }
}

function removeTree(root, relative) {
  if (!inspect(root, relative)) return
  const target = path.join(root, relative)
  // Node's native rmSync can silently leave Unicode Windows paths behind.
  // unlink/rmdir also make each deletion observable and never traverse links.
  function remove(file) {
    const stat = fs.lstatSync(file)
    if (stat.isSymbolicLink()) throw Error('删除时发现链接，已停止。')
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(file)) remove(path.join(file, child))
      fs.rmdirSync(file)
    } else fs.unlinkSync(file)
  }
  remove(target)
  if (fs.existsSync(target)) throw Error(`删除未完成：${relative}`)
}

function processes(root) {
  if (process.platform !== 'win32') throw Error('进程检查需要 Windows。')
  const command = `@(Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne [int]$env:MYMAP_CLEAN_PID -and
    $_.Name -in @('node.exe','electron.exe','MyMap.exe','MyMapUpdateTest.exe','makensis.exe','7z.exe','7za.exe') -and
    (($_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:MYMAP_CLEAN_ROOT + '\\', [StringComparison]::OrdinalIgnoreCase)) -or
     ($_.CommandLine -and $_.CommandLine.IndexOf($env:MYMAP_CLEAN_ROOT + '\\', [StringComparison]::OrdinalIgnoreCase) -ge 0))
  } | Select-Object ProcessId,Name) | ConvertTo-Json -Compress`
  const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    env: { ...process.env, MYMAP_CLEAN_ROOT: root, MYMAP_CLEAN_PID: String(process.pid) }
  }).trim()
  const values = result ? JSON.parse(result) : []
  return Array.isArray(values) ? values : [values]
}

function blocked(root, active, ownLock = false) {
  const reasons = []
  for (const name of ['.local-release.lock', '.update-lifecycle.lock', ...(ownLock ? [] : ['.cleanup.lock'])])
    if (fs.existsSync(path.join(root, 'test-results', name))) reasons.push(`活动锁：${name}`)
  for (const item of active) reasons.push(`活动进程：${item.Name} (${item.ProcessId})`)
  return reasons
}

function createPlan(root, { tracked, active } = {}) {
  root = workspace(root)
  const current = config(root)
  tracked ??= execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true })
    .split('\0')
    .filter(Boolean)
  active ??= processes(root)
  const candidates = [],
    skipped = [],
    preserve = [
      ...current.names.map((name) => `release/${name}`),
      'node_modules',
      '.git',
      'resources',
      'test-results/build-tools'
    ]
  const blockedReasons = blocked(root, active)
  const completeRelease = current.names.every((name) => fs.existsSync(path.join(root, 'release', name)))
  if (fs.existsSync(path.join(root, 'release')) && !completeRelease)
    skipped.push({ path: 'release', reason: '当前发行文件不完整，保留整个发行目录' })
  function candidate(relative) {
    if (tracked.some((file) => file === relative || file.startsWith(relative + '/'))) {
      skipped.push({ path: relative, reason: '包含 Git 跟踪文件' })
      return
    }
    try {
      const entry = inspect(root, relative)
      if (entry) candidates.push(entry)
    } catch (error) {
      skipped.push({ path: relative, reason: error.message })
    }
  }
  function children(relative, choose) {
    try {
      const info = inspect(root, relative)
      if (!info) return
      for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
        const name = `${relative}/${entry.name}`
        const action = choose(entry)
        if (action === 'delete') candidate(name)
        else if (action === 'keep') preserve.push(name)
        else skipped.push({ path: name, reason: '未识别的内容，保留' })
      }
    } catch (error) {
      skipped.push({ path: relative, reason: error.message })
    }
  }
  for (const directory of ['out', '.superpowers', 'playwright-report']) candidate(directory)
  children('release', (entry) =>
    !completeRelease || current.names.includes(entry.name)
      ? 'keep'
      : (entry.isDirectory() && entry.name === 'win-unpacked') ||
          (entry.isFile() &&
            (/^MyMap-\d+\.\d+\.\d+-(Setup|Portable)-x64\.exe(?:\.blockmap)?$/.test(entry.name) ||
              entry.name === 'builder-debug.yml'))
        ? 'delete'
        : 'unknown'
  )
  children('test-results', (entry) =>
    ['build-tools', 'reports', '.cleanup.lock', '.local-release.lock', '.update-lifecycle.lock'].includes(
      entry.name
    )
      ? 'keep'
      : (entry.isDirectory() &&
            (testDirectories.has(entry.name) ||
              /^(update-lifecycle|cancel-probe)-[A-Za-z0-9]{6}$/.test(entry.name) ||
              /^import-lifecycle-[a-z0-9-]+$/.test(entry.name))) ||
          (entry.isFile() && testFiles.has(entry.name))
        ? 'delete'
        : 'unknown'
  )
  children('test-results/reports', (entry) =>
    retainedReports.has(entry.name)
      ? 'keep'
      : entry.isFile() && oldReports.has(entry.name)
        ? 'delete'
        : 'unknown'
  )
  const retainEvidence = []
  for (const item of evidence) {
    if (!candidates.some((entry) => item.source.startsWith(entry.path + '/'))) continue
    inspect(root, item.source)
    if (!fs.existsSync(path.join(root, item.source))) continue
    inspect(root, item.destination)
    if (
      fs.existsSync(path.join(root, item.destination)) &&
      !fs
        .readFileSync(path.join(root, item.source))
        .equals(fs.readFileSync(path.join(root, item.destination)))
    )
      blockedReasons.push(`验收摘要目标已有不同内容：${item.destination}`)
    retainEvidence.push(item)
  }
  return {
    root,
    current,
    candidates,
    preserve: [...new Set(preserve)],
    skipped,
    evidence: retainEvidence,
    blocked: blockedReasons,
    estimatedBytes: candidates.reduce((sum, entry) => sum + entry.bytes, 0)
  }
}

function acquireLock(root, name, incompatible = []) {
  if (!['.cleanup.lock', '.update-lifecycle.lock'].includes(name)) throw Error('清理锁名称无效。')
  root = workspace(root)
  inspect(root, 'test-results')
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true })
  const file = path.join(root, 'test-results', name),
    owner = `${process.pid}:${randomUUID()}`
  if (incompatible.some((other) => fs.existsSync(path.join(root, 'test-results', other))))
    throw Error('其他验收或清理任务正在运行。')
  let fd
  try {
    fd = fs.openSync(file, 'wx')
  } catch (error) {
    if (error.code === 'EEXIST') throw Error('其他验收或清理任务正在运行。')
    throw error
  }
  fs.writeFileSync(fd, owner)
  fs.closeSync(fd)
  return () => {
    if (
      fs.existsSync(file) &&
      !fs.lstatSync(file).isSymbolicLink() &&
      fs.readFileSync(file, 'utf8') === owner
    )
      fs.unlinkSync(file)
  }
}

async function applyPlan(plan, { active = processes, tracked } = {}) {
  const root = workspace(plan.root)
  if (plan.blocked.length) throw Error(`清理已停止：${plan.blocked.join('；')}`)
  const unlock = acquireLock(root, '.cleanup.lock', ['.local-release.lock', '.update-lifecycle.lock'])
  const report = {
    generatedAtUtc: new Date().toISOString(),
    status: 'running',
    deleted: [],
    skipped: plan.skipped,
    preserved: plan.preserve,
    evidence: plan.evidence,
    freedBytes: 0
  }
  try {
    const current = config(root)
    const before = current.names.every((name) => fs.existsSync(path.join(root, 'release', name)))
      ? await artifacts(root, current)
      : []
    const fresh = createPlan(root, { tracked, active: [] })
    const allowed = new Map(fresh.candidates.map((item) => [item.path, item.fingerprint]))
    for (const entry of plan.candidates)
      if (allowed.get(entry.path) !== entry.fingerprint)
        throw Error(`预览后内容发生变化，请重新检查：${entry.path}`)
    const running = blocked(root, active(root), true)
    if (running.length) throw Error(`清理已停止：${running.join('；')}`)
    inspect(root, 'test-results/reports')
    fs.mkdirSync(path.join(root, 'test-results/reports'), { recursive: true })
    for (const item of plan.evidence) {
      inspect(root, item.source)
      inspect(root, item.destination)
      if (!fs.existsSync(path.join(root, item.destination)))
        fs.copyFileSync(
          path.join(root, item.source),
          path.join(root, item.destination),
          fs.constants.COPYFILE_EXCL
        )
    }
    for (const entry of plan.candidates) {
      const locks = blocked(root, [], true)
      if (locks.length) throw Error(`清理已停止：${locks.join('；')}`)
      if (inspect(root, entry.path)?.fingerprint !== entry.fingerprint)
        throw Error(`删除前内容发生变化：${entry.path}`)
      removeTree(root, entry.path)
      report.deleted.push({ path: entry.path, bytes: entry.bytes, files: entry.files })
      report.freedBytes += entry.bytes
    }
    const after = before.length ? await artifacts(root, current) : []
    if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('保留的发行文件发生变化。')
    report.artifacts = after
    report.status = 'passed'
    return report
  } catch (error) {
    report.status = 'failed'
    report.error = error.message
    throw error
  } finally {
    try {
      inspect(root, 'test-results/reports')
      fs.mkdirSync(path.join(root, 'test-results/reports'), { recursive: true })
      fs.writeFileSync(
        path.join(root, 'test-results/reports/cleanup.json'),
        JSON.stringify(report, null, 2) + '\n'
      )
    } finally {
      unlock()
    }
  }
}

function finishUpdateFixture(root, fixture, { passed, restored, keep = false }) {
  if (!passed || !restored || keep) return false
  root = workspace(root)
  const relative = path.relative(root, path.resolve(fixture)).split(path.sep).join('/')
  if (!/^test-results\/update-lifecycle-[A-Za-z0-9]{6}$/.test(relative)) throw Error('升级测试清理路径越界。')
  removeTree(root, relative)
  return true
}

module.exports = { createPlan, applyPlan, inspect, processes, acquireLock, finishUpdateFixture }
