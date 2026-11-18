// Observe IPC calls and payloads without changing their arguments, results or scheduling.
const { ipcMain, utilityProcess } = require('electron')
const { resolve } = require('node:path')
if (!process.env.MYMAP_TEST_ROOT || !process.env.MYMAP_BENCH_ENTRY) throw Error('Benchmark profile required')
const counts = { rendererSnapshots: 0, workerSnapshots: 0, initialSnapshots: 0 }
globalThis.galleryBenchmarkCounts = counts
const register = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
  register(channel, (event, ...args) => {
    if (channel === 'mymap:call' && args[0] === 'snapshot') counts.rendererSnapshots++
    return listener(event, ...args)
  })
const fork = utilityProcess.fork.bind(utilityProcess)
utilityProcess.fork = (...args) => {
  const child = fork(...args)
  const pending = new Map()
  const send = child.postMessage.bind(child)
  child.postMessage = (request, ...other) => {
    if (request.method === 'init' || request.method === 'snapshot') pending.set(request.id, request.method)
    return send(request, ...other)
  }
  child.on('message', ({ id, result }) => {
    if (!pending.has(id)) return
    const method = pending.get(id)
    pending.delete(id)
    if (Array.isArray(result?.photos) && Array.isArray(result?.attachments)) {
      counts.workerSnapshots++
      if (method === 'init') counts.initialSnapshots++
    }
  })
  return child
}
require(resolve(process.env.MYMAP_BENCH_ENTRY))
