const fs = require('node:fs')
const path = require('node:path')
const LANGUAGES = new Set(['en-US.pak', 'zh-CN.pak', 'zh-TW.pak'])
function trimDistribution(appOutDir, outputRoot) {
  const root = path.resolve(outputRoot)
  const app = path.resolve(appOutDir)
  const relative = path.relative(root, app)
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
    throw new Error('Cleanup target is outside the build output 范围')
  if (fs.existsSync(app) && fs.lstatSync(app).isSymbolicLink())
    throw new Error('Build output cannot be a link')
  const locales = path.join(app, 'locales')
  if (fs.existsSync(locales)) {
    if (fs.lstatSync(locales).isSymbolicLink()) throw new Error('Locale directory cannot be a link')
    for (const name of fs.readdirSync(locales))
      if (name.endsWith('.pak') && !LANGUAGES.has(name)) fs.unlinkSync(path.join(locales, name))
  }
  for (const relativeName of ['resources/default_app.asar', 'version']) {
    const target = path.join(app, relativeName)
    if (fs.existsSync(target) && !fs.lstatSync(target).isDirectory()) fs.unlinkSync(target)
  }
}
module.exports = async (context) => trimDistribution(context.appOutDir, context.outDir)
module.exports.trimDistribution = trimDistribution
