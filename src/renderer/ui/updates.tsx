import { useEffect, useState } from 'react'
import type { UpdateState } from '../../shared/types'
import { Download, RotateCcw, X } from './icons'
import type { GuardedAction } from '../pages/types'

export function useUpdates() {
  const [state, setState] = useState<UpdateState>()
  useEffect(() => {
    if (!window.myMap.updateState) return
    let active = true,
      received = false
    const off = window.myMap.onUpdate((value) => {
      received = true
      if (active) setState(value)
    })
    void window.myMap
      .updateState()
      .then((value) => {
        if (active && !received) setState(value)
      })
      .catch(() => {})
    return () => {
      active = false
      off()
    }
  }, [])
  return state
}
const bytes = (value?: number) => (value ? `${(value / 1024 / 1024).toFixed(1)} MB` : '大小待确认')

export function UpdateActions({
  state,
  guarded,
  reportError
}: {
  state: UpdateState
  guarded: GuardedAction
  reportError: (message: string) => void
}) {
  const run = (operation: () => Promise<unknown>) => {
    void operation().catch((error) => reportError(String(error)))
  }
  return (
    <>
      {state.stage === 'available' || (state.stage === 'error' && state.latestVersion) ? (
        <button
          className="button primary"
          onClick={() =>
            run(() => (state.portable ? window.myMap.openUpdateDownload() : window.myMap.downloadUpdate()))
          }
        >
          <Download size={18} />
          {state.portable ? '前往下载新版' : `下载更新 · ${bytes(state.size)}`}
        </button>
      ) : null}
      {state.stage === 'downloading' && (
        <button className="button" onClick={() => run(() => window.myMap.cancelUpdateDownload())}>
          取消下载
        </button>
      )}
      {state.stage === 'ready' && (
        <button className="button primary" onClick={() => guarded(() => window.myMap.installUpdate())}>
          <RotateCcw size={18} />
          重启并安装
        </button>
      )}
    </>
  )
}
export function UpdateNotice({
  state,
  guarded,
  reportError
}: {
  state?: UpdateState
  guarded: GuardedAction
  reportError: (message: string) => void
}) {
  const [dismissed, setDismissed] = useState('')
  if (!state || !state.supported) return null
  const consent = state.enabled === null
  const available =
    ['available', 'ready'].includes(state.stage) && dismissed !== `${state.latestVersion}:${state.stage}`
  if (!consent && !available) return null
  const preference = (enabled: boolean) => {
    void window.myMap.setUpdateChecks(enabled).catch((error) => reportError(String(error)))
  }
  return (
    <section className="update-notice" aria-label="软件更新提醒">
      <div>
        <strong>
          {consent
            ? '要自动检查新版本吗？'
            : state.stage === 'ready'
              ? '更新已下载，随时可以安装'
              : `有新版 MyMap ${state.latestVersion}`}
        </strong>
        <p>
          {consent
            ? '开启后每天检查一次。下载与安装都由你确认，旅行资料始终留在本地。'
            : state.stage === 'ready'
              ? '重启前会保存当前修改。也可以稍后在设置中安装。'
              : '地图和手账可以继续使用，稍后也可在设置中更新。'}
        </p>
      </div>
      <div className="settings-actions">
        {consent ? (
          <>
            <button className="button primary" onClick={() => preference(true)}>
              开启自动检查
            </button>
            <button className="button" onClick={() => preference(false)}>
              暂不开启
            </button>
          </>
        ) : (
          <>
            <UpdateActions state={state} guarded={guarded} reportError={reportError} />
            <button
              className="icon-button"
              aria-label="稍后处理更新"
              onClick={() => setDismissed(`${state.latestVersion}:${state.stage}`)}
            >
              <X size={18} />
            </button>
          </>
        )}
      </div>
    </section>
  )
}
export function UpdateSettings({
  state,
  guarded,
  reportError
}: {
  state?: UpdateState
  guarded: GuardedAction
  reportError: (message: string) => void
}) {
  if (!state) return null
  const busy = ['checking', 'downloading'].includes(state.stage)
  return (
    <section className="settings-card update-setting" aria-label="软件更新">
      <div>
        <h2>软件更新</h2>
        <p>当前 MyMap {state.currentVersion}。仅更新程序，旅行资料保存在自己的电脑上。</p>
      </div>
      <label className="update-toggle">
        <input
          type="checkbox"
          checked={state.enabled === true}
          disabled={!state.supported}
          onChange={(event) => {
            void window.myMap
              .setUpdateChecks(event.target.checked)
              .catch((error) => reportError(String(error)))
          }}
        />
        <span>自动检查新版本</span>
      </label>
      <p>
        {state.portable
          ? '免安装版下载后请关闭旧程序，手动替换文件。'
          : '发现新版时提醒你，确认下载后才会获取安装包，重启安装需要再次确认。'}
      </p>
      <div role="status" aria-live="polite">
        {state.stage === 'checking' && '正在检查新版本…'}
        {state.stage === 'idle' && state.lastCheckedAt && '当前已是最新版本。'}
        {state.latestVersion && state.stage !== 'idle' && state.stage !== 'checking' && (
          <p>
            新版 {state.latestVersion} · {bytes(state.size)}
          </p>
        )}
        {state.stage === 'downloading' && (
          <>
            <progress aria-label="更新下载进度" max={100} value={state.percent || 0} />
            <span>
              {Math.floor(state.percent || 0)}% · {bytes(state.transferred)} / {bytes(state.size)}
            </span>
          </>
        )}
        {state.stage === 'ready' && <p>更新已下载并完成校验。</p>}
        {state.error && <p className="inline-error">{state.error}</p>}
      </div>
      {state.releaseNotes && (
        <details>
          <summary>本次更新内容</summary>
          <p className="update-release-notes">{state.releaseNotes}</p>
        </details>
      )}
      <div className="settings-actions">
        <button
          className="button"
          disabled={busy || state.stage === 'ready' || !state.supported}
          onClick={() => {
            void window.myMap.checkForUpdates().catch((error) => reportError(String(error)))
          }}
        >
          {state.stage === 'checking' ? '正在检查…' : '检查更新'}
        </button>
        <UpdateActions state={state} guarded={guarded} reportError={reportError} />
        <button
          className="text-button"
          onClick={() => {
            void window.myMap.openUpdateDownload().catch((error) => reportError(String(error)))
          }}
        >
          打开官方下载页
        </button>
      </div>
      <p>程序尚未签名，请核对官方下载来源。无法连接 GitHub 时可稍后重试。</p>
    </section>
  )
}
