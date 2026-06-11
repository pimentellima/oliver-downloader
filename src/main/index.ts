import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  migrate,
  deleteDownloadRecord,
  getDownload,
  getSettings,
  listDownloads,
  markInterruptedDownloads,
  updateDownload,
  updateSettings
} from './database'
import {
  checkAndApplyYtDlpUpdate,
  getBinaryStatus,
  initializeBinaries,
  setBinaryStatusListener,
  stopBinaryUpdateTimer
} from './binaries'
import {
  checkForAppUpdate,
  downloadAppUpdate,
  getAppUpdateStatus,
  installAppUpdate,
  setAppUpdateWindow
} from './app-updater'
import {
  analyzeUrl,
  cancelDownload,
  enqueueDownload,
  retryDownload,
  runQueue,
  setDownloadWindow,
  stopActiveDownloadForQuit
} from './downloader'
import type { AnalyzedVideo, Settings } from '../shared/contracts'

let mainWindow: BrowserWindow | null = null
let isQuitting = false

app.setName('Oliver Downloader')

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 620,
    show: false,
    title: 'Oliver Downloader',
    backgroundColor: '#0f1412',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  setDownloadWindow(mainWindow)
  setAppUpdateWindow(mainWindow)

  mainWindow.webContents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = []

    if (params.isEditable) {
      items.push(
        { label: 'Cortar', role: 'cut', enabled: params.editFlags.canCut },
        { label: 'Copiar', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'Colar', role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { label: 'Selecionar tudo', role: 'selectAll', enabled: params.editFlags.canSelectAll }
      )
    } else if (params.selectionText.trim()) {
      items.push({ label: 'Copiar', role: 'copy' })
    }

    if (items.length > 0) {
      Menu.buildFromTemplate(items).popup()
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', async (event) => {
    if (isQuitting) return
    const active = listDownloads().some((item) => ['analyzing', 'downloading', 'converting'].includes(item.status))
    if (!active) return

    event.preventDefault()
    const result = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: ['Cancelar downloads e fechar', 'Continuar no app'],
      defaultId: 1,
      cancelId: 1,
      title: 'Download em andamento',
      message: 'Existe um download em andamento.',
      detail: 'Se fechar agora, o processo sera cancelado e podera ser repetido depois.'
    })

    if (result.response === 0) {
      isQuitting = true
      await stopActiveDownloadForQuit()
      mainWindow?.close()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('downloads:analyze', (_event, url: string) => analyzeUrl(url))
  ipcMain.handle('downloads:enqueue', (_event, video: AnalyzedVideo) => enqueueDownload(video))
  ipcMain.handle('downloads:cancel', (_event, id: number) => cancelDownload(id))
  ipcMain.handle('downloads:retry', (_event, id: number) => retryDownload(id))
  ipcMain.handle('downloads:list', () => listDownloads())
  ipcMain.handle('downloads:deleteRecord', async (_event, id: number) => {
    const item = getDownload(id)
    if (['analyzing', 'downloading', 'converting'].includes(item.status)) {
      throw new Error('Cancele o download antes de remover da lista.')
    }
    if (item.outputPath && existsSync(item.outputPath)) {
      await shell.trashItem(item.outputPath)
    }
    deleteDownloadRecord(id)
    mainWindow?.webContents.send('downloads:event', { deletedId: id, binaryStatus: getBinaryStatus() })
  })

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:update', (_event, settings: Pick<Settings, 'downloadDirectory'>) => updateSettings(settings))
  ipcMain.handle('settings:chooseDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: getSettings().downloadDirectory
    })
    if (result.canceled) return null
    return result.filePaths[0] ?? null
  })

  ipcMain.handle('binaries:status', () => getBinaryStatus())
  ipcMain.handle('binaries:checkYtdlp', () => checkAndApplyYtDlpUpdate())
  ipcMain.handle('appUpdate:status', () => getAppUpdateStatus())
  ipcMain.handle('appUpdate:check', () => checkForAppUpdate())
  ipcMain.handle('appUpdate:download', () => downloadAppUpdate())
  ipcMain.handle('appUpdate:install', () => installAppUpdate())
  ipcMain.handle('shell:openDirectory', async (_event, path: string) => {
    if (!existsSync(path)) {
      throw new Error('Pasta não encontrada.')
    }
    await openDirectoryInFileManager(path)
  })
  ipcMain.handle('shell:showInFolder', async (_event, id: number) => {
    const item = getDownload(id)
    if (!item.outputPath || !existsSync(item.outputPath)) {
      throw new Error('Arquivo não encontrado.')
    }
    await showItemInFileManager(item.outputPath)
    return item
  })
  ipcMain.handle('shell:playFile', async (_event, id: number) => {
    const item = getDownload(id)
    if (!item.outputPath || !existsSync(item.outputPath)) {
      throw new Error('Arquivo não encontrado.')
    }
    const error = await shell.openPath(item.outputPath)
    if (error) throw new Error(error)
  })
  ipcMain.handle('shell:deleteDownloadedFile', async (_event, id: number) => {
    const item = getDownload(id)
    if (!item.outputPath || !existsSync(item.outputPath)) {
      const updated = updateDownload(id, { outputPath: null, fileSizeBytes: null })
      mainWindow?.webContents.send('downloads:event', { item: updated, binaryStatus: getBinaryStatus() })
      return updated
    }
    await shell.trashItem(item.outputPath)
    const updated = updateDownload(id, { outputPath: null, fileSizeBytes: null })
    mainWindow?.webContents.send('downloads:event', { item: updated, binaryStatus: getBinaryStatus() })
    return updated
  })
}

async function openDirectoryInFileManager(path: string): Promise<void> {
  if (process.platform === 'darwin') {
    await execFileAsync('open', [path])
    return
  }

  if (process.platform === 'win32') {
    await execFileAsync('explorer.exe', [path])
    return
  }

  await shell.openExternal(pathToFileURL(path).toString())
}

async function showItemInFileManager(path: string): Promise<void> {
  if (process.platform === 'darwin') {
    await execFileAsync('open', ['-R', path])
    return
  }

  if (process.platform === 'win32') {
    await execFileAsync('explorer.exe', [`/select,${path}`])
    return
  }

  shell.showItemInFolder(path)
}

function execFileAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

app.whenReady().then(async () => {
  migrate()
  markInterruptedDownloads()
  registerIpc()
  createWindow()

  setBinaryStatusListener((status) => {
    mainWindow?.webContents.send('binaries:event', status)
  })

  await initializeBinaries()
  void runQueue()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => {
  isQuitting = true
  stopBinaryUpdateTimer()
})
