import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export function ensureDir(path: string): string {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }
  return path
}

export function userDataPath(...parts: string[]): string {
  return join(app.getPath('userData'), ...parts)
}

export function defaultDownloadDirectory(): string {
  return ensureDir(join(app.getPath('downloads'), 'Oliver Downloader'))
}

export function managedBinDirectory(): string {
  return ensureDir(userDataPath('bin'))
}

export function databasePath(): string {
  return userDataPath('oliver-downloader.sqlite')
}

export function bundledBinDirectory(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'bin')
  }
  return join(app.getAppPath(), 'resources', 'bin')
}
