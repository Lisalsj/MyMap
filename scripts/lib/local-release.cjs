const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { execFileSync, spawn } = require('node:child_process')
const yaml = require('js-yaml')

const reportFile = 'test-results/reports/local-release.json'
const phases = [
  'format',
  'unit',
  'update',
  'build',
  'packaged',
  'portable',
  'manifest',
  'checksums',
  'payload'
]

function config(root) {
  const output = path.join(root, 'release')
  if (
    fs.existsSync(output) &&
    (fs.lstatSync(output).isSymbolicLink() || path.dirname(fs.realpathSync(output)) !== fs.realpathSync(root))
  )
    throw Error('发行目录必须位于当前项目内且不能是链接。')
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  if (
    !/^\d+\.\d+\.\d+$/.test(pkg.version) ||
    pkg.version !== lock.version ||
    pkg.version !== lock.packages?.['']?.version
  )
    throw Error('package.json 与锁文件必须使用一致的正式版本号。')
  const provider = pkg.build?.publish
  if (
    provider?.provider !== 'github' ||
    !/^[\w.-]+$/.test(provider.owner) ||
    !/^[\w.-]+$/.test(provider.repo) ||
    pkg.build.directories.output !== 'release'
  )
    throw Error('项目发布配置无效。')
  return {
    version: pkg.version,
    tag: `v${pkg.version}`,
    repository: `${provider.owner}/${provider.repo}`,
    names: [
      `MyMap-${pkg.version}-Setup-x64.exe`,
      `MyMap-${pkg.version}-Portable-x64.exe`,
      'latest.yml',
      'SHA256SUMS.txt'
    ]
  }
}

