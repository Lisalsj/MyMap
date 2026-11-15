const fs = require('node:fs')
const path = require('node:path')
const local = require('./lib/local-release.cjs')
const { credential, createClient } = require('./lib/github-release.cjs')

function lock(root) {
  const file = path.join(root, 'test-results/.local-release.lock')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let fd
  try {
    fd = fs.openSync(file, 'wx')
  } catch {
    throw Error(
      '已有本机验收或发布正在运行；若上次中断，请确认相关进程已退出后移除 test-results/.local-release.lock。'
    )
  }
  const owner = `${process.pid}:${require('node:crypto').randomUUID()}`
  fs.writeFileSync(fd, owner)
  fs.closeSync(fd)
  return () => {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === owner) fs.unlinkSync(file)
  }
}

function options(args) {
  const result = { verifyOnly: false, dryRun: false, resume: false }
  for (let index = 0; index < args.length; index++) {
    const value = args[index]
    if (value === '--verify-only') result.verifyOnly = true
    else if (value === '--dry-run') result.dryRun = true
    else if (value === '--resume') result.resume = true
    else if (value === '--notes' && args[index + 1] && !args[index + 1].startsWith('--'))
      result.notesPath = args[++index]
    else throw Error(`未知或不完整的参数：${value}`)
  }
  if (result.verifyOnly && (result.dryRun || result.resume || result.notesPath))
    throw Error('--verify-only 不能与发布参数组合。')
  return result
}

async function main(args = process.argv.slice(2)) {
  const selected = options(args)
  if (
    process.platform !== 'win32' ||
    process.arch !== 'x64' ||
    Number(process.versions.node.split('.')[0]) !== 24
  )
    throw Error('本机验收需要 Windows x64 与 Node.js 24。')
  const root = path.resolve(__dirname, '..')
  const current = local.config(root)
  const gitClient = local.git(root)
  const unlock = lock(root)
  try {
    if (!selected.verifyOnly) {
      local.assertOrigin(gitClient.origin(), current.repository)
      local.assertSource(gitClient)
    }
    const notes = selected.notesPath
      ? fs
          .readFileSync(path.resolve(selected.notesPath), 'utf8')
          .replace(/^\uFEFF/, '')
          .trim()
      : undefined
    if (!selected.verifyOnly && !selected.dryRun && !notes)
      throw Error('请通过 --notes <文件> 提供更新说明。')
    const context = { root, current, gitClient, run: local.runner(root, process.env) }
    const report = selected.resume
      ? await local.resume(root, current, gitClient)
      : await local.verify(context)
    if (selected.verifyOnly) {
      console.log(`本机完整验收通过：${current.version}；记录位于 ${local.reportFile}`)
      return
    }
    const client = createClient({ repository: current.repository, token: credential() })
    try {
      return await local.publish({ ...context, client }, report, { notes, dryRun: selected.dryRun })
    } finally {
      client.close()
    }
  } finally {
    unlock()
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
module.exports = { options, lock, main }
