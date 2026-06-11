import Database from 'better-sqlite3'
import { existsSync, statSync } from 'node:fs'
import { databasePath, defaultDownloadDirectory, ensureDir } from './paths'
import type { AnalyzedVideo, DownloadItem, DownloadStatus, Settings } from '../shared/contracts'

type DownloadRow = {
  id: number
  video_id: string
  canonical_url: string
  original_url: string
  title: string
  channel: string
  thumbnail_url: string | null
  duration_seconds: number | null
  status: DownloadStatus
  phase: DownloadItem['phase']
  progress: number | null
  speed: string | null
  eta: string | null
  output_path: string | null
  file_size_bytes: number | null
  error_summary: string | null
  error_details: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (!db) {
    db = new Database(databasePath())
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
  }
  return db
}

export function migrate(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      download_directory TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      original_url TEXT NOT NULL,
      title TEXT NOT NULL,
      channel TEXT NOT NULL,
      thumbnail_url TEXT,
      duration_seconds INTEGER,
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      progress REAL,
      speed TEXT,
      eta TEXT,
      output_path TEXT,
      file_size_bytes INTEGER,
      error_summary TEXT,
      error_details TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_downloads_video_id ON downloads(video_id);
    CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
    CREATE INDEX IF NOT EXISTS idx_downloads_created_at ON downloads(created_at);
  `)

  const now = new Date().toISOString()
  const existing = getDb().prepare('SELECT id FROM settings WHERE id = 1').get()
  if (!existing) {
    getDb().prepare(
      'INSERT INTO settings (id, download_directory, created_at, updated_at) VALUES (1, ?, ?, ?)'
    ).run(defaultDownloadDirectory(), now, now)
  }
}

export function getSettings(): Settings {
  const row = getDb()
    .prepare('SELECT download_directory, created_at, updated_at FROM settings WHERE id = 1')
    .get() as { download_directory: string; created_at: string; updated_at: string }
  return {
    downloadDirectory: row.download_directory,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function updateSettings(input: Pick<Settings, 'downloadDirectory'>): Settings {
  const dir = ensureDir(input.downloadDirectory)
  const now = new Date().toISOString()
  getDb().prepare('UPDATE settings SET download_directory = ?, updated_at = ? WHERE id = 1').run(dir, now)
  return getSettings()
}

export function findDownloadByVideoId(videoId: string): DownloadItem | null {
  const row = getDb().prepare('SELECT * FROM downloads WHERE video_id = ? ORDER BY id DESC LIMIT 1').get(videoId) as
    | DownloadRow
    | undefined
  return row ? mapDownload(row) : null
}

export function getDownload(id: number): DownloadItem {
  const row = getDb().prepare('SELECT * FROM downloads WHERE id = ?').get(id) as DownloadRow | undefined
  if (!row) throw new Error('Download nao encontrado.')
  return mapDownload(row)
}

export function listDownloads(): DownloadItem[] {
  const rows = getDb().prepare('SELECT * FROM downloads ORDER BY created_at DESC, id DESC').all() as DownloadRow[]
  return rows.map(mapDownload)
}

export function deleteDownloadRecord(id: number): void {
  getDb().prepare('DELETE FROM downloads WHERE id = ?').run(id)
}

export function insertDownload(video: AnalyzedVideo): DownloadItem {
  const existing = findDownloadByVideoId(video.videoId)
  if (existing) return existing

  const now = new Date().toISOString()
  const result = getDb()
    .prepare(
      `INSERT INTO downloads (
        video_id, canonical_url, original_url, title, channel, thumbnail_url, duration_seconds,
        status, phase, progress, speed, eta, output_path, file_size_bytes, error_summary,
        error_details, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'idle', NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL)`
    )
    .run(
      video.videoId,
      video.canonicalUrl,
      video.originalUrl,
      video.title,
      video.channel,
      video.thumbnailUrl,
      video.durationSeconds,
      now,
      now
    )
  return getDownload(Number(result.lastInsertRowid))
}

export function updateDownload(
  id: number,
  patch: Partial<
    Pick<
      DownloadItem,
      | 'status'
      | 'phase'
      | 'progress'
      | 'speed'
      | 'eta'
      | 'outputPath'
      | 'fileSizeBytes'
      | 'errorSummary'
      | 'errorDetails'
      | 'completedAt'
    >
  >
): DownloadItem {
  const fields: string[] = []
  const values: unknown[] = []
  const mapping = {
    status: 'status',
    phase: 'phase',
    progress: 'progress',
    speed: 'speed',
    eta: 'eta',
    outputPath: 'output_path',
    fileSizeBytes: 'file_size_bytes',
    errorSummary: 'error_summary',
    errorDetails: 'error_details',
    completedAt: 'completed_at'
  } as const

  for (const [key, column] of Object.entries(mapping)) {
    if (key in patch) {
      fields.push(`${column} = ?`)
      values.push(patch[key as keyof typeof patch] ?? null)
    }
  }

  fields.push('updated_at = ?')
  values.push(new Date().toISOString(), id)
  getDb().prepare(`UPDATE downloads SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getDownload(id)
}

export function resetForRetry(id: number): DownloadItem {
  return updateDownload(id, {
    status: 'pending',
    phase: 'idle',
    progress: null,
    speed: null,
    eta: null,
    outputPath: null,
    fileSizeBytes: null,
    errorSummary: null,
    errorDetails: null,
    completedAt: null
  })
}

export function markInterruptedDownloads(): void {
  const now = new Date().toISOString()
  getDb().prepare(
    `UPDATE downloads
     SET status = 'cancelled', phase = 'idle', progress = NULL, speed = NULL, eta = NULL,
         error_summary = 'Download interrompido ao fechar o app.',
         updated_at = ?
     WHERE status IN ('analyzing', 'downloading', 'converting')`
  ).run(now)
}

export function pendingDownloads(): DownloadItem[] {
  const rows = getDb().prepare("SELECT * FROM downloads WHERE status = 'pending' ORDER BY id ASC").all() as DownloadRow[]
  return rows.map(mapDownload)
}

export function refreshCompletedFileSize(item: DownloadItem): DownloadItem {
  if (!item.outputPath || !existsSync(item.outputPath)) return item
  return updateDownload(item.id, { fileSizeBytes: statSync(item.outputPath).size })
}

function mapDownload(row: DownloadRow): DownloadItem {
  return {
    id: row.id,
    videoId: row.video_id,
    canonicalUrl: row.canonical_url,
    originalUrl: row.original_url,
    title: row.title,
    channel: row.channel,
    thumbnailUrl: row.thumbnail_url,
    durationSeconds: row.duration_seconds,
    status: row.status,
    phase: row.phase,
    progress: row.progress,
    speed: row.speed,
    eta: row.eta,
    outputPath: row.output_path,
    fileSizeBytes: row.file_size_bytes,
    errorSummary: row.error_summary,
    errorDetails: row.error_details,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  }
}
