import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell, utilityProcess } from 'electron'
import { join, resolve } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type { AppSnapshot, ImportProgress } from '../shared/types'
import { assetPath, isTrustedUrl, allowedRequest, mediaRequest } from './security'
import { version as appVersion } from '../../package.json'
import { UpdateService, type UpdatePreferences } from './updates'
import { createUpdaterAdapter } from './updaterAdapter'

const developmentUrl = process.env.ELECTRON_RENDERER_URL
const profile =
  process.env.MYMAP_TEST_ROOT ||
  __MYMAP_UPDATE_TEST_ROOT__ ||
  join(process.env.LOCALAPPDATA || app.getPath('appData'), app.isPackaged ? 'MyMap' : 'MyMap-development')
mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('disable-component-update')
app.commandLine.appendSwitch('disable-domain-reliability')
app.commandLine.appendSwitch('disable-features', 'MediaRouter,OptimizationHints')
if (__MYMAP_UPDATE_TEST_URL__ && /^\d{2,5}$/.test(__MYMAP_UPDATE_TEST_DEBUG_PORT__))
  app.commandLine.appendSwitch('remote-debugging-port', __MYMAP_UPDATE_TEST_DEBUG_PORT__)
protocol.registerSchemesAsPrivileged([
  { scheme: 'mymap', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'mymap-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])
const settingsFile = join(profile, 'settings.json')
let personalLibrary = join(profile, 'Library')
let updatePreferences: UpdatePreferences = { enabled: null }
try {
  const value = JSON.parse(readFileSync(settingsFile, 'utf8'))
  if (typeof value.library === 'string' && value.library) personalLibrary = resolve(value.library)
  if (value.updates && typeof value.updates.enabled === 'boolean')
    updatePreferences.enabled = value.updates.enabled
  if (Number.isFinite(value.updates?.lastAttemptAt) && value.updates.lastAttemptAt > 0)
    updatePreferences.lastAttemptAt = value.updates.lastAttemptAt
} catch {
  /* first launch */
}
let demo = process.env.MYMAP_DEMO === '1'
let window: BrowserWindow | null = null
let worker: Electron.UtilityProcess | null = null
let initialLibrary: Promise<unknown> | undefined
let nextId = 0,
  closing = false,
  allowClose = false,
  dataReady = false
let flushTimer: NodeJS.Timeout | undefined
const pending = new Map<
  number,
  { method: string; resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
>()
const assetsRoot = app.isPackaged
  ? join(process.resourcesPath, 'data')
  : resolve(__dirname, '../../resources')
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
    pending.set(id, { method, resolve: res, reject, timer })
    worker.postMessage({ id, method, args })
  })
}
function saveSettings(): void {
  const temp = `${settingsFile}.tmp`
  writeFileSync(temp, JSON.stringify({ library: personalLibrary, updates: updatePreferences }, null, 2))
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
const updates = new UpdateService({
  currentVersion: app.getVersion?.() || appVersion,
  supported: app.isPackaged,
  portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
  preferences: updatePreferences,
  save: (preferences) => {
    const previous = updatePreferences
    updatePreferences = { ...preferences }
    try {
      saveSettings()
    } catch (error) {
      updatePreferences = previous
      throw error
    }
  },
  createAdapter: createUpdaterAdapter,
  changed: (state) => window?.webContents.send('mymap:update', state)
})
let updateExit: { resolve: () => void; reject: (error: Error) => void } | undefined
function rejectUpdateExit(error: unknown) {
  updateExit?.reject(error instanceof Error ? error : Error(String(error)))
  updateExit = undefined
}
function libraryOperationRunning() {
  return [...pending.values()].some((request) =>
    ['backup', 'restoreBackup', 'importPhotos', 'init', 'exportEntry'].includes(request.method)
  )
}
async function handle(method: string, args: any[]): Promise<any> {
  if (method === 'updateState') return updates.snapshot()
  if (method === 'setUpdateChecks') {
    if (typeof args[0] !== 'boolean') throw Error('无效更新设置')
    return updates.setEnabled(args[0])
  }
  if (method === 'checkForUpdates') return updates.check()
  if (method === 'downloadUpdate') return updates.download()
  if (method === 'cancelUpdateDownload') return updates.cancel()
  if (method === 'openUpdateDownload')
    return shell.openExternal('https://github.com/Lisalsj/MyMap/releases/latest')
  if (method === 'installUpdate') {
    if (closing || updates.snapshot().stage !== 'ready') throw Error('当前没有可安装的更新，或程序正在退出。')
    if (libraryOperationRunning() || (await rpc<ImportProgress>('importProgress')).running)
      throw Error('请等待照片导入、备份或恢复完成后再更新。')
    if (closing || libraryOperationRunning()) throw Error('请等待当前资料操作完成后再更新。')
    return new Promise<void>((resolve, reject) => {
      updateExit = { resolve, reject }
      window!.close()
    })
  }
  if (method === 'snapshot') return rpc<AppSnapshot>('snapshot')
  if (forwarded.has(method)) return rpc(method, ...args)
  if (method === 'cities')
    return rpc('cities', typeof args[0] === 'string' ? args[0].trim().toLocaleLowerCase().slice(0, 120) : '')
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
  updates.dispose()
  await initialLibrary?.catch(() => {})
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
function createLibraryWorker() {
  const instance = utilityProcess.fork(join(__dirname, 'worker.js'), [], {
    serviceName: 'MyMap 本地资料服务',
    stdio: 'pipe'
  })
  worker = instance
  instance.stderr?.on('data', (data) => {
    if (process.env.MYMAP_TEST_ROOT || !app.isPackaged) process.stderr.write(data)
  })
  instance.on('message', (message: any) => {
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
  instance.on('exit', (code) => {
    if (worker !== instance) return
    worker = null
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error(`资料服务已停止（${code}），请重新打开程序`))
    }
    pending.clear()
  })
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
      createLibraryWorker()
      // Start Chromium and the local library together. Renderer calls wait for the
      // initial library, while the window, fonts and page modules can load in parallel.
      initialLibrary = rpc('init', demo ? join(profile, 'Demo') : personalLibrary, demo, assetsRoot)
      void initialLibrary.catch(async (error) => {
        reportStartupError('无法打开 MyMap 资料库', error)
        await shutdown()
      })
      protocol.handle('mymap', async (request) => {
        try {
          const file = assetPath(join(__dirname, '../renderer'), request.url)
          if (!existsSync(file)) return new Response('Not found', { status: 404 })
          const response = await net.fetch(pathToFileURL(file).toString())
          const headers = new Headers(response.headers)
          headers.set(
            'Content-Security-Policy',
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' mymap-media: data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'"
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
      ipcMain.handle('mymap:call', async (event, method: unknown, args: unknown) => {
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
        await initialLibrary
        return handle(method, args)
      })
      ipcMain.on('mymap:map-ready', (event) => {
        if (
          event.sender.id === window?.webContents.id &&
          isTrustedUrl(event.senderFrame?.url || '', developmentUrl)
        )
          updates.uiReady()
      })
      ipcMain.on('mymap:ready', (event) => {
        if (event.sender.id === window?.webContents.id) dataReady = true
      })
      ipcMain.on('mymap:flushed', async (event) => {
        if (!closing || event.sender.id !== window?.webContents.id) return
        clearTimeout(flushTimer)
        flushTimer = undefined
        try {
          await initialLibrary
          const progress = await rpc<ImportProgress>('importProgress')
          if (updateExit) {
            if (progress.running || libraryOperationRunning()) {
              rejectUpdateExit(Error('请等待照片导入、备份或恢复完成后再更新。'))
              resumeEditing()
              return
            }
            let stopped = false
            try {
              await rpc('shutdown')
              stopped = true
              await updates.install()
              allowClose = true
              updates.dispose()
              worker?.kill()
              worker = null
              updateExit.resolve()
              updateExit = undefined
            } catch (error) {
              if (stopped) {
                const previous = worker
                worker = null
                previous?.kill()
                createLibraryWorker()
                await rpc('init', demo ? join(profile, 'Demo') : personalLibrary, demo, assetsRoot).catch(
                  () => {}
                )
              }
              rejectUpdateExit(error)
              resumeEditing()
            }
            return
          }
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
          if (updateExit) {
            rejectUpdateExit(error)
            resumeEditing()
            return
          }
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
        if (closing && event.sender.id === window?.webContents.id) {
          rejectUpdateExit(Error('当前草稿未保存，更新已取消。'))
          resumeEditing()
        }
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
            rejectUpdateExit(Error('退出前保存超时，更新已取消。'))
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
