import { BrowserWindow } from 'electron'
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdir, readdir, rename } from 'node:fs/promises'
import { extname, join } from 'node:path'
import {
  getDownload,
  getSettings,
  insertDownload,
  pendingDownloads,
  refreshCompletedFileSize,
  resetForRetry,
  updateDownload
} from './database'
import { ensureYtDlpAvailable, getBinaryStatus, getFfmpegPath, setQueueBusy } from './binaries'
import { sanitizeYoutubeUrl } from './url'
import type { AnalyzedVideo, DownloadEvent, DownloadItem } from '../shared/contracts'

let activeProcess: ChildProcessWithoutNullStreams | null = null
let activeDownloadId: number | null = null
let queueRunning = false
let mainWindow: BrowserWindow | null = null

export function setDownloadWindow(window: BrowserWindow): void {
  mainWindow = window
}

export async function analyzeUrl(inputUrl: string): Promise<AnalyzedVideo> {
  const sanitized = sanitizeYoutubeUrl(inputUrl)
  const ytdlp = await ensureYtDlpAvailable()
  const payload = await execJson(ytdlp, [
    '--dump-single-json',
    '--skip-download',
    '--no-playlist',
    sanitized.canonicalUrl
  ])

  return {
    videoId: sanitized.videoId,
    canonicalUrl: sanitized.canonicalUrl,
    originalUrl: inputUrl.trim(),
    title: String(payload.title ?? 'Video sem titulo'),
    channel: String(payload.channel ?? payload.uploader ?? 'Canal desconhecido'),
    thumbnailUrl: typeof payload.thumbnail === 'string' ? payload.thumbnail : null,
    durationSeconds: typeof payload.duration === 'number' ? payload.duration : null
  }
}

export async function enqueueDownload(video: AnalyzedVideo): Promise<DownloadItem> {
  const item = insertDownload(video)
  emit(item)
  void runQueue()
  return item
}

export async function retryDownload(downloadId: number): Promise<DownloadItem> {
  const item = resetForRetry(downloadId)
  emit(item)
  void runQueue()
  return item
}

export async function cancelDownload(downloadId: number): Promise<DownloadItem> {
  const item = getDownload(downloadId)
  if (activeDownloadId === downloadId && activeProcess) {
    activeProcess.kill('SIGTERM')
  }

  const cancelled = updateDownload(item.id, {
    status: 'cancelled',
    phase: 'idle',
    progress: null,
    speed: null,
    eta: null,
    errorSummary: 'Download cancelado pelo usuário.',
    errorDetails: null
  })
  emit(cancelled)
  return cancelled
}

export async function runQueue(): Promise<void> {
  if (queueRunning) return
  queueRunning = true
  setQueueBusy(true)

  try {
    while (true) {
      const next = pendingDownloads()[0]
      if (!next) break
      await runDownload(next)
    }
  } finally {
    queueRunning = false
    activeDownloadId = null
    activeProcess = null
    setQueueBusy(false)
  }
}

export async function stopActiveDownloadForQuit(): Promise<void> {
  if (activeDownloadId && activeProcess) {
    activeProcess.kill('SIGTERM')
    const item = updateDownload(activeDownloadId, {
      status: 'cancelled',
      phase: 'idle',
      progress: null,
      speed: null,
      eta: null,
      errorSummary: 'Download interrompido ao fechar o app.'
    })
    emit(item)
  }
}

