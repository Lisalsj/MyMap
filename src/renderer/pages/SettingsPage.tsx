import { ArrowRight, FolderOpen, ShieldCheck, Sparkles, Trash2, Upload } from '../ui/icons'
import type { AppSnapshot } from '../../shared/types'
import { version as appVersion } from '../../../package.json'
import type { Confirmation, GuardedAction, RunOperation } from './types'
import '../styles/settings.css'

export function SettingsPage({
  snapshot,
  run,
  confirm,
  guarded,
  reset
}: {
  snapshot: AppSnapshot
  run: RunOperation
  confirm: (confirmation: Confirmation) => void
  guarded: GuardedAction
  reset: () => void
}) {
  const trashItems = [
    ...snapshot.trips
      .filter((trip) => trip.deletedAt)
      .map((trip) => ({ kind: 'trip' as const, id: trip.id, label: trip.title, type: '旅行' })),
    ...snapshot.entries
      .filter((entry) => entry.deletedAt)
      .map((entry) => ({ kind: 'entry' as const, id: entry.id, label: entry.title, type: '手记' })),
    ...snapshot.attachments
      .filter((attachment) => attachment.deletedAt)
      .map((attachment) => ({
        kind: 'attachment' as const,
        id: attachment.id,
        label: attachment.caption || '旅行照片',
        type: '照片'
      }))
  ]
  const switchLibrary = (operation: () => Promise<unknown>) =>
    guarded(async () => {
      if (await run(operation)) reset()
    })

  return (
    <div className="settings-layout">
      <section className="settings-card library-setting">
        <div className="settings-section-heading">
          <span className="settings-icon">
            <FolderOpen size={24} />
          </span>
          <div>
            <h2>资料库</h2>
            <p>旅行、手记和照片，保存在自己的电脑上。</p>
          </div>
        </div>
        <div className="library-path">
          <span>当前资料库{snapshot.library.isDemo && <b>独立演示库</b>}</span>
          <code>{snapshot.library.path}</code>
        </div>
        <div className="settings-actions">
          <button className="button" onClick={() => run(() => window.myMap.openLibraryFolder())}>
            <FolderOpen size={18} />
            打开资料库文件夹
          </button>
          <button className="button" onClick={() => switchLibrary(() => window.myMap.chooseLibrary())}>
            选择其他资料库
            <ArrowRight size={18} />
          </button>
        </div>
      </section>

      <section className="settings-card backup-setting">
        <div className="settings-section-heading">
          <span className="settings-icon">
            <ShieldCheck size={24} />
          </span>
          <div>
            <h2>备份与恢复</h2>
            <p>备份包含旅行记录与照片，建议定期保存到另一块磁盘。</p>
          </div>
        </div>
        <div className="settings-actions">
          <button className="button primary" onClick={() => run(() => window.myMap.backup(), '备份已创建')}>
            <ShieldCheck size={18} />
            创建完整备份
          </button>
          <button
            className="button"
            onClick={() =>
              confirm({
                title: '从备份恢复资料库',
                description: '将打开备份选择窗口。恢复会切换到备份中的资料；请先妥善保存当前资料库。',
                label: '选择备份恢复',
                action: async () => {
                  const result = await window.myMap.restoreBackup()
                  if (result) reset()
                  return result
                }
              })
            }
          >
            <Upload size={18} />
            从备份恢复
          </button>
        </div>
      </section>

      <section className="settings-card demo-setting">
        <div className="settings-section-heading">
          <span className="settings-icon">
            <Sparkles size={24} />
          </span>
          <div>
            <h2>独立演示库</h2>
            <p>体验地图、手记和照片收藏，演示数据与你的旅行分开保存。</p>
          </div>
        </div>
        <div className="settings-actions">
          <button
            className="button"
            onClick={() => switchLibrary(() => window.myMap.setDemo(!snapshot.library.isDemo))}
          >
            {snapshot.library.isDemo ? '回到我的资料库' : '打开独立演示库'}
            <ArrowRight size={18} />
          </button>
        </div>
      </section>

      <section className="settings-card trash-card">
        <div className="section-title">
          <div>
            <h2>
              回收站 <small>{trashItems.length}</small>
            </h2>
            <p className="muted">暂时收起的回忆，仍可以找回来。</p>
          </div>
          <button
            className="button danger"
            disabled={!trashItems.length}
            onClick={() =>
              confirm({
                title: '永久清空回收站？',
                description: '回收站中的旅行、手记和照片关联将被永久移除，无法恢复。请确认不再需要这些资料。',
                label: '永久清空',
                action: () => window.myMap.emptyTrash()
              })
            }
          >
            <Trash2 size={18} />
            清空回收站
          </button>
        </div>
        {trashItems.length ? (
          <div className="trash-list">
            {trashItems.map((item) => (
              <div className="trash-row" key={item.kind + item.id}>
                <span className="trash-type">{item.type}</span>
                <span className="trash-label">{item.label}</span>
                <button
                  className="text-button"
                  onClick={() => run(() => window.myMap.restore(item.kind, item.id), '已从回收站恢复')}
                >
                  恢复
                  <ArrowRight size={18} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="trash-empty">
            <Trash2 size={24} />
            <p>回收站里没有内容</p>
            <span>移入回收站的旅行、手记和照片会显示在这里。</span>
          </div>
        )}
        <p className="settings-danger-note">清空回收站会永久移除其中的资料，此操作无法撤销。</p>
      </section>

      <section className="settings-privacy" aria-label="隐私与版本">
        <ShieldCheck size={24} />
        <div>
          <h2>完全离线，只属于你</h2>
          <p>无需账号、无需网络。地图、城市检索、照片和文字都在本地运行。</p>
          <p className="settings-version">MyMap {appVersion} · 私人旅行空间</p>
        </div>
      </section>
    </div>
  )
}
