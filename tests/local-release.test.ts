import { afterEach, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'

const require = createRequire(import.meta.url)
const local = require('../scripts/lib/local-release.cjs')
const cli = require('../scripts/local-release.cjs')
const github = require('../scripts/lib/github-release.cjs')
const yaml = require('js-yaml')
const roots: string[] = []
const digest = (data: string | Buffer, algorithm = 'sha256', encoding: 'hex' | 'base64' = 'hex') =>
  createHash(algorithm).update(data).digest(encoding)

afterEach(() => {
  for (const root of roots) {
    const verified = realpathSync(root)
    if (
      dirname(verified) !== realpathSync(tmpdir()) ||
      !basename(verified).startsWith('mymap-local-release-')
    )
      throw Error('Unexpected release fixture cleanup path')
    rmSync(verified, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
  roots.length = 0
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mymap-local-release-'))
  roots.push(root)
  const version = '0.6.0'
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      version,
      build: {
        publish: { provider: 'github', owner: 'Lisalsj', repo: 'MyMap' },
        directories: { output: 'release' }
      }
    })
  )
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ version, packages: { '': { version } } }))
  mkdirSync(join(root, 'release'))
  const current = local.config(root)
  const setup = Buffer.alloc(1200, 7),
    portable = Buffer.alloc(1200, 8)
  writeFileSync(join(root, 'release', current.names[0]), setup)
  writeFileSync(join(root, 'release', current.names[1]), portable)
  const sha512 = digest(setup, 'sha512', 'base64')
  writeFileSync(
    join(root, 'release/latest.yml'),
    yaml.dump({
      version,
      path: current.names[0],
      sha512,
      files: [{ url: current.names[0], size: setup.length, sha512 }]
    })
  )
  writeFileSync(
    join(root, 'release/SHA256SUMS.txt'),
    `${digest(setup)}  ${current.names[0]}\n${digest(portable)}  ${current.names[1]}\n`
  )
  const sha = 'a'.repeat(40),
    events: string[] = []
  let tag: string | null = null,
    remoteTag: string | null = null,
    main = 'b'.repeat(40)
  const state = { sha, branch: 'main', dirty: false }
  const gitClient = {
    state: () => ({ ...state }),
    origin: () => 'https://github.com/Lisalsj/MyMap.git',
    localTag: vi.fn(() => tag),
    remoteMain: vi.fn(async () => main),
    ancestor: vi.fn(() => true),
    tag: vi.fn(() => {
      tag = sha
      events.push('tag')
    }),
    push: vi.fn(async () => {
      main = sha
      remoteTag = sha
      events.push('push')
    })
  }
  let release: any = null
  const client = {
    preflight: vi.fn(async () => {}),
    latest: vi.fn(async (): Promise<any> => null),
    release: vi.fn(async () => (release ? structuredClone(release) : null)),
    tagCommit: vi.fn(async () => remoteTag),
    create: vi.fn(async (name: string, commit: string, notes: string) => {
      events.push('draft')
      release = { id: 1, tag_name: name, target_commitish: commit, body: notes, draft: true, assets: [] }
      return structuredClone(release)
    }),
    upload: vi.fn(async (_id: number, file: any) => {
      events.push(`upload:${file.name}`)
      const uploaded = { ...file, state: 'uploaded', digest: `sha256:${file.sha256}` }
      release.assets.push(uploaded)
      return uploaded
    }),
    publish: vi.fn(async () => {
      events.push('publish')
      release.draft = false
      return { ...release, html_url: 'https://github.com/Lisalsj/MyMap/releases/tag/v0.6.0' }
    }),
    verifyPublic: vi.fn(async () => {
      events.push('public-check')
    })
  }
  const run = vi.fn(async (phase: string) => {
    events.push(phase)
  })
  const context = {
    root,
    current,
    gitClient,
    client,
    run,
    log: vi.fn(),
    inspectPayload: vi.fn(async () => {
      events.push('payload')
      return { publicResourcesVerified: true }
    })
  }
  return {
    ...context,
    context,
    state,
    sha,
    events,
    setRelease: (value: any) => {
      release = value
    },
    getRelease: () => release,
    setRemoteTag: (value: string | null) => {
      remoteTag = value
    }
  }
}

