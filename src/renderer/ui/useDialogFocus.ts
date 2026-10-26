import { useEffect, useRef, type RefObject } from 'react'

type FocusTarget = HTMLElement | SVGElement
type DialogEntry = { token: symbol; holder: RefObject<HTMLElement | null>; prior: FocusTarget | null }
const dialogs: DialogEntry[] = []
let returnTarget: FocusTarget | null = null
const focusableSelector =
  'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]'
function focusable(holder: HTMLElement) {
  return [...holder.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (element) =>
      element.getClientRects().length > 0 &&
      !element.closest('[inert]') &&
      element.getAttribute('aria-hidden') !== 'true'
  )
}
/** Only the uppermost dialog handles modal keys; child dialogs restore their trigger. */
export function useDialogFocus(holder: RefObject<HTMLElement | null>, onEscape: () => void) {
  const close = useRef(onEscape),
    token = useRef(Symbol('dialog'))
  close.current = onEscape
  useEffect(() => {
    const active = document.activeElement
    const prior = active instanceof HTMLElement || active instanceof SVGElement ? active : null
    if (!dialogs.length) returnTarget = prior
    const entry: DialogEntry = { token: token.current, holder, prior }
    dialogs.push(entry)
    const top = () => dialogs.at(-1)?.token === entry.token
    const keydown = (event: KeyboardEvent) => {
      const container = holder.current
      if (!top() || !container) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        close.current()
      } else if (event.key === 'Tab') {
        const elements = focusable(container),
          first = elements[0],
          last = elements.at(-1)
        if (!first) {
          event.preventDefault()
          container.focus()
          return
        }
        if (
          !container.contains(document.activeElement) ||
          (event.shiftKey && document.activeElement === first)
        ) {
          event.preventDefault()
          ;(event.shiftKey ? last : first)?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', keydown, true)
    const timer = window.setTimeout(() => {
      if (!top() || !holder.current) return
      const elements = focusable(holder.current)
      const initial = elements.find((element) => element.matches('[autofocus],input,textarea'))
      ;(initial || elements[0] || holder.current).focus()
    }, 0)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', keydown, true)
      const wasTop = top(),
        index = dialogs.indexOf(entry)
      if (index >= 0) dialogs.splice(index, 1)
      if (!wasTop) return
      const remaining = dialogs.at(-1)?.holder.current
      if (remaining) {
        if (entry.prior?.isConnected && remaining.contains(entry.prior)) entry.prior.focus()
        else (focusable(remaining)[0] || remaining).focus()
      } else {
        if (returnTarget?.isConnected) returnTarget.focus()
        returnTarget = null
      }
    }
  }, [holder])
}

/** Photo-arrow handlers use the same top-dialog rule as Tab/Escape. */
export function isTopDialog(element: HTMLElement | null) {
  return !!element && dialogs.at(-1)?.holder.current === element
}
