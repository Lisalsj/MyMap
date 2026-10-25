import { useEffect, useMemo, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BookOpen, Check, Download, Eye, ImagePlus, PencilLine, Plus, Save, Trash2 } from '../ui/icons'
import { photoUrl, type AppSnapshot, type Entry } from '../../shared/types'
import { DraftQueue, mediaId, safeMarkdownUrl, type Draft, type SaveState } from '../model'
import { getSnapshotIndex } from '../snapshotIndex'
import { Empty, Modal, Spinner } from './Common'
import '../styles/journal.css'

interface Props {
  snapshot: AppSnapshot
  entryId: string | null
  tripId: string
  setEntryId: (id: string) => void
  onSaved: (entry: Entry) => void
  registerFlush: (flush: () => Promise<void>) => void
  run: (operation: () => Promise<unknown>, success?: string) => Promise<boolean>
  refresh: () => Promise<void>
  confirmTrash: (id: string) => void
}
export function Journal({
  snapshot,
  entryId,
  tripId,
  setEntryId,
  onSaved,
  registerFlush,
  run,
  refresh,
  confirmTrash
}: Props) {
  const index = useMemo(() => getSnapshotIndex(snapshot), [snapshot])
  const [scopeTrip, setScopeTrip] = useState(tripId)
  const entries = useMemo(
    () =>
      index.activeEntries
        .filter((entry) => !scopeTrip || entry.tripId === scopeTrip)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [index, scopeTrip]
  )
  const candidate = entryId ? index.entryById.get(entryId) : undefined
  const selected =
    candidate && !candidate.deletedAt && index.activeTripIds.has(candidate.tripId) ? candidate : undefined
  const [draft, setDraft] = useState<Draft | null>(null),
    [status, setStatus] = useState<SaveState>('saved'),
    [saveError, setSaveError] = useState(''),
    [preview, setPreview] = useState(false),
    [photoPicker, setPhotoPicker] = useState(false),
    [newTrip, setNewTrip] = useState(tripId || index.activeTrips[0]?.id || ''),
    [creating, setCreating] = useState(false)
  const savedCallback = useRef(onSaved)
  savedCallback.current = onSaved
  const queue = useRef<DraftQueue | null>(null)
  if (!queue.current)
    queue.current = new DraftQueue(
      (d) => window.myMap.saveEntry(d),
      (s, e) => {
        setStatus(s)
        setSaveError(e || '')
      },
      (e) => savedCallback.current(e)
    )
  useEffect(() => {
    if (selected) {
      queue.current!.open(selected)
      setDraft({ ...selected })
      // Search and detail-page entry links always reveal the selected entry's scope.
      if (scopeTrip && selected.tripId !== scopeTrip) setScopeTrip(selected.tripId)
    } else {
      setDraft(null)
      queue.current!.draft = null
    }
  }, [selected?.id])
  useEffect(() => {
    registerFlush(() => queue.current!.flush())
    return () => {
      registerFlush(async () => {})
    }
  }, [registerFlush])
  useEffect(() => {
    if (!draft) return
    const timer = setTimeout(() => queue.current!.flush().catch(() => {}), 500)
    return () => clearTimeout(timer)
  }, [draft])
  const edit = (patch: Partial<Draft>) => {
    if (!draft) return
    const next = { ...draft, ...patch }
    setDraft(next)
    queue.current!.edit(next)
  }
  const open = async (id: string) => {
    try {
      await queue.current!.flush()
      setEntryId(id)
    } catch {}
  }
  const changeScope = async (value: string) => {
    try {
      await queue.current!.flush()
      setScopeTrip(value)
      if (value) setNewTrip(value)
      const next = index.activeEntries
        .filter((entry) => !value || entry.tripId === value)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      if (selected && value && selected.tripId !== value) setEntryId(next?.id || '')
    } catch {
      /* Keep the current scope and recoverable draft when saving fails. */
    }
  }
  async function create() {
    const id = newTrip || index.activeTrips[0]?.id
    if (!id) return
    try {
      await queue.current!.flush()
      setCreating(true)
      const entry = await window.myMap.saveEntry({ tripId: id, title: '未命名的旅行手记', markdown: '' })
      onSaved(entry)
      if (scopeTrip && scopeTrip !== id) setScopeTrip(id)
      setEntryId(entry.id)
    } catch (e) {
      setSaveError(String(e))
      setStatus('error')
    } finally {
      setCreating(false)
    }
  }
  const attachments = draft ? index.attachmentsByTrip.get(draft.tripId) || [] : []
  return (
    <div className="journal-layout">
      <aside className="journal-index">
        <div className="journal-index-heading">
          <h2>手记目录</h2>
          <span>{entries.length} 篇</span>
        </div>
        <label className="journal-scope">
          查看范围
          <select
            aria-label="手记查看旅行"
            value={scopeTrip}
            onChange={(event) => void changeScope(event.target.value)}
          >
            <option value="">所有旅行</option>
            {index.activeTrips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.title}
              </option>
            ))}
          </select>
        </label>
        <div className="journal-create">
          <label>
            新手记保存到
            <select
              aria-label="新游记所属旅行"
              value={newTrip}
              onChange={(event) => setNewTrip(event.target.value)}
            >
              <option value="">选择所属旅行</option>
              {index.activeTrips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.title}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button primary journal-new"
            disabled={creating || !index.activeTrips.length}
            onClick={create}
          >
            <Plus size={16} />
            {creating ? '创建中…' : '写一篇手记'}
          </button>
        </div>
        <div className="entry-list">
          {entries.map((e) => (
            <button
              className={`entry-item ${e.id === entryId ? 'active' : ''}`}
              key={e.id}
              onClick={() => open(e.id)}
            >
              <BookOpen size={18} />
              <span>
                <strong>{e.title || '未命名手记'}</strong>
                <small>{index.tripById.get(e.tripId)?.title}</small>
                <small>
                  {e.updatedAt.slice(0, 10).replaceAll('-', '.')} · {e.markdown.length} 字
                </small>
              </span>
            </button>
          ))}
        </div>
        {!entries.length && (
          <p className="journal-list-empty">
            {scopeTrip
              ? '这段旅行还没有手记。选择上方旅行，写下第一篇。'
              : '还没有手记。选择所属旅行，开始记录。'}
          </p>
        )}
      </aside>
      <section className="journal-paper">
        {draft ? (
          <>
            <div className="editor-toolbar">
              <span className={`save-status ${status}`} role="status">
                {status === 'saving' ? (
                  <Spinner />
                ) : status === 'error' ? (
                  <Save size={14} />
                ) : (
                  <Check size={14} />
                )}
                {
                  {
                    saved: '所有文字已保存',
                    saving: '正在保存…',
                    pending: '等待保存…',
                    error: '保存失败，草稿仍保留'
                  }[status]
                }
              </span>
              <div className="toolbar-actions">
                <button
                  className="icon-button"
                  title={preview ? '继续编辑' : '预览排版'}
                  aria-label={preview ? '继续编辑' : '预览排版'}
                  aria-pressed={preview}
                  onClick={() => setPreview(!preview)}
                >
                  {preview ? <PencilLine size={18} /> : <Eye size={18} />}
                  <span>{preview ? '编辑' : '预览'}</span>
                </button>
                <button
                  className="icon-button"
                  title="插入旅行照片"
                  aria-label="插入旅行照片"
                  onClick={() => setPhotoPicker(true)}
                >
                  <ImagePlus size={18} />
                  <span>插图</span>
                </button>
                <button
                  className="icon-button"
                  title="导出 Markdown"
                  aria-label="导出 Markdown"
                  onClick={async () => {
                    try {
                      await queue.current!.flush()
                      await run(() => window.myMap.exportEntry(draft.id))
                    } catch {}
                  }}
                >
                  <Download size={18} />
                  <span>导出</span>
                </button>
                <button
                  className="icon-button danger"
                  title="移到回收站"
                  aria-label="移到回收站"
                  onClick={async () => {
                    try {
                      await queue.current!.flush()
                      confirmTrash(draft.id)
                    } catch {}
                  }}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
            {saveError && (
              <div role="alert" className="inline-error save-error">
                {saveError}
                <button className="text-button" onClick={() => queue.current!.flush().catch(() => {})}>
                  重试保存
                </button>
              </div>
            )}
            <div className="entry-associations">
              <span className="entry-trip">
                所属旅行<strong>{index.tripById.get(draft.tripId)?.title}</strong>
              </span>
              <label>
                关联地点
                <select
                  aria-label="游记关联地点"
                  value={draft.visitId || ''}
                  onChange={(e) => edit({ visitId: e.target.value || null })}
                >
                  <option value="">整段旅行 · 不关联地点</option>
                  {(index.orderedVisitsByTrip.get(draft.tripId) || []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {index.placeById.get(v.placeId)?.name} {v.date}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {preview ? (
              <article className="markdown-body">
                <h1>{draft.title}</h1>
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  skipHtml
                  urlTransform={safeMarkdownUrl}
                  components={{
                    img: ({ src, alt }) => {
                      const id = mediaId(typeof src === 'string' ? src : '')
                      return id && index.photoById.has(id) && !index.photoById.get(id)!.deletedAt ? (
                        <figure>
                          <img src={photoUrl(id, 'preview')} alt={alt || '旅行照片'} loading="lazy" />
                          {alt && <figcaption>{alt}</figcaption>}
                        </figure>
                      ) : (
                        <span className="blocked-image">[仅显示资料库中的照片]</span>
                      )
                    },
                    a: ({ children }) => <span className="offline-link">{children}</span>
                  }}
                >
                  {draft.markdown || '*这页还留着空白，等待你的故事。*'}
                </Markdown>
              </article>
            ) : (
              <div className="writing-area">
                <input
                  className="entry-title"
                  value={draft.title}
                  maxLength={200}
                  onChange={(e) => edit({ title: e.target.value })}
                  aria-label="游记标题"
                  placeholder="为这一天起个名字"
                />
                <div className="entry-subtitle">写下沿途的风景与心情</div>
                <textarea
                  className="markdown-input"
                  aria-label="Markdown 游记正文"
                  value={draft.markdown}
                  onChange={(e) => edit({ markdown: e.target.value })}
                  placeholder={
                    '记得那天的阳光吗？\n\n写下沿途的小事，让回忆慢慢生长。\n\n支持 Markdown：# 标题、**加粗**、- 清单、> 引用'
                  }
                />
                <footer className="writing-footer">
                  <span>支持 Markdown · 自动保存到本地</span>
                  <span>{draft.markdown.length} 字</span>
                </footer>
              </div>
            )}
          </>
        ) : (
          <Empty
            title="让旅途，再发生一次"
            description="选择一篇手记，或翻开新的一页。每一段普通的日子，都值得被记住。"
            action={index.activeTrips.length ? create : undefined}
            label="写一篇手记"
          />
        )}
      </section>
      {photoPicker && draft && (
        <Modal title="插入本次旅行的照片" wide onClose={() => setPhotoPicker(false)}>
          {attachments.length ? (
            <div className="photo-picker">
              {attachments.map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    edit({
                      markdown:
                        draft.markdown +
                        `\n\n![${a.caption.replaceAll(']', '').replaceAll('\n', ' ')}](mymap-photo:${a.photoId})\n`
                    })
                    setPhotoPicker(false)
                  }}
                >
                  <img src={photoUrl(a.photoId)} loading="lazy" alt={a.caption || '旅行照片'} />
                  <span>{a.caption || '插入这张照片'}</span>
                </button>
              ))}
            </div>
          ) : (
            <Empty
              title="这一程，还没有照片"
              description="先到照片馆导入本次旅行的照片，再把喜欢的放进手记。"
            />
          )}
        </Modal>
      )}
    </div>
  )
}