async function runDownload(item: DownloadItem): Promise<void> {
  activeDownloadId = item.id
  const ytdlp = await ensureYtDlpAvailable()
  const downloadDirectory = getSettings().downloadDirectory
  await mkdir(downloadDirectory, { recursive: true })

  const workingTemplate = join(downloadDirectory, `.oliver-${item.id}-%(title).80s.%(ext)s`)
  let current = updateDownload(item.id, {
    status: 'downloading',
    phase: 'download',
    progress: 0,
    speed: null,
    eta: null,
    errorSummary: null,
    errorDetails: null
  })
  emit(current)

  const args = [
    '--no-playlist',
    '--newline',
    '--progress',
    '--progress-delta',
    '0.2',
    '--no-color',
    '--progress-template',
    'download:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
    '-f',
    'bv*[vcodec^=avc1]+ba[acodec^=mp4a]/b[ext=mp4][vcodec^=avc1][acodec^=mp4a]/bv*+ba/b',
    '--merge-output-format',
    'mp4',
    '--ffmpeg-location',
    getFfmpegPath(),
    '-o',
    workingTemplate,
    item.canonicalUrl
  ]

  await new Promise<void>((resolve) => {
    const child = spawn(ytdlp, args, { windowsHide: true })
    activeProcess = child
    let stderr = ''
    let stdout = ''
    let stdoutBuffer = ''
    let stderrBuffer = ''
    let settled = false

    child.on('error', (error) => {
      if (settled) return
      settled = true
      activeProcess = null
      const failed = updateDownload(item.id, {
        status: 'failed',
        phase: 'error',
        speed: null,
        eta: null,
        errorSummary: 'Não foi possível executar o yt-dlp.',
        errorDetails: error.message
      })
      emit(failed)
      resolve()
    })

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      stdoutBuffer = consumeLines(stdoutBuffer + text, handleOutputLine)
    })

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text
      stderrBuffer = consumeLines(stderrBuffer + text, handleOutputLine)
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      if (stdoutBuffer) handleOutputLine(stdoutBuffer)
      if (stderrBuffer) handleOutputLine(stderrBuffer)
      activeProcess = null
      if (getDownload(item.id).status === 'cancelled') {
        resolve()
        return
      }

      if (code === 0) {
        resolve()
      } else {
        const failed = updateDownload(item.id, {
          status: 'failed',
          phase: 'error',
          speed: null,
          eta: null,
          errorSummary: summarizeError(stderr || stdout),
          errorDetails: [stderr.trim(), stdout.trim()].filter(Boolean).join('\n\n')
        })
        emit(failed)
      }
    })

    function handleOutputLine(line: string): void {
      const parsed = parseProgress(line)
      if (!parsed) return

      current = updateDownload(item.id, {
        status: parsed.phase === 'merge' ? 'converting' : 'downloading',
        phase: parsed.phase,
        progress: parsed.progress,
        speed: parsed.speed,
        eta: parsed.eta
      })
      emit(current)
    }
  })

  const afterDownload = getDownload(item.id)
  if (afterDownload.status === 'cancelled' || afterDownload.status === 'failed') return

  const downloadedPath = await findNewestWorkingFile(downloadDirectory, item.id)
  if (!downloadedPath) {
    const failed = updateDownload(item.id, {
      status: 'failed',
      phase: 'error',
      speed: null,
      eta: null,
      errorSummary: 'Não foi possível encontrar o arquivo baixado.',
      errorDetails: null
    })
    emit(failed)
    return
  }

  const finalPath = await uniqueOutputPath(downloadDirectory, item.title, extname(downloadedPath) || '.mp4')
  await rename(downloadedPath, finalPath)
  const completed = refreshCompletedFileSize(
    updateDownload(item.id, {
      status: 'completed',
      phase: 'complete',
      progress: 100,
      speed: null,
      eta: null,
      outputPath: finalPath,
      fileSizeBytes: existsSync(finalPath) ? statSync(finalPath).size : null,
      errorSummary: null,
      errorDetails: null,
      completedAt: new Date().toISOString()
    })
  )
  emit(completed)
}

function execJson(command: string, args: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      reject(new Error(`Não foi possível executar o yt-dlp: ${error.message}`))
    })
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(summarizeError(stderr || stdout)))
        return
      }
      try {
        resolve(JSON.parse(stdout) as Record<string, unknown>)
      } catch {
        reject(new Error('Não foi possível ler os metadados retornados pelo yt-dlp.'))
      }
    })
  })
}

function parseProgress(line: string):
  | { phase: 'download' | 'merge'; progress: number | null; speed: string | null; eta: string | null }
  | null {
  const cleanLine = stripAnsi(line).trim()

  if (cleanLine.includes('[Merger]') || cleanLine.includes('[VideoRemuxer]')) {
    return { phase: 'merge', progress: null, speed: null, eta: null }
  }

  const markerIndex = cleanLine.indexOf('download:')
  if (markerIndex === -1) return null

  const [percent, speed, eta] = cleanLine.slice(markerIndex + 'download:'.length).split('|')
  const progress = Number.parseFloat(percent.replace('%', '').trim())
  return {
    phase: 'download',
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : null,
    speed: normalizeProgressValue(speed),
    eta: normalizeProgressValue(eta)
  }
}

function consumeLines(value: string, onLine: (line: string) => void): string {
  const lines = value.split(/\r?\n/)
  const remainder = lines.pop() ?? ''
  for (const line of lines) onLine(line)
  return remainder
}

function normalizeProgressValue(value: string | undefined): string | null {
  const normalized = value?.trim()
  if (!normalized || normalized === 'NA' || normalized === 'Unknown') return null
  return normalized
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '')
}

async function uniqueOutputPath(directory: string, title: string, extension: string): Promise<string> {
  const safeTitle = sanitizeFileName(title) || 'video'
  const files = new Set(await readdir(directory).catch(() => []))
  let candidate = `${safeTitle}${extension}`
  let index = 2

  while (files.has(candidate)) {
    candidate = `${safeTitle} (${index})${extension}`
    index += 1
  }

  return join(directory, candidate)
}

async function findNewestWorkingFile(directory: string, downloadId: number): Promise<string | null> {
  const files = await readdir(directory).catch(() => [])
  const candidates = files
    .filter((file) => file.startsWith(`.oliver-${downloadId}-`) && !file.endsWith('.part') && !file.endsWith('.ytdl'))
    .map((file) => join(directory, file))
    .filter((path) => existsSync(path))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)

  return candidates[0] ?? null
}

function sanitizeFileName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

function summarizeError(raw: string): string {
  const text = raw.trim()
  if (!text) return 'Falha desconhecida ao baixar o vídeo.'
  if (/private video/i.test(text)) return 'Este vídeo é privado.'
  if (/sign in|login|age/i.test(text)) return 'Este vídeo exige login ou confirmação de idade.'
  if (/unavailable|removed/i.test(text)) return 'Este vídeo não está disponível.'
  if (/network|timed out|timeout|temporary failure/i.test(text)) return 'Falha de rede durante o download.'
  return text.split(/\r?\n/).find(Boolean)?.replace(/^ERROR:\s*/i, '') ?? 'Falha ao baixar o vídeo.'
}

function emit(item: DownloadItem): void {
  const event: DownloadEvent = { item, binaryStatus: getBinaryStatus() }
  mainWindow?.webContents.send('downloads:event', event)
}
