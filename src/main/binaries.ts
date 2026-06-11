import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { app } from 'electron'
import { chmodSync, createWriteStream, existsSync } from 'node:fs'
import { copyFile, rename, rm } from 'node:fs/promises'
import https from 'node:https'
import { basename, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { bundledBinDirectory, managedBinDirectory } from './paths'
import type { BinaryStatus } from '../shared/contracts'

const execFileAsync = promisify(execFile)
const ONE_HOUR_MS = 60 * 60 * 1000

// No app empacotado, ffmpeg.path aponta para dentro do app.asar (caminho virtual);
// spawn não enxerga o asar, então o binário real fica em app.asar.unpacked.
export function getFfmpegPath(): string {
  return ffmpeg.path.replace('app.asar', 'app.asar.unpacked')
}

let status: BinaryStatus = {
  ytdlpPath: null,
  ytdlpVersion: null,
  ytdlpUpdateState: 'idle',
  ytdlpLatestVersion: null,
  ytdlpLastCheckedAt: null,
  ffmpegPath: getFfmpegPath(),
  message: null
}

let updateTimer: NodeJS.Timeout | null = null
let updateInFlight: Promise<BinaryStatus> | null = null
let isQueueBusy = false
let onStatus: ((status: BinaryStatus) => void) | null = null

export function setBinaryStatusListener(listener: (next: BinaryStatus) => void): void {
  onStatus = listener
}

export function setQueueBusy(next: boolean): void {
  isQueueBusy = next
  if (!next && status.ytdlpUpdateState === 'pending') {
    void checkAndApplyYtDlpUpdate()
  }
}

export function getBinaryStatus(): BinaryStatus {
  status = {
    ...status,
    ytdlpPath: resolveYtDlpPath(),
    ffmpegPath: getFfmpegPath()
  }
  return { ...status }
}

export async function initializeBinaries(): Promise<void> {
  await ensureYtDlpAvailable()
  void checkAndApplyYtDlpUpdate()
  updateTimer = setInterval(() => {
    void checkAndApplyYtDlpUpdate()
  }, ONE_HOUR_MS)
}

export function stopBinaryUpdateTimer(): void {
  if (updateTimer) clearInterval(updateTimer)
}

export async function ensureYtDlpAvailable(): Promise<string> {
  const current = resolveYtDlpPath()
  if (current) {
    status = {
      ...status,
      ytdlpPath: current,
      ytdlpVersion: await readYtDlpVersion(current)
    }
    emit()
    return current
  }

  await checkAndApplyYtDlpUpdate({ forceDownload: true })
  const downloaded = resolveYtDlpPath()
  if (!downloaded) {
    throw new Error('yt-dlp nao esta disponivel. Verifique a conexao ou empacote o binario.')
  }
  return downloaded
}

export async function checkAndApplyYtDlpUpdate(options: { forceDownload?: boolean } = {}): Promise<BinaryStatus> {
  if (updateInFlight) return updateInFlight

  updateInFlight = performUpdate(options)
    .catch((error) => {
      status = {
        ...status,
        ytdlpUpdateState: 'failed',
        message: error instanceof Error ? error.message : 'Falha ao atualizar yt-dlp.'
      }
      emit()
      return getBinaryStatus()
    })
    .finally(() => {
      updateInFlight = null
    })

  return updateInFlight
}

function resolveYtDlpPath(): string | null {
  const managed = join(managedBinDirectory(), ytdlpFileName())
  if (existsSync(managed)) return managed

  const bundled = join(bundledBinDirectory(), ytdlpFileName())
  if (existsSync(bundled)) {
    return bundled
  }

  return null
}

async function performUpdate(options: { forceDownload?: boolean }): Promise<BinaryStatus> {
  status = { ...getBinaryStatus(), ytdlpUpdateState: 'checking', message: 'Verificando atualizacao do yt-dlp...' }
  emit()

  const release = await fetchLatestRelease()
  status = {
    ...status,
    ytdlpLatestVersion: release.tag_name,
    ytdlpLastCheckedAt: new Date().toISOString()
  }

  const currentPath = resolveYtDlpPath()
  const currentVersion = currentPath ? await readYtDlpVersion(currentPath) : null
  const latestVersion = release.tag_name.replace(/^yt-dlp@/, '').replace(/^v/, '')

  if (!options.forceDownload && currentVersion && normalizeVersion(currentVersion) === normalizeVersion(latestVersion)) {
    status = {
      ...status,
      ytdlpPath: currentPath,
      ytdlpVersion: currentVersion,
      ytdlpUpdateState: 'idle',
      message: 'yt-dlp atualizado.'
    }
    emit()
    return getBinaryStatus()
  }

  if (isQueueBusy) {
    status = {
      ...status,
      ytdlpUpdateState: 'pending',
      message: 'Atualizacao do yt-dlp pendente ate a fila ficar ociosa.'
    }
    emit()
    return getBinaryStatus()
  }

  const asset = release.assets.find((candidate) => candidate.name === ytdlpFileName())
  if (!asset) {
    throw new Error(`Release do yt-dlp nao contem asset ${ytdlpFileName()}.`)
  }

  status = { ...status, ytdlpUpdateState: 'updating', message: 'Baixando atualizacao do yt-dlp...' }
  emit()

  const destination = join(managedBinDirectory(), ytdlpFileName())
  const temp = `${destination}.download`
  await downloadFile(asset.browser_download_url, temp)
  if (process.platform !== 'win32') chmodSync(temp, 0o755)

  const previous = existsSync(destination) ? `${destination}.previous` : null
  if (previous) {
    await rm(previous, { force: true })
    await rename(destination, previous)
  }

  try {
    await rename(temp, destination)
    const version = await readYtDlpVersion(destination)
    status = {
      ...status,
      ytdlpPath: destination,
      ytdlpVersion: version,
      ytdlpUpdateState: 'idle',
      message: `yt-dlp atualizado para ${version}.`
    }
    if (previous) await rm(previous, { force: true })
  } catch (error) {
    await rm(temp, { force: true })
    if (previous && existsSync(previous)) {
      await copyFile(previous, destination)
      await rm(previous, { force: true })
    }
    throw error
  }

  emit()
  return getBinaryStatus()
}

async function readYtDlpVersion(path: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(path, ['--version'], { timeout: 10_000 })
    return stdout.trim() || null
  } catch {
    return null
  }
}

