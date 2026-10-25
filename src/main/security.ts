import { resolve, relative, isAbsolute, sep } from 'node:path'
export function isTrustedUrl(value: string, developmentUrl?: string): boolean {
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'mymap:' && url.hostname === 'app') ||
      Boolean(developmentUrl && url.origin === new URL(developmentUrl).origin)
    )
  } catch {
    return false
  }
}
export function allowedRequest(value: string, developmentUrl?: string): boolean {
  try {
    const url = new URL(value)
    if (['mymap:', 'mymap-media:', 'data:', 'blob:', 'devtools:'].includes(url.protocol)) return true
    if (developmentUrl) {
      const dev = new URL(developmentUrl)
      return ['http:', 'ws:'].includes(url.protocol) && url.hostname === dev.hostname && url.port === dev.port
    }
    return false
  } catch {
    return false
  }
}
export function assetPath(root: string, value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'mymap:' || url.hostname !== 'app') throw new Error('无效资源来源')
  const raw = decodeURIComponent(url.pathname)
  if (
    raw.includes('\0') ||
    raw.includes('\\') ||
    raw.split('/').some((part) => part === '..' || part === '.')
  )
    throw new Error('无效资源路径')
  const target = resolve(root, '.' + (raw === '/' ? '/index.html' : raw))
  const rel = relative(resolve(root), target)
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('资源路径超出范围')
  return target
}
export function mediaRequest(value: string): { id: string; variant: 'thumb' | 'preview' | 'original' } {
  const url = new URL(value)
  const match = /^\/([a-zA-Z0-9_-]+)\/(thumb|preview|original)$/.exec(decodeURIComponent(url.pathname))
  if (url.protocol !== 'mymap-media:' || url.hostname !== 'photo' || !match) throw new Error('无效照片地址')
  return { id: match[1], variant: match[2] as 'thumb' | 'preview' | 'original' }
}
