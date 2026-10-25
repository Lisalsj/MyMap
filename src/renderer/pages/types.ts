export type Page = 'map' | 'trips' | 'journal' | 'gallery' | 'passport' | 'settings'

export type RunOperation = (operation: () => Promise<unknown>, success?: string) => Promise<boolean>
export type GuardedAction = (action: () => void | Promise<void>) => Promise<void>

export interface Confirmation {
  title: string
  description: string
  label: string
  action: () => Promise<unknown>
}