function git(root, executeFile = execFileSync) {
  const execute = (args, optional = false) => {
    try {
      return executeFile('git', args, {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 60000,
        stdio: ['ignore', 'pipe', 'pipe']
      }).trim()
    } catch (error) {
      if (optional && [1, 2].includes(error.status)) return null
      throw Error(`Git 操作失败（${args[0]}），请检查登录状态和远端冲突；不会强制推送。`)
    }
  }
  return {
    state: () => ({
      sha: execute(['rev-parse', 'HEAD']),
      branch: execute(['branch', '--show-current']),
      dirty: Boolean(execute(['status', '--porcelain=v1', '--untracked-files=all']))
    }),
    origin: () => execute(['remote', 'get-url', 'origin']),
    tracked: () =>
      new Set(
        execute(['ls-files'])
          .split('\n')
          .map((name) => name.replaceAll('\\', '/'))
      ),
    localTag: (tag) => execute(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], true),
    tag: (tag, sha) => execute(['tag', '-a', tag, sha, '-m', `MyMap ${tag}`]),
    async remoteMain() {
      const row = execute(['ls-remote', '--refs', 'origin', 'refs/heads/main'])
      return row ? row.split(/\s/)[0] : null
    },
    ancestor: (sha, head) => execute(['merge-base', '--is-ancestor', sha, head], true) !== null,
    push: (tag) =>
      execute(['push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${tag}:refs/tags/${tag}`])
  }
}

function assertOrigin(origin, repository) {
  const valid =
    origin === `https://github.com/${repository}.git` ||
    origin === `https://github.com/${repository}` ||
    origin === `git@github.com:${repository}.git`
  if (!valid) throw Error('origin 与项目的 GitHub 发布仓库不一致，已停止。')
}

function assertSource(gitClient, sha) {
  const state = gitClient.state()
  if (state.dirty || state.branch !== 'main' || (sha && state.sha !== sha))
    throw Error('发布要求 main 上已提交、干净且未经改动的源码；请重新提交并验收。')
  return state
}

function cleanEnvironment(env, root) {
  const result = { ...env }
  for (const key of Object.keys(result))
    if (
      key.startsWith('MYMAP_') ||
      ['ELECTRON_RUN_AS_NODE', 'GH_TOKEN', 'GITHUB_TOKEN', 'NODE_OPTIONS'].includes(key)
    )
      delete result[key]
  const nsis = path.join(root, 'test-results/build-tools/nsis')
  if (!result.ELECTRON_BUILDER_NSIS_DIR && fs.existsSync(path.join(nsis, 'makensis.exe')))
    result.ELECTRON_BUILDER_NSIS_DIR = nsis
  return result
}

async function hash(file, algorithm = 'sha256', encoding = 'hex') {
  const value = createHash(algorithm)
  for await (const chunk of fs.createReadStream(file)) value.update(chunk)
  return value.digest(encoding)
}

async function artifacts(root, current) {
  const result = []
  for (const name of current.names) {
    const file = path.join(root, 'release', name)
    if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile())
      throw Error(`发行文件不符合预期：${name}`)
    result.push({ name, size: fs.statSync(file).size, sha256: await hash(file) })
  }
  const manifest = yaml.load(fs.readFileSync(path.join(root, 'release/latest.yml'), 'utf8'))
  const installer = result[0]
  const entry = manifest.files?.[0]
  if (
    manifest.version !== current.version ||
    manifest.path !== installer.name ||
    manifest.files?.length !== 1 ||
    entry?.url !== installer.name ||
    entry.size !== installer.size ||
    entry.sha512 !== manifest.sha512 ||
    entry.sha512 !== (await hash(path.join(root, 'release', installer.name), 'sha512', 'base64'))
  )
    throw Error('安装程序与 latest.yml 的版本、大小或 SHA-512 不一致。')
  const expected = result
    .slice(0, 2)
    .map((item) => `${item.sha256}  ${item.name}`)
    .sort()
    .join('\n')
  const actual = fs
    .readFileSync(path.join(root, 'release/SHA256SUMS.txt'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .sort()
    .join('\n')
  if (actual !== expected) throw Error('SHA256SUMS.txt 必须且只能包含当前版本两份 EXE 的正确校验值。')
  return result
}

async function inspectPayload(root, current, gitClient) {
  const asar = require('@electron/asar')
  const archive = path.join(root, 'release/win-unpacked/resources/app.asar')
  const files = asar.listPackage(archive).map((item) => item.replaceAll('\\', '/').replace(/^\//, ''))
  const forbidden =
    /(?:^|\/)(?:Library|backups|test-results|\.git|\.env[^/]*)(?:\/|$)|\.(?:sqlite[^/]*|db(?:-wal|-shm)?|log|map)$/i
  if (
    files.some(
      (file) => forbidden.test(file) || !/^(?:out(?:\/|$)|node_modules(?:\/|$)|package\.json$)/.test(file)
    )
  )
    throw Error('程序包包含非预期的个人资料、测试文件或源码。')
  const packaged = JSON.parse(asar.extractFile(archive, 'package.json'))
  if (packaged.version !== current.version) throw Error('程序包内版本不一致。')
  async function inspectTree(directory, relative = '') {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = relative ? `${relative}/${item.name}` : item.name
      if (item.isSymbolicLink() || forbidden.test(name)) throw Error(`分发目录包含非预期文件或链接：${name}`)
      const file = path.join(directory, item.name)
      if (item.isDirectory()) await inspectTree(file, name)
      else if (/\.(?:jpe?g|png|webp|heic|raw|zip|bak)$/i.test(name) && !name.startsWith('resources/data/'))
        throw Error(`分发目录包含非公共照片或归档：${name}`)
      else if (
        name.startsWith('resources/app.asar.unpacked/') &&
        !/^resources\/app\.asar\.unpacked\/node_modules\/(?:sharp\/|@img\/(?:sharp-win32-x64|colour)\/)/.test(
          name
        )
      )
        throw Error(`原生模块目录包含非预期文件：${name}`)
    }
  }
  await inspectTree(path.join(root, 'release/win-unpacked'))
  const resourceNames = fs.readdirSync(path.join(root, 'release/win-unpacked/resources'))
  if (
    resourceNames.some(
      (name) => !['app.asar', 'app.asar.unpacked', 'app-update.yml', 'data', 'elevate.exe'].includes(name)
    )
  )
    throw Error('程序资源目录包含非预期内容。')
  async function compareBuild(directory, relative = 'out') {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = `${relative}/${item.name}`
      if (item.isSymbolicLink()) throw Error('构建目录不允许链接。')
      const file = path.join(directory, item.name)
      if (item.isDirectory()) await compareBuild(file, name)
      else if (!fs.readFileSync(file).equals(asar.extractFile(archive, path.join(...name.split('/')))))
        throw Error(`包内构建文件不一致：${name}`)
    }
  }
  await compareBuild(path.join(root, 'out'))
  if (
    files.some(
      (name) =>
        (name === 'out' || name.startsWith('out/')) && !fs.existsSync(path.join(root, ...name.split('/')))
    )
  )
    throw Error('程序包包含不属于当前构建的文件。')
  const tracked = gitClient.tracked()
  const resources = path.join(root, 'release/win-unpacked/resources/data')
  async function walk(directory, relative = '') {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw Error('公共资源中不允许链接。')
      const name = relative ? `${relative}/${item.name}` : item.name
      const file = path.join(directory, item.name)
      if (item.isDirectory()) await walk(file, name)
      else {
        if (
          !/^(?:cities\.json\.gz|data-manifest\.json|DATA-LICENSES\.md|THIRD-PARTY-NOTICES\.md|LICENSE-MyMap\.txt|icon\.png|licenses\/[^]+|demo\/[^/]+\.(?:png|jpe?g|webp))$/.test(
            name
          ) ||
          !tracked.has(`resources/${name}`) ||
          (await hash(file)) !== (await hash(path.join(root, 'resources', name)))
        )
          throw Error(`分发资源必须来自已跟踪的公共资源：${name}`)
      }
    }
  }
  await walk(resources)
  return { archiveEntries: files.length, publicResourcesVerified: true }
}

function save(root, report) {
  const destination = path.join(root, reportFile)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  const temporary = destination + '.tmp'
  fs.writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n')
  fs.renameSync(temporary, destination)
}

function runNode(root, env, file, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      cwd: root,
      env,
      stdio: 'inherit',
      windowsHide: true
    })
    child.once('error', () => reject(Error(`无法启动验收工具：${path.basename(file)}`)))
    child.once('exit', (code, signal) =>
      code === 0
        ? resolve()
        : reject(Error(`验收工具失败：${path.basename(file)}，退出码 ${code ?? signal}。后续阶段已停止。`))
    )
  })
}

