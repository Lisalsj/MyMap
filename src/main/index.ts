import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell, utilityProcess } from 'electron'
import { join, resolve } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type { AppSnapshot, City, ImportProgress } from '../shared/types'
import { loadCities } from '../shared/cities'
import { assetPath, isTrustedUrl, allowedRequest, mediaRequest } from './security'

const developmentUrl = process.env.ELECTRON_RENDERER_URL
const profile =
  process.env.MYMAP_TEST_ROOT ||
  join(process.env.LOCALAPPDATA || app.getPath('appData'), app.isPackaged ? 'MyMap' : 'MyMap-development')
mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('disable-component-update')
app.commandLine.appendSwitch('disable-domain-reliability')
app.commandLine.appendSwitch('disable-features', 'MediaRouter,OptimizationHints')
protocol.registerSchemesAsPrivileged([
  { scheme: 'mymap', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'mymap-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])
const settingsFile = join(profile, 'settings.json')
let personalLibrary = join(profile, 'Library')
try {
  const value = JSON.parse(readFileSync(settingsFile, 'utf8'))
  if (typeof value.library === 'string' && value.library) personalLibrary = resolve(value.library)
} catch {
  /* first launch */
}
let demo = process.env.MYMAP_DEMO === '1'
let window: BrowserWindow | null = null
let worker: Electron.UtilityProcess | null = null
let nextId = 0,
  closing = false,
  allowClose = false,
  dataReady = false
let flushTimer: NodeJS.Timeout | undefined
const pending = new Map<
  number,
  { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
>()
const assetsRoot = app.isPackaged
  ? join(process.resourcesPath, 'data')
  : resolve(__dirname, '../../resources')
let cities: City[] = []
function rpc<T = any>(method: string, ...args: unknown[]): Promise<T> {
  return new Promise((res, reject) => {
    if (!worker) return reject(new Error('资料服务尚未就绪'))
    const id = ++nextId
    const timer = setTimeout(
      () => {
        pending.delete(id)
        reject(new Error('操作耗时过长，请检查资料库磁盘是否可用'))
      },
      ['importPhotos', 'backup', 'restoreBackup', 'shutdown'].includes(method) ? 3600000 : 30000
    )
    pending.set(id, { resolve: res, reject, timer })
    worker.postMessage({ id, method, args })
  })
}
function saveSettings(): void {
  const temp = `${settingsFile}.tmp`
  writeFileSync(temp, JSON.stringify({ library: personalLibrary }, null, 2))
  require('node:fs').renameSync(temp, settingsFile)
}
async function switchLibrary(path: string, isDemo: boolean): Promise<void> {
  await rpc('init', path, isDemo, assetsRoot)
  demo = isDemo
  if (!isDemo) {
    personalLibrary = path
    saveSettings()
  }
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
function reportStartupError(title: string, error: unknown): void {
  if (process.env.MYMAP_TEST_HEADLESS === '1') console.error(title, String(error))
  else dialog.showErrorBox(title, String(error))
}
async function selectFolder(title: string): Promise<string | null> {
  const response = await dialog.showOpenDialog(window!, {
    title,
    properties: ['openDirectory', 'createDirectory']
  })
  return response.canceled ? null : response.filePaths[0] || null
}
const forwarded = new Set([
  'saveTrip',
  'saveEntry',
  'saveVisit',
  'deleteVisit',
  'reorderVisits',
  'trash',
  'restore',
  'emptyTrash',
  'cancelImport',
  'importProgress',
  'updateAttachment',
  'confirmPhotoLocation'
])
async function handle(method: string, args: any[]): Promise<any> {
  if (method === 'snapshot') return rpc<AppSnapshot>('snapshot')
  if (forwarded.has(method)) return rpc(method, ...args)
  if (method === 'cities') {
    const query = typeof args[0] === 'string' ? args[0].trim().toLocaleLowerCase().slice(0, 120) : ''
    if (!query) return cities.filter((city) => city.country === 'CN').slice(0, 12)
    return cities
      .filter((city) =>
        `${city.name} ${city.aliases} ${city.country} ${city.region}`.toLocaleLowerCase().includes(query)
      )
      .sort((a, b) => Number(b.name === query) - Number(a.name === query) || b.population - a.population)
      .slice(0, 30)
  }
  if (method === 'importPhotos' || method === 'importDroppedPhotos') {
    let paths: string[]
    if (method === 'importPhotos') {
      const result = await dialog.showOpenDialog(window!, {
        title: '选择旅行照片 · 原图只复制到本地资料库',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '照片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
      })
      if (result.canceled) return
      paths = result.filePaths
    } else {
      paths = args[1]
      if (!Array.isArray(paths) || paths.length > 20000 || paths.some((p) => typeof p !== 'string' || !p))
        throw new Error('无效照片列表')
    }
    await rpc('importPhotos', paths, args[0], (method === 'importPhotos' ? args[1] : args[2]) || {})
    return
  }
  if (method === 'setDemo') {
    if (typeof args[0] !== 'boolean') throw new Error('无效模式')
    await switchLibrary(args[0] ? join(profile, 'Demo') : personalLibrary, args[0])
    return
  }
  if (method === 'chooseLibrary') {
    const selected = await selectFolder('选择或创建本地资料库文件夹')
    if (!selected) return null
    const path = resolve(selected)
    const appDir = resolve(app.getAppPath())
    if (path === appDir || path.startsWith(appDir + require('node:path').sep))
      throw new Error('请选择程序目录之外的资料库文件夹')
    await switchLibrary(path, false)
    return path
  }
  if (method === 'openLibraryFolder') {
    const snapshot = await rpc<AppSnapshot>('snapshot')
    const error = await shell.openPath(snapshot.library.path)
    if (error) throw new Error(error)
    return
  }
  if (method === 'backup') {
    const parent = await selectFolder('选择备份保存位置 · 将自动创建完整备份文件夹')
    if (!parent) return null
    return rpc('backup', join(parent, `MyMap-backup-${stamp()}`))
  }
  if (method === 'restoreBackup') {
    const source = await selectFolder('选择包含 manifest.json 的 MyMap 备份文件夹')
    if (!source) return null
    const parent = await selectFolder('选择恢复位置 · 将创建新资料库，保留原资料')
    if (!parent) return null
    const destination = join(parent, `MyMap-restored-${stamp()}`)
    await rpc('restoreBackup', source, destination)
    await switchLibrary(destination, false)
    return destination
  }
  if (method === 'exportEntry') {
    const parent = await selectFolder('选择游记导出位置 · 将创建 Markdown 和配图文件夹')
    if (!parent) return null
    return rpc('exportEntry', args[0], join(parent, `MyMap-journal-${stamp()}`))
  }
  throw new Error('不支持的操作')
}
async function shutdown(): Promise<void> {
  try {
    await rpc('shutdown')
  } catch {
    /* worker exit also releases the lock */
  }
  allowClose = true
  worker?.kill()
  worker = null
  window?.destroy()
  app.quit()
}
function resumeEditing(): void {
  clearTimeout(flushTimer)
  flushTimer = undefined
  closing = false
  window?.setEnabled(true)
}
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  app
    .whenReady()
    .then(async () => {
      worker = utilityProcess.fork(join(__dirname, 'worker.js'), [], {
        serviceName: 'MyMap 本地资料服务',
        stdio: 'pipe'
      })
      worker.stderr?.on('data', (data) => {
        if (process.env.MYMAP_TEST_ROOT || !app.isPackaged) process.stderr.write(data)
      })
      worker.on('message', (message: any) => {
        if (message.event === 'progress') {
          window?.webContents.send('mymap:progress', message.progress as ImportProgress)
          return
        }
        const request = pending.get(message.id)
        if (!request) return
        clearTimeout(request.timer)
        pending.delete(message.id)
        message.error ? request.reject(new Error(message.error)) : request.resolve(message.result)
      })
      worker.on('exit', (code) => {
        worker = null
        for (const request of pending.values()) {
          clearTimeout(request.timer)
          request.reject(new Error(`资料服务已停止（${code}），请重新打开程序`))
        }
        pending.clear()
      })
      try {
        cities = loadCities(assetsRoot)
      } catch {
        /* still allow manually entered locations */
      }
      try {
        await rpc('init', demo ? join(profile, 'Demo') : personalLibrary, demo, assetsRoot)
      } catch (error) {
        reportStartupError('无法打开 MyMap 资料库', error)
        await shutdown()
        return
      }
      protocol.handle('mymap', async (request) => {
        try {
          const file = assetPath(join(__dirname, '../renderer'), request.url)
          if (!existsSync(file)) return new Response('Not found', { status: 404 })
          const response = await net.fetch(pathToFileURL(file).toString())
          const headers = new Headers(response.headers)
          headers.set(
            'Content-Security-Policy',
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' mymap-media: data: blob:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'"
          )
          return new Response(response.body, { status: response.status, headers })
        } catch {
          return new Response('Forbidden', { status: 403 })
        }
      })
      protocol.handle('mymap-media', async (request) => {
        try {
          const { id, variant } = mediaRequest(request.url)
          const file = await rpc<string>('photoPath', id, variant)
          return net.fetch(pathToFileURL(file).toString())
        } catch {
          return new Response('Photo unavailable', { status: 404 })
        }
      })
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false)
      )
      session.defaultSession.setPermissionCheckHandler(() => false)
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*'] },
        (details, callback) => callback({ cancel: !allowedRequest(details.url, developmentUrl) })
      )
      window = new BrowserWindow({
        width: 1440,
        height: 940,
        minWidth: 1100,
        minHeight: 720,
        title: 'MyMap · 旅行手账',
        backgroundColor: '#F7F4ED',
        icon: join(assetsRoot, 'icon.png'),
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          spellcheck: false
        }
      })
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) dataReady = false
      })
      window.webContents.on('will-navigate', (event, url) => {
        if (!isTrustedUrl(url, developmentUrl)) event.preventDefault()
      })
      ipcMain.handle('mymap:call', (event, method: unknown, args: unknown) => {
        if (
          event.sender.id !== window?.webContents.id ||
          !event.senderFrame ||
          event.senderFrame !== window.webContents.mainFrame ||
          !isTrustedUrl(event.senderFrame.url, developmentUrl) ||
          typeof method !== 'string' ||
          !Array.isArray(args) ||
          args.length > 5
        )
          throw new Error('无效操作来源')
        return handle(method, args)
      })
      ipcMain.on('mymap:ready', (event) => {
        if (event.sender.id === window?.webContents.id) dataReady = true
      })
      ipcMain.on('mymap:flushed', async (event) => {
        if (!closing || event.sender.id !== window?.webContents.id) return
        clearTimeout(flushTimer)
        flushTimer = undefined
        try {
          const progress = await rpc<ImportProgress>('importProgress')
          if (progress.running) {
            const choice = await dialog.showMessageBox(window!, {
              type: 'question',
              message: '照片仍在导入',
              detail: '退出会停止剩余导入，已完成的照片会保留。',
              buttons: ['继续导入', '停止导入并退出'],
              defaultId: 0,
              cancelId: 0
            })
            if (choice.response === 0) {
              resumeEditing()
              return
            }
          }
          window?.setEnabled(false)
          await shutdown()
        } catch (error) {
          resumeEditing()
          const detail = `${String(error)}\n\n已保存的资料会保留。请先复制保留尚未保存的草稿，再重试关闭或重新打开程序。选择“仍要退出”会关闭当前窗口，未保存的内容需要自行保留。`
          const choice = await dialog
            .showMessageBox(window!, {
              type: 'error',
              message: '无法完成退出前的检查',
              detail,
              buttons: ['返回并保留草稿', '仍要退出'],
              defaultId: 0,
              cancelId: 0
            })
            .catch(() => {
              dialog.showErrorBox('无法完成退出前的检查', detail)
              return { response: 0 }
            })
          if (choice.response === 1) {
            closing = true
            window?.setEnabled(false)
            await shutdown()
          }
        }
      })
      ipcMain.on('mymap:flush-failed', (event) => {
        if (closing && event.sender.id === window?.webContents.id) resumeEditing()
      })
      window.on('close', (event) => {
        if (allowClose) return
        event.preventDefault()
        if (closing) return
        closing = true
        if (!dataReady) {
          void shutdown()
          return
        }
        window?.setEnabled(false)
        window?.webContents.send('mymap:flush')
        flushTimer = setTimeout(() => {
          if (closing && !allowClose) {
            resumeEditing()
            void dialog.showMessageBox(window!, {
              type: 'warning',
              message: '还有内容尚未保存',
              detail: '请检查手账保存状态，保存完成后再退出。'
            })
          }
        }, 15000)
        flushTimer.unref()
      })
      window.once('ready-to-show', () => {
        if (process.env.MYMAP_TEST_HEADLESS !== '1') window?.show()
      })
      if (developmentUrl) await window.loadURL(developmentUrl)
      else await window.loadURL('mymap://app/index.html')
    })
    .catch((error) => {
      // Closing a window can reject an unfinished loadURL with ERR_FAILED.
      // The requested shutdown owns that path; it is not a startup failure.
      if (closing || allowClose || window?.isDestroyed()) return
      // Reloading intentionally aborts the previous navigation while its new document loads.
      if (error && typeof error === 'object' && error.code === 'ERR_ABORTED') return
      reportStartupError('MyMap 启动失败', error)
      worker?.kill()
      app.exit(1)
    })
}
app.on('window-all-closed', () => app.quit())
