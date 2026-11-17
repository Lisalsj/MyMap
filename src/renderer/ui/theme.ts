import { useSyncExternalStore } from 'react'

export type ThemeId = 'forest' | 'sky-rose'
export const themeKey = 'mymap:view:theme'
export const themes = [
  { id: 'forest', name: '米白森林', description: '米白纸面，森林绿与温暖的小贴纸。' },
  { id: 'sky-rose', name: '晴空樱粉', description: '浅蓝纸面，雾蓝地图与樱粉色回忆。' }
] as const

export function readTheme(storage: Pick<Storage, 'getItem'>): ThemeId {
  try {
    return storage.getItem(themeKey) === 'sky-rose' ? 'sky-rose' : 'forest'
  } catch {
    return 'forest'
  }
}

let current: ThemeId = 'forest'
const listeners = new Set<() => void>()
function apply(theme: ThemeId) {
  current = theme
  document.documentElement.dataset.theme = theme
  for (const listener of listeners) listener()
}

/** Runs before React paints; CSS alone changes the retained map and open editors. */
export function initializeTheme() {
  let theme: ThemeId = 'forest'
  try {
    theme = readTheme(window.localStorage)
  } catch {
    /* storage can be disabled */
  }
  apply(theme)
}

export function setTheme(theme: ThemeId): boolean {
  apply(theme)
  try {
    window.localStorage.setItem(themeKey, theme)
    return true
  } catch {
    return false
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const snapshot = () => current
export const useTheme = () => useSyncExternalStore(subscribe, snapshot, snapshot)
