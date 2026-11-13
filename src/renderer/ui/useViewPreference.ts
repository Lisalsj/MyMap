import { useState } from 'react'

export function useViewPreference<T extends string>(key: string, choices: readonly T[], fallback: T) {
  const storageKey = `mymap:view:${key}`
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      return choices.includes(saved as T) ? (saved as T) : fallback
    } catch {
      return fallback
    }
  })
  const update = (next: string) => {
    if (!choices.includes(next as T)) return
    setValue(next as T)
    try {
      localStorage.setItem(storageKey, next)
    } catch {
      // The current view remains usable when the local settings store is unavailable.
    }
  }
  return [value, update] as const
}