function runner(root, env) {
  const clean = cleanEnvironment(env, root)
  const npm = env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
  const npmRun = (script) => runNode(root, clean, npm, ['run', script])
  return (phase) => {
    if (phase === 'format') return npmRun('format:check')
    if (phase === 'unit') return npmRun('test')
    if (phase === 'update') return npmRun('test:update')
    if (phase === 'build') return npmRun('dist:win')
    if (phase === 'packaged')
      return runNode(
        root,
        { ...clean, MYMAP_EXECUTABLE: path.join(root, 'release/win-unpacked/MyMap.exe') },
        'node_modules/@playwright/test/cli.js',
        ['test', '--output=test-results/packaged']
      )
    if (phase === 'portable') return runNode(root, clean, 'scripts/portable-smoke.cjs')
    if (phase === 'manifest') return npmRun('verify:manifest')
    if (phase === 'checksums') return npmRun('checksums')
    throw Error('未知的验收阶段。')
  }
}

async function verify(context) {
  const { root, current, gitClient, run, log = console.log } = context
  const initial = gitClient.state()
  const report = {
    version: current.version,
    repository: current.repository,
    sha: initial.sha,
    sourceClean: !initial.dirty,
    startedAtUtc: new Date().toISOString(),
    status: 'running',
    phases: []
  }
  save(root, report)
  try {
    for (const name of phases) {
      const phase = { name, startedAtUtc: new Date().toISOString(), status: 'running' }
      report.phases.push(phase)
      save(root, report)
      log(`\n本机验收 ${report.phases.length}/${phases.length}：${name}`)
      try {
        if (name === 'payload')
          phase.result = await (context.inspectPayload || inspectPayload)(root, current, gitClient)
        else await run(name)
        phase.status = 'passed'
      } catch (error) {
        phase.status = 'failed'
        throw error
      } finally {
        phase.finishedAtUtc = new Date().toISOString()
        save(root, report)
      }
    }
    const final = gitClient.state()
    if (initial.sha !== final.sha || initial.dirty !== final.dirty)
      throw Error('验收期间源码状态发生变化，请重新验收。')
    report.artifacts = await artifacts(root, current)
    report.status = 'passed'
    return report
  } catch (error) {
    report.status = 'failed'
    report.error = error.message
    throw error
  } finally {
    report.finishedAtUtc = new Date().toISOString()
    save(root, report)
  }
}

