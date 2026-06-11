import { app, BrowserWindow, dialog } from 'electron'
import electronUpdater, { type UpdateCheckResult, type UpdateInfo } from 'electron-updater'

const { autoUpdater } = electronUpdater

export type AppUpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface AppUpdateStatus {
  state: AppUpdateState
  currentVersion: string
  latestVersion: string | null
  progress: number | null
  message: string
}

let mainWindow: BrowserWindow | null = null
let updateAvailable = false
let updateDownloaded = false
let status: AppUpdateStatus = {
  state: 'idle',
  currentVersion: app.getVersion(),
  latestVersion: null,
  progress: null,
  message: 'Atualizado.'
}

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false

export function setAppUpdateWindow(window: BrowserWindow): void {
  mainWindow = window
}

export function getAppUpdateStatus(): AppUpdateStatus {
  return { ...status, currentVersion: app.getVersion() }
}

export async function checkForAppUpdate(): Promise<AppUpdateStatus> {
  if (!app.isPackaged) {
    setStatus({
      state: 'not-available',
      latestVersion: null,
      progress: null,
      message: 'Atualizações do app funcionam depois que ele estiver instalado.'
    })
    return getAppUpdateStatus()
  }

  updateAvailable = false
  setStatus({ state: 'checking', progress: null, message: 'Verificando atualização...' })

  try {
    const result = (await autoUpdater.checkForUpdates()) as UpdateCheckResult | null
    if (!updateAvailable) {
      setStatus({
        state: 'not-available',
        latestVersion: result?.updateInfo?.version ?? null,
        progress: null,
        message: 'Atualizado.'
      })
    }
  } catch (error) {
    setStatus({
      state: 'error',
      progress: null,
      message: error instanceof Error ? error.message : 'Não foi possível verificar atualização.'
    })
  }

  return getAppUpdateStatus()
}

export async function downloadAppUpdate(): Promise<AppUpdateStatus> {
  if (!updateAvailable) {
    return checkForAppUpdate()
  }

  setStatus({ state: 'downloading', progress: 0, message: 'Baixando atualização...' })

  try {
    await autoUpdater.downloadUpdate()
  } catch (error) {
    setStatus({
      state: 'error',
      progress: null,
      message: error instanceof Error ? error.message : 'Não foi possível baixar atualização.'
    })
  }

  return getAppUpdateStatus()
}

export function installAppUpdate(): AppUpdateStatus {
  if (!updateDownloaded) {
    setStatus({ state: 'error', message: 'Nenhuma atualização baixada para instalar.' })
    return getAppUpdateStatus()
  }

  autoUpdater.quitAndInstall(false, true)
  return getAppUpdateStatus()
}

autoUpdater.on('update-available', (info: UpdateInfo) => {
  updateAvailable = true
  updateDownloaded = false
  setStatus({
    state: 'available',
    latestVersion: info.version,
    progress: null,
    message: `Nova versão ${info.version} disponível.`
  })
})

autoUpdater.on('update-not-available', (info: UpdateInfo) => {
  updateAvailable = false
  updateDownloaded = false
  setStatus({
    state: 'not-available',
    latestVersion: info.version,
    progress: null,
    message: 'Atualizado.'
  })
})

autoUpdater.on('download-progress', (progress) => {
  setStatus({
    state: 'downloading',
    progress: Math.round(progress.percent),
    message: `Baixando atualização (${Math.round(progress.percent)}%).`
  })
})

autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
  updateDownloaded = true
  setStatus({
    state: 'downloaded',
    latestVersion: info.version,
    progress: 100,
    message: 'Atualização pronta para instalar.'
  })

  if (!mainWindow) return
  void dialog
    .showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Instalar agora', 'Depois'],
      defaultId: 0,
      cancelId: 1,
      title: 'Atualização pronta',
      message: 'A atualização foi baixada.',
      detail: 'Clique em instalar para reiniciar o app e concluir a atualização.'
    })
    .then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall(false, true)
      }
    })
})

autoUpdater.on('error', (error) => {
  setStatus({
    state: 'error',
    progress: null,
    message: error.message || 'Erro ao atualizar o app.'
  })
})

function setStatus(patch: Partial<AppUpdateStatus>): void {
  status = {
    ...status,
    ...patch,
    currentVersion: app.getVersion()
  }
  mainWindow?.webContents.send('app-update:event', getAppUpdateStatus())
}
