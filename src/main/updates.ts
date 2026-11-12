import type { UpdateState } from '../shared/types'

export interface UpdatePreferences {
  enabled: boolean | null
  lastAttemptAt?: number
}
export interface ReleaseInfo {
  version: string
  notes: string
  size: number
}
export interface UpdateAdapter {
  check(): Promise<ReleaseInfo | null>
  download(progress: (percent: number, transferred: number) => void): Promise<void>
  cancel(): void
  install(): void
}
export interface UpdateOptions {
  currentVersion: string
  supported: boolean
  portable: boolean
  preferences: UpdatePreferences
  save: (preferences: UpdatePreferences) => void
  createAdapter: () => Promise<UpdateAdapter>
  changed: (state: UpdateState) => void
  now?: () => number
}
const DAY = 24 * 60 * 60 * 1000

/** User consent gates all scheduled network activity. Download and install are explicit. */
export class UpdateService {
  private state: UpdateState
  private adapter?: Promise<UpdateAdapter>
  private operation?: Promise<UpdateState>
  private timer?: ReturnType<typeof setTimeout>
  private readyAt?: number
  private cancelled = false
  private downloaded = false
  constructor(private options: UpdateOptions) {
    this.state = {
      enabled: options.preferences.enabled,
      supported: options.supported,
      portable: options.portable,
      stage: 'idle',
      currentVersion: options.currentVersion,
      automatic: false
    }
  }
  snapshot() {
    return { ...this.state }
  }
  private emit(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch }
    this.options.changed(this.snapshot())
    return this.snapshot()
  }
  private now() {
    return (this.options.now || Date.now)()
  }
  private getAdapter() {
    return (this.adapter ??= this.options.createAdapter().catch((error) => {
      this.adapter = undefined
      throw error
    }))
  }
  setEnabled(enabled: boolean) {
    this.options.save({ ...this.options.preferences, enabled })
    this.options.preferences.enabled = enabled
    this.emit({ enabled })
    this.schedule()
    return this.snapshot()
  }
  uiReady() {
    if (this.readyAt === undefined) {
      this.readyAt = this.now()
      this.schedule()
    }
  }
  private schedule() {
    clearTimeout(this.timer)
    if (!this.state.enabled || !this.options.supported || this.readyAt === undefined) return
    const lastAttemptAt = Math.min(this.options.preferences.lastAttemptAt || 0, this.now())
    const due = Math.max(this.readyAt + 15000, lastAttemptAt + DAY)
    this.timer = setTimeout(
      () => {
        void Promise.resolve()
          .then(() => this.check(true))
          .catch(() =>
            this.emit({ stage: 'error', automatic: true, error: '更新设置暂时无法保存，请稍后重试。' })
          )
      },
      Math.max(0, due - this.now())
    )
    this.timer.unref?.()
  }
  check(automatic = false): Promise<UpdateState> {
    if (this.operation) return this.operation
    if (!this.options.supported)
      return Promise.resolve(
        this.emit({ stage: 'error', automatic, error: '开发环境不检查正式更新，请使用安装版。' })
      )
    if (automatic && !this.state.enabled) return Promise.resolve(this.snapshot())
    if (this.state.stage === 'ready' || this.state.stage === 'downloading')
      return Promise.resolve(this.snapshot())
    const lastAttemptAt = this.now()
    this.options.save({ ...this.options.preferences, lastAttemptAt })
    this.options.preferences.lastAttemptAt = lastAttemptAt
    this.emit({ stage: 'checking', automatic, error: undefined })
    this.operation = (async () => {
      try {
        const release = await (await this.getAdapter()).check()
        return this.emit({
          stage: release ? 'available' : 'idle',
          lastCheckedAt: this.now(),
          latestVersion: release?.version,
          releaseNotes: release?.notes,
          size: release?.size,
          percent: undefined,
          error: undefined
        })
      } catch {
        return this.emit({ stage: 'error', error: '暂时无法连接更新源，请检查网络或稍后重试。' })
      } finally {
        this.operation = undefined
        this.schedule()
      }
    })()
    return this.operation
  }
  download(): Promise<UpdateState> {
    if (this.operation) return this.operation
    if (this.options.portable) return Promise.reject(Error('免安装版请下载新程序并手动替换。'))
    if (!this.state.latestVersion || !['available', 'error'].includes(this.state.stage))
      return Promise.reject(Error('请先检查是否有新版本。'))
    this.cancelled = false
    this.downloaded = false
    this.emit({ stage: 'downloading', automatic: false, error: undefined, percent: 0, transferred: 0 })
    this.operation = (async () => {
      try {
        const adapter = await this.getAdapter()
        if (this.cancelled) return this.emit({ stage: 'available' })
        await adapter.download((percent, transferred) => this.emit({ percent, transferred }))
        if (this.cancelled) return this.emit({ stage: 'available' })
        this.downloaded = true
        return this.emit({ stage: 'ready', percent: 100 })
      } catch {
        return this.emit({
          stage: this.cancelled ? 'available' : 'error',
          error: this.cancelled ? undefined : '下载或校验失败，更新未安装。请重试下载。'
        })
      } finally {
        this.operation = undefined
      }
    })()
    return this.operation
  }
  async cancel() {
    this.cancelled = true
    if (this.adapter) (await this.adapter).cancel()
  }
  async install() {
    if (!this.downloaded || this.state.stage !== 'ready' || this.options.portable)
      throw Error('没有已校验、可安装的更新。')
    ;(await this.getAdapter()).install()
  }
  dispose() {
    clearTimeout(this.timer)
  }
}

export function updateRequestAllowed(value: string, repository = 'Lisalsj/MyMap') {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443'))
      return false
    if (url.hostname === 'github.com')
      return (
        url.pathname === `/${repository}/releases.atom` || url.pathname.startsWith(`/${repository}/releases/`)
      )
    if (url.hostname === 'api.github.com')
      return (
        url.pathname === `/repos/${repository}/releases` ||
        url.pathname.startsWith(`/repos/${repository}/releases/`)
      )
    return (
      url.hostname === 'release-assets.githubusercontent.com' &&
      url.pathname.startsWith('/github-production-release-asset/')
    )
  } catch {
    return false
  }
}