it('runs every required gate before a single push, uploads four exact files and publishes last', async () => {
  const f = fixture()
  const report = await local.verify(f.context)
  await local.publish(f.context, report, { notes: '旅行更新' })
  expect(f.events.slice(0, 9)).toEqual(local.phases)
  expect(f.events.slice(9)).toEqual([
    'tag',
    'push',
    'draft',
    ...f.current.names.map((n: string) => `upload:${n}`),
    'publish',
    'public-check'
  ])
  expect(f.gitClient.push).toHaveBeenCalledTimes(1)
  expect(f.client.publish).toHaveBeenCalledTimes(1)
  const saved = JSON.parse(readFileSync(join(f.root, local.reportFile), 'utf8'))
  expect(saved.status).toBe('passed')
  expect(saved.publication.status).toBe('verified')
})

it.each(['unit', 'update', 'build', 'packaged', 'payload'])(
  'stops immediately at a failed %s gate and rejects any attempt to publish its report',
  async (failed) => {
    const f = fixture()
    f.context.run = vi.fn(async (phase: string) => {
      if (phase === failed) throw Error('fixture failure')
    })
    if (failed === 'payload')
      f.context.inspectPayload = vi.fn(async () => {
        throw Error('fixture failure')
      })
    await expect(local.verify(f.context)).rejects.toThrow('fixture failure')
    const report = JSON.parse(readFileSync(join(f.root, local.reportFile), 'utf8'))
    expect(report.status).toBe('failed')
    expect(report.phases.at(-1)).toMatchObject({ name: failed, status: 'failed' })
    await expect(local.publish(f.context, report, { notes: '更新' })).rejects.toThrow('原验收')
    expect(f.gitClient.push).not.toHaveBeenCalled()
    expect(f.client.create).not.toHaveBeenCalled()
  }
)

it.each(['dirty', 'sha', 'branch', 'artifact'])(
  'rejects changed %s between verification and publication',
  async (change) => {
    const f = fixture(),
      report = await local.verify(f.context)
    if (change === 'dirty') f.state.dirty = true
    if (change === 'sha') f.state.sha = 'c'.repeat(40)
    if (change === 'branch') f.state.branch = 'other'
    if (change === 'artifact') writeFileSync(join(f.root, 'release', f.current.names[1]), 'modified')
    await expect(local.publish(f.context, report, { notes: '更新' })).rejects.toThrow()
    expect(f.gitClient.push).not.toHaveBeenCalled()
    expect(f.client.create).not.toHaveBeenCalled()
  }
)

it('dry-run detects a public version and performs no tag, push or remote mutation', async () => {
  const f = fixture(),
    report = await local.verify(f.context)
  f.setRelease({ draft: false, tag_name: f.current.tag, assets: [] })
  const result = await local.publish(f.context, report, { dryRun: true })
  expect(result).toMatchObject({ status: 'dry-run', publishable: false })
  await expect(local.publish(f.context, report, { notes: '更新' })).rejects.toThrow('已公开')
  expect(f.gitClient.tag).not.toHaveBeenCalled()
  expect(f.gitClient.push).not.toHaveBeenCalled()
  expect(f.client.create).not.toHaveBeenCalled()
  expect(f.client.upload).not.toHaveBeenCalled()
  expect(f.client.publish).not.toHaveBeenCalled()
})

it('dry-run for a new version reports its exact inputs without modifying anything remote', async () => {
  const f = fixture(),
    report = await local.verify(f.context)
  expect(await local.publish(f.context, report, { dryRun: true })).toMatchObject({
    publishable: true,
    assets: f.current.names
  })
  expect(f.gitClient.tag).not.toHaveBeenCalled()
  expect(f.gitClient.push).not.toHaveBeenCalled()
  expect(f.client.create).not.toHaveBeenCalled()
})

