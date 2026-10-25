import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const state = vi.hoisted(() => ({
  window: null as any,
  worker: null as any,
  ipc: new Map<string, (...args: any[]) => any>(),
  calls: new Map<string, (...args: any[]) => any>(),
  dialogs: [] as any[],
  choices: [] as number[],
  startupErrors: [] as string[],
  rejectLoad: null as null | ((error: Error) => void),
  progress: () => Promise.resolve({ running: false }),
  shutdown: () => Promise.resolve(),
  quit: false
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    enabled = true
    destroyed = false
    sent: string[] = []
    webContents = {
      id: 1,
      mainFrame: { url: 'mymap://app/index.html' },
      send: (channel: string) => {
        this.sent.push(channel)
      },
      setWindowOpenHandler() {},
      on() {}
    }
    constructor() {
      super()
      state.window = this
    }
    setEnabled(enabled: boolean) {
      this.enabled = enabled
    }
    destroy() {
      this.destroyed = true
    }
    isDestroyed() {
      return this.destroyed
    }
    loadURL() {
      return new Promise<void>((_resolve, reject) => {
        state.rejectLoad = reject
      })
    }
  }
  return {
    app: {
      isPackaged: false,
      getPath: () => tmpdir(),
      setPath() {},
      commandLine: { appendSwitch() {} },
      requestSingleInstanceLock: () => true,
      on() {},
      whenReady: () => Promise.resolve(),
      exit() {},
      quit: () => {
        state.quit = true
      }
    },
    BrowserWindow: Window,
    dialog: {
      showErrorBox(_title: string, message: string) {
        state.startupErrors.push(message)
      },
      showMessageBox: async (_window: unknown, options: any) => {
        state.dialogs.push(options)
        return { response: state.choices.shift() ?? 0 }
      }
    },
    ipcMain: {
      on: (name: string, callback: any) => state.ipc.set(name, callback),
      handle: (name: string, callback: any) => state.calls.set(name, callback)
    },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    session: {
      defaultSession: {
        setPermissionRequestHandler() {},
        setPermissionCheckHandler() {},
        webRequest: { onBeforeRequest() {} }
      }
    },
    utilityProcess: {
      fork: () => {
        const worker = new EventEmitter() as any
        worker.kill = () => {}
        worker.postMessage = ({ id, method }: any) => {
          const work =
            method === 'importProgress'
              ? state.progress()
              : method === 'shutdown'
                ? state.shutdown()
                : Promise.resolve({})
          work.then(
            (result) => worker.emit('message', { id, result }),
            (error) => worker.emit('message', { id, error: String(error) })
          )
        }
        state.worker = worker
        return worker
      }
    },
    net: {},
    shell: {}
  }
})

let profile: string
const tick = async () => {
  for (let index = 0; index < 15; index++) await Promise.resolve()
}
const event = () => ({ sender: state.window.webContents, senderFrame: state.window.webContents.mainFrame })
function close() {
  state.ipc.get('mymap:ready')?.(event())
  const e = { preventDefault: vi.fn() }
  state.window.emit('close', e)
  return e
}
async function flushed() {
  await Promise.allSettled([state.ipc.get('mymap:flushed')!(event())])
  await tick()
}
beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  state.window = null
  state.worker = null
  state.ipc.clear()
  state.calls.clear()
  state.dialogs = []
  state.choices = []
  state.startupErrors = []
  state.rejectLoad = null
  state.quit = false
  state.progress = () => Promise.resolve({ running: false })
  state.shutdown = () => Promise.resolve()
  profile = mkdtempSync(join(tmpdir(), 'mymap-close-'))
  vi.stubEnv('MYMAP_TEST_ROOT', profile)
  vi.stubEnv('ELECTRON_RENDERER_URL', '')
  await import('../src/main/index')
  await tick()
  await state.calls.get('mymap:call')!(event(), 'snapshot', [])
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  rmSync(profile, { recursive: true, force: true })
})

it('does not show a startup failure when closing aborts an in-flight initial document load', async () => {
  state.window.emit('close', { preventDefault: vi.fn() })
  await tick()
  state.rejectLoad!(new Error("ERR_FAILED (-2) loading 'mymap://app/index.html'"))
  await tick()
  expect(state.startupErrors).toEqual([])
})

it('still reports a genuine startup failure when no shutdown was requested', async () => {
  state.rejectLoad!(new Error('Local application document is missing'))
  await tick()
  expect(state.startupErrors).toEqual(['Error: Local application document is missing'])
})

