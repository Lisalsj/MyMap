const { mkdirSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

// Generated evidence stays outside the maintained documentation and is overwritten
// on each run. Version and environment details belong inside the report itself.
const reportsDirectory = resolve('test-results/reports')
const screenshotsDirectory = resolve('test-results/screenshots')

function reportPath(name) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`Invalid report name: ${name}`)
  return join(reportsDirectory, `${name}.json`)
}

function writeReport(name, value) {
  const target = reportPath(name)
  mkdirSync(reportsDirectory, { recursive: true })
  writeFileSync(target, JSON.stringify(value, null, 2) + '\n')
  return target
}

module.exports = { reportPath, writeReport, screenshotsDirectory }
