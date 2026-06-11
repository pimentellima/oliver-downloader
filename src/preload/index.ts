import { contextBridge, ipcRenderer } from 'electron'
import type { AnalyzedVideo, AppApi, DownloadEvent } from '../shared/contracts'

const api: AppApi = {
  analyzeUrl: (inputUrl: string) => ipcRenderer.invoke('downloads:analyze', inputUrl),
  enqueueDownload: (video: AnalyzedVideo) => ipcRenderer.invoke('downloads:enqueue', video),
  cancelDownload: (downloadId: number) => ipcRenderer.invoke('downloads:cancel', downloadId),
  retryDownload: (downloadId: number) => ipcRenderer.invoke('downloads:retry', downloadId),
  listDownloads: () => ipcRenderer.invoke('downloads:list'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  chooseDownloadDirectory: () => ipcRenderer.invoke('settings:chooseDirectory'),
  getBinaryStatus: () => ipcRenderer.invoke('binaries:status'),
  checkYtdlpUpdate: () => ipcRenderer.invoke('binaries:checkYtdlp'),
  getAppUpdateStatus: () => ipcRenderer.invoke('appUpdate:status'),
  checkForAppUpdate: () => ipcRenderer.invoke('appUpdate:check'),
  downloadAppUpdate: () => ipcRenderer.invoke('appUpdate:download'),
  installAppUpdate: () => ipcRenderer.invoke('appUpdate:install'),
  openDirectory: (path: string) => ipcRenderer.invoke('shell:openDirectory', path),
  showInFolder: (downloadId: number) => ipcRenderer.invoke('shell:showInFolder', downloadId),
  playFile: (downloadId: number) => ipcRenderer.invoke('shell:playFile', downloadId),
  deleteDownloadedFile: (downloadId: number) => ipcRenderer.invoke('shell:deleteDownloadedFile', downloadId),
  deleteDownloadRecord: (downloadId: number) => ipcRenderer.invoke('downloads:deleteRecord', downloadId),
  onDownloadEvent: (callback: (event: DownloadEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: DownloadEvent) => callback(payload)
    ipcRenderer.on('downloads:event', listener)
    return () => ipcRenderer.removeListener('downloads:event', listener)
  },
  onBinaryEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) => callback(payload)
    ipcRenderer.on('binaries:event', listener)
    return () => ipcRenderer.removeListener('binaries:event', listener)
  },
  onAppUpdateEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) => callback(payload)
    ipcRenderer.on('app-update:event', listener)
    return () => ipcRenderer.removeListener('app-update:event', listener)
  }
}

contextBridge.exposeInMainWorld('oliver', api)
