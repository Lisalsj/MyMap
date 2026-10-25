import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const roots: string[] = []
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'mymap-distribution-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.length = 0
})
it('removes only redundant locale and default-app files while preserving native runtime and licenses', () => {
  const { trimDistribution } = require('../scripts/after-pack.cjs')
  const root = fixture(),
    output = join(root, 'release'),
    app = join(output, 'win-unpacked')
  mkdirSync(join(app, 'locales'), { recursive: true })
  mkdirSync(join(app, 'resources'), { recursive: true })
  for (const file of ['en-US.pak', 'zh-CN.pak', 'zh-TW.pak', 'fr.pak', 'ja.pak'])
    writeFileSync(join(app, 'locales', file), 'locale')
  for (const file of ['ffmpeg.dll', 'icudtl.dat', 'vk_swiftshader.dll', 'LICENSES.chromium.html', 'version'])
    writeFileSync(join(app, file), 'runtime')
  writeFileSync(join(app, 'resources', 'app.asar'), 'application')
  writeFileSync(join(app, 'resources', 'default_app.asar'), 'default')
  trimDistribution(app, output)
  expect(existsSync(join(app, 'locales', 'fr.pak'))).toBe(false)
  expect(existsSync(join(app, 'locales', 'ja.pak'))).toBe(false)
  expect(existsSync(join(app, 'locales', 'zh-CN.pak'))).toBe(true)
  expect(existsSync(join(app, 'locales', 'en-US.pak'))).toBe(true)
  for (const file of ['ffmpeg.dll', 'icudtl.dat', 'vk_swiftshader.dll', 'LICENSES.chromium.html'])
    expect(existsSync(join(app, file))).toBe(true)
  expect(existsSync(join(app, 'resources', 'app.asar'))).toBe(true)
  expect(existsSync(join(app, 'resources', 'default_app.asar'))).toBe(false)
  expect(existsSync(join(app, 'version'))).toBe(false)
})
it('refuses a cleanup target outside the intended build output', () => {
  const { trimDistribution } = require('../scripts/after-pack.cjs')
  const root = fixture()
  const outside = join(root, 'outside')
  mkdirSync(outside)
  writeFileSync(join(outside, 'version'), 'keep')
  expect(() => trimDistribution(outside, join(root, 'release'))).toThrow(/outside|范围/)
  expect(existsSync(join(outside, 'version'))).toBe(true)
})
