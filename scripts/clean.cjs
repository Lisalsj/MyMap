const { resolve } = require('node:path')
const { createPlan, applyPlan } = require('./lib/cleanup.cjs')

async function main(args = process.argv.slice(2)) {
  if (args.some((arg) => arg !== '--apply') || args.length > 1)
    throw Error('用法：npm run clean [-- --apply]')
  const plan = createPlan(resolve(__dirname, '..'))
  const size = (bytes) => `${(bytes / 1024 ** 3).toFixed(2)} GiB`
  console.log(args.length ? '执行生成物清理' : '清理预览（未删除文件）')
  for (const item of plan.candidates) console.log(`删除：${item.path} · ${size(item.bytes)}`)
  for (const item of plan.evidence) console.log(`保留摘要：${item.source} → ${item.destination}`)
  for (const item of plan.skipped) console.log(`跳过：${item.path} · ${item.reason}`)
  console.log(`保留：${plan.preserve.join('、')}`)
  console.log(`预计释放：${size(plan.estimatedBytes)}`)
  if (plan.blocked.length) throw Error(`活动任务阻止清理：${plan.blocked.join('；')}`)
  if (args.length) {
    const result = await applyPlan(plan)
    console.log(
      `清理完成：${result.deleted.length} 项，释放 ${size(result.freedBytes)}；${result.artifacts.length ? '当前发行文件哈希未变' : '发行目录已保留'}。`
    )
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