it('prevents an older version from replacing the latest update feed', async () => {
  const f = fixture(),
    report = await local.verify(f.context)
  f.client.latest.mockResolvedValueOnce({ tag_name: 'v0.7.0' })
  await expect(local.publish(f.context, report, { notes: '更新' })).rejects.toThrow('不能回退')
  expect(f.gitClient.push).not.toHaveBeenCalled()
  expect(f.client.create).not.toHaveBeenCalled()
})

it.each(['tag', 'main', 'origin'])('refuses a conflicting %s without pushing', async (kind) => {
  const f = fixture(),
    report = await local.verify(f.context)
  if (kind === 'tag') f.setRemoteTag('c'.repeat(40))
  if (kind === 'main') f.gitClient.ancestor.mockReturnValue(false)
  if (kind === 'origin') f.gitClient.origin = () => 'https://github.com/else/Other.git'
  await expect(local.publish(f.context, report, { notes: '更新' })).rejects.toThrow()
  expect(f.gitClient.push).not.toHaveBeenCalled()
})

it('does not create a draft after an atomic push fails', async () => {
  const f = fixture(),
    report = await local.verify(f.context)
  f.gitClient.push.mockRejectedValueOnce(Error('push rejected'))
  await expect(local.publish(f.context, report, { notes: '更新' })).rejects.toThrow('push rejected')
  expect(f.client.create).not.toHaveBeenCalled()
  expect(f.client.upload).not.toHaveBeenCalled()
})

it('resumes an interrupted upload using the same verified bytes and does not push again', async () => {
  const f = fixture(),
    report = await local.verify(f.context)
  const upload = f.client.upload.getMockImplementation()!
  f.client.upload.mockImplementationOnce(upload).mockRejectedValueOnce(Error('offline'))
  await expect(local.publish(f.context, report, { notes: '更新' })).rejects.toThrow('offline')
  expect(f.getRelease().assets).toHaveLength(1)
  expect(f.client.publish).not.toHaveBeenCalled()
  const recovered = await local.resume(f.root, f.current, f.gitClient)
  await local.publish(f.context, recovered, { notes: '更新' })
  expect(f.gitClient.push).toHaveBeenCalledTimes(1)
  expect(f.client.upload.mock.calls.filter((args) => args[1].name === f.current.names[0])).toHaveLength(1)
  expect(f.getRelease().assets).toHaveLength(4)
})

it.each(['digest', 'extra', 'notes', 'commit'])(
  'refuses a mismatching draft %s without replacing or deleting its attachments',
  async (change) => {
    const f = fixture(),
      report = await local.verify(f.context)
    const asset = {
      ...report.artifacts[0],
      state: 'uploaded',
      digest: `sha256:${report.artifacts[0].sha256}`
    }
    const release = {
      id: 1,
      tag_name: f.current.tag,
      target_commitish: f.sha,
      body: '更新',
      draft: true,
      assets: [asset]
    }
    if (change === 'digest') asset.digest = 'sha256:bad'
    if (change === 'extra') asset.name = 'private.zip'
    if (change === 'notes') release.body = 'other'
    if (change === 'commit') release.target_commitish = 'c'.repeat(40)
    f.setRelease(release)
    await expect(local.publish(f.context, report, { notes: '更新' })).rejects.toThrow()
    expect(f.gitClient.push).not.toHaveBeenCalled()
    expect(f.client.upload).not.toHaveBeenCalled()
    expect(f.client.publish).not.toHaveBeenCalled()
  }
)

it('never publishes an upload with a wrong server digest', async () => {
  const f = fixture(),
    report = await local.verify(f.context)
  f.client.upload.mockResolvedValueOnce({ ...report.artifacts[0], state: 'uploaded', digest: 'sha256:wrong' })
  await expect(local.publish(f.context, report, { notes: '更新' })).rejects.toThrow('SHA-256')
  expect(f.client.publish).not.toHaveBeenCalled()
})

