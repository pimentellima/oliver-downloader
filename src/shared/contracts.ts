export type DownloadStatus =
  | 'pending'
  | 'analyzing'
  | 'downloading'
  | 'converting'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type DownloadPhase = 'idle' | 'metadata' | 'download' | 'merge' | 'complete' | 'error'

export interface Settings {
  downloadDirectory: string
  createdAt: string
  updatedAt: string
}

export interface AnalyzedVideo {
  videoId: string
  canonicalUrl: string
  originalUrl: string
  title: string
  channel: string
  thumbnailUrl: string | null
  durationSeconds: number | null
}

export interface DownloadItem extends AnalyzedVideo {
  id: number
  status: DownloadStatus
  phase: DownloadPhase
  progress: number | null
  speed: string | null
  eta: string | null
  outputPath: string | null
  fileSizeBytes: number | null
  errorSummary: string | null
  errorDetails: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface BinaryStatus {
  ytdlpPath: string | null
  ytdlpVersion: string | null
  ytdlpUpdateState: 'idle' | 'checking' | 'updating' | 'pending' | 'failed'
  ytdlpLatestVersion: string | null
  ytdlpLastCheckedAt: string | null
  ffmpegPath: string | null
  message: string | null
}

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

export interface DownloadEvent {
  item?: DownloadItem
  deletedId?: number
  binaryStatus?: BinaryStatus
}

export interface AppApi {
  analyzeUrl(inputUrl: string): Promise<AnalyzedVideo>
  enqueueDownload(video: AnalyzedVideo): Promise<DownloadItem>
  cancelDownload(downloadId: number): Promise<DownloadItem>
  retryDownload(downloadId: number): Promise<DownloadItem>
  listDownloads(): Promise<DownloadItem[]>
  getSettings(): Promise<Settings>
  updateSettings(settings: Pick<Settings, 'downloadDirectory'>): Promise<Settings>
  chooseDownloadDirectory(): Promise<string | null>
  getBinaryStatus(): Promise<BinaryStatus>
  checkYtdlpUpdate(): Promise<BinaryStatus>
  getAppUpdateStatus(): Promise<AppUpdateStatus>
  checkForAppUpdate(): Promise<AppUpdateStatus>
  downloadAppUpdate(): Promise<AppUpdateStatus>
  installAppUpdate(): Promise<AppUpdateStatus>
  openDirectory(path: string): Promise<void>
  showInFolder(downloadId: number): Promise<DownloadItem>
  playFile(downloadId: number): Promise<void>
  deleteDownloadedFile(downloadId: number): Promise<DownloadItem>
  deleteDownloadRecord(downloadId: number): Promise<void>
  onDownloadEvent(callback: (event: DownloadEvent) => void): () => void
  onBinaryEvent(callback: (status: BinaryStatus) => void): () => void
  onAppUpdateEvent(callback: (status: AppUpdateStatus) => void): () => void
}

declare global {
  interface Window {
    oliver: AppApi
  }
}