it('closes safely before renderer readiness even after an early snapshot request', async () => {
  state.window.emit('close', { preventDefault: vi.fn() })
  await tick()
  expect(state.window.sent).toEqual([])
  expect(state.window.destroyed).toBe(true)
})

it('freezes native input before flushing and keeps it frozen until pending background work finishes', async () => {
  let finish!: () => void
  state.shutdown = () =>
    new Promise<void>((resolve) => {
      finish = resolve
    })
  expect(close().preventDefault).toHaveBeenCalled()
  expect(state.window.enabled).toBe(false)
  expect(state.window.sent).toEqual(['mymap:flush'])
  const closing = flushed()
  await tick()
  expect(state.window.enabled).toBe(false)
  expect(state.window.destroyed).toBe(false)
  finish()
  await closing
  expect(state.window.destroyed).toBe(true)
})

it('restores editing and close retry after a progress check failure, with explicit safe exit advice', async () => {
  state.progress = () => Promise.reject(new Error('资料服务已停止'))
  close()
  await flushed()
  expect(state.window.enabled).toBe(true)
  expect(state.window.destroyed).toBe(false)
  expect(state.dialogs).toHaveLength(1)
  expect(state.dialogs[0].detail).toMatch(/已保存/)
  expect(state.dialogs[0].detail).toMatch(/草稿/)
  expect(state.dialogs[0].detail).toMatch(/重试/)
  close()
  expect(state.window.sent).toEqual(['mymap:flush', 'mymap:flush'])
})

it('only exits after an explicit choice when the progress check fails', async () => {
  state.progress = () => Promise.reject(new Error('检查超时'))
  state.choices = [1]
  close()
  await flushed()
  expect(state.dialogs[0].buttons[1]).toMatch(/退出/)
  expect(state.window.enabled).toBe(false)
  expect(state.window.destroyed).toBe(true)
})

it('restores editing when the worker exits during the progress check', async () => {
  state.progress = () => new Promise(() => {})
  close()
  const closing = flushed()
  await tick()
  expect(state.window.enabled).toBe(false)
  state.worker.emit('exit', 1)
  await closing
  expect(state.window.enabled).toBe(true)
  expect(state.window.destroyed).toBe(false)
  expect(state.dialogs[0].detail).toMatch(/资料服务已停止/)
  close()
  await flushed()
  expect(state.dialogs).toHaveLength(2)
})

it('restores editing when the progress RPC times out after flush has already completed', async () => {
  state.progress = () => new Promise(() => {})
  close()
  const closing = flushed()
  await tick()
  await vi.advanceTimersByTimeAsync(30000)
  await closing
  expect(state.window.enabled).toBe(true)
  expect(state.window.destroyed).toBe(false)
  expect(state.dialogs[0].detail).toMatch(/操作耗时过长/)
  close()
  expect(state.window.sent).toHaveLength(2)
})

it('reenables input and allows retry when renderer saving fails', async () => {
  close()
  state.ipc.get('mymap:flush-failed')!(event())
  expect(state.window.enabled).toBe(true)
  expect(state.window.destroyed).toBe(false)
  close()
  expect(state.window.sent).toHaveLength(2)
})

it('reenables input when the user continues importing', async () => {
  state.progress = () => Promise.resolve({ running: true })
  close()
  await flushed()
  expect(state.window.enabled).toBe(true)
  expect(state.window.destroyed).toBe(false)
  close()
  expect(state.window.sent).toHaveLength(2)
})

it('keeps input frozen while stopping an import and waiting for shutdown', async () => {
  state.progress = () => Promise.resolve({ running: true })
  state.choices = [1]
  let finish!: () => void
  state.shutdown = () =>
    new Promise<void>((resolve) => {
      finish = resolve
    })
  close()
  const closing = flushed()
  await tick()
  expect(state.window.enabled).toBe(false)
  expect(state.window.destroyed).toBe(false)
  finish()
  await closing
  expect(state.window.destroyed).toBe(true)
})

it('reenables input after a flush timeout and ignores a late acknowledgment', async () => {
  close()
  await vi.advanceTimersByTimeAsync(15000)
  expect(state.window.enabled).toBe(true)
  expect(state.window.destroyed).toBe(false)
  await flushed()
  expect(state.window.destroyed).toBe(false)
  close()
  expect(state.window.sent).toHaveLength(2)
})
