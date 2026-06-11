import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FolderOpen,
  History,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Settings as SettingsIcon,
  Square,
  Terminal,
  Trash2,
  Video
} from 'lucide-react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { AppUpdateStatus, BinaryStatus, DownloadItem, Settings } from '@shared/contracts'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { Progress } from '@renderer/components/ui/progress'
import { cn, formatBytes, formatDuration, statusLabel } from '@renderer/lib/utils'

const emptyBinary: BinaryStatus = {
  ytdlpPath: null,
  ytdlpVersion: null,
  ytdlpUpdateState: 'idle',
  ytdlpLatestVersion: null,
  ytdlpLastCheckedAt: null,
  ffmpegPath: null,
  message: null
}

const emptyAppUpdate: AppUpdateStatus = {
  state: 'idle',
  currentVersion: '0.0.0',
  latestVersion: null,
  progress: null,
  message: 'Atualizado.'
}

export default function App(): JSX.Element {
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [binaryStatus, setBinaryStatus] = useState<BinaryStatus>(emptyBinary)
  const [appUpdateStatus, setAppUpdateStatus] = useState<AppUpdateStatus>(emptyAppUpdate)

  async function refresh(): Promise<void> {
    const [items, nextSettings, binaries, appUpdate] = await Promise.all([
      window.oliver.listDownloads(),
      window.oliver.getSettings(),
      window.oliver.getBinaryStatus(),
      window.oliver.getAppUpdateStatus()
    ])
    setDownloads(items)
    setSettings(nextSettings)
    setBinaryStatus(binaries)
    setAppUpdateStatus(appUpdate)
  }

  useEffect(() => {
    void refresh()
    const offDownload = window.oliver.onDownloadEvent((event) => {
      if (event.deletedId) {
        setDownloads((current) => current.filter((item) => item.id !== event.deletedId))
      }
      if (event.item) {
        setDownloads((current) => upsertDownload(current, event.item!))
      }
      if (event.binaryStatus) setBinaryStatus(event.binaryStatus)
    })
    const offBinary = window.oliver.onBinaryEvent(setBinaryStatus)
    const offAppUpdate = window.oliver.onAppUpdateEvent(setAppUpdateStatus)
    return () => {
      offDownload()
      offBinary()
      offAppUpdate()
    }
  }, [])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="app-shell">
        <aside className="sidebar">
          <div>
            <div className="brand-mark">
              <Download className="h-5 w-5" />
            </div>
            <h1 className="mt-4 text-xl font-black tracking-tight">Oliver Downloader</h1>
            <p className="mt-2 text-sm leading-5 text-muted-foreground">Baixe vídeos públicos do YouTube em MP4, localmente.</p>
          </div>

          <nav className="mt-8 grid gap-2">
            <NavLink to="/" icon={<Video className="h-4 w-4" />} label="Baixar" />
            <NavLink to="/historico" icon={<History className="h-4 w-4" />} label="Histórico" />
            <NavLink to="/configuracoes" icon={<SettingsIcon className="h-4 w-4" />} label="Configurações" />
          </nav>

          <UpdatePanel
            status={appUpdateStatus}
            onStatus={setAppUpdateStatus}
            ytdlpStatus={binaryStatus}
            onYtdlpStatus={setBinaryStatus}
          />
        </aside>

        <main className="main-panel">
          <Routes>
            <Route
              path="/"
              element={
                <DownloadPage
                  downloads={downloads}
                  settings={settings}
                  onRefresh={refresh}
                />
              }
            />
            <Route path="/historico" element={<HistoryPage downloads={downloads} onRefresh={refresh} />} />
            <Route
              path="/configuracoes"
              element={<SettingsPage settings={settings} binaryStatus={binaryStatus} onSettings={setSettings} onBinaryStatus={setBinaryStatus} />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

function NavLink({ to, icon, label }: { to: string; icon: JSX.Element; label: string }): JSX.Element {
  const location = useLocation()
  const active = location.pathname === to
  return (
    <Link className={cn('nav-link', active && 'active')} to={to}>
      {icon}
      {label}
    </Link>
  )
}

function DownloadPage({
  downloads,
  settings,
  onRefresh
}: {
  downloads: DownloadItem[]
  settings: Settings | null
  onRefresh: () => Promise<void>
}): JSX.Element {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const queue = useMemo(
    () => downloads.filter(shouldShowInQueue).sort((a, b) => b.id - a.id),
    [downloads]
  )

  async function chooseDirectory(): Promise<void> {
    const directory = await window.oliver.chooseDownloadDirectory()
    if (!directory) return
    await window.oliver.updateSettings({ downloadDirectory: directory })
    await onRefresh()
  }

  async function openDownloadDirectory(): Promise<void> {
    if (!settings?.downloadDirectory) return
    try {
      await openDirectory(settings.downloadDirectory)
    } catch (err) {
      window.alert(errorMessage(err))
    }
  }

  async function analyze(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const video = await window.oliver.analyzeUrl(url)
      await window.oliver.enqueueDownload(video)
      setUrl('')
      await onRefresh()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card className="download-card">
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Novo download</CardTitle>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              O arquivo final fica em{' '}
              <button className="font-medium text-foreground hover:underline" type="button" onClick={openDownloadDirectory}>
                {settings?.downloadDirectory ?? 'Downloads/Oliver Downloader'}
              </button>
              .{' '}
              <button className="text-muted-foreground hover:underline" type="button" onClick={chooseDirectory}>
                Clique para alterar o local de download.
              </button>
            </p>
          </div>
          <Button variant="secondary" onClick={chooseDirectory}>
            <FolderOpen className="h-4 w-4" />
            Alterar pasta
          </Button>
        </CardHeader>
        <CardContent>
          <form className="flex gap-3" onSubmit={analyze}>
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="Cole um link youtube.com/watch, youtu.be ou Shorts"
              disabled={busy}
            />
            <Button disabled={busy || !url.trim()} type="submit">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {busy ? 'Analisando...' : 'Baixar'}
            </Button>
          </form>

          {error && <ErrorBox message={error} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Fila</CardTitle>
          <Badge>{queue.length} item(ns)</Badge>
        </CardHeader>
        <CardContent>
          <DownloadList items={queue} empty="Nenhum download na fila." onRefresh={onRefresh} />
        </CardContent>
      </Card>
    </div>
  )
}

function HistoryPage({ downloads, onRefresh }: { downloads: DownloadItem[]; onRefresh: () => Promise<void> }): JSX.Element {
  const history = downloads.filter((item) => ['completed', 'failed', 'cancelled'].includes(item.status))
  return (
    <div className="space-y-5">
      <PageTitle title="Histórico" detail="Veja aqui os vídeos que você baixou e também os que não foram concluídos." />
      <Card>
        <CardContent className="pt-4">
          <DownloadList items={history} empty="Histórico vazio." onRefresh={onRefresh} />
        </CardContent>
      </Card>
    </div>
  )
}

function SettingsPage({
  settings,
  binaryStatus,
  onSettings,
  onBinaryStatus
}: {
  settings: Settings | null
  binaryStatus: BinaryStatus
  onSettings: (settings: Settings) => void
  onBinaryStatus: (status: BinaryStatus) => void
}): JSX.Element {
  const [saving, setSaving] = useState(false)

  async function chooseDirectory(): Promise<void> {
    const directory = await window.oliver.chooseDownloadDirectory()
    if (!directory) return
    setSaving(true)
    try {
      onSettings(await window.oliver.updateSettings({ downloadDirectory: directory }))
    } finally {
      setSaving(false)
    }
  }

  async function updateYtDlp(): Promise<void> {
    onBinaryStatus(await window.oliver.checkYtdlpUpdate())
  }

  return (
    <div className="space-y-5">
      <PageTitle title="Configurações" detail="A v1 mantém somente o necessário: destino dos vídeos e estado dos binários locais." />
      <Card>
        <CardHeader>
          <CardTitle>Pasta de download</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Input value={settings?.downloadDirectory ?? ''} readOnly />
          <Button variant="secondary" onClick={chooseDirectory} disabled={saving}>
            <FolderOpen className="h-4 w-4" />
            Alterar
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Binários locais</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <InfoRow label="yt-dlp" value={binaryStatus.ytdlpVersion ?? 'Não detectado'} />
          <InfoRow label="Estado" value={binaryStatus.message ?? binaryStatus.ytdlpUpdateState} />
          <InfoRow label="ffmpeg" value={binaryStatus.ffmpegPath ?? 'Não detectado'} />
          <Button className="w-fit" variant="outline" onClick={updateYtDlp}>
            <RefreshCw className="h-4 w-4" />
            Checar atualização
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function DownloadList({
  items,
  empty,
  onRefresh
}: {
  items: DownloadItem[]
  empty: string
  onRefresh: () => Promise<void>
}): JSX.Element {
  if (items.length === 0) {
    return <div className="empty-state">{empty}</div>
  }

  return (
    <div className="grid gap-3">
      {items.map((item) => (
        <DownloadRow key={item.id} item={item} onRefresh={onRefresh} />
      ))}
    </div>
  )
}

function DownloadRow({ item, onRefresh }: { item: DownloadItem; onRefresh: () => Promise<void> }): JSX.Element {
  const active = ['downloading', 'converting'].includes(item.status)
  const failed = item.status === 'failed'
  const done = item.status === 'completed'
  const fileRemoved = done && !item.outputPath

  async function cancel(): Promise<void> {
    await window.oliver.cancelDownload(item.id)
  }

  async function retry(): Promise<void> {
    await window.oliver.retryDownload(item.id)
  }

  async function showInFolder(): Promise<void> {
    if (!item.outputPath) return
    try {
      if (typeof window.oliver.showInFolder === 'function') {
        await window.oliver.showInFolder(item.id)
        return
      }
      await openDirectory(item.outputPath)
    } catch (err) {
      window.alert(errorMessage(err))
    }
  }

  async function playFile(): Promise<void> {
    if (!item.outputPath) return
    try {
      if (typeof window.oliver.playFile === 'function') {
        await window.oliver.playFile(item.id)
        return
      }
      await openDirectory(item.outputPath)
    } catch (err) {
      window.alert(errorMessage(err))
    }
  }

  async function remove(): Promise<void> {
    const confirmed = window.confirm(
      item.outputPath
        ? 'Remover este vídeo? O arquivo vai para a lixeira e o item sai da fila e do histórico.'
        : 'Remover este item da fila e do histórico?'
    )
    if (!confirmed) return
    try {
      if (typeof window.oliver.deleteDownloadRecord !== 'function') {
        throw new Error('Reinicie o app para carregar a opção de remover da fila e do histórico.')
      }
      await window.oliver.deleteDownloadRecord(item.id)
      await onRefresh()
    } catch (err) {
      window.alert(errorMessage(err))
    }
  }

  return (
    <div className="download-row">
      <Thumb url={item.thumbnailUrl} small />
      <div className="download-row-main">
        <div className="download-row-header">
          <div className="min-w-0">
            <p className="truncate font-bold">{item.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {item.channel} · {formatDuration(item.durationSeconds)}
            </p>
          </div>
          <StatusBadge item={item} />
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Progress value={item.progress} />
          <span className="w-12 text-right text-xs text-muted-foreground">{item.progress == null ? '-' : `${Math.round(item.progress)}%`}</span>
        </div>

        <div className="download-row-meta">
          <span className="shrink-0">{item.speed ?? 'Sem velocidade'}</span>
          <span className="shrink-0">ETA {item.eta ?? '-'}</span>
          <span className="shrink-0">{formatBytes(item.fileSizeBytes)}</span>
          {item.outputPath && <span className="min-w-0 truncate">Arquivo: {item.outputPath}</span>}
          {fileRemoved && <span className="min-w-0 truncate">Arquivo removido. Você pode baixar novamente ou remover este item.</span>}
        </div>

        {item.errorSummary && (
          <details className="mt-3 rounded-md border border-destructive/25 bg-destructive/10 p-3 text-sm">
            <summary className="cursor-pointer font-semibold text-destructive">{item.errorSummary}</summary>
            {item.errorDetails && <pre className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{item.errorDetails}</pre>}
          </details>
        )}
      </div>

      <div className="download-row-actions">
        {active && (
          <Button size="sm" variant="destructive" onClick={cancel}>
            <Square className="h-4 w-4" />
            Cancelar
          </Button>
        )}
        {(failed || item.status === 'cancelled' || fileRemoved) && (
          <Button size="sm" variant="secondary" onClick={retry}>
            <RotateCcw className="h-4 w-4" />
            Repetir
          </Button>
        )}
        {done && item.outputPath && (
          <Button size="sm" variant="outline" onClick={showInFolder} title="Mostrar o arquivo no Finder ou Explorer">
            <FolderOpen className="h-4 w-4" />
            Abrir pasta
          </Button>
        )}
        {done && item.outputPath && (
          <Button size="sm" variant="outline" onClick={playFile}>
            <Play className="h-4 w-4" />
            Reproduzir
          </Button>
        )}
        {!active && item.status !== 'analyzing' && (
          <Button size="sm" variant="destructive" onClick={remove} title="Remover da fila e do histórico (exclui o arquivo)">
            <Trash2 className="h-4 w-4" />
            Excluir
          </Button>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ item }: { item: DownloadItem }): JSX.Element {
  const tone = {
    completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    failed: 'border-destructive/40 bg-destructive/10 text-destructive',
    cancelled: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    downloading: 'border-primary/40 bg-primary/10 text-primary',
    converting: 'border-primary/40 bg-primary/10 text-primary',
    pending: 'border-border bg-secondary text-muted-foreground',
    analyzing: 'border-primary/40 bg-primary/10 text-primary'
  }[item.status]
  return (
    <Badge className={`${tone} h-8 shrink-0 px-3 py-0`}>
      {item.status === 'completed' && <CheckCircle2 className="mr-2 h-4 w-4" />}
      {['downloading', 'converting'].includes(item.status) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {statusLabel(item.status)}
    </Badge>
  )
}

function UpdatePanel({
  status,
  onStatus,
  ytdlpStatus,
  onYtdlpStatus
}: {
  status: AppUpdateStatus
  onStatus: (status: AppUpdateStatus) => void
  ytdlpStatus: BinaryStatus
  onYtdlpStatus: (status: BinaryStatus) => void
}): JSX.Element {
  const [checking, setChecking] = useState(false)

  async function checkUpdate(): Promise<void> {
    setChecking(true)
    try {
      const nextYtdlp = await window.oliver.checkYtdlpUpdate()
      onYtdlpStatus(nextYtdlp)
      if (!nextYtdlp.ytdlpPath) {
        onStatus({
          ...status,
          state: 'error',
          progress: null,
          message: 'Não foi possível preparar o motor de download.'
        })
        return
      }

      const next = await window.oliver.checkForAppUpdate()
      onStatus(next)
      if (next.state === 'available') {
        onStatus(await window.oliver.downloadAppUpdate())
      }
    } finally {
      setChecking(false)
    }
  }

  async function installUpdate(): Promise<void> {
    onStatus(await window.oliver.installAppUpdate())
  }

  const canInstall = status.state === 'downloaded'
  const busy = checking || status.state === 'checking' || status.state === 'downloading'

  return (
    <div className="binary-panel">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
        <Terminal className="h-3.5 w-3.5" />
        Atualizações
      </div>
      <p className="mt-3 text-sm font-semibold">{status.message}</p>
      {status.progress != null && status.state === 'downloading' && <Progress className="mt-3" value={status.progress} />}
      <Button className="mt-3 w-full" size="sm" variant={canInstall ? 'default' : 'secondary'} onClick={canInstall ? installUpdate : checkUpdate} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        {canInstall ? 'Instalar atualização' : busy ? 'Verificando...' : 'Verificar atualização'}
      </Button>
      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer hover:underline">Mostrar detalhes</summary>
        <div className="mt-2 grid gap-1 break-all font-mono">
          <span>App: {status.currentVersion}</span>
          <span>Última versão: {status.latestVersion ?? 'não checada'}</span>
          <span>yt-dlp: {ytdlpStatus.ytdlpVersion ?? 'não detectado'}</span>
        </div>
      </details>
    </div>
  )
}

function PageTitle({ title, detail }: { title: string; detail: string }): JSX.Element {
  return (
    <div>
      <h2 className="text-3xl font-black tracking-tight">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 rounded-md border border-border bg-secondary/40 p-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all font-mono text-xs">{value}</span>
    </div>
  )
}

function Thumb({ url, small = false }: { url: string | null; small?: boolean }): JSX.Element {
  if (!url) {
    return (
      <div className={cn('thumb bg-secondary', small ? 'h-16 w-24' : 'h-24 w-40')}>
        <Video className="h-6 w-6 text-muted-foreground" />
      </div>
    )
  }
  return <img className={cn('thumb object-cover', small ? 'h-16 w-24' : 'h-24 w-40')} src={url} alt="" />
}

function ErrorBox({ message }: { message: string }): JSX.Element {
  return (
    <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4" />
      {message}
    </div>
  )
}

function upsertDownload(items: DownloadItem[], item: DownloadItem): DownloadItem[] {
  const exists = items.some((candidate) => candidate.id === item.id)
  const next = exists ? items.map((candidate) => (candidate.id === item.id ? item : candidate)) : [item, ...items]
  return next.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

function shouldShowInQueue(item: DownloadItem): boolean {
  if (['pending', 'analyzing', 'downloading', 'converting'].includes(item.status)) return true
  if (item.status !== 'completed' || !item.completedAt) return false

  const completedAt = new Date(item.completedAt).getTime()
  if (!Number.isFinite(completedAt)) return false

  return Date.now() - completedAt < 24 * 60 * 60 * 1000
}

async function openDirectory(path: string): Promise<void> {
  if (typeof window.oliver.openDirectory === 'function') {
    await window.oliver.openDirectory(path)
    return
  }

  const legacyApi = window.oliver as typeof window.oliver & {
    revealPath?: (path: string) => Promise<void>
  }

  if (typeof legacyApi.revealPath === 'function') {
    await legacyApi.revealPath(path)
    return
  }

  throw new Error('Reinicie o app para carregar os novos botões de abrir pasta e reproduzir.')
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Algo deu errado.'
}