it('refuses a tag moved remotely while attachments were uploading', async () => {
  const f = fixture(),
    report = await local.verify(f.context)
  const upload = f.client.upload.getMockImplementation()!
  f.client.upload.mockImplementation(async (...args: any[]) => {
    const result = await (upload as any)(...args)
    if (f.getRelease().assets.length === 4) f.setRemoteTag('c'.repeat(40))
    return result
  })
  await expect(local.publish(f.context, report, { notes: '更新' })).rejects.toThrow('远端标签')
  expect(f.client.publish).not.toHaveBeenCalled()
})

it('uses one atomic Git push for the exact main and tag refs without force', async () => {
  const commands: string[][] = []
  const client = local.git('unused', (_file: string, args: string[], settings: any) => {
    commands.push(args)
    expect(settings.windowsHide).toBe(true)
    return ''
  })
  client.push('v0.6.0')
  expect(commands).toEqual([
    ['push', '--atomic', 'origin', 'HEAD:refs/heads/main', 'refs/tags/v0.6.0:refs/tags/v0.6.0']
  ])
})

it('records public download failure without deleting or overwriting the public release', async () => {
  const f = fixture(),
    report = await local.verify(f.context)
  f.client.verifyPublic.mockRejectedValueOnce(Error('network unavailable'))
  await expect(local.publish(f.context, report, { notes: '更新' })).rejects.toThrow('network unavailable')
  const saved = JSON.parse(readFileSync(join(f.root, local.reportFile), 'utf8'))
  expect(saved.publication).toMatchObject({ status: 'published', error: 'network unavailable' })
  expect(f.getRelease().draft).toBe(false)
})

it('rejects version, manifest and checksum mismatches', async () => {
  const f = fixture()
  writeFileSync(join(f.root, 'package-lock.json'), JSON.stringify({ version: '0.5.0' }))
  expect(() => local.config(f.root)).toThrow('一致')
  writeFileSync(join(f.root, 'release/latest.yml'), 'version: 0.1.0\n')
  await expect(local.artifacts(f.root, f.current)).rejects.toThrow('latest.yml')
  const g = fixture()
  writeFileSync(join(g.root, 'release/SHA256SUMS.txt'), 'bad')
  await expect(local.artifacts(g.root, g.current)).rejects.toThrow('SHA256SUMS')
})

it('removes test injection and credentials from verification children and uses the local NSIS fallback', () => {
  const f = fixture()
  mkdirSync(join(f.root, 'test-results/build-tools/nsis'), { recursive: true })
  writeFileSync(join(f.root, 'test-results/build-tools/nsis/makensis.exe'), '')
  const result = local.cleanEnvironment(
    {
      PATH: 'keep',
      GH_TOKEN: 'secret',
      GITHUB_TOKEN: 'other',
      MYMAP_TEST_ROOT: 'personal',
      MYMAP_EXECUTABLE: 'old',
      MYMAP_UPDATE_TEST_URL: 'bad',
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: 'bad'
    },
    f.root
  )
  expect(result).toEqual({
    PATH: 'keep',
    ELECTRON_BUILDER_NSIS_DIR: join(f.root, 'test-results/build-tools/nsis')
  })
})

it('uses the existing Git credential only in memory and does not expose credential errors', () => {
  const execute = vi.fn(() => 'protocol=https\npassword=fixture-secret\n')
  expect(github.credential({}, execute)).toBe('fixture-secret')
  expect(execute.mock.calls[0]?.slice(0, 2)).toEqual(['git', ['credential', 'fill']])
  expect(github.credential({ GH_TOKEN: 'env-secret' }, execute)).toBe('env-secret')
  expect(() =>
    github.credential({}, () => {
      throw Error('fixture-secret')
    })
  ).toThrow('登录不可用')
  try {
    github.credential({}, () => {
      throw Error('fixture-secret')
    })
  } catch (error) {
    expect(String(error)).not.toContain('fixture-secret')
  }
})

