import { useRef, type ReactNode } from 'react'
import { X, Compass, ArrowRight, Image } from '../ui/icons'
import { photoUrl, type AppSnapshot, type Trip } from '../../shared/types'
import { getSnapshotIndex } from '../snapshotIndex'
import { useDialogFocus } from '../ui/useDialogFocus'

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
  const holder = useRef<HTMLElement>(null)
  useDialogFocus(holder, onClose)
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
        tabIndex={-1}
        className={`modal ${wide ? 'modal-wide' : ''}`}
      >
        <header className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
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
  return (
    <span className="activity-indicator" role="status" aria-label="正在处理">
      <i />
      <i />
      <i />
    </span>
  )
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
  const index = getSnapshotIndex(snapshot)
  const attachment = index.attachmentsByTrip.get(trip.id)?.find((a) => a.photoId === trip.coverPhotoId)
  const photo = attachment && index.photoById.get(attachment.photoId)
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
            <Image size={16} /> 旅程里的风景
          </span>
        </>
      )}
    </div>
  )
}
