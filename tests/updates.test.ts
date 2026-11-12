import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  UpdateService,
  updateRequestAllowed,
  type UpdateAdapter,
  type UpdatePreferences
} from '../src/main/updates'
import type { UpdateState } from '../src/shared/types'

function fixture(enabled: boolean | null = null) {
  const preferences: UpdatePreferences = { enabled }
  const changed: UpdateState[] = []
  const adapter: UpdateAdapter = {
    check: vi.fn(async () => ({ version: '0.4.1', notes: '地图提速', size: 123456 })),
    download: vi.fn(async (progress) => {
      progress(50, 61728)
    }),
    cancel: vi.fn(),
    install: vi.fn()
  }
  const createAdapter = vi.fn(async () => adapter),
    save = vi.fn()
  const service = new UpdateService({
    currentVersion: '0.4.0',
    supported: true,
    portable: false,
    preferences,
    save,
    createAdapter,
    changed: (state) => changed.push(state)
  })
  return { service, adapter, createAdapter, save, changed }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-12T00:00:00Z'))
})
afterEach(() => vi.useRealTimers())
describe('consent and update lifecycle', () => {
  it('does not even construct a network adapter before consent, after rejecting consent, or before the map is ready', async () => {
    const f = fixture()
    f.service.uiReady()
    await vi.advanceTimersByTimeAsync(60000)
    expect(f.createAdapter).not.toHaveBeenCalled()
    f.service.setEnabled(false)
    await vi.advanceTimersByTimeAsync(86400000)
    expect(f.createAdapter).not.toHaveBeenCalled()
    f.service.dispose()
    const other = fixture(true)
    await vi.advanceTimersByTimeAsync(60000)
    expect(other.createAdapter).not.toHaveBeenCalled()
    other.service.dispose()
  })
  it('waits fifteen seconds after map readiness, checks once daily, and never auto downloads', async () => {
    const f = fixture(true)
    f.service.uiReady()
    await vi.advanceTimersByTimeAsync(14999)
    expect(f.createAdapter).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(f.adapter.check).toHaveBeenCalledTimes(1)
    expect(f.adapter.download).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(86399999)
    expect(f.adapter.check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(f.adapter.check).toHaveBeenCalledTimes(2)
    f.service.setEnabled(false)
    await vi.advanceTimersByTimeAsync(86400000)
    expect(f.adapter.check).toHaveBeenCalledTimes(2)
    f.service.dispose()
  })
  it('allows one manual check without enabling automatic network requests', async () => {
    const f = fixture(false)
    const state = await f.service.check()
    expect(state).toMatchObject({
      enabled: false,
      stage: 'available',
      latestVersion: '0.4.1',
      automatic: false
    })
    expect(f.save).toHaveBeenCalled()
    expect(f.adapter.download).not.toHaveBeenCalled()
    f.service.dispose()
  })
  it('does not install before a successful explicit download, and reports download progress', async () => {
    const f = fixture()
    await expect(f.service.install()).rejects.toThrow(/已校验/)
    await f.service.check()
    await f.service.download()
    expect(f.changed).toContainEqual(expect.objectContaining({ stage: 'downloading', percent: 50 }))
    expect(f.service.snapshot()).toMatchObject({ stage: 'ready', percent: 100 })
    expect(f.adapter.install).not.toHaveBeenCalled()
    await f.service.install()
    expect(f.adapter.install).toHaveBeenCalledTimes(1)
    f.service.dispose()
  })
  it('retains a usable update after cancellation and rejects a failed checksum', async () => {
    const f = fixture()
    let fail!: (error: Error) => void
    f.adapter.download = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject
        })
    )
    f.adapter.cancel = () => fail(Error('cancelled'))
    await f.service.check()
    const first = f.service.download()
    await vi.advanceTimersByTimeAsync(0)
    await f.service.cancel()
    await first
    expect(f.service.snapshot()).toMatchObject({ stage: 'available', error: undefined })
    f.adapter.download = vi.fn(async () => {
      throw Error('sha512 mismatch')
    })
    await f.service.download()
    expect(f.service.snapshot()).toMatchObject({ stage: 'error' })
    await expect(f.service.install()).rejects.toThrow(/已校验/)
    expect(f.adapter.install).not.toHaveBeenCalled()
    f.service.dispose()
  })
  it('joins concurrent checks and exposes a quiet automatic network failure', async () => {
    const f = fixture(true)
    f.adapter.check = vi.fn(async () => {
      throw Error('offline')
    })
    const first = f.service.check(true),
      second = f.service.check()
    expect(first).toBe(second)
    await first
    expect(f.service.snapshot()).toMatchObject({ stage: 'error', automatic: true })
    expect(f.adapter.check).toHaveBeenCalledTimes(1)
    f.service.dispose()
  })
  it('handles no newer version and rejects portable in-place replacement', async () => {
    const f = fixture()
    f.adapter.check = vi.fn(async () => null)
    expect(await f.service.check()).toMatchObject({ stage: 'idle', latestVersion: undefined })
    f.service.dispose()
    const portable = new UpdateService({
      currentVersion: '0.4.0',
      supported: true,
      portable: true,
      preferences: { enabled: false },
      save() {},
      createAdapter: async () => f.adapter,
      changed() {}
    })
    await expect(portable.download()).rejects.toThrow(/免安装/)
    portable.dispose()
  })
})
it('limits updater traffic to the public repository and GitHub release CDN, never arbitrary URLs', () => {
  for (const url of [
    'https://github.com/Lisalsj/MyMap/releases.atom',
    'https://api.github.com/repos/Lisalsj/MyMap/releases/latest',
    'https://github.com/Lisalsj/MyMap/releases/download/v1/latest.yml',
    'https://release-assets.githubusercontent.com/github-production-release-asset/123/a'
  ])
    expect(updateRequestAllowed(url)).toBe(true)
  for (const url of [
    'http://github.com/Lisalsj/MyMap/releases.atom',
    'https://github.com/other/project/releases/latest',
    'https://api.github.com/repos/Lisalsj/MyMap/releases-evil',
    'https://github.com.evil/Lisalsj/MyMap/releases/latest',
    'https://user:secret@github.com/Lisalsj/MyMap/releases/latest',
    'https://example.com/update.exe',
    'file:///update.exe'
  ])
    expect(updateRequestAllowed(url)).toBe(false)
})
