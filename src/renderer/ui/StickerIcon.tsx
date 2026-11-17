import { BookOpen, Camera, Gift, Map, Sparkles, Stamp, Suitcase } from './icons'
import './stickers.css'

const artwork = {
  map: Map,
  trips: Suitcase,
  journal: BookOpen,
  gallery: Camera,
  passport: Stamp,
  memory: Gift
}
export type StickerKind = keyof typeof artwork

/** Decorative companion to a visible label, using the app's existing vector family. */
export function StickerIcon({ kind, large = false }: { kind: StickerKind; large?: boolean }) {
  const Art = artwork[kind]
  return (
    <span className={`sticker-icon sticker-${kind}${large ? ' sticker-large' : ''}`} aria-hidden="true">
      <Art weight="duotone" />
      <Sparkles className="sticker-spark" weight="fill" />
      <i className="sticker-dot" />
    </span>
  )
}
