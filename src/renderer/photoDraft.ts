import type { PhotoAttachment } from '../shared/types'
import type { SaveState } from './model'

export type PhotoDraft = Pick<PhotoAttachment, 'id' | 'caption' | 'visitId' | 'entryId'>
export type PhotoDraftPatch = Partial<Omit<PhotoDraft, 'id'>>
const key = (draft: PhotoDraft) => JSON.stringify([draft.id, draft.caption, draft.visitId, draft.entryId])

/** One active photo draft; navigation waits for all edits received during a write. */
export class PhotoDraftQueue {
  draft: PhotoDraft | null = null
  private savedKey = ''
  private running: Promise<void> | null = null

  constructor(
    private save: (draft: PhotoDraft) => Promise<void>,
    private state: (state: SaveState, error?: string) => void
  ) {}

  open(attachment: PhotoDraft) {
    if (this.dirty) throw new Error('请先保存当前照片说明。')
    this.draft = {
      id: attachment.id,
      caption: attachment.caption,
      visitId: attachment.visitId,
      entryId: attachment.entryId
    }
    this.savedKey = key(this.draft)
    this.state('saved')
  }

  edit(patch: PhotoDraftPatch) {
    if (!this.draft) return
    this.draft = { ...this.draft, ...patch }
    this.state(this.dirty ? 'pending' : 'saved')
  }

  get dirty() {
    return !!this.draft && key(this.draft) !== this.savedKey
  }

  flush(): Promise<void> {
    if (this.running) return this.running
    const drain = async () => {
      while (this.draft && this.dirty) {
        const next = { ...this.draft }
        this.state('saving')
        try {
          await this.save(next)
          this.savedKey = key(next)
        } catch (error) {
          this.state('error', error instanceof Error ? error.message : String(error))
          throw error
        }
      }
      this.state('saved')
    }
    this.running = drain().finally(() => {
      this.running = null
    })
    return this.running
  }
}
