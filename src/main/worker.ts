import { LibraryService } from '../backend/library'
import type { ImportProgress } from '../shared/types'

type Message = { id: number; method: string; args: unknown[] }
const port = process.parentPort!
let library: LibraryService | undefined
let importing: Promise<unknown> | null = null
let operation: Promise<unknown> | null = null
let switching = false
let stopping = false
const methods = new Set([
  'snapshot',
  'saveTrip',
  'saveEntry',
  'saveVisit',
  'deleteVisit',
  'reorderVisits',
  'trash',
  'restore',
  'emptyTrash',
  'updateAttachment',
  'confirmPhotoLocation',
  'photoPath',
  'cancelImport',
  'importProgress',
  'backup',
  'exportEntry'
])
port.on('message', async ({ data }: { data: Message }) => {
  try {
    const { method, args } = data
    if (stopping && method !== 'shutdown') throw new Error('资料服务正在安全关闭')
    if (switching && method !== 'shutdown') throw new Error('资料库正在切换，请稍候')
    let result: unknown
    if (method === 'init') {
      if (importing || operation) throw new Error('请等待照片导入或备份结束后再切换资料库')
      const [path, isDemo, assetsPath] = args as [string, boolean, string]
      if (library?.snapshot().library.path === path) result = library.snapshot()
      else {
        switching = true
        try {
          const next = new LibraryService(path, { isDemo, assetsPath })
          try {
            if (isDemo) await next.seedDemo()
            library?.close()
          } catch (error) {
            next.close()
            throw error
          }
          library = next
          result = library.snapshot()
        } finally {
          switching = false
        }
      }
    } else if (method === 'restoreBackup') {
      if (importing || operation) throw new Error('请先结束照片导入或备份')
      const task = LibraryService.restoreBackup(args[0] as string, args[1] as string)
      operation = task
      try {
        await task
        result = args[1]
      } finally {
        operation = null
      }
    } else if (method === 'shutdown') {
      stopping = true
      library?.cancelImport()
      await Promise.allSettled([importing, operation])
      library?.close()
      result = true
    } else if (method === 'importPhotos') {
      if (!library) throw new Error('资料库尚未打开')
      if (importing) throw new Error('已有照片导入任务，请等待完成')
      const task = library.importPhotos(
        args[0] as string[],
        args[1] as string,
        args[2] as never,
        (progress: ImportProgress) => port.postMessage({ event: 'progress', progress })
      )
      importing = task
      try {
        result = await task
      } finally {
        importing = null
      }
    } else {
      if (!library || !methods.has(method)) throw new Error('无效资料库操作')
      const fn = (library as unknown as Record<string, (...values: unknown[]) => unknown>)[method]
      if (operation && ['backup', 'emptyTrash', 'exportEntry'].includes(method))
        throw new Error('已有资料任务正在处理')
      const task = Promise.resolve(fn.apply(library, args))
      if (['backup', 'emptyTrash', 'exportEntry'].includes(method)) {
        operation = task
        try {
          result = await task
        } finally {
          operation = null
        }
      } else result = await task
    }
    port.postMessage({ id: data.id, result })
  } catch (error) {
    port.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) })
  }
})
process.on('exit', () => {
  try {
    library?.close()
  } catch {
    /* OS releases handles */
  }
})
