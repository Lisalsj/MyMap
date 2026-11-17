import { describe, expect, it, vi, afterEach } from 'vitest'
import { initializeTheme, readTheme, setTheme, themeKey } from '../src/renderer/ui/theme'

afterEach(() => vi.unstubAllGlobals())
describe('device theme preference', () => {
  it('falls back to forest for missing, damaged or unavailable storage', () => {
    for (const value of [null, '', '{broken', 'purple', 'forest'])
      expect(readTheme({ getItem: () => value })).toBe('forest')
    expect(
      readTheme({
        getItem: () => {
          throw Error('disabled')
        }
      })
    ).toBe('forest')
    expect(readTheme({ getItem: () => 'sky-rose' })).toBe('sky-rose')
  })
  it('applies saved preferences before rendering and reports write failure while preserving the chosen appearance', () => {
    const root = { dataset: { theme: '' } }
    const storage = { getItem: () => 'sky-rose', setItem: vi.fn() }
    vi.stubGlobal('document', { documentElement: root })
    vi.stubGlobal('window', { localStorage: storage })
    initializeTheme()
    expect(root.dataset.theme).toBe('sky-rose')
    expect(setTheme('forest')).toBe(true)
    expect(storage.setItem).toHaveBeenCalledWith(themeKey, 'forest')
    storage.setItem.mockImplementation(() => {
      throw Error('quota')
    })
    expect(setTheme('sky-rose')).toBe(false)
    expect(root.dataset.theme).toBe('sky-rose')
  })
})