it('rejects ambiguous CLI arguments and simultaneous runs', () => {
  expect(cli.options(['--resume', '--dry-run'])).toMatchObject({ resume: true, dryRun: true })
  expect(() => cli.options(['--notes'])).toThrow('参数')
  expect(() => cli.options(['--force'])).toThrow('参数')
  expect(() => cli.options(['--verify-only', '--resume'])).toThrow('组合')
  const f = fixture(),
    release = cli.lock(f.root)
  expect(() => cli.lock(f.root)).toThrow('正在运行')
  release()
  cli.lock(f.root)()
})

it('keeps the workflow manual, read-only, using the same verification gate and no release publishing', () => {
  const workflow = yaml.load(readFileSync(resolve('.github/workflows/windows.yml'), 'utf8'))
  expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
  expect(workflow.permissions).toEqual({ contents: 'read' })
  const steps = workflow.jobs.windows.steps
  expect(steps.some((step: any) => step.run === 'npm run verify:local')).toBe(true)
  expect(JSON.stringify(steps)).not.toMatch(/gh release|release:local|contents: write/)
  expect(steps.at(-1).with.path).not.toContain('*.exe')
})

function transport(handler: (url: URL, options: any, body: Buffer) => any) {
  return (url: URL, options: any, callback: (response: any) => void) => {
    const data: Buffer[] = []
    const request: any = new Writable({
      write(chunk, _encoding, done) {
        data.push(Buffer.from(chunk))
        done()
      }
    })
    request.setTimeout = () => request
    request.on('finish', () =>
      queueMicrotask(() => {
        const result = handler(url, options, Buffer.concat(data))
        if (result.error) {
          request.emit('error', result.error)
          return
        }
        const response: any = Readable.from([
          Buffer.isBuffer(result.body) ? result.body : Buffer.from(JSON.stringify(result.body || {}))
        ])
        response.statusCode = result.status || 200
        response.headers = result.headers || {}
        callback(response)
      })
    )
    return request
  }
}

it('uses authenticated GitHub API requests but strips authorization on public downloads and redirects', async () => {
  const f = fixture(),
    files = await local.artifacts(f.root, f.current),
    requests: any[] = []
  const client = github.createClient({
    repository: f.current.repository,
    token: 'fixture-secret',
    env: {},
    log: vi.fn(),
    requestImpl: transport((url, options) => {
      requests.push({ url, options })
      if (url.hostname === 'api.github.com')
        return { body: { private: false, permissions: { push: true }, default_branch: 'main' } }
      if (url.hostname === 'github.com')
        return {
          status: 302,
          headers: {
            location: `https://release-assets.githubusercontent.com/${url.pathname.split('/').at(-1)}`
          }
        }
      const name = url.pathname.slice(1)
      return { body: readFileSync(join(f.root, 'release', name)), status: name.endsWith('.exe') ? 206 : 200 }
    })
  })
  try {
    await client.preflight()
    await client.verifyPublic(f.current.tag, files, f.root)
    expect(requests[0].options.headers.Authorization).toBe('Bearer fixture-secret')
    for (const request of requests.slice(1)) expect(request.options.headers.Authorization).toBeUndefined()
  } finally {
    client.close()
  }
})

it('rejects a public download redirect to an unapproved host and redacts network errors', async () => {
  const f = fixture(),
    files = await local.artifacts(f.root, f.current)
  const redirected = github.createClient({
    repository: f.current.repository,
    token: 'fixture-secret',
    env: {},
    requestImpl: transport(() => ({ status: 302, headers: { location: 'https://untrusted.example/file' } }))
  })
  try {
    await expect(redirected.verifyPublic(f.current.tag, files, f.root)).rejects.toThrow('非预期')
  } finally {
    redirected.close()
  }
  const broken = github.createClient({
    repository: f.current.repository,
    token: 'fixture-secret',
    env: {},
    requestImpl: transport(() => ({ error: Object.assign(Error('fixture-secret'), { code: 'ECONNRESET' }) }))
  })
  try {
    await expect(broken.preflight()).rejects.toThrow('ECONNRESET')
    await broken.preflight().catch((error: Error) => expect(error.message).not.toContain('fixture-secret'))
  } finally {
    broken.close()
  }
})

