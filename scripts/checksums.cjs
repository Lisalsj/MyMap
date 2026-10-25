const { createHash } = require('node:crypto')
const { createReadStream, readdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
async function main() {
  const lines = []
  for (const file of readdirSync('release')
    .filter((name) => name.endsWith('.exe'))
    .sort()) {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(join('release', file))) hash.update(chunk)
    lines.push(`${hash.digest('hex')}  ${file}`)
  }
  if (!lines.length) throw new Error('No Windows executables to checksum')
  writeFileSync('release/SHA256SUMS.txt', lines.join('\n') + '\n')
  console.log(lines.join('\n'))
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
