import type { UpdateAdapter } from './updates'
import { updateRequestAllowed } from './updates'
import { app } from 'electron'

export async function createUpdaterAdapter(): Promise<UpdateAdapter> {
  const { NsisUpdater, CancellationToken } = await import('electron-updater')
  const { ElectronAppAdapter } = await import('electron-updater/out/ElectronAppAdapter')
  const { ElectronHttpExecutor } = await import('electron-updater/out/electronHttpExecutor')
  const testFeed = __MYMAP_UPDATE_TEST_URL__
  const adapter = new (class extends ElectronAppAdapter {
    override get baseCachePath() {
      return app.getPath('userData')
    }
  })()
  class AbortableExecutor extends ElectronHttpExecutor {
    private requests = new Set<Electron.ClientRequest>()
    override createRequest(...args: Parameters<InstanceType<typeof ElectronHttpExecutor>['createRequest']>) {
      const [options, onResponse] = args
      const request = super.createRequest(options, (response) => {
        const release = () => this.requests.delete(request)
        response.once('end', release)
        response.once('close', release)
        response.once('error', release)
        onResponse(response)
      })
      this.requests.add(request)
      // Electron can close the outgoing GET body before the response is delivered.
      // Keep tracking until its response finishes, or the request aborts/fails.
      request.once('abort', () => this.requests.delete(request))
      request.once('error', () => this.requests.delete(request))
      return request
    }
    abortDownloads() {
      for (const request of this.requests) request.abort()
      this.requests.clear()
    }
  }
  class LocalUpdater extends NsisUpdater {
    protected override readonly app = adapter
    readonly httpExecutor = new AbortableExecutor((info, callback) => this.emit('login', info, callback))
  }
  const updater = new LocalUpdater()
  // Configure the fixed provider after the request-tracking executor is initialized.
  updater.setFeedURL(
    testFeed
      ? { provider: 'generic', url: testFeed }
      : { provider: 'github', owner: 'Lisalsj', repo: 'MyMap', private: false }
  )
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.allowPrerelease = false
  updater.allowDowngrade = false
  updater.disableDifferentialDownload = true
  updater.disableWebInstaller = true
  updater.logger = testFeed ? console : null
  updater.netSession.setPermissionRequestHandler((_web, _permission, callback) => callback(false))
  updater.netSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const localTestRequest = testFeed && new URL(details.url).origin === new URL(testFeed).origin
    callback({ cancel: !localTestRequest && !updateRequestAllowed(details.url) })
  })
  // check/download also reject; listen to EventEmitter errors to avoid an uncaught exception.
  updater.on('error', () => {})
  let cancellation: InstanceType<typeof CancellationToken> | undefined
  return {
    async check() {
      const result = await updater.checkForUpdates()
      if (!result?.isUpdateAvailable) return null
      const info = result.updateInfo
      const installer = info.files.find((file) => file.url.endsWith('.exe'))
      if (!installer || !installer.sha512) throw Error('更新元数据缺少安装程序校验值')
      const notes =
        typeof info.releaseNotes === 'string'
          ? info.releaseNotes
          : (info.releaseNotes || []).map((note) => note.note || '').join('\n')
      return {
        version: info.version,
        notes: notes.replace(/<[^>]*>/g, '').slice(0, 4000),
        size: installer.size || 0
      }
    },
    async download(progress) {
      cancellation = new CancellationToken()
      const listener = (value: { percent: number; transferred: number }) =>
        progress(value.percent, value.transferred)
      updater.on('download-progress', listener)
      try {
        await updater.downloadUpdate(cancellation)
      } finally {
        updater.removeListener('download-progress', listener)
        cancellation = undefined
      }
    },
    cancel() {
      cancellation?.cancel()
      // The pinned runtime rejects its stream promise on cancellation but can leave
      // the Electron request alive. Abort it explicitly, including redirect requests.
      updater.httpExecutor.abortDownloads()
    },
    install() {
      updater.quitAndInstall(true, true)
    }
  }
}