async function payloadFixture() {
  const f = fixture()
  const app = join(f.root, 'application')
  const resources = join(f.root, 'release/win-unpacked/resources')
  for (const location of [
    join(app, 'out/main'),
    join(f.root, 'out/main'),
    join(resources, 'data'),
    join(f.root, 'resources')
  ])
    mkdirSync(location, { recursive: true })
  writeFileSync(join(app, 'package.json'), JSON.stringify({ version: f.current.version }))
  for (const directory of [app, f.root])
    writeFileSync(join(directory, 'out/main/index.js'), 'production build')
  for (const directory of [join(resources, 'data'), join(f.root, 'resources')])
    writeFileSync(join(directory, 'DATA-LICENSES.md'), 'public attribution')
  writeFileSync(join(resources, 'elevate.exe'), 'NSIS helper')
  const pack = () => require('@electron/asar').createPackage(app, join(resources, 'app.asar'))
  await pack()
  const tracked = () => new Set(['resources/DATA-LICENSES.md'])
  return { ...f, app, resources, pack, checkGit: { ...f.gitClient, tracked } }
}

it('accepts a matching production payload including the NSIS elevation helper', async () => {
  const f = await payloadFixture()
  expect(await local.inspectPayload(f.root, f.current, f.checkGit)).toMatchObject({
    publicResourcesVerified: true
  })
})

it.each(['library', 'secret', 'untracked-photo', 'extra-resource', 'native-file', 'changed-build'])(
  'rejects a distributed %s payload',
  async (kind) => {
    const f = await payloadFixture()
    if (kind === 'library') writeFileSync(join(f.resources, 'library.sqlite'), 'private')
    if (kind === 'secret') {
      writeFileSync(join(f.app, '.env'), 'secret')
      await f.pack()
    }
    if (kind === 'untracked-photo') {
      for (const directory of [join(f.resources, 'data/demo'), join(f.root, 'resources/demo')]) {
        mkdirSync(directory, { recursive: true })
        writeFileSync(join(directory, 'private.jpg'), 'personal')
      }
    }
    if (kind === 'extra-resource') writeFileSync(join(f.resources, 'private.zip'), 'private')
    if (kind === 'native-file') {
      const directory = join(f.resources, 'app.asar.unpacked/node_modules/unexpected')
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, 'file.dat'), 'private')
    }
    if (kind === 'changed-build') writeFileSync(join(f.root, 'out/main/index.js'), 'different build')
    await expect(local.inspectPayload(f.root, f.current, f.checkGit)).rejects.toThrow()
  }
)

it('sends the actual streamed asset bytes and UTF-8 notes through the GitHub transport', async () => {
  const f = fixture(),
    files = await local.artifacts(f.root, f.current),
    requests: any[] = []
  const client = github.createClient({
    repository: f.current.repository,
    token: 'fixture-secret',
    env: {},
    log: vi.fn(),
    requestImpl: transport((url, options, body) => {
      requests.push({ url, options, body })
      return { body: { id: 1 } }
    })
  })
  try {
    await client.create(f.current.tag, f.sha, '中文说明\n第二行')
    await client.upload(1, files[0], f.root)
    await client.publish(1)
    expect(JSON.parse(requests[0].body.toString())).toMatchObject({
      body: '中文说明\n第二行',
      draft: true,
      target_commitish: f.sha
    })
    expect(requests[0].options.headers['Content-Length']).toBe(requests[0].body.length)
    expect(requests[1].url.hostname).toBe('uploads.github.com')
    expect(requests[1].body.equals(readFileSync(join(f.root, 'release', files[0].name)))).toBe(true)
    expect(requests[1].options.headers['Content-Length']).toBe(files[0].size)
    expect(JSON.parse(requests[2].body.toString())).toEqual({ draft: false, make_latest: 'true' })
  } finally {
    client.close()
  }
})
