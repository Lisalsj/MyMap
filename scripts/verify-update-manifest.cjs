const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const yaml = require('js-yaml')

async function verify(root = 'release', version = require('../package.json').version) {
  const asar = require('@electron/asar')
  const archive = path.join(root, 'win-unpacked/resources/app.asar')
  const main = asar.extractFile(archive, path.join('out', 'main', 'index.js')).toString()
  if (main.includes('http://127.0.0.1:') || main.includes('update-lifecycle-'))
    throw Error('Test update configuration found in a production build')
  const config = yaml.load(fs.readFileSync(path.join(root, 'win-unpacked/resources/app-update.yml'), 'utf8'))
  if (config.provider !== 'github' || config.owner !== 'Lisalsj' || config.repo !== 'MyMap')
    throw Error('Production updater points at an unexpected provider')
  const manifest = yaml.load(fs.readFileSync(path.join(root, 'latest.yml'), 'utf8'))
  const name = `MyMap-${version}-Setup-x64.exe`
  const file = manifest.files?.find((item) => item.url === name)
  if (
    manifest.version !== version ||
    !file ||
    manifest.files.length !== 1 ||
    manifest.path !== name ||
    manifest.sha512 !== file.sha512
  )
    throw Error('Update manifest does not identify the expected NSIS installer')
  const hash = createHash('sha512')
  for await (const chunk of fs.createReadStream(path.join(root, name))) hash.update(chunk)
  const size = fs.statSync(path.join(root, name)).size
  if (file.sha512 !== hash.digest('base64') || (file.size && file.size !== size))
    throw Error('Installer and update manifest checksum/size differ')
  if (!file.size) {
    file.size = size
    fs.writeFileSync(path.join(root, 'latest.yml'), yaml.dump(manifest))
  }
  console.log(`Verified update manifest and NSIS installer: ${version}`)
}
if (require.main === module)
  verify().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
module.exports = { verify }
