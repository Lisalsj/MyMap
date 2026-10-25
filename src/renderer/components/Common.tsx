import { useEffect, useRef, type ReactNode } from 'react'
import { X, Compass, LoaderCircle, ArrowRight, Image } from 'lucide-react'
import { photoUrl, type AppSnapshot, type Trip } from '../../shared/types'

export function Modal({
  title,
  children,
  onClose,
  wide = false
}: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  const close = useRef(onClose),
    holder = useRef<HTMLElement>(null)
  close.current = onClose
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        close.current()
      }
      if (e.key === 'Tab') {
        const focusable = [
          ...holder.current!.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]'
          )
        ]
        const first = focusable[0],
          last = focusable.at(-1)
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
      }
    }
    window.addEventListener('keydown', key, true)
    const prior = document.activeElement as HTMLElement | null
    const timer = setTimeout(() => {
      const h = holder.current
      ;(
        h?.querySelector<HTMLElement>('input') ||
        h?.querySelector<HTMLElement>('textarea') ||
        h?.querySelector<HTMLElement>('button')
      )?.focus()
    }, 0)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', key, true)
      prior?.focus()
    }
  }, [])
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <section
        ref={holder}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? 'modal-wide' : ''}`}
      >
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}
export function Empty({
  title,
  description,
  action,
  label = '新建旅行'
}: {
  title: string
  description: string
  action?: () => void
  label?: string
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Compass size={34} strokeWidth={1.2} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && (
        <button className="button primary" onClick={action}>
          {label}
          <ArrowRight size={16} />
        </button>
      )}
    </div>
  )
}
export function Spinner() {
  return <LoaderCircle size={15} className="spin" />
}
export function Cover({
  trip,
  snapshot,
  className = ''
}: {
  trip: Trip
  snapshot: AppSnapshot
  className?: string
}) {
  const attachment = snapshot.attachments.find(
    (a) => !a.deletedAt && a.tripId === trip.id && a.photoId === trip.coverPhotoId
  )
  const photo = attachment && snapshot.photos.find((p) => !p.deletedAt && p.id === attachment.photoId)
  return (
    <div className={`trip-cover ${className} cover-${trip.title.length % 4}`}>
      {photo ? (
        <img src={photoUrl(photo.id, 'preview')} alt={trip.title} loading="lazy" />
      ) : (
        <>
          <div className="cover-sun" />
          <div className="cover-mountain back" />
          <div className="cover-mountain front" />
          <span className="cover-mark">
            <Image size={15} /> YOUR NEXT CHAPTER
          </span>
        </>
      )}
    </div>
  )
}