async function resume(root, current, gitClient) {
  let report
  try {
    report = JSON.parse(fs.readFileSync(path.join(root, reportFile), 'utf8'))
  } catch {
    throw Error('没有可恢复的本机验收记录，请先执行完整验收。')
  }
  if (
    report.status !== 'passed' ||
    !report.sourceClean ||
    report.version !== current.version ||
    report.repository !== current.repository ||
    report.phases?.length !== phases.length ||
    phases.some(
      (name, index) => report.phases[index].name !== name || report.phases[index].status !== 'passed'
    )
  )
    throw Error('原验收没有全部通过或源码未提交，不能续传。')
  assertSource(gitClient, report.sha)
  if (JSON.stringify(await artifacts(root, current)) !== JSON.stringify(report.artifacts))
    throw Error('发行文件在验收后发生变化，不能续传，请重新验收。')
  return report
}

function matchAsset(remote, local) {
  if (
    !remote ||
    remote.name !== local.name ||
    remote.state !== 'uploaded' ||
    remote.size !== local.size ||
    remote.digest !== `sha256:${local.sha256}`
  )
    throw Error(`远端附件大小或 SHA-256 不一致：${local.name}。不会覆盖或删除附件。`)
}

function newerVersion(version, previous) {
  const older = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(previous)
  if (!older) throw Error('无法识别远端最新正式版本，不能自动将本次发布设为 latest。')
  const left = version.split('.').map(BigInt),
    right = older.slice(1).map(BigInt)
  for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return left[index] > right[index]
  return false
}