function ytdlpFileName(): string {
  if (process.platform === 'win32') return 'yt-dlp.exe'
  if (process.platform === 'darwin') return 'yt-dlp_macos'
  return 'yt-dlp'
}

function normalizeVersion(version: string): string {
  return version.replace(/^yt-dlp@/, '').replace(/^v/, '').trim()
}

function emit(): void {
  onStatus?.(getBinaryStatus())
}

function downloadFile(url: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': app.getName() } }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        downloadFile(response.headers.location, destination).then(resolve, reject)
        return
      }

      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`Falha ao baixar ${basename(destination)}: HTTP ${response.statusCode}.`))
        return
      }

      const file = createWriteStream(destination)
      response.pipe(file)
      file.on('finish', () => {
        file.close((error) => (error ? reject(error) : resolve()))
      })
      file.on('error', reject)
    })
    request.on('error', reject)
    request.setTimeout(60_000, () => {
      request.destroy(new Error('Tempo esgotado ao baixar yt-dlp.'))
    })
  })
}

type GitHubRelease = {
  tag_name: string
  assets: Array<{ name: string; browser_download_url: string }>
}

function fetchLatestRelease(): Promise<GitHubRelease> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest',
      { headers: { Accept: 'application/vnd.github+json', 'User-Agent': app.getName() } },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume()
          reject(new Error(`GitHub respondeu HTTP ${response.statusCode} ao checar yt-dlp.`))
          return
        }

        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          body += chunk
        })
        response.on('end', () => {
          try {
            resolve(JSON.parse(body) as GitHubRelease)
          } catch {
            reject(new Error('Resposta invalida do GitHub ao checar yt-dlp.'))
          }
        })
      }
    )
    request.on('error', reject)
    request.setTimeout(30_000, () => {
      request.destroy(new Error('Tempo esgotado ao checar atualizacao do yt-dlp.'))
    })
  })
}
