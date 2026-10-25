import { statSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
import sharp from 'sharp'
import exifr from 'exifr'
import { basename } from 'node:path'
import { atomicWrite, managedPath, sha256 } from './files'
import type { Photo } from '../shared/types'

// libvips' file cache otherwise keeps Windows file handles open after a read.
sharp.cache(false)

/** A camera's wall-clock time belongs to the trip's local day, independent of the host timezone. */
function cameraLocalTime(exif: any): string {
  for (const [raw, rawOffset] of [
    [exif?.DateTimeOriginal, exif?.OffsetTimeOriginal],
    [exif?.CreateDate, exif?.OffsetTimeDigitized]
  ]) {
    if (typeof raw !== 'string') continue
    const match =
      /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?(?:\s*(Z|UTC|[+-]\d{2}:?\d{2}))?$/.exec(
        raw.trim()
      )
    if (!match) continue
    const [, year, month, day, hour, minute, second, fraction = '', embeddedOffset] = match
    const dayText = `${year}-${month}-${day}`
    const calendarDate = new Date(`${dayText}T00:00:00Z`)
    if (
      !Number.isFinite(calendarDate.getTime()) ||
      calendarDate.toISOString().slice(0, 10) !== dayText ||
      Number(hour) > 23 ||
      Number(minute) > 59 ||
      Number(second) > 59
    )
      continue
    const candidateOffset = embeddedOffset || (typeof rawOffset === 'string' ? rawOffset.trim() : '')
    let offset = ''
    if (candidateOffset === 'Z' || candidateOffset === 'UTC') offset = 'Z'
    else {
      const parts = /^([+-])(\d{2}):?(\d{2})$/.exec(candidateOffset)
      if (
        parts &&
        Number(parts[2]) <= 14 &&
        Number(parts[3]) <= 59 &&
        (Number(parts[2]) !== 14 || parts[3] === '00')
      )
        offset = `${parts[1]}${parts[2]}:${parts[3]}`
    }
    return `${dayText}T${hour}:${minute}:${second}${fraction}${offset}`
  }
  return ''
}

export async function inspectImage(source: string) {
  const stat = statSync(source)
  if (!stat.isFile() || stat.size > 100 * 1024 * 1024) throw new Error('照片必须是小于 100 MB 的文件')
  const bytes = readFileSync(source)
  const metadata = await sharp(bytes, { limitInputPixels: 80_000_000, animated: false }).metadata()
  if (!['jpeg', 'png', 'webp'].includes(metadata.format || ''))
    throw new Error('仅支持 JPEG、PNG 和 WebP 照片')
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > 80_000_000)
    throw new Error('照片超过 8000 万像素限制')
  let exif: any = null
  // exifr's default Date reviver uses the host timezone; retain the original EXIF date string.
  try {
    exif = await exifr.parse(bytes, { gps: true, tiff: true, exif: true, reviveValues: false })
  } catch {
    /* Valid images need not have readable EXIF. */
  }
  const capturedAt = cameraLocalTime(exif)
  const lat = typeof exif?.latitude === 'number' && Math.abs(exif.latitude) <= 90 ? exif.latitude : null
  const lon = typeof exif?.longitude === 'number' && Math.abs(exif.longitude) <= 180 ? exif.longitude : null
  const rotated = [5, 6, 7, 8].includes(metadata.orientation || 1)
  return {
    bytes,
    hash: sha256(bytes),
    originalName: basename(source),
    mime: `image/${metadata.format === 'jpeg' ? 'jpeg' : metadata.format}`,
    ext: metadata.format === 'jpeg' ? 'jpg' : metadata.format!,
    width: rotated ? metadata.height : metadata.width,
    height: rotated ? metadata.width : metadata.height,
    size: bytes.length,
    capturedAt,
    lat,
    lon
  }
}
export async function createPreviews(
  root: string,
  photo: Pick<Photo, 'originalPath' | 'previewPath' | 'thumbPath'>
): Promise<void> {
  validateMediaPaths(photo)
  const original = readFileSync(managedPath(root, photo.originalPath))
  for (const [path, edge] of [
    [photo.thumbPath, 640],
    [photo.previewPath, 2000]
  ] as const) {
    const output = managedPath(root, path)
    if (!existsSync(output))
      atomicWrite(
        output,
        await sharp(original, { limitInputPixels: 80_000_000 })
          .rotate()
          .resize(edge, edge, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer()
      )
  }
}
export function removeMedia(
  root: string,
  photo: Pick<Photo, 'originalPath' | 'previewPath' | 'thumbPath'>
): void {
  validateMediaPaths(photo)
  for (const path of [photo.originalPath, photo.previewPath, photo.thumbPath]) {
    const file = managedPath(root, path)
    if (existsSync(file)) unlinkSync(file)
  }
}
export function validateMediaPaths(photo: Pick<Photo, 'originalPath' | 'previewPath' | 'thumbPath'>): void {
  if (
    !/^originals\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(photo.originalPath) ||
    !/^previews\/[a-zA-Z0-9-]+\.webp$/.test(photo.previewPath) ||
    !/^thumbs\/[a-zA-Z0-9-]+\.webp$/.test(photo.thumbPath)
  )
    throw new Error('照片路径不属于受管理的媒体目录')
}
