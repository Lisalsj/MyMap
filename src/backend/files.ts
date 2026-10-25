import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
/** Every persisted media path is a portable path beneath the managed library. */
export function managedPath(root: string, path: string): string {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes('\\') ||
    path.includes(':') ||
    path.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw new Error('不安全的资料路径')
  const base = resolve(root)
  const target = resolve(base, path)
  if (relative(base, target).startsWith(`..${sep}`) || target === base) throw new Error('资料路径越界')
  let current = base
  if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error('资料目录不能是符号链接')
  for (const component of path.split('/')) {
    current = join(current, component)
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw new Error('资料路径不能包含符号链接')
  }
  return target
}
export function emptyDirectory(path: string): string {
  const target = resolve(path)
  if (existsSync(target) && (lstatSync(target).isSymbolicLink() || !lstatSync(target).isDirectory()))
    throw new Error('请选择普通空文件夹')
  mkdirSync(target, { recursive: true })
  if (readdirSync(target).length) throw new Error('目标必须是空文件夹')
  return realpathSync(target)
}
export function atomicWrite(path: string, data: Buffer | string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, data, { flag: 'wx' })
    renameSync(temporary, path)
  } catch (error) {
    try {
      unlinkSync(temporary)
    } catch {}
    throw error
  }
}
export const fileHash = (path: string) => sha256(readFileSync(path))
