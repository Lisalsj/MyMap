import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { MyMapApi, ImportProgress, UpdateState } from '../shared/types'
const call = <T>(method: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke('mymap:call', method, args)
const api: MyMapApi = {
  updateState: () => call('updateState'),
  setUpdateChecks: (enabled) => call('setUpdateChecks', enabled),
  checkForUpdates: () => call('checkForUpdates'),
  downloadUpdate: () => call('downloadUpdate'),
  cancelUpdateDownload: () => call('cancelUpdateDownload'),
  installUpdate: () => call('installUpdate'),
  openUpdateDownload: () => call('openUpdateDownload'),
  onUpdate: (handler) => {
    const listener = (_: unknown, state: UpdateState) => handler(state)
    ipcRenderer.on('mymap:update', listener)
    return () => ipcRenderer.removeListener('mymap:update', listener)
  },
  snapshot: () => call('snapshot'),
  saveTrip: (input) => call('saveTrip', input),
  saveEntry: (input) => call('saveEntry', input),
  saveVisit: (input) => call('saveVisit', input),
  deleteVisit: (id) => call('deleteVisit', id),
  reorderVisits: (tripId, ids) => call('reorderVisits', tripId, ids),
  trash: (kind, id) => call('trash', kind, id),
  restore: (kind, id) => call('restore', kind, id),
  emptyTrash: () => call('emptyTrash'),
  importPhotos: (tripId, options) => call('importPhotos', tripId, options),
  importDroppedPhotos: (tripId, files, options) =>
    call(
      'importDroppedPhotos',
      tripId,
      Array.from(files, (file) => webUtils.getPathForFile(file)),
      options
    ),
  cancelImport: () => call('cancelImport'),
  importProgress: () => call('importProgress'),
  updateAttachment: (id, patch) => call('updateAttachment', id, patch),
  confirmPhotoLocation: (id, attachmentId) => call('confirmPhotoLocation', id, attachmentId),
  backup: () => call('backup'),
  restoreBackup: () => call('restoreBackup'),
  chooseLibrary: () => call('chooseLibrary'),
  openLibraryFolder: () => call('openLibraryFolder'),
  exportEntry: (id) => call('exportEntry', id),
  setDemo: (enabled) => call('setDemo', enabled),
  cities: (query) => call('cities', query),
  onProgress: (handler) => {
    const listener = (_: unknown, p: ImportProgress) => handler(p)
    ipcRenderer.on('mymap:progress', listener)
    return () => ipcRenderer.removeListener('mymap:progress', listener)
  }
}
contextBridge.exposeInMainWorld('myMap', api)
ipcRenderer.on('mymap:flush', () => window.dispatchEvent(new Event('mymap:flush')))
window.addEventListener('mymap:flushed', () => ipcRenderer.send('mymap:flushed'))
window.addEventListener('mymap:flush-failed', () => ipcRenderer.send('mymap:flush-failed'))
window.addEventListener('mymap:ready', () => ipcRenderer.send('mymap:ready'))
window.addEventListener('mymap:map-ready', () => ipcRenderer.send('mymap:map-ready'))
