import { describe, expect, it, vi } from 'vitest'
import { PhotoDraftQueue, type PhotoDraft } from '../src/renderer/photoDraft'

const original: PhotoDraft = { id: 'a', caption: '原说明', visitId: null, entryId: null }

describe('photo details serialized draft saving', () => {
  it('does not write unchanged details', async () => {
    const save = vi.fn()
    const queue = new PhotoDraftQueue(save, vi.fn())
    queue.open(original)
    await queue.flush()
    expect(save).not.toHaveBeenCalled()
  })

  it('drains newer caption and associations during an in-flight save before navigation can finish', async () => {
    let release!: () => void
    const writes: PhotoDraft[] = []
    const save = vi.fn(async (draft: PhotoDraft) => {
      writes.push(draft)
      if (writes.length === 1)
        await new Promise<void>((resolve) => {
          release = resolve
        })
    })
    const queue = new PhotoDraftQueue(save, vi.fn())
    queue.open(original)
    queue.edit({ caption: '第一稿', visitId: 'visit-1' })
    const navigationFlush = queue.flush()
    queue.edit({ caption: '最新说明', entryId: 'entry-1' })
    expect(queue.flush()).toBe(navigationFlush)
    release()
    await navigationFlush
    expect(writes).toEqual([
      { ...original, caption: '第一稿', visitId: 'visit-1' },
      { ...original, caption: '最新说明', visitId: 'visit-1', entryId: 'entry-1' }
    ])
    expect(queue.dirty).toBe(false)
  })

  it('retains the newest draft after failure and rejects navigation until a successful retry', async () => {
    const state = vi.fn()
    const save = vi.fn().mockRejectedValueOnce(new Error('磁盘已满')).mockResolvedValue(undefined)
    const queue = new PhotoDraftQueue(save, state)
    queue.open(original)
    queue.edit({ caption: '不能丢失', visitId: 'visit', entryId: 'entry' })
    await expect(queue.flush()).rejects.toThrow('磁盘已满')
    expect(queue.draft).toEqual({ ...original, caption: '不能丢失', visitId: 'visit', entryId: 'entry' })
    expect(queue.dirty).toBe(true)
    expect(state).toHaveBeenLastCalledWith('error', '磁盘已满')
    expect(() => queue.open({ ...original, id: 'next' })).toThrow()
    await queue.flush()
    expect(queue.dirty).toBe(false)
    expect(() => queue.open({ ...original, id: 'next' })).not.toThrow()
  })

  it('merges a confirmed GPS visit into the latest caption and journal association', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const queue = new PhotoDraftQueue(save, vi.fn())
    queue.open(original)
    queue.edit({ caption: '确认位置前', entryId: 'entry' })
    await queue.flush()
    queue.edit({ caption: '确认位置期间继续输入' })
    queue.edit({ visitId: 'gps-visit' })
    await queue.flush()
    expect(save).toHaveBeenLastCalledWith({
      ...original,
      caption: '确认位置期间继续输入',
      entryId: 'entry',
      visitId: 'gps-visit'
    })
  })
})