async function publish(context, report, { notes, dryRun = false } = {}) {
  const { root, current, gitClient, client, log = console.log } = context
  assertOrigin(gitClient.origin(), current.repository)
  assertSource(gitClient, report.sha)
  const checked = await resume(root, current, gitClient)
  if (JSON.stringify(checked.artifacts) !== JSON.stringify(report.artifacts))
    throw Error('验收记录与当前发布不一致。')
  await client.preflight()
  let release = await client.release(current.tag)
  const latest = release && !release.draft ? null : await client.latest()
  const remoteTag = await client.tagCommit(current.tag)
  const remoteMain = await gitClient.remoteMain()
  const localTag = gitClient.localTag(current.tag)
  const blocked =
    release && !release.draft
      ? '该版本已公开，拒绝覆盖；发布新软件时请使用新的版本号。'
      : latest && !newerVersion(current.version, latest.tag_name)
        ? '新版本必须高于最新公开版本，不能回退应用更新来源。'
        : (remoteTag && remoteTag !== report.sha) || (localTag && localTag !== report.sha)
          ? '版本标签指向其他提交，拒绝移动标签。'
          : remoteMain && !gitClient.ancestor(remoteMain, report.sha)
            ? '远端 main 已发生变化，请同步后重新验收。'
            : null
  if (dryRun) {
    const result = {
      status: 'dry-run',
      publishable: !blocked,
      reason: blocked,
      tag: current.tag,
      sha: report.sha,
      assets: report.artifacts.map((item) => item.name)
    }
    log(JSON.stringify(result, null, 2))
    return result
  }
  if (blocked) throw Error(blocked)
  if (!notes?.trim()) throw Error('发布必须通过 --notes 指定非空的中文更新说明文件。')
  const notesHash = createHash('sha256').update(notes).digest('hex')
  if (report.publication?.notesHash && report.publication.notesHash !== notesHash)
    throw Error('续传时更新说明必须与原发布一致。')
  if (
    release &&
    (release.tag_name !== current.tag || release.target_commitish !== report.sha || release.body !== notes)
  )
    throw Error('已有草稿与本次提交或更新说明不一致，已停止。')
  const localNames = new Set(report.artifacts.map((item) => item.name))
  function inspectRemote(value, complete = false) {
    const seen = new Set()
    for (const asset of value.assets) {
      if (!localNames.has(asset.name) || seen.has(asset.name)) throw Error('草稿中包含非预期或重复附件。')
      seen.add(asset.name)
      matchAsset(
        asset,
        report.artifacts.find((item) => item.name === asset.name)
      )
    }
    if (complete && seen.size !== localNames.size) throw Error('草稿附件不完整，不能公开。')
  }
  if (release) inspectRemote(release)
  report.publication = { ...report.publication, notesHash, status: 'preparing' }
  save(root, report)
  try {
    assertSource(gitClient, report.sha)
    if (!localTag) gitClient.tag(current.tag, report.sha)
    if (remoteMain !== report.sha || !remoteTag) {
      log('本机验收已通过，一次性推送 main 与版本标签。')
      await gitClient.push(current.tag)
    }
    if ((await client.tagCommit(current.tag)) !== report.sha) throw Error('远端标签与已验证提交不一致。')
    if (!release) release = await client.create(current.tag, report.sha, notes)
    report.publication.releaseId = release.id
    save(root, report)
    for (const artifact of report.artifacts) {
      assertSource(gitClient, report.sha)
      if (JSON.stringify(await artifacts(root, current)) !== JSON.stringify(report.artifacts))
        throw Error('上传前发行文件发生变化，已停止。')
      const prior = release.assets.find((item) => item.name === artifact.name)
      if (!prior) matchAsset(await client.upload(release.id, artifact, root), artifact)
    }
    release = await client.release(current.tag)
    if (
      !release?.draft ||
      release.id !== report.publication.releaseId ||
      release.target_commitish !== report.sha ||
      release.body !== notes
    )
      throw Error('公开前草稿状态发生变化。')
    inspectRemote(release, true)
    if ((await client.tagCommit(current.tag)) !== report.sha) throw Error('公开前远端标签发生变化。')
    assertSource(gitClient, report.sha)
    if (JSON.stringify(await artifacts(root, current)) !== JSON.stringify(report.artifacts))
      throw Error('公开前发行文件发生变化。')
    const published = await client.publish(release.id)
    if (published.draft || published.tag_name !== current.tag) throw Error('GitHub 未确认公开发布。')
    report.publication.status = 'published'
    report.publication.url = published.html_url
    save(root, report)
    await client.verifyPublic(current.tag, report.artifacts, root)
    report.publication.status = 'verified'
    log(`发布与公开下载核对完成：${published.html_url}`)
    return report.publication
  } catch (error) {
    report.publication.error = error.message
    throw error
  } finally {
    save(root, report)
  }
}

module.exports = {
  reportFile,
  phases,
  config,
  git,
  assertOrigin,
  assertSource,
  cleanEnvironment,
  hash,
  artifacts,
  inspectPayload,
  save,
  runner,
  verify,
  resume,
  matchAsset,
  publish
}
